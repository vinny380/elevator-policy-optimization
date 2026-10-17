import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Building } from './Building';
import { Chart } from './Chart';
import { ComparisonPanel } from './ComparisonPanel';
import { PddlInspector } from './PddlInspector';
import { controllerAction, type Controller } from './comparison';
import { defaults, floorLabel, learningDefaults, Simulation, type Config, type Learning, type QTable, type Pattern } from './engine';
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
  const [controller, setController] = useState<Controller>('collective');
  const [learning, setLearning] = useState<Learning>(learningDefaults);
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
  const qRef = useRef<QTable>({});
  const previousConfig = useRef(config);
  const dialog = useRef<HTMLDialogElement>(null);
  const [qVersion, setQVersion] = useState<number | null>(null);
  useEffect(() => {
    const worker = new Worker(new URL('./training.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;
    worker.onmessage = ({ data }: MessageEvent<TrainingMessage>) => {
      if (data.type === 'error') { setNotice(data.message); setRunning(false); return; }
      setStats({ episodes: data.episodes, decisions: data.decisions, states: data.states });
      // Keep a bounded set of real snapshots; every plotted point remains replayable.
      setPoints(prev => [...prev, data.point].slice(-100));
      setCheckpoints(prev => [...prev, data.checkpoint].slice(-100));
      setBest(prev => !prev || data.checkpoint.score > prev.score ? data.checkpoint : prev);
    };
    worker.onerror = () => { setNotice('Training worker failed. Restart training to retry.'); setRunning(false); };
    setSim(new Simulation(config)); setPoints([]); setCheckpoints([]); setBest(null); setStats({ episodes: 0, decisions: 0, states: 0 });
    setRunning(false); setSelectedCheckpoint(null); qRef.current = {}; setQVersion(null); setController('collective'); setSelectedPerson(null);
    if (previousConfig.current !== config) { setNotice('New experiment; training and replay reset. Previous scores cleared.'); }
    previousConfig.current = config;
    return () => { worker.terminate(); workerRef.current = null; };
  }, [config]);
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
  function replay(which: Controller = controller) { setSim(new Simulation(config)); setController(which); setPaused(false); setNotice(`Replaying seed ${config.seed} with ${which === 'learned' ? `checkpoint ${qVersion}` : which === 'pddl' ? 'PDDL stop planning' : 'selective collective (LOOK)'}.`); }
  function chooseCheckpoint(episode: number) {
    const checkpoint = best?.episode === episode ? best : checkpoints.find(c => c.episode === episode); if (!checkpoint) return;
    qRef.current = checkpoint.q; setSelectedCheckpoint(episode); setQVersion(episode);
    setSim(new Simulation(config)); setController('learned'); setPaused(false); setNotice(`Checkpoint ${fmt(episode)} loaded. Replaying the same passenger arrivals.`);
  }
  function train() {
    if (running) { workerRef.current?.postMessage({ type: 'pause' }); setRunning(false); return; }
    workerRef.current?.postMessage({ type: stats.episodes ? 'resume' : 'start', config, learning }); setRunning(true);
    setNotice('Training runs in the background. Select a checkpoint to watch the policy.');
  }
  function changeLearning(partial: Partial<Learning>) {
    if (running) { workerRef.current?.postMessage({ type: 'pause' }); setRunning(false); }
    setLearning(prev => ({ ...prev, ...partial })); setNotice('Training paused. Resume to apply the new learning settings.');
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
      <div className="identity"><span className="identity-mark" aria-hidden="true">↑↓</span><div><h1>Elevator</h1><p>Policy optimization</p></div></div>
      <nav className="policy-switch glass" aria-label="Elevator controller">
        <button aria-pressed={controller === 'collective'} onClick={() => replay('collective')}>LOOK</button>
        <button aria-pressed={controller === 'learned'} onClick={() => { if (best) chooseCheckpoint(best.episode); else { setPanel('learning'); setNotice('Train a policy to unlock RL playback.'); } }}>RL{!best && <span className="untrained-dot" aria-label="Not trained" />}</button>
        <button aria-pressed={controller === 'pddl'} onClick={() => replay('pddl')}>PDDL</button>
      </nav>
      <div className="hud-tools"><button className="icon-button glass" title="Compare algorithms" aria-label="Compare algorithms" onClick={() => setPanel('comparison')}><Icon name="chart" /></button><button className="icon-button glass" title="Building settings" aria-label="Building settings" onClick={() => setPanel('settings')}><Icon name="settings" /></button></div>
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
        <p className="hud-caption">{sim.lastPlan ? `${sim.lastPlan.stops.length} stops · ${sim.lastPlan.cost}s planned route` : 'Waiting for a call'}</p>
        <button className="text-button" onClick={() => setPanel('planner')}>View plan <Icon name="arrow" /></button>
      </> : <>
        <div className="hud-card-title"><span><i className={`status-dot ${running ? 'running' : ''}`} /> {running ? 'Learning' : 'Reinforcement learning'}</span><button className="icon-button" title="Learning settings and checkpoints" aria-label="Learning settings and checkpoints" onClick={() => setPanel('learning')}><Icon name="settings" /></button></div>
        <div className="reward-summary"><strong title="Evaluation score · higher is better">{latest ? latest.evaluation.toFixed(2) : '—'}</strong><span>{stats.episodes ? `${fmt(stats.episodes)} episodes` : 'Ready to train'}</span></div>
        <Chart points={points} selected={selectedCheckpoint} onSelect={chooseCheckpoint} />
        {latest && <div className="score-key"><span><i />Latest</span><span>Best {best?.score.toFixed(2)}</span><span>LOOK {latest.baseline.toFixed(2)}</span></div>}
        <button className="primary-button" onClick={train}><Icon name={running ? 'pause' : 'play'} />{running ? 'Pause training' : stats.episodes ? 'Resume training' : 'Train a policy'}</button>
        {best && <button className="text-button replay-best" onClick={() => chooseCheckpoint(best.episode)}>Replay best <Icon name="arrow" /></button>}
      </>}
    </aside>
    <div className="world-info"><span className="world-status"><i className={`status-dot ${active < config.cars ? 'warning' : ''}`} />{active} of {config.cars} elevators online</span><span>{config.floors} floors · G · P1–P5</span></div>
    {person && <section className="passenger-card glass" aria-label="Selected passenger"><button className="icon-button" aria-label="Close passenger" onClick={() => setSelectedPerson(null)}><Icon name="close" /></button><span>{person.id === 1 && config.pattern === 'night' ? 'You' : `Passenger ${person.id + 1}`}</span><strong>{floorLabel(person.from)} <span>→</span> {floorLabel(person.to)}</strong><p>{person.delivered !== null ? 'Arrived' : person.boarded !== null ? `In elevator ${String.fromCharCode(65 + person.car!)}` : 'Waiting'} · {Math.round((person.boarded ?? sim.time) - person.arrived)}s wait</p></section>}
    <div className="playback-dock glass" role="group" aria-label="Playback controls">
      <button className="icon-button play-toggle" onClick={() => setPaused(value => !value)} title={paused ? 'Play (Space)' : 'Pause (Space)'} aria-label={paused ? 'Play simulation' : 'Pause simulation'}><Icon name={paused ? 'play' : 'pause'} /></button>
      <span className="sim-time">{clock}</span><span className="dock-divider" />
      <button className="speed-button" aria-label={`Playback speed ${speed} times. Click to change.`} onClick={() => setSpeed(value => value === 1 ? 4 : value === 4 ? 16 : 1)}>{speed}×</button>
      <button className="icon-button" title="Restart simulation" aria-label="Restart simulation" onClick={() => replay()}><Icon name="reset" /></button>
      <button className="icon-button" title="Reset camera" aria-label="Reset camera" onClick={() => setCameraReset(value => value + 1)}><Icon name="camera" /></button>
    </div>
    <span className="camera-hint">Drag to orbit · scroll to zoom</span>
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
          <details><summary>About the simulation</summary><p>Constant-speed travel, fixed door dwell, and no mid-flight route changes. Wait statistics include unserved passengers. This models the starting conditions of your late-night trip, not your building’s proprietary controller.</p><p>RL selects among four routing strategies using approximate state bins and duration-aware Q-learning. PDDL plans up to six known stops with classical action costs. Full temporal planning remains on the roadmap.</p><a href="https://github.com/vinny380/elevator-policy-optimization" target="_blank" rel="noreferrer">Source & methodology ↗</a></details>
        </>}
        {panel === 'learning' && <>
          <Chart points={points} selected={selectedCheckpoint} onSelect={chooseCheckpoint} /><div className="learning-totals"><div><strong>{fmt(stats.episodes)}</strong><span>Episodes</span></div><div><strong>{fmt(stats.decisions)}</strong><span>Choices</span></div><div><strong>{fmt(stats.states)}</strong><span>States</span></div></div>
          <Section title="Checkpoints"><label className="select-label">Replay<select disabled={!checkpoints.length} value={selectedCheckpoint ?? ''} onChange={event => chooseCheckpoint(Number(event.target.value))}><option value="" disabled>{checkpoints.length ? 'Select a policy' : 'Train to create checkpoints'}</option>{selectedCheckpoint !== null && !availableCheckpoints.some(c => c.episode === selectedCheckpoint) && <option value={selectedCheckpoint}>Episode {fmt(selectedCheckpoint)} · loaded</option>}{availableCheckpoints.map(c => <option value={c.episode} key={c.episode}>Episode {fmt(c.episode)} · {c.score.toFixed(2)}{c.episode === best?.episode ? ' · best' : ''}</option>)}</select></label>{best && <p className="field-note">{fmt(stats.episodes - best.episode)} episodes since the best score. {latest && best.score < latest.baseline ? 'Best still trails LOOK.' : 'Best matches or beats LOOK on evaluation seeds.'}</p>}<button className="primary-button" onClick={train}><Icon name={running ? 'pause' : 'play'} />{running ? 'Pause training' : stats.episodes ? 'Resume training' : 'Train a policy'}</button></Section>
          <Section title="Reward"><Range label="Waiting time" value={config.waitWeight} min={0} max={4} step={0.25} onChange={waitWeight => change({ waitWeight })} /><Range label="Long waits" value={config.tailWeight} min={0} max={4} step={0.25} onChange={tailWeight => change({ tailWeight })} /><Range label="Time inside car" value={config.rideWeight} min={0} max={4} step={0.25} onChange={rideWeight => change({ rideWeight })} /><p className="field-note">Reward changes start a fresh experiment.</p></Section>
          <details><summary>Learning parameters</summary><Range label="Exploration ε" value={learning.epsilon} min={0} max={1} step={0.05} onChange={epsilon => changeLearning({ epsilon })} /><Range label="Learning rate α" value={learning.alpha} min={0.01} max={1} step={0.01} onChange={alpha => changeLearning({ alpha })} /><Range label="Discount γ" value={learning.gamma} min={0} max={1} step={0.01} onChange={gamma => changeLearning({ gamma })} hint="Per second. 1 values the entire episode equally." /></details>
          <details><summary>How scores work</summary><p>Higher is better: negative waiting, long-wait, and ride cost per passenger. Six-minute episodes; four fixed evaluation seeds with exploration off. Best can overfit those seeds—use Compare to test separate traffic.</p><p>The graph retains 100 checkpoints plus the best-ever policy. Replay uses the building seed. Training stays in this tab; reload clears it.</p></details>
          <button className="secondary-button" disabled={!stats.episodes} onClick={() => setConfig(prev => ({ ...prev }))}>Restart from scratch</button><p className="field-note">Clears checkpoints. Keeps your settings.</p>
        </>}
        {panel === 'comparison' && <ComparisonPanel config={config} q={qVersion === null ? null : qRef.current} checkpoint={qVersion} onWatch={which => { replay(which); setPanel(null); }} />}
        {panel === 'planner' && <PddlInspector plan={sim.lastPlan} fallbacks={sim.plannerFallbacks} />}
      </div>
    </dialog>
  </main>;
}
