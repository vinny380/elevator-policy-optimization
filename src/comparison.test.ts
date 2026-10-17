import test from 'node:test';
import assert from 'node:assert/strict';
import { defaults, learningDefaults } from './engine.ts';
import { Trainer, neuralDefaults } from './learning.ts';
import { compare, benchmarkScenarios, type SavedPolicy } from './comparison.ts';

test('neural policies share held-out arrivals and remain frozen through comparison and transfer', () => {
  const trainer = new Trainer(defaults, 'ddqn', learningDefaults, neuralDefaults); trainer.run(); trainer.run();
  const saved: SavedPolicy = { id: 'ddqn', name: 'DDQN test', policy: trainer.policy, episode: 2, score: 0, seed: 7 };
  const frozen = structuredClone(saved), progress: number[] = [];
  const result = compare(defaults, [saved], null, (n, total) => { progress.push(n); assert.equal(total, 16); });
  assert.equal(progress.at(-1), 16); assert.deepEqual(saved, frozen);
  for (const row of result.rows) {
    assert.equal(row.people, result.rows[0].people);
    assert.ok(Number.isFinite(row.milliseconds) && row.milliseconds >= 0);
    assert.ok(Number.isFinite(row.waitSE) && row.waitSE >= 0);
    assert.equal('policy' in row, false, 'results must not duplicate network snapshots');
  }
  const scenarios = benchmarkScenarios(defaults, true);
  assert.equal(scenarios.length, 6);
  assert.equal(scenarios[4].config.enabled.slice(0, 3).filter(Boolean).length, 3);
  assert.equal(scenarios[5].config.enabled.slice(0, 3).filter(Boolean).length, 1);
  assert.deepEqual(defaults.enabled, [true, false, false, true, true]);
});
