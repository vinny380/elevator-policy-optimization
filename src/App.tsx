import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Building } from './Building';
import { Chart } from './Chart';
import { ComparisonPanel } from './ComparisonPanel';
import { PddlInspector } from './PddlInspector';
import { controllerAction, policyName, type SavedPolicy, type Controller } from './comparison';
import { defaults, floorLabel, learningDefaults, Simulation, type Config, type Learning, type Pattern } from './engine';
import { neuralDefaults, type NeuralSettings } from './learning';
import { ALGORITHM_NAMES, type Algorithm, type Policy } from './policy';
import { referencePolicies } from './reference';
import type { Checkpoint, Point, TrainingMessage } from './training.worker';

const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });
function Range({ label, value, min, max, step = 1, suffix = '', onChange, hint }: { label: string; value: number; min: number; max: number; step?: number; suffix?: string; onChange: (v: number) => void; hint?: string }) {
  return <label className="range-field"><span><span>{label}</span><output>{value}{suffix}</output></span><input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))} style={{ '--fill': `${(value - min) / (max - min) * 100}%` } as React.CSSProperties} />{hint && <small>{hint}</small>}</label>;
}
function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="control-section"><h3>{title}</h3>{children}</section>;
}
const icons = {
  play: <path d="m9 5 11 7-11 7Z" />,
  pause: <><path d="M8 5v14M16 5v14" /></>,
  reset: <><path d="M3 10a9 9 0 1 1 2 8M3 4v6h6" /></>,
  settings: <><path d="M4 7h16M4 17h16" /><circle cx="9" cy="7" r="3" /><circle cx="15" cy="17" r="3" /></>,
  chart: <><path d="M4 4v16h16M8 15l4-6 4 3 4-7" /></>,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  camera: <><path d="M8 4H4v4M16 4h4v4M4 16v4h4M20 16v4h-4" /><circle cx="12" cy="12" r="3" /></>,
  arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
};
function Icon({ name }: { name: keyof typeof icons }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{icons[name]}</svg>;
}
type Panel = 'settings' | 'learning' | 'comparison' | 'planner';
export function App() {
  const [config, setConfig] = useState<Config>({ ...defaults, enabled: [...defaults.enabled] });
  const [sim, setSim] = useState(() => new Simulation(defaults));
  const [, setTick] = useState(0);
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState(4);
  const [controller, setController] = useState<Controller>('predictive');
  const [learning, setLearning] = useState<Learning>(learningDefaults);
  const [algorithm, setAlgorithm] = useState<Algorithm>('ddqn');
  const [neural, setNeural] = useState<NeuralSettings>(neuralDefaults);
  const [policies, setPolicies] = useState<SavedPolicy[]>(() => referencePolicies(defaults));
  const [phase, setPhase] = useState('Learning');
  const [trainingDetails, setTrainingDetails] = useState({ updates: 0, pretraining: 0 });
  const [running, setRunning] = useState(false);
  const [points, setPoints] = useState<Point[]>([]);
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [best, setBest] = useState<Checkpoint | null>(null);
  const [selectedCheckpoint, setSelectedCheckpoint] = useState<number | null>(null);
  const [stats, setStats] = useState({ episodes: 0, decisions: 0, states: 0 });
  const [notice, setNotice] = useState('');
  const [selectedPerson, setSelectedPerson] = useState<number | null>(null);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [cameraReset, setCameraReset] = useState(0);
  const workerRef = useRef<Worker | null>(null);
  const trainingStarted = useRef(false);
  const qRef = useRef<Policy>({ algorithm: 'tabular', q: {} });
  const previousConfig = useRef(config);
  const dialog = useRef<HTMLDialogElement>(null);
  const [qVersion, setQVersion] = useState<number | null>(null);
  useEffect(() => {
    const worker = new Worker(new URL('./training.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker; trainingStarted.current = false; setPhase('Learning'); setTrainingDetails({ updates: 0, pretraining: 0 });
    worker.onmessage = ({ data }: MessageEvent<TrainingMessage>) => {
      if (data.type === 'error') { setNotice(data.message); setRunning(false); return; }
      setPhase(data.phase); setTrainingDetails({ updates: data.updates, pretraining: data.pretraining });
      setStats({ episodes: data.episodes, decisions: data.decisions, states: data.states });
      // Keep a bounded set of real snapshots; every plotted point remains replayable.
      setPoints(prev => [...prev, data.point].slice(-100));
      setCheckpoints(prev => [...prev, data.checkpoint].slice(-100));
      const id = `${algorithm}-${algorithm === 'ppo' ? neural.pretrain : 0}-${neural.seed}-${neural.variedTraffic}`;
      setPolicies(prev => {
        const previous = prev.find(p => p.id === id);
        if (previous && previous.score >= data.checkpoint.score) return prev;
        const saved: SavedPolicy = { id, name: policyName(data.checkpoint.policy, neural.seed, neural.pretrain), policy: data.checkpoint.policy, episode: data.episodes, score: data.checkpoint.score, seed: neural.seed, learning: data.checkpoint.learning, neural: data.checkpoint.neural };
        return [...prev.filter(p => p.id !== id), saved].slice(-12);
      });
      setBest(prev => !prev || data.checkpoint.score > prev.score ? data.checkpoint : prev);
    };
    worker.onerror = () => { setNotice('Training worker failed. Restart training to retry.'); setRunning(false); };
    setSim(new Simulation(config)); setPoints([]); setCheckpoints([]); setBest(null); setStats({ episodes: 0, decisions: 0, states: 0 });
    setRunning(false); setSelectedCheckpoint(null); qRef.current = { algorithm: 'tabular', q: {} }; setQVersion(null); setController('predictive'); setSelectedPerson(null);
    if (previousConfig.current !== config) { setPolicies(referencePolicies(config)); setNotice('New experiment; training and replay reset. Previous scores cleared.'); }
    previousConfig.current = config;
    return () => { worker.terminate(); workerRef.current = null; };
  }, [config, algorithm, neural.seed, neural.pretrain, neural.variedTraffic]);
  useEffect(() => {
    let frame = 0, last = performance.now(), accumulated = 0, rendered = 0;
    const animate = (now: number) => {
      const dt = Math.min(0.25, (now - last) / 1000); last = now;
      if (!paused) {
        accumulated += dt * speed;
        while (accumulated >= 1) { sim.step(controllerAction(sim, controller, qRef.current)); accumulated--; }
        if (now - rendered > 100) { setTick(t => t + 1); rendered = now; }
      }
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate); return () => cancelAnimationFrame(frame);
  }, [sim, paused, speed, controller]);
  useEffect(() => { if (panel) dialog.current?.showModal(); else dialog.current?.close(); }, [panel]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || event.repeat || panel || !(event.target instanceof HTMLElement) || event.target.closest('input, select, textarea, button, a, summary, [contenteditable]')) return;
      event.preventDefault(); setPaused(value => !value);
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [panel]);
  function change(partial: Partial<Config>) { setConfig(prev => ({ ...prev, ...partial })); }
  function fleet(count: number) {
    const enabled = [...config.enabled];
    if (!enabled.slice(0, count).some(Boolean)) enabled[0] = true;
    change({ cars: count, enabled });
  }
  function toggleCar(id: number) {
    const enabled = [...config.enabled]; enabled[id] = !enabled[id];
    if (!enabled.slice(0, config.cars).some(Boolean)) { setNotice('Keep one car in service so passengers can reach their destinations.'); return; }
    change({ enabled });
  }
  function replay(which: Controller = controller) { setSim(new Simulation(config)); setController(which); setPaused(false); setNotice(`Replaying seed ${config.seed} with ${which === 'learned' ? `checkpoint ${qVersion}` : which === 'pddl' ? 'PDDL stop planning' : which === 'predictive' ? 'predictive rollouts' : 'selective collective (LOOK)'}.`); }
  function chooseCheckpoint(episode: number) {
    const checkpoint = best?.episode === episode ? best : checkpoints.find(c => c.episode === episode); if (!checkpoint) return;
    qRef.current = checkpoint.policy; setSelectedCheckpoint(episode); setQVersion(episode);
    setSim(new Simulation(config)); setController('learned'); setPaused(false); setNotice(`Checkpoint ${fmt(episode)} loaded. Replaying the same passenger arrivals.`);
  }
  function train() {
    if (running) { workerRef.current?.postMessage({ type: 'pause' }); setRunning(false); return; }
    workerRef.current?.postMessage({ type: trainingStarted.current ? 'resume' : 'start', config, learning, algorithm, neural }); trainingStarted.current = true; setRunning(true);
    setNotice('Training runs in the background. Select a checkpoint to watch the policy.');
  }
  function changeLearning(partial: Partial<Learning>) {
    if (running) { workerRef.current?.postMessage({ type: 'pause' }); setRunning(false); }
    setLearning(prev => ({ ...prev, ...partial })); setNotice('Training paused. Resume to apply the new learning settings.');
  }
  function changeNeural(partial: Partial<NeuralSettings>) {
    if (running) { workerRef.current?.postMessage({ type: 'pause' }); setRunning(false); }
    setNeural(prev => ({ ...prev, ...partial })); setNotice('Training paused. Resume to apply settings. Seed, traffic or warm-start changes begin a new run.');
  }
  function watchSaved(which: Controller, id: string) {
    if (which === 'learned') {
      const saved = policies.find(p => p.id === id); if (!saved) return;
      qRef.current = saved.policy; setQVersion(saved.episode); setSelectedCheckpoint(null);
      setSim(new Simulation(config)); setController('learned'); setPaused(false);
      setNotice(`Replaying ${saved.name}, episode ${saved.episode}.`);
    } else replay(which);
    setPanel(null);
  }
  const metrics = sim.metrics();
  const active = config.enabled.slice(0, config.cars).filter(Boolean).length;
  const latest = points.at(-1);
  const availableCheckpoints = best && !checkpoints.some(c => c.episode === best.episode) ? [best, ...checkpoints] : checkpoints;
  const person = selectedPerson === null ? null : sim.people[selectedPerson];
  const clock = `${String(Math.floor(sim.time / 60)).padStart(2, '0')}:${String(sim.time % 60).padStart(2, '0')}`;
  return <main className="game" aria-label="Elevator Policy Optimization">
    <Building simulation={sim} onSelect={setSelectedPerson} resetToken={cameraReset} />
    <div className="scene-vignette" />
    <header className="hud-header">
      <div className="identity"><span className="identity-mark" aria-hidden="true">↑↓</span><div><h1>Toronto</h1><p>Bisha · 88 Blue Jays Way</p></div></div>
      <nav className="policy-switch glass" aria-label="Elevator controller">
        <button aria-pressed={controller === 'collective'} onClick={() => replay('collective')}>LOOK</button>
        <button aria-pressed={controller === 'learned'} onClick={() => { if (best) chooseCheckpoint(best.episode); else if (qVersion !== null) replay('learned'); else if (policies.length) watchSaved('learned', policies.at(-1)!.id); else { setPanel('learning'); setNotice('Train a policy to unlock RL playback.'); } }}>RL{!best && qVersion === null && !policies.length && <span className="untrained-dot" aria-label="Not trained" />}</button>
        <button aria-pressed={controller === 'predictive'} onClick={() => replay('predictive')}>Plan</button>
        <button aria-pressed={controller === 'pddl'} onClick={() => replay('pddl')}>PDDL</button>
      </nav>
      <div className="hud-tools"><button className="icon-button glass" title="Compare algorithms" aria-label="Compare algorithms" onClick={() => { workerRef.current?.postMessage({ type: 'pause' }); setRunning(false); setPanel('comparison'); }}><Icon name="chart" /></button><button className="icon-button glass" title="Building settings" aria-label="Building settings" onClick={() => setPanel('settings')}><Icon name="settings" /></button></div>
    </header>
    <section className="live-stats" aria-label="Live statistics">
      <div><strong>{Math.round(metrics.meanWait)}<small>s</small></strong><span>Avg. wait</span></div>
      <div><strong>{metrics.waiting}</strong><span>Waiting</span></div>
      <div><strong>{metrics.delivered}</strong><span>Arrived</span></div>
    </section>
    <aside className="learning-hud glass" aria-label={controller === 'pddl' ? 'Planner' : 'Learning progress'}>
      {controller === 'pddl' ? <>
        <div className="hud-card-title"><span><i className="status-dot" /> PDDL planner</span><button className="icon-button" title="Inspect PDDL" aria-label="Inspect PDDL" onClick={() => setPanel('planner')}><Icon name="arrow" /></button></div>
        <div className="next-stop"><span>Next stop</span><strong>{sim.lastPlan?.firstStop ? floorLabel(sim.lastPlan.firstStop.floor) : '—'}</strong></div>
        <p className="hud-caption">{sim.lastPlan ? `${sim.lastPlan.stops.length} stops · ${sim.lastPlan.cost.toFixed(2)} estimated cost` : 'Waiting for a call'}</p>
        <button className="text-button" onClick={() => setPanel('planner')}>View plan <Icon name="arrow" /></button>
      </> : <>
        <div className="hud-card-title"><span><i className={`status-dot ${running ? 'running' : ''}`} /> {running ? phase : ALGORITHM_NAMES[algorithm]}</span><button className="icon-button" title="Learning settings and checkpoints" aria-label="Learning settings and checkpoints" onClick={() => setPanel('learning')}><Icon name="settings" /></button></div>
        <div className="reward-summary"><strong title="Evaluation score · higher is better">{latest ? latest.evaluation.toFixed(2) : '—'}</strong><span>{stats.episodes ? `${fmt(stats.episodes)} episodes` : 'Ready to train'}</span></div>
        <Chart points={points} selected={selectedCheckpoint} onSelect={chooseCheckpoint} />
        {latest && <div className="score-key"><span><i />Latest</span><span>Best {best?.score.toFixed(2)}</span><span>LOOK {latest.baseline.toFixed(2)}</span></div>}
        <button className="primary-button" onClick={train}><Icon name={running ? 'pause' : 'play'} />{running ? 'Pause training' : stats.episodes ? 'Resume training' : 'Train a policy'}</button>
        {best && <button className="text-button replay-best" onClick={() => chooseCheckpoint(best.episode)}>Replay best <Icon name="arrow" /></button>}
      </>}
    </aside>
    <div className="world-info"><span className="world-status"><i className={`status-dot ${active < config.cars ? 'warning' : ''}`} />{active} of {config.cars} elevators online</span><span>{config.floors} simulated floors · G · P1–P5</span>{controller === 'learned' && <span>{ALGORITHM_NAMES[qRef.current.algorithm]} · checkpoint {qVersion}</span>}</div>
    {person && <section className="passenger-card glass" aria-label="Selected passenger"><button className="icon-button" aria-label="Close passenger" onClick={() => setSelectedPerson(null)}><Icon name="close" /></button><span>{person.id === 1 && config.pattern === 'night' ? 'You' : `Passenger ${person.id + 1}`}</span><strong>{floorLabel(person.from)} <span>→</span> {floorLabel(person.to)}</strong><p>{person.delivered !== null ? 'Arrived' : person.boarded !== null ? `In elevator ${String.fromCharCode(65 + person.car!)}` : 'Waiting'} · {Math.round((person.boarded ?? sim.time) - person.arrived)}s wait</p></section>}
    <div className="playback-dock glass" role="group" aria-label="Playback controls">
      <button className="icon-button play-toggle" onClick={() => setPaused(value => !value)} title={paused ? 'Play (Space)' : 'Pause (Space)'} aria-label={paused ? 'Play simulation' : 'Pause simulation'}><Icon name={paused ? 'play' : 'pause'} /></button>
      <span className="sim-time">{clock}</span><span className="dock-divider" />
      <button className="speed-button" aria-label={`Playback speed ${speed} times. Click to change.`} onClick={() => setSpeed(value => value === 1 ? 4 : value === 4 ? 16 : 1)}>{speed}×</button>
      <button className="icon-button" title="Restart simulation" aria-label="Restart simulation" onClick={() => replay()}><Icon name="reset" /></button>
      <button className="icon-button" title="Reset camera" aria-label="Reset camera" onClick={() => setCameraReset(value => value + 1)}><Icon name="camera" /></button>
    </div>
    <div className="map-credit"><span>Select Bisha to focus · scroll to explore</span><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a><a href="/toronto/README.md" target="_blank" rel="noreferrer">Model & sources</a></div>
    <div className={`notice glass ${notice ? 'visible' : ''}`} role="status">{notice}</div>
    <dialog ref={dialog} className={`game-dialog ${panel === 'comparison' ? 'wide-dialog' : ''}`} aria-labelledby="panel-title" onCancel={() => setPanel(null)} onClick={event => { if (event.target === dialog.current) { const rect = dialog.current.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) setPanel(null); } }}>
      <header className="dialog-header"><h2 id="panel-title">{panel === 'settings' ? 'Building' : panel === 'learning' ? 'Learning' : panel === 'comparison' ? 'Compare policies' : 'PDDL plan'}</h2><button className="icon-button" autoFocus aria-label="Close panel" onClick={() => setPanel(null)}><Icon name="close" /></button></header>
      <div className="dialog-content">
        {notice && <p className="panel-notice" role="status">{notice}</p>}
        {panel === 'settings' && <>
          <Section title="Elevators"><div className="fleet-picker" role="group" aria-label="Number of elevators">{[1, 2, 3, 4, 5].map(n => <button key={n} aria-pressed={config.cars === n} onClick={() => fleet(n)}>{n}</button>)}</div><div className="car-toggles">{config.enabled.slice(0, config.cars).map((enabled, id) => <button key={id} aria-pressed={enabled} aria-label={`Elevator ${String.fromCharCode(65 + id)} ${enabled ? 'online' : 'offline'}`} onClick={() => toggleCar(id)}><span className={`status-dot ${enabled ? '' : 'warning'}`} />{String.fromCharCode(65 + id)}<small>{enabled ? 'Online' : 'Offline'}</small></button>)}</div></Section>
          <Section title="Building & traffic"><Range label="Floors" value={config.floors} min={10} max={40} onChange={floors => change({ floors })} /><label className="select-label">Traffic<select value={config.pattern} onChange={event => change({ pattern: event.target.value as Pattern })}><option value="night">Late night</option><option value="morning">Morning rush</option><option value="evening">Evening rush</option><option value="mixed">Between floors</option></select></label><Range label="Arrivals" value={config.demand} min={1} max={30} suffix=" / min" onChange={demand => change({ demand })} /></Section>
          <details><summary>Car specifications</summary><Range label="Capacity" value={config.capacity} min={2} max={16} onChange={capacity => change({ capacity })} /><Range label="Travel speed" value={config.speed} min={0.5} max={3} step={0.25} suffix=" fl/s" onChange={speed => change({ speed })} /><Range label="Door dwell" value={config.doors} min={2} max={10} suffix="s" onChange={doors => change({ doors })} /><label className="select-label">Seed<input aria-label="Random seed" type="number" min={1} max={999999} value={config.seed} onChange={event => { const seed = Number(event.target.value); if (Number.isInteger(seed) && seed >= 1 && seed <= 999999) change({ seed }); }} /></label></details>
          <details><summary>Follow a passenger</summary><label className="select-label">Passenger<select aria-label="Passenger to follow" value={selectedPerson ?? ''} onChange={event => { setSelectedPerson(Number(event.target.value)); setPanel(null); }}><option value="" disabled>Select a passenger</option>{sim.people.map(p => <option key={p.id} value={p.id}>{p.id === 1 && config.pattern === 'night' ? 'You' : `Passenger ${p.id + 1}`} · {floorLabel(p.from)} → {floorLabel(p.to)}</option>)}</select></label></details>
          <button className="secondary-button" onClick={() => setConfig({ ...defaults, enabled: [...defaults.enabled] })}>Restore original scenario</button><p className="field-note">Building changes reset training and replay.</p>
          <details><summary>Toronto model</summary><p>Real OpenStreetMap street and building footprints from Blue Jays Way to the CN Tower and Rogers Centre. Bisha’s glass tower, heritage podium and rooftop terrace, the CN Tower, and the stadium are modelled in 3D. Neighbouring heights use mapped heights or storey counts; missing heights are estimated.</p><p>The exterior represents the 44-storey Bisha tower. The elevator cutaway uses your configurable simulation floors and an illustrative layout, not architectural plans. This is a geographic model, not a photogrammetric scan.</p><a href="/toronto/README.md" target="_blank" rel="noreferrer">Map data, references & model assumptions ↗</a></details><details><summary>About the simulation</summary><p>Constant-speed travel, fixed door dwell, and no mid-flight route changes. Wait statistics include unserved passengers. This models the starting conditions of your late-night trip, not your building’s proprietary controller.</p><p>Double DQN and PPO choose legal stops from per-floor queues and car state. Tabular Q-learning remains a strategy-selection baseline. Predictive planning samples independent future traffic. PDDL optimizes a bounded approximation of passenger costs; full temporal planning remains on the roadmap.</p><a href="https://github.com/vinny380/elevator-policy-optimization" target="_blank" rel="noreferrer">Source & methodology ↗</a></details>
        </>}
        {panel === 'learning' && <>
          <Section title="Algorithm"><label className="select-label">Learner<select value={algorithm} onChange={e => setAlgorithm(e.target.value as Algorithm)}>{Object.entries(ALGORITHM_NAMES).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
          {algorithm === 'ppo' && <label className="select-label">Warm start<select value={neural.pretrain} onChange={e => changeNeural({ pretrain: Number(e.target.value) })}><option value={0}>Learn from scratch</option><option value={20}>Imitate LOOK · 20 episodes</option><option value={100}>Imitate LOOK · 100 episodes</option></select></label>}
          <label className="select-label">Training traffic<select value={neural.variedTraffic ? 'varied' : 'current'} onChange={e => changeNeural({ variedTraffic: e.target.value === 'varied' })}><option value="varied">Varied traffic + service levels</option><option value="current">Current scenario only</option></select></label>
          <label className="select-label">Training seed<input type="number" min={1} max={999999} value={neural.seed} onChange={e => { const seed = Number(e.target.value); if (Number.isInteger(seed) && seed >= 1 && seed <= 999999) changeNeural({ seed }); }} /></label>
          <p className="field-note">Changing learner or seed starts a new run. Best policies from the last 12 runs stay in Compare until the building or reward changes.</p></Section>
          <Chart points={points} selected={selectedCheckpoint} onSelect={chooseCheckpoint} /><div className="learning-totals"><div><strong>{fmt(stats.episodes)}</strong><span>Episodes</span></div><div><strong>{fmt(stats.decisions)}</strong><span>Choices</span></div><div><strong>{fmt(stats.states)}</strong><span>{algorithm === 'tabular' ? 'States' : 'Parameters'}</span></div></div>
          <Section title="Checkpoints"><label className="select-label">Replay<select disabled={!checkpoints.length} value={selectedCheckpoint ?? ''} onChange={event => chooseCheckpoint(Number(event.target.value))}><option value="" disabled>{checkpoints.length ? 'Select a policy' : 'Train to create checkpoints'}</option>{selectedCheckpoint !== null && !availableCheckpoints.some(c => c.episode === selectedCheckpoint) && <option value={selectedCheckpoint}>Episode {fmt(selectedCheckpoint)} · loaded</option>}{availableCheckpoints.map(c => <option value={c.episode} key={c.episode}>Episode {fmt(c.episode)} · {c.score.toFixed(2)}{c.episode === best?.episode ? ' · best' : ''}</option>)}</select></label>{best && <p className="field-note">{fmt(stats.episodes - best.episode)} episodes since the best score. {latest && best.score < latest.baseline ? 'Best still trails LOOK.' : 'Best matches or beats LOOK on evaluation seeds.'}</p>}<button className="primary-button" onClick={train}><Icon name={running ? 'pause' : 'play'} />{running ? 'Pause training' : stats.episodes ? 'Resume training' : 'Train a policy'}</button></Section>
          <Section title="Reward"><Range label="Waiting time" value={config.waitWeight} min={0} max={4} step={0.25} onChange={waitWeight => change({ waitWeight })} /><Range label="Long waits" value={config.tailWeight} min={0} max={4} step={0.25} onChange={tailWeight => change({ tailWeight })} /><Range label="Time inside car" value={config.rideWeight} min={0} max={4} step={0.25} onChange={rideWeight => change({ rideWeight })} /><p className="field-note">Reward changes start a fresh experiment.</p></Section>
          <details><summary>Learning parameters</summary>
            {algorithm !== 'ppo' && <Range label="Exploration ε" value={learning.epsilon} min={0} max={1} step={0.05} onChange={epsilon => changeLearning({ epsilon })} />}
            {algorithm === 'tabular' ? <Range label="Learning rate α" value={learning.alpha} min={0.01} max={1} step={0.01} onChange={alpha => changeLearning({ alpha })} /> : <>
              <Range label="Learning rate" value={neural.rate} min={0.0001} max={0.003} step={0.0001} onChange={rate => changeNeural({ rate })} />
              <label className="select-label">Batch size<select value={neural.batch} onChange={e => changeNeural({ batch: Number(e.target.value) })}>{[16, 32, 64].map(n => <option key={n}>{n}</option>)}</select></label>
              {algorithm === 'ddqn' ? <Range label="Target sync" value={neural.targetEvery} min={10} max={500} step={10} suffix=" updates" onChange={targetEvery => changeNeural({ targetEvery })} /> : <><Range label="PPO clip" value={neural.clip} min={0.05} max={0.4} step={0.05} onChange={clip => changeNeural({ clip })} /><Range label="Entropy bonus" value={neural.entropy} min={0} max={0.1} step={0.005} onChange={entropy => changeNeural({ entropy })} /><Range label="Update epochs" value={neural.epochs} min={1} max={8} onChange={epochs => changeNeural({ epochs })} /></>}
              <p className="field-note">{fmt(trainingDetails.updates)} optimizer updates · {trainingDetails.pretraining} imitation episodes. PPO samples its policy during training; replay uses its highest-probability legal action.</p>
            </>}
            <Range label="Discount γ" value={learning.gamma} min={0} max={1} step={0.01} onChange={gamma => changeLearning({ gamma })} hint="Per second. 1 values the entire episode equally." />
          </details>
          <details><summary>What the learner sees</summary><p>Each legal stop’s distance, direction, queue count and age, available capacity, passed destinations, and nearby cars; fleet load and traffic context. One scorer shares what it learns across floors. LOOK’s recommendation is an explicit input, not a hidden fallback. Waiting destinations and future arrivals are hidden. Queue counts and ages assume simulated sensors, not just physical hall buttons.</p><p>Neural policies choose a legal next stop for one ready car at a time, sharing one stop-scoring network and a separate value network. Double DQN uses replay, a target network, and separate value/advantage outputs. PPO uses clipped policy updates, a value estimate, entropy, and duration-aware advantages. Its optional warm start imitates LOOK choices; it does not reproduce the literature’s pickup-time pretraining.</p></details>
          <details><summary>How scores work</summary><p>Higher is better: negative waiting, long-wait, and ride cost per passenger. Six-minute episodes; {neural.variedTraffic ? 'up to 32 fixed evaluation trials across traffic and service levels' : 'four fixed evaluation seeds'}, with exploration off. Best can overfit those seeds—use Compare to test separate traffic.</p><p>The graph retains 100 checkpoints plus the best-ever policy. Imitation episodes are included in the episode count; the cyan curve always measures the learned policy with exploration off. Replay uses the building seed. Training stays in this tab; reload clears it.</p></details>
          <button className="secondary-button" disabled={!stats.episodes} onClick={() => setConfig(prev => ({ ...prev }))}>Restart from scratch</button><p className="field-note">Clears checkpoints. Keeps your settings.</p>
        </>}
        {panel === 'comparison' && <ComparisonPanel config={config} policies={policies} checkpoint={qVersion} onWatch={watchSaved} />}
        {panel === 'planner' && <PddlInspector plan={sim.lastPlan} fallbacks={sim.plannerFallbacks} />}
      </div>
    </dialog>
  </main>;
}
