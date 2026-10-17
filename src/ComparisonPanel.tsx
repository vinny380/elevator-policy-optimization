import { useEffect, useRef, useState } from 'react';
import type { Config } from './engine';
import type { ComparisonResult, Controller, SavedPolicy } from './comparison';
import type { ComparisonMessage } from './comparison.worker';

export function ComparisonPanel({ config, policies, checkpoint, onWatch }: { config: Config; policies: SavedPolicy[]; checkpoint: number | null; onWatch: (controller: Controller, id: string) => void }) {
  const [result, setResult] = useState<ComparisonResult | null>(null);
  const [progress, setProgress] = useState({ completed: 0, total: 8 });
  const [error, setError] = useState('');
  const worker = useRef<Worker | null>(null);
  const [revision, setRevision] = useState(0);
  const [stress, setStress] = useState(false);
  useEffect(() => {
    const w = new Worker(new URL('./comparison.worker.ts', import.meta.url), { type: 'module' });
    worker.current = w; setResult(null); setError(''); setProgress({ completed: 0, total: (3 + policies.length) * 4 * (stress ? 6 : 1) });
    w.onmessage = ({ data }: MessageEvent<ComparisonMessage>) => {
      if (data.type === 'done') { setResult(data.result); w.terminate(); }
      else if (data.type === 'error') { setError(data.message); w.terminate(); }
      else setProgress(data);
    };
    w.onerror = () => { setError('Comparison worker failed. Retry the comparison.'); w.terminate(); };
    w.postMessage({ config, policies, checkpoint, stress });
    return () => { w.terminate(); worker.current = null; };
  }, [config, policies, checkpoint, revision, stress]);
  function changeLabel(change: number | null) {
    if (change === null) return 'No relative change: baseline is zero';
    if (Math.abs(change) < 0.05) return 'Same as baseline';
    return `${Math.abs(change).toFixed(1)}% ${change < 0 ? 'lower' : 'higher'} wait`;
  }
  return <section className="comparison-panel" aria-labelledby="comparison-title">
    <div className="comparison-heading"><div><p className="eyebrow">THE SAME BUILDING. THE SAME PEOPLE.</p><h2 id="comparison-title">Test on unseen traffic.</h2></div><div className="comparison-actions"><span>{result ? `${result.scenarios.length * 4} trials / policy · 6 min each` : error ? 'Comparison stopped' : `Running ${progress.completed} / ${progress.total} trials…`}</span><button onClick={() => setRevision(n => n + 1)} disabled={!result && !error}>Run again ↻</button></div></div>
    <label className="select-label">Test suite<select value={stress ? 'stress' : 'current'} onChange={e => setStress(e.target.value === 'stress')}><option value="current">Current building · 4 seeds</option><option value="stress">Traffic + outages · 24 trials / policy</option></select></label>
    {error ? <p role="alert" className="comparison-error">{error}</p> : <div className="comparison-scroll"><table><thead><tr><th>Controller</th><th>Mean wait*</th><th>Mean P95*</th><th>Frustration / person ↓</th><th>Trips completed</th><th>Compute / trial</th><th><span className="sr-only">Replay</span></th></tr></thead><tbody>
      {result ? result.rows.map(row => <tr key={row.id}><th scope="row"><strong>{row.name}</strong><span>{row.controller === 'collective' ? 'Conventional reference' : row.controller === 'pddl' ? 'Marginal wait/ride cost · no training' : row.controller === 'predictive' ? 'Sampled futures · no training' : 'Frozen policy · exploration off'}</span></th><td><strong>{row.metrics.meanWait.toFixed(1)}s</strong><span>Paired Δ SE {row.waitSE.toFixed(1)}s</span>{row.controller !== 'collective' && <span className={row.waitChange !== null && row.waitChange < -0.05 ? 'comparison-better' : row.waitChange !== null && row.waitChange > 0.05 ? 'comparison-worse' : 'comparison-neutral'}>{changeLabel(row.waitChange)}</span>}</td><td>{row.metrics.p95.toFixed(1)}s</td><td>{(-row.metrics.score).toFixed(2)}</td><td>{row.metrics.delivered.toFixed(1)} / {row.people.toFixed(1)}<span>{row.metrics.waiting.toFixed(1)} still waiting · {row.metrics.riding.toFixed(1)} aboard</span></td><td>{row.milliseconds.toFixed(0)}ms</td><td><button onClick={() => onWatch(row.controller, row.id)}>Watch →</button></td></tr>) : <tr><td colSpan={7} className="comparison-pending">Running real simulations in the background…</td></tr>}
      {!policies.length && <tr className="comparison-untrained"><th scope="row">RL policy</th><td colSpan={6}>Train a policy to include its best saved checkpoint here.</td></tr>}
    </tbody></table></div>}
    <p className="comparison-notes">Best saved checkpoint from each run. Training is paused during comparison. * Includes people still waiting. Values are means across identical traffic streams, separate from training and checkpoint selection. Differences may be positive or negative; SE is the standard error of paired differences vs LOOK, not a confidence guarantee. Stress results combine four traffic patterns and all-online/one-online variants; transfer uses frozen policies. “Watch” replays the environment seed in Building settings.</p>
    {result && <button className="secondary-button" onClick={() => { const url = URL.createObjectURL(new Blob([JSON.stringify({ config, policies: policies.map(({ policy, ...metadata }) => metadata), result }, null, 2)], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = 'elevator-benchmark.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }}>Download measured results</button>}
    <details className="baseline-explanation"><summary>What is the conventional algorithm? <span>+</span></summary><p>Selective collective control answers car destinations and matching-direction hall calls along a sweep. This LOOK reference reverses at the last outstanding request instead of traveling to the end of an empty shaft. When only opposite-direction calls lie ahead, it reaches the farthest one and collects passengers on the return sweep. Cars share calls to avoid duplicate assignments.</p><p>This is our simplified implementation of a conventional control family, not proprietary firmware from your building. <a href="https://www.mitsubishielectric.com/elevator/products/basic/elevators/nexway_s_ip_ap_v2/pdf/product_guide.pdf" target="_blank" rel="noreferrer">Manufacturer reference: selective collective control ↗</a></p></details>
  </section>;
}
