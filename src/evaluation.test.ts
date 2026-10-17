import test from 'node:test';
import assert from 'node:assert/strict';
import { defaults, Simulation } from './engine.ts';
import { selectionCases, SELECTION_SEEDS } from './evaluation.ts';
import { referencePolicies } from './reference.ts';
import { policyStop } from './policy.ts';
import { COMPARISON_SEEDS } from './comparison.ts';

test('selection covers traffic and service diversity without duplicating equivalent fleets', () => {
  const cases = selectionCases(defaults, true);
  assert.equal(cases.length, 32);
  assert.deepEqual(new Set(cases.map(c => c.config.pattern)), new Set(['night', 'morning', 'evening', 'mixed']));
  assert.deepEqual(new Set(cases.map(c => c.config.enabled.slice(0, c.config.cars).filter(Boolean).length)), new Set([1, 3]));
  assert.equal(selectionCases({ ...defaults, enabled: [true, true, true, true, true] }, true).length, 16);
  assert.equal(selectionCases({ ...defaults, cars: 1 }, true).length, 16);
  assert.equal(selectionCases(defaults, false).length, 4);
  assert.ok(SELECTION_SEEDS.every(seed => !COMPARISON_SEEDS.includes(seed)));
});

test('bundled reference is a usable frozen policy, with independent weights and matching experiment metadata', () => {
  const saved = referencePolicies(defaults)[0], original = structuredClone(saved);
  assert.equal(saved.episode, 1360);
  assert.equal(saved.policy.network!.weights.length, 1122);
  const sim = new Simulation(defaults);
  for (let t = 0; t < 360; t++) sim.step((s, c, stops) => policyStop(s, c, stops, saved.policy));
  assert.ok(Number.isFinite(sim.metrics().score));
  assert.ok(sim.metrics().delivered > 0);
  assert.deepEqual(saved, original);
  saved.policy.network!.weights.fill(0);
  assert.deepEqual(referencePolicies(defaults)[0], original);
  assert.deepEqual(referencePolicies({ ...defaults, tailWeight: 0 }), []);
  assert.deepEqual(referencePolicies({ ...defaults, pattern: 'morning' }), []);
});
