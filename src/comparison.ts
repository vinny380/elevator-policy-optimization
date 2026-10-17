import { BASELINE_NAME, EPISODE_SECONDS, greedy, PDDL_ACTION, Simulation, type Config, type Metrics, type QTable } from './engine';
import { ALGORITHM_NAMES, policyStop, type Policy } from './policy';
import type { Learning } from './engine';
import type { NeuralSettings } from './learning';
import { predictiveStop } from './predictive';

export type Controller = 'collective' | 'learned' | 'pddl' | 'predictive';
export interface SavedPolicy { id: string; name: string; policy: Policy; episode: number; score: number; seed: number; learning?: Learning; neural?: NeuralSettings }
export const COMPARISON_SEEDS = [-810001, -810002, -810003, -810004];
export interface ComparisonRow {
  controller: Controller; id: string; name: string; metrics: Metrics; people: number; fallbacks: number;
  waitChange: number | null; costChange: number | null; milliseconds: number; waitSE: number; costSE: number;
}
export interface ComparisonResult { rows: ComparisonRow[]; seeds: number[]; horizon: number; checkpoint: number | null; scenarios: string[] }
export function controllerAction(sim: Simulation, controller: Controller, policy: Policy | QTable) {
  if (controller === 'pddl') return PDDL_ACTION;
  if (controller === 'predictive') return predictiveStop;
  if (controller !== 'learned') return 0;
  const p = typeof policy.algorithm === 'string' ? policy as Policy : { algorithm: 'tabular' as const, q: policy as QTable };
  return p.algorithm === 'tabular' ? greedy(p.q, sim.stateKey()) : (s: Simulation, car: typeof s.cars[number], stops: Parameters<typeof policyStop>[2]) => policyStop(s, car, stops, p);
}
export function benchmarkScenarios(config: Config, stress: boolean) {
  if (!stress) return [{ name: 'Current building', config }];
  const scenarios: { name: string; config: Config }[] = (['night', 'morning', 'evening', 'mixed'] as const).map(pattern => ({ name: pattern, config: { ...config, pattern } }));
  // Test transfer to outages/restoration without retraining, not just another random seed.
  const enabled = config.enabled.map((_, i) => i < config.cars);
  scenarios.push({ name: 'All cars online', config: { ...config, enabled } });
  scenarios.push({ name: 'One car online', config: { ...config, enabled: enabled.map((_, i) => i === 0) } });
  return scenarios;
}
const standardError = (values: number[]) => {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((s, x) => s + (x - mean) ** 2, 0) / (values.length - 1) / values.length);
};
export function compare(config: Config, policies: SavedPolicy[] | QTable | null, checkpoint: number | null, progress?: (completed: number, total: number) => void, stress = false): ComparisonResult {
  const saved: SavedPolicy[] = Array.isArray(policies) ? policies : policies ? [{ id: 'tabular', name: `RL · checkpoint ${checkpoint}`, policy: { algorithm: 'tabular', q: policies }, episode: checkpoint ?? 0, score: 0, seed: 0 }] : [];
  const entries: { controller: Controller; id: string; name: string; policy?: Policy }[] = [
    { controller: 'collective', id: 'collective', name: BASELINE_NAME },
    { controller: 'pddl', id: 'pddl', name: 'PDDL · weighted stops' },
    { controller: 'predictive', id: 'predictive', name: 'Predictive rollouts' },
    ...saved.map(p => ({ controller: 'learned' as const, id: p.id, name: p.name, policy: p.policy })),
  ];
  const scenarios = benchmarkScenarios(config, stress), rows: ComparisonRow[] = []; let completed = 0;
  let baselineRuns: { metrics: Metrics }[] = [];
  for (const entry of entries) {
    const started = performance.now();
    const runs = scenarios.flatMap(scenario => COMPARISON_SEEDS.map(seed => {
      const sim = new Simulation(scenario.config, seed);
      for (let t = 0; t < EPISODE_SECONDS; t++) sim.step(controllerAction(sim, entry.controller, entry.policy ?? {}));
      progress?.(++completed, entries.length * scenarios.length * COMPARISON_SEEDS.length);
      return { metrics: sim.metrics(), people: sim.people.length, fallbacks: sim.plannerFallbacks };
    }));
    const milliseconds = (performance.now() - started) / runs.length;
    if (!baselineRuns.length) baselineRuns = runs;
    const metrics = Object.fromEntries(Object.keys(runs[0].metrics).map(key => [key, runs.reduce((sum, r) => sum + r.metrics[key as keyof Metrics], 0) / runs.length])) as unknown as Metrics;
    const baseline = rows[0]?.metrics;
    const delta = (a: number, b: number) => Math.abs(b) < 1e-9 ? null : (a - b) / Math.abs(b) * 100;
    rows.push({ controller: entry.controller, id: entry.id, name: entry.name, metrics, milliseconds,
      waitSE: standardError(runs.map((r, i) => r.metrics.meanWait - baselineRuns[i].metrics.meanWait)),
      costSE: standardError(runs.map((r, i) => -r.metrics.score + baselineRuns[i].metrics.score)),
      people: runs.reduce((n, r) => n + r.people, 0) / runs.length, fallbacks: runs.reduce((n, r) => n + r.fallbacks, 0),
      waitChange: baseline ? delta(metrics.meanWait, baseline.meanWait) : 0,
      costChange: baseline ? delta(-metrics.score, -baseline.score) : 0 });
  }
  return { rows, seeds: [...COMPARISON_SEEDS], horizon: EPISODE_SECONDS, checkpoint, scenarios: scenarios.map(s => s.name) };
}
export function policyName(policy: Policy, seed: number, pretrain: number) { return `${ALGORITHM_NAMES[policy.algorithm]}${policy.algorithm === 'ppo' && pretrain ? ` + LOOK imitation (${pretrain} ep)` : ''} · seed ${seed}`; }
