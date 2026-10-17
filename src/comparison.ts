import { BASELINE_NAME, EPISODE_SECONDS, greedy, PDDL_ACTION, Simulation, type Config, type Metrics, type QTable } from './engine';

export type Controller = 'collective' | 'learned' | 'pddl';
// Negative seeds are separate from the positive training and checkpoint-selection streams.
export const COMPARISON_SEEDS = [-810001, -810002, -810003, -810004];
export interface ComparisonRow {
  controller: Controller; name: string; metrics: Metrics; people: number; fallbacks: number;
  waitChange: number | null; costChange: number | null;
}
export interface ComparisonResult { rows: ComparisonRow[]; seeds: number[]; horizon: number; checkpoint: number | null }
export function controllerAction(sim: Simulation, controller: Controller, q: QTable) {
  return controller === 'pddl' ? PDDL_ACTION : controller === 'learned' ? greedy(q, sim.stateKey()) : 0;
}
export function compare(config: Config, q: QTable | null, checkpoint: number | null, progress?: (completed: number, total: number) => void): ComparisonResult {
  const controllers: Controller[] = ['collective', 'pddl', ...(q ? ['learned' as const] : [])];
  const rows: ComparisonRow[] = []; let completed = 0;
  for (const controller of controllers) {
    const runs = COMPARISON_SEEDS.map(seed => {
      const sim = new Simulation(config, seed);
      for (let t = 0; t < EPISODE_SECONDS; t++) sim.step(controllerAction(sim, controller, q ?? {}));
      progress?.(++completed, controllers.length * COMPARISON_SEEDS.length);
      return { metrics: sim.metrics(), people: sim.people.length, fallbacks: sim.plannerFallbacks };
    });
    const metrics = Object.fromEntries(Object.keys(runs[0].metrics).map(key => [key, runs.reduce((sum, r) => sum + r.metrics[key as keyof Metrics], 0) / runs.length])) as unknown as Metrics;
    const baseline = rows[0]?.metrics;
    const delta = (a: number, b: number) => Math.abs(b) < 1e-9 ? null : (a - b) / Math.abs(b) * 100;
    rows.push({ controller, name: controller === 'collective' ? BASELINE_NAME : controller === 'pddl' ? 'PDDL stop planner' : `RL · checkpoint ${checkpoint}`,
      metrics, people: runs.reduce((n, r) => n + r.people, 0) / runs.length, fallbacks: runs.reduce((n, r) => n + r.fallbacks, 0),
      waitChange: baseline ? delta(metrics.meanWait, baseline.meanWait) : 0,
      costChange: baseline ? delta(-metrics.score, -baseline.score) : 0 });
  }
  return { rows, seeds: [...COMPARISON_SEEDS], horizon: EPISODE_SECONDS, checkpoint };
}
