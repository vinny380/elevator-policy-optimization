import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Building } from './Building';
import { Chart } from './Chart';
import { defaults, floorLabel, greedy, learningDefaults, Simulation, type Config, type Learning, type QTable, type Pattern } from './engine';
import type { Checkpoint, Point, TrainingMessage } from './training.worker';

const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });
function Range({ label, value, min, max, step = 1, suffix = '', onChange, hint }: { label: string; value: number; min: number; max: number; step?: number; suffix?: string; onChange: (v: number) => void; hint?: string }) {
  return <label className="range-field"><span><span>{label}</span><output>{value}{suffix}</output></span><input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))} style={{ '--fill': `${(value - min) / (max - min) * 100}%` } as React.CSSProperties} />{hint && <small>{hint}</small>}</label>;
}
function Section({ number, title, children }: { number: string; title: string; children: ReactNode }) {
  return <section className="control-section"><h2><span>{number}</span>{title}</h2>{children}</section>;
}
export function App() {
  const [config, setConfig] = useState<Config>({ ...defaults, enabled: [...defaults.enabled] });
  const [sim, setSim] = useState(() => new Simulation(defaults));
  const [, setTick] = useState(0);
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState(4);
  const [controller, setController] = useState<'collective' | 'learned'>('collective');
  const [learning, setLearning] = useState<Learning>(learningDefaults);
  const [running, setRunning] = useState(false);
  const [points, setPoints] = useState<Point[]>([]);
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [selectedCheckpoint, setSelectedCheckpoint] = useState<number | null>(null);
  const [stats, setStats] = useState({ episodes: 0, steps: 0, states: 0 });
  const [notice, setNotice] = useState('Start with the night that started it all.');
  const [selectedPerson, setSelectedPerson] = useState<number>(1);
  const [showMethod, setShowMethod] = useState(false);
  const [experiment, setExperiment] = useState(1);
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
      setStats({ episodes: data.episodes, steps: data.steps, states: data.states });
      // Keep a bounded set of real snapshots; every plotted point remains replayable.
      setPoints(prev => [...prev, data.point].slice(-100));
      setCheckpoints(prev => [...prev, data.checkpoint].slice(-100));
    };
    worker.onerror = () => { setNotice('Training worker failed. Restart training to retry.'); setRunning(false); };
    setSim(new Simulation(config)); setPoints([]); setCheckpoints([]); setStats({ episodes: 0, steps: 0, states: 0 });
    setRunning(false); setSelectedCheckpoint(null); qRef.current = {}; setQVersion(null); setController('collective'); setSelectedPerson(config.pattern === 'night' ? 1 : 0);
    if (previousConfig.current !== config) { setExperiment(n => n + 1); setNotice('Configuration changed. New experiment; previous scores cleared.'); }
    previousConfig.current = config;
    return () => { worker.terminate(); workerRef.current = null; };
  }, [config]);
  useEffect(() => {
    let frame = 0, last = performance.now(), accumulated = 0, rendered = 0;
    const animate = (now: number) => {
      const dt = Math.min(0.25, (now - last) / 1000); last = now;
      if (!paused) {
        accumulated += dt * speed;
        while (accumulated >= 1) { sim.step(controller === 'learned' ? greedy(qRef.current, sim.stateKey()) : 0); accumulated--; }
        if (now - rendered > 100) { setTick(t => t + 1); rendered = now; }
      }
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate); return () => cancelAnimationFrame(frame);
  }, [sim, paused, speed, controller]);
  useEffect(() => { if (showMethod) dialog.current?.showModal(); else dialog.current?.close(); }, [showMethod]);
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
  function replay(which = controller) { setSim(new Simulation(config)); setController(which); setPaused(false); setNotice(`Replaying seed ${config.seed} with ${which === 'learned' ? `checkpoint ${qVersion}` : 'collective control'}.`); }
  function chooseCheckpoint(episode: number) {
    const checkpoint = checkpoints.find(c => c.episode === episode); if (!checkpoint) return;
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
  const best = checkpoints.reduce<Checkpoint | undefined>((a, b) => !a || b.score > a.score ? b : a, undefined);
  const person = sim.people[selectedPerson];
  const clock = `${String(Math.floor(sim.time / 60)).padStart(2, '0')}:${String(sim.time % 60).padStart(2, '0')}`;
  return <div className="app-shell">
    <header className="app-header">
      <a href="#" className="brand" aria-label="Elevator Policy Optimization home"><span className="brand-mark">↑<span>↓</span></span><span>ELEVATOR<span className="brand-sub">POLICY OPTIMIZATION</span></span></a>
      <nav aria-label="Main navigation"><a className="nav-active" href="#simulation">Playground</a><button onClick={() => setShowMethod(true)}>How it works <span>↗</span></button><a href="https://github.com/vinny380/elevator-policy-optimization/issues" target="_blank" rel="noreferrer">Roadmap <span>↗</span></a></nav>
      <span className="version"><i /> LOCAL LAB <span>v0.1</span></span>
    </header>
    <main>
      <div className="page-title"><div><p className="eyebrow">AN EXPERIMENT IN MOVING PEOPLE</p><h1>Every floor. A better decision.</h1><p>Build the conditions. Change the incentives. Watch a policy learn.</p></div><div className="experiment-id"><span>EXPERIMENT</span><strong>{String(experiment).padStart(3, '0')}</strong><small>SEED {config.seed}</small></div></div>
      <div className="workspace">
        <aside className="left-panel">
          <div className="panel-top"><span>ENVIRONMENT</span><span className="small-icon">⌘</span></div>
          <Section number="01" title="The building">
            <Range label="Above-ground floors" value={config.floors} min={10} max={40} onChange={floors => change({ floors })} />
            <div className="subtle-row"><span>Ground + parking</span><span>G · P1–P5</span></div>
            <div className="field-label">Elevators <span>{config.cars} installed</span></div>
            <div className="fleet-picker" role="group" aria-label="Number of elevators">{[1, 2, 3, 4, 5].map(n => <button key={n} className={config.cars === n ? 'selected' : ''} aria-pressed={config.cars === n} onClick={() => fleet(n)}>{n}</button>)}</div>
            <div className="car-toggles">{config.enabled.slice(0, config.cars).map((enabled, id) => <button key={id} className={enabled ? 'car-toggle online' : 'car-toggle offline'} onClick={() => toggleCar(id)} aria-label={`Elevator ${String.fromCharCode(65 + id)} ${enabled ? 'in service' : 'out of service'}`} aria-pressed={enabled}><span className="mini-car">▥</span><strong>{String.fromCharCode(65 + id)}</strong><i /></button>)}</div>
            <p className="field-note">Click a car to toggle service. Changes start a new experiment.</p>
            <details><summary>Car specifications <span>+</span></summary><Range label="Capacity" value={config.capacity} min={2} max={16} suffix=" people" onChange={capacity => change({ capacity })} /><Range label="Travel speed" value={config.speed} min={0.5} max={3} step={0.25} suffix=" fl/s" onChange={speed => change({ speed })} /><Range label="Door dwell" value={config.doors} min={2} max={10} suffix=" s" onChange={doors => change({ doors })} /></details>
          </Section>
          <Section number="02" title="The people">
            <label className="select-label">Traffic pattern<select value={config.pattern} onChange={e => change({ pattern: e.target.value as Pattern })}><option value="night">Late night</option><option value="morning">Morning rush ↑</option><option value="evening">Evening rush ↓</option><option value="mixed">Between floors ↕</option></select></label>
            <Range label="Arrival rate" value={config.demand} min={1} max={30} suffix=" / min" onChange={demand => change({ demand })} />
            <label className="seed-field">Random seed<input aria-label="Random seed" type="number" min={1} max={999999} value={config.seed} onChange={e => { const seed = Number(e.target.value); if (Number.isInteger(seed) && seed >= 1 && seed <= 999999) change({ seed }); }} /></label>
          </Section>
          <button className="scenario-card" onClick={() => { setConfig({ ...defaults, enabled: [...defaults.enabled] }); setNotice('Original scenario restored: three cars, one working, you at G.'); }}><span className="scenario-time">22:30 <span>↗</span></span><strong>The night it started</strong><span>Three elevators. One working.<br />One very long wait.</span><span className="scenario-link">Load original scenario →</span></button>
          <div className="left-footer"><i /> Everything runs in your browser.</div>
        </aside>
        <section className="simulation-panel" id="simulation" aria-label="Live elevator simulation">
          <div className="scene-header"><div><span className="live-dot" /> LIVE SIMULATION <span className="scene-clock">{clock}</span></div><span className={active < config.cars ? 'service-badge degraded' : 'service-badge'}>{active} / {config.cars} IN SERVICE</span></div>
          <div className="scene-controller"><button className={controller === 'collective' ? 'active' : ''} onClick={() => replay('collective')}>Collective control</button><button disabled={!checkpoints.length} className={controller === 'learned' ? 'active' : ''} onClick={() => { if (best) chooseCheckpoint(best.episode); }}>Learned policy <span>RL</span></button></div>
          <Building simulation={sim} onSelect={setSelectedPerson} />
          <div className="scene-caption"><span>{config.floors} FLOORS IS A LONG WAY TO WAIT.</span><p>{config.floors} above ground · 5 below · {config.capacity} people per car</p></div>
          <div className="scene-legend"><span><i className="legend-calm" /> Waiting</span><span><i className="legend-angry" /> Long wait</span><span className="drag-hint">Drag to orbit · scroll to zoom</span></div>
          <div className="scene-bottom"><div className="playback"><button aria-label={paused ? 'Play simulation' : 'Pause simulation'} className="play-button" onClick={() => setPaused(p => !p)}>{paused ? '▶' : 'Ⅱ'}</button><button aria-label="Reset simulation" onClick={() => replay()}>↺</button><div className="speed-picker" role="group" aria-label="Simulation playback speed">{[1, 4, 16].map(n => <button key={n} className={speed === n ? 'active' : ''} aria-pressed={speed === n} onClick={() => setSpeed(n)}>{n}×</button>)}</div><span className="playback-label">{controller === 'learned' ? `CHECKPOINT ${qVersion}` : 'BASELINE POLICY'}</span></div>
          <div className="metrics"><div><span>Waiting now</span><strong>{metrics.waiting}<small>people</small></strong></div><div><span>Mean wait*</span><strong>{Math.round(metrics.meanWait)}<small>sec</small></strong></div><div><span>95th percentile*</span><strong>{Math.round(metrics.p95)}<small>sec</small></strong></div><div><span>Delivered</span><strong>{metrics.delivered}<small>people</small></strong></div></div></div>
        </section>
        <aside className="right-panel" id="learning">
          <div className="panel-top"><span>THE LEARNING LAB</span><span className="beta-tag">Q-LEARNING</span></div>
          <div className="training-intro"><h2>Better is learned.</h2><p>One episode. Hundreds of decisions.<br />A little less waiting, if the policy improves.</p></div>
          <div className="chart-heading"><span>POLICY REWARD <span className="muted">↑ BETTER</span></span><strong>{latest ? latest.evaluation.toFixed(2) : '—'}</strong></div>
          <Chart points={points} selected={selectedCheckpoint} onSelect={chooseCheckpoint} />
          <div className="chart-legend"><span><i className="evaluation-key" /> Evaluation</span><span><i className="training-key" /> Training</span><span><i className="baseline-key" /> Baseline</span></div>
          <div className="training-counters"><div><strong>{fmt(stats.episodes)}</strong><span>EPISODES</span></div><div><strong>{fmt(stats.steps)}</strong><span>DECISIONS</span></div><div><strong>{fmt(stats.states)}</strong><span>Q STATES</span></div></div>
          <button className={`train-button ${running ? 'is-training' : ''}`} onClick={train}><span>{running ? 'Ⅱ' : '▷'}</span>{running ? 'Pause training' : stats.episodes ? 'Resume training' : 'Start learning'}<span>{running ? <i className="training-pulse" /> : '→'}</span></button>
          <div className="checkpoint-control"><label htmlFor="checkpoint">Replay a checkpoint</label><select id="checkpoint" disabled={!checkpoints.length} value={selectedCheckpoint ?? ''} onChange={e => chooseCheckpoint(Number(e.target.value))}><option value="" disabled>{checkpoints.length ? 'Choose a trained policy…' : 'Available after training'}</option>{selectedCheckpoint !== null && !checkpoints.some(c => c.episode === selectedCheckpoint) && <option value={selectedCheckpoint}>Episode {fmt(selectedCheckpoint)} · currently loaded</option>}{checkpoints.map(c => <option value={c.episode} key={c.episode}>Episode {fmt(c.episode)} · {c.score.toFixed(2)}</option>)}</select></div>
          <Section number="03" title="What should it care about?">
            <Range label="Waiting time" value={config.waitWeight} min={0} max={4} step={0.25} onChange={waitWeight => change({ waitWeight })} />
            <Range label="Long-wait penalty" value={config.tailWeight} min={0} max={4} step={0.25} onChange={tailWeight => change({ tailWeight })} />
            <Range label="Time inside the car" value={config.rideWeight} min={0} max={4} step={0.25} onChange={rideWeight => change({ rideWeight })} />
            <p className="field-note">A long wait gets increasingly expensive. Changing rewards starts a fresh experiment.</p>
          </Section>
          <details className="learning-settings"><summary>Learning parameters <span>+</span></summary><Range label="Exploration (ε)" value={learning.epsilon} min={0} max={1} step={0.05} onChange={epsilon => changeLearning({ epsilon })} hint="Chance of trying a different strategy." /><Range label="Learning rate (α)" value={learning.alpha} min={0.01} max={1} step={0.01} onChange={alpha => changeLearning({ alpha })} hint="How strongly new outcomes update the policy." /><Range label="Future reward (γ)" value={learning.gamma} min={0} max={0.99} step={0.01} onChange={gamma => changeLearning({ gamma })} hint="How much later consequences matter." /></details>
          <p className="training-disclosure">Learns to select among four routing strategies. 6-minute episodes. Evaluation uses four fixed seeds with exploration off. Improvement is measured, never scripted.</p>
        </aside>
      </div>
      <section className="inspection-row" aria-label="Live inspection">
        <div className="passenger-inspector"><span className="inspector-icon">♙</span><div><span className="eyebrow">FOLLOW A PASSENGER</span><div className="passenger-select"><select aria-label="Passenger to follow" value={person ? selectedPerson : ''} onChange={e => setSelectedPerson(Number(e.target.value))}>{!sim.people.length && <option value="">Waiting for the first arrival</option>}{sim.people.map(p => <option key={p.id} value={p.id}>{p.id === 1 && config.pattern === 'night' ? 'You' : `Passenger ${p.id + 1}`} · {floorLabel(p.from)} → {floorLabel(p.to)}</option>)}</select></div></div>{person && <div className="passenger-status"><strong>{person.delivered !== null ? 'Arrived' : person.boarded !== null ? `In car ${String.fromCharCode(65 + person.car!)}` : 'Waiting'}<span>{Math.round((person.boarded ?? sim.time) - person.arrived)}s wait</span></strong><div className="frustration-track"><i style={{ width: `${Math.min(100, ((person.boarded ?? sim.time) - person.arrived) / 1.2)}%` }} /></div></div>}</div>
        <div className="decision-inspector"><span className="eyebrow">NEXT DECISION</span>{sim.cars.filter(c => c.enabled).slice(0, 2).map(c => <p key={c.id}><span>{String.fromCharCode(65 + c.id)}</span>{c.reason} <small>· {c.passengers.length}/{config.capacity} aboard</small></p>)}</div>
      </section>
      <footer className="status-bar"><span role="status"><i />{notice}</span><span>* Includes current waits · Model, not building telemetry</span></footer>
    </main>
    <dialog ref={dialog} className="method-dialog" onCancel={() => setShowMethod(false)} onClick={e => { if (e.target === dialog.current) setShowMethod(false); }}><button className="dialog-close" onClick={() => setShowMethod(false)} aria-label="Close explanation">×</button><p className="eyebrow">INSIDE THE EXPERIMENT</p><h2>A real learner. A simplified world.</h2><p>The same deterministic engine runs the 3D replay and training. Each second, tabular Q-learning chooses one of four stop-selection strategies: collective, nearest stop, oldest call, or balanced. Choices affect cars when they become ready for a new stop.</p><h3>What the agent sees</h3><p>Bins for active hall calls, oldest waiting call, fleet occupancy, lobby demand, average car height, and active car count. Passenger destinations are used for routing only after boarding; hall calls expose direction.</p><h3>What the reward means</h3><code>cost = Σ [w₁·wait/60 + w₂·(wait/60)² + w₃·ride/60]</code><p>The agent receives the negative increase in cost every second. All waiting passengers count, including those still unserved at the six-minute horizon. The chart shows negative cost per arriving passenger; closer to zero is better.</p><h3>How comparisons work</h3><p>Training uses changing seeds. Evaluation uses four separate fixed seeds, no exploration, and a collective-control baseline with exactly the same arrivals. The baseline and evaluation use the same six-minute horizon. Replays use the seed in the environment controls, which is separate from the evaluation suite. Only the latest 100 checkpoints are retained in this tab.</p><h3>Model limits</h3><p>Travel uses constant floor speed, one-second steps, and fixed door dwell. There is no acceleration model or mid-flight route insertion. Rendering interpolates the resulting motion. These scores compare policies inside this model, not certified real-world lift performance.</p><h3>Next: a planning challenger</h3><p>PDDL integration, counterfactual routes, experiment branching, and sharing are tracked on the <a href="https://github.com/vinny380/elevator-policy-optimization/issues" target="_blank" rel="noreferrer">GitHub roadmap</a>. They are not implemented in this version.</p></dialog>
  </div>;
}
