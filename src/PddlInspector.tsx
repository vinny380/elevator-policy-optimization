import { floorLabel } from './engine';
import type { PlanningSnapshot } from './pddl';

export function PddlInspector({ plan, fallbacks }: { plan: PlanningSnapshot | null; fallbacks: number }) {
  function download(name: string, text: string) {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const link = document.createElement('a'); link.href = url; link.download = name; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <section className="pddl-inspector" aria-label="Live PDDL planner">
    <p className="eyebrow">PLANNING, IN PLAIN SIGHT</p><h2>A plan you can inspect.</h2>
    <p>Uniform-cost search solves an actual PDDL snapshot. The car executes the first stop, then replans when ready for its next decision.</p>
    {plan ? <><div className="pddl-stats"><span>CAR <strong>{String.fromCharCode(65 + plan.car)}</strong></span><span>EXPANDED <strong>{plan.expanded}</strong></span><span>PLAN COST <strong>{plan.cost.toFixed(2)}</strong></span></div><div className="pddl-route"><strong>{plan.status === 'solved' ? '✓ Validated plan' : 'Search limit · LOOK fallback'}</strong><span>{plan.objective} · snapshot at {plan.time}s · {plan.stops.length} of {plan.candidateCount} candidate stops</span><ol>{plan.actions.map((action, index) => <li key={action}><span>{index === 0 ? 'NEXT' : String(index + 1).padStart(2, '0')}</span><code>({action})</code></li>)}</ol>{plan.firstStop && <p>Next stop: <b>{floorLabel(plan.firstStop.floor)}</b> · {plan.firstStop.inside ? 'onboard destination' : 'hall call'}</p>}</div><details><summary>Inspect domain + problem <span>+</span></summary><label>domain.pddl</label><pre>{plan.domain}</pre><label>problem.pddl</label><pre>{plan.problem}</pre></details><div className="pddl-downloads"><button onClick={() => download('domain.pddl', plan.domain)}>↓ Domain</button><button onClick={() => download('problem.pddl', plan.problem)}>↓ Problem</button><button onClick={() => download('plan.txt', plan.actions.map(a => `(${a})`).join('\n'))}>↓ Plan</button></div></> : <div className="pddl-empty">Waiting for the first stop decision. Press play to generate a plan.</div>}
    <p className="pddl-limits">Classical STRIPS + action costs. Uses your wait, long-wait, and ride weights over at most six known stops. It freezes marginal cost rates at the snapshot, so this approximates the full waiting objective. Passenger capacity and boarding stay in the simulator; future arrivals and unboarded destinations are unknown. This is not a full temporal passenger plan. {fallbacks} search fallbacks.</p>
  </section>;
}
