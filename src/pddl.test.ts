import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePddl, planStops, solvePddl, validatePlan, type Stop } from './pddl.ts';
import { defaults, PDDL_ACTION, Simulation } from './engine.ts';
import { compare, COMPARISON_SEEDS } from './comparison.ts';

const stop = (floor: number, inside = true): Stop => ({ floor, inside, age: 10, direction: 1 });

test('generated PDDL is parsed, solved, and validated with the expected route cost', () => {
  const plan = planStops(0, [stop(10), stop(20)], 1, 4, 0, 0);
  assert.equal(plan.status, 'solved'); assert.equal(plan.cost, 28);
  assert.deepEqual(plan.actions, ['serve-f10-from-g', 'serve-f20-from-f10']);
  assert.equal(validatePlan(parsePddl(plan.domain, plan.problem), plan.actions), plan.cost);
});

test('changing a PDDL action cost changes the chosen plan', () => {
  const plan = planStops(0, [stop(10), stop(20)], 1, 4, 0, 0);
  const expensive = plan.domain.replace('(increase (total-cost) 14)', '(increase (total-cost) 999)');
  const result = solvePddl(expensive, plan.problem);
  assert.equal(result.actions[0], 'serve-f20-from-g');
});

test('planner agrees with an independent enumeration of all stop orders', () => {
  const floors = [-5, 0, 10, 22, 40];
  function minimum(from: number, pending: number[]): number {
    if (!pending.length) return 0;
    return Math.min(...pending.map((floor, i) => Math.max(1, Math.ceil(Math.abs(floor - from) / 1.5)) + 4 + minimum(floor, pending.filter((_, j) => i !== j))));
  }
  const result = planStops(15, floors.map(f => stop(f)), 1.5, 4, 0, 0);
  assert.equal(result.status, 'solved'); assert.equal(result.cost, minimum(15, floors));
});

test('unsupported temporal syntax, negative costs, invalid plans, and search limits fail explicitly', () => {
  const plan = planStops(0, [stop(10)], 1, 4, 0, 0);
  assert.throws(() => parsePddl(plan.domain.replace(':strips', ':durative-actions'), plan.problem), /Only STRIPS/);
  assert.throws(() => parsePddl(plan.domain.replace('(total-cost) 14', '(total-cost) -1'), plan.problem), /nonnegative/);
  assert.throws(() => validatePlan(parsePddl(plan.domain, plan.problem), []), /goal/);
  assert.throws(() => validatePlan(parsePddl(plan.domain, plan.problem), ['imaginary-action']), /Invalid/);
  assert.equal(solvePddl(plan.domain, plan.problem, 0).status, 'limit');
});

test('candidate horizon is bounded and includes onboard destinations first', () => {
  const result = planStops(0, Array.from({ length: 12 }, (_, i) => ({ ...stop(i + 1, i === 11), age: i })), 1, 4, 0, 0);
  assert.equal(result.stops.length, 6); assert.equal(result.candidateCount, 12);
  assert.ok(result.stops.some(s => s.floor === 12)); assert.equal(result.status, 'solved');
});

test('PDDL runs the real simulator and delivers a closed workload with one to five cars', () => {
  for (let cars = 1; cars <= 5; cars++) {
    const sim = new Simulation({ ...defaults, cars, capacity: 2, enabled: [true, true, true, true, true], pattern: 'mixed' });
    for (const [from, to] of [[0, 40], [40, -5], [-5, 30], [0, 10], [10, 0], [35, 4], [2, 33], [0, 40]]) sim.addPassenger(from, to);
    for (let t = 0; t < 1800 && sim.metrics().delivered < sim.people.length; t++) sim.step(PDDL_ACTION, false);
    assert.equal(sim.metrics().delivered, sim.people.length, `Fleet ${cars}`);
    assert.equal(sim.plannerFallbacks, 0); assert.equal(sim.lastPlan?.status, 'solved');
  }
});

test('PDDL does not use destinations of passengers who have not boarded', () => {
  const a = new Simulation({ ...defaults, pattern: 'mixed' });
  const b = new Simulation({ ...defaults, pattern: 'mixed' });
  a.addPassenger(5, 10); b.addPassenger(5, 40);
  a.step(PDDL_ACTION, false); b.step(PDDL_ACTION, false);
  assert.equal(a.lastPlan?.domain, b.lastPlan?.domain); assert.equal(a.lastPlan?.problem, b.lastPlan?.problem);
});

test('four-way comparison uses matching streams and signed deltas without mutating the checkpoint', () => {
  const q = { '0:0:0:0:0:1': [-1, -2, -3, -4] }; const before = structuredClone(q);
  const result = compare(defaults, q, 20);
  assert.deepEqual(q, before); assert.deepEqual(result.seeds, COMPARISON_SEEDS);
  assert.equal(result.rows.length, 4); assert.equal(result.checkpoint, 20);
  for (const row of result.rows) {
    assert.equal(row.people, result.rows[0].people);
    assert.ok(Math.abs(row.metrics.waiting + row.metrics.riding + row.metrics.delivered - row.people) < 1e-8);
    assert.ok(Number.isFinite(row.metrics.score));
    assert.equal(row.waitChange, (row.metrics.meanWait - result.rows[0].metrics.meanWait) / result.rows[0].metrics.meanWait * 100);
  }
});

test('zero-cost objective comparisons avoid division by zero', () => {
  const result = compare({ ...defaults, waitWeight: 0, tailWeight: 0, rideWeight: 0 }, null, null);
  assert.equal(result.rows[1].costChange, null);
});
