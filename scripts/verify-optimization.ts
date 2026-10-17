import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { defaults, EPISODE_SECONDS, PDDL_ACTION, Simulation, type Metrics, type StopSelector } from '../src/engine.ts';
import { predictiveStop, rolloutDefaults } from '../src/predictive.ts';
import { policyStop } from '../src/policy.ts';
import { referencePolicies } from '../src/reference.ts';

// Reserved final test streams: never used for training, checkpoint selection, or tuning.
const seeds = Array.from({ length: 40 }, (_, i) => -970001 - i);
const scenarios = (['night', 'morning', 'evening', 'mixed'] as const).flatMap(pattern => [1, 2, 3, 5].map(cars => ({
  name: `${pattern} / ${cars} online`, config: { ...defaults, pattern, cars, enabled: [true, true, true, true, true] },
})));
const reference = referencePolicies(defaults)[0];
const controllers: { name: string; action: number | StopSelector }[] = [
  { name: 'LOOK', action: 0 },
  { name: 'Previous planner (45s, 2 samples)', action: (s, c, stops) => predictiveStop(s, c, stops, { horizon: 45, samples: 2, uncertainty: 0 }) },
  { name: 'Predictive planner', action: predictiveStop },
  { name: reference.name, action: (s, c, stops) => policyStop(s, c, stops, reference.policy) },
  { name: 'PDDL', action: PDDL_ACTION },
];
const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
const interval = (xs: number[]) => {
  const m = mean(xs), se = Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1) / xs.length);
  return { mean: m, se, ci95: [m - 2.023 * se, m + 2.023 * se] };
};
type Trial = { scenario: number; seed: number; metrics: Metrics; people: number; fallbacks: number };
let baseline: Trial[] = [];
function summarize(runs: Trial[], control: Trial[]) {
  const metrics = Object.fromEntries(Object.keys(runs[0].metrics).map(key => [key, mean(runs.map(r => r.metrics[key as keyof Metrics]))])) as unknown as Metrics;
  const baseCost = mean(control.map(r => -r.metrics.score));
  // Shared seeds across scenarios are a block, not 16 independent observations.
  const costDifference = interval(seeds.map(seed => mean(runs.flatMap((r, i) => r.seed === seed ? [-r.metrics.score + control[i].metrics.score] : []))));
  return { metrics, costReductionPercent: (baseCost + metrics.score) / baseCost * 100, costDifference,
    people: mean(runs.map(r => r.people)), unfinished: metrics.waiting + metrics.riding,
    plannerFallbacks: runs.reduce((n, r) => n + r.fallbacks, 0) };
}
const results = controllers.map(controller => {
  const start = performance.now();
  const runs = scenarios.flatMap(({ config }, scenario) => seeds.map(seed => {
    const sim = new Simulation(config, seed);
    for (let t = 0; t < EPISODE_SECONDS; t++) sim.step(controller.action);
    return { scenario, seed, metrics: sim.metrics(), people: sim.people.length, fallbacks: sim.plannerFallbacks };
  }));
  const millisecondsPerTrial = (performance.now() - start) / runs.length;
  if (!baseline.length) baseline = runs;
  runs.forEach((r, i) => assert.equal(r.people, baseline[i].people, 'Controllers must see the same arrivals'));
  const result = { name: controller.name, trials: runs.length, millisecondsPerTrial, ...summarize(runs, baseline),
    scenarios: scenarios.map((scenario, i) => ({ name: scenario.name, ...summarize(runs.filter(r => r.scenario === i), baseline.filter(r => r.scenario === i)) })) };
  console.log(JSON.stringify({ name: result.name, cost: -result.metrics.score, reduction: result.costReductionPercent, wait: result.metrics.meanWait, millisecondsPerTrial }));
  return result;
});
const output = process.argv[2] ?? 'benchmarks/optimization.json';
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify({
  methodology: 'Frozen controllers. 40 reserved seeds × four traffic patterns × 1/2/3/5 online cars. Equal weight per trial; paired cost intervals use seed blocks and t(39)=2.023. Six-minute horizon; unfinished passengers accrue costs. CPU timings are environment-dependent. No final-test model selection.',
  seeds, scenarios, horizon: EPISODE_SECONDS, planner: rolloutDefaults,
  reference: { name: reference.name, episode: reference.episode, seed: reference.seed, learning: reference.learning, neural: reference.neural }, results,
}, null, 2) + '\n');
console.log(`Saved ${output}`);
