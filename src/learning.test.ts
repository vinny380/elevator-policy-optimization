import test from 'node:test';
import assert from 'node:assert/strict';
import { defaults, learningDefaults, random, Simulation } from './engine.ts';
import { Adam, backward, forward, network, probabilities, sharedNetwork } from './network.ts';
import { ACTIONS, OBSERVATIONS, observe, actionId, policyStop, type Algorithm } from './policy.ts';
import { Trainer, neuralDefaults, evaluatePolicy, doubleTarget, advantages, clippedDerivative, ppoGradient, makeTransitions, type Transition } from './learning.ts';
import { predictiveStop } from './predictive.ts';
import { planStops, parsePddl, validatePlan } from './pddl.ts';

const close = (a: number, b: number, tolerance = 1e-4) => assert.ok(Math.abs(a - b) < tolerance, `${a} ≠ ${b}`);

test('network backprop agrees with finite differences for every weight', () => {
  const n = network(3, 4, 2, random(10)), x = Float32Array.of(0.1, -0.4, 0.7), dy = Float32Array.of(0.3, -0.2);
  const { hidden } = forward(n, x), gradient = new Float32Array(n.weights.length);
  backward(n, x, hidden, dy, gradient);
  const loss = () => forward(n, x).output.reduce((sum, y, i) => sum + y * dy[i], 0);
  for (let i = 0; i < n.weights.length; i++) {
    const original = n.weights[i], epsilon = 0.001;
    n.weights[i] = original + epsilon; const plus = loss(); n.weights[i] = original - epsilon; const minus = loss(); n.weights[i] = original;
    close(gradient[i], (plus - minus) / (2 * epsilon));
  }
  const before = loss(); new Adam(n).step(n, gradient, 0.001); assert.ok(loss() < before);
});

test('masked softmax is stable and assigns no probability to illegal actions', () => {
  const p = probabilities(Float32Array.of(10000, 9999, 20000), [0, 1]);
  close(p[0] + p[1], 1); assert.equal(p[2], 0); assert.ok(p[0] > p[1]);
});

const transition = (patch: Partial<Transition> = {}): Transition => ({ x: new Float32Array(OBSERVATIONS), legal: [0, 1], action: 0, reward: -2, elapsed: 3, next: new Float32Array(OBSERVATIONS), nextLegal: [0, 1], terminal: false, logp: Math.log(0.5), value: 1, ...patch });
const constantNetwork = (values: number[]) => {
  const n = network(OBSERVATIONS, 2, ACTIONS + 1, random(1)); n.weights.fill(0);
  const bias = n.weights.length - n.outputs; values.forEach((v, i) => n.weights[bias + i] = v); return n;
};
test('Double DQN selects with online network, evaluates target network, discounts duration and masks', () => {
  const online = constantNetwork([3, 2, 100]), target = constantNetwork([4, 9, 100]);
  const mean = (4 + 9 + 100) / ACTIONS;
  close(doubleTarget(transition(), online, target, 0.9), -2 + 0.9 ** 3 * (4 - mean));
  assert.equal(doubleTarget(transition({ terminal: true, nextLegal: [] }), online, target, 0.9), -2);
});

test('semi-Markov transitions credit future ticks, simultaneous choices, and terminal rewards exactly', () => {
  const base = { x: new Float32Array(OBSERVATIONS), legal: [0], action: 0, logp: 0, value: 0 };
  const t = makeTransitions([{ ...base, time: 1 }, { ...base, time: 1 }, { ...base, time: 3 }], [-1, -2, -3, -4, -5], 0.5);
  assert.equal(t[0].elapsed, 0); assert.equal(t[0].reward, 0); assert.equal(t[0].terminal, false);
  assert.equal(t[1].reward, -2 - 0.5 * 3); assert.equal(t[1].elapsed, 2);
  assert.equal(t[2].reward, -4 - 0.5 * 5); assert.equal(t[2].terminal, true);
  const g = advantages([transition({ reward: -2, elapsed: 2, value: 1 }), transition({ reward: -3, value: 2, terminal: true })], 0.9, 1);
  close(g.returns[0], -2 + 0.9 ** 2 * -3); close(g.returns[1], -3);
});

test('PPO clips only detrimental over-updates, and actor/entropy/critic gradients match finite differences', () => {
  assert.equal(clippedDerivative(1.3, 2, 0.2), 0); assert.equal(clippedDerivative(0.7, -2, 0.2), 0);
  close(clippedDerivative(0.7, 2, 0.2), -1.4); close(clippedDerivative(1.3, -2, 0.2), 2.6);
  const output = new Float32Array(ACTIONS + 1); output[0] = 0.1; output[1] = -0.1; output[ACTIONS] = 0.5;
  const t = transition(), advantage = 0.7, returns = -1, settings = { ...neuralDefaults, entropy: 0.03 };
  const dy = ppoGradient(output, t, advantage, returns, settings);
  const loss = () => {
    const p = probabilities(output, t.legal), ratio = p[0] / Math.exp(t.logp);
    const entropy = -t.legal.reduce((sum, a) => sum + p[a] * Math.log(p[a]), 0);
    return -Math.min(ratio * advantage, Math.max(0.8, Math.min(1.2, ratio)) * advantage) - settings.entropy * entropy + 0.25 * (output[ACTIONS] - returns) ** 2;
  };
  for (const i of [0, 1, 2, ACTIONS]) {
    const value = output[i]; output[i] = value + 0.001; const plus = loss(); output[i] = value - 0.001; const minus = loss(); output[i] = value;
    close(dy[i], (plus - minus) / 0.002);
  }
});

test('observations and forecasts hide unboarded destinations and real future random state', () => {
  const a = new Simulation({ ...defaults, pattern: 'mixed' }), b = new Simulation({ ...defaults, pattern: 'mixed' }, 991);
  a.addPassenger(0, 10); b.addPassenger(0, 40);
  assert.equal(observe(a, a.cars[0]).length, OBSERVATIONS);
  assert.ok(observe(a, a.cars[0]).every(Number.isFinite));
  assert.deepEqual(observe(a, a.cars[0]), observe(b, b.cars[0]));
  const fa = a.forecast(17), fb = b.forecast(17);
  for (let t = 0; t < 60; t++) { fa.step(); fb.step(); }
  assert.deepEqual(fa.people, fb.people);
  assert.equal(a.time, 0); assert.equal(a.people[0].to, 10);
  assert.deepEqual(predictiveStop(a, a.cars[0], a.candidates(a.cars[0])), predictiveStop(b, b.cars[0], b.candidates(b.cars[0])));
  b.people[0].to = -5; assert.notDeepEqual(observe(a, a.cars[0]), observe(b, b.cars[0]));
});

test('all learners train deterministically, update weights, and evaluate immutable checkpoints', () => {
  for (const algorithm of ['tabular', 'ddqn', 'ppo'] as Algorithm[]) {
    const a = new Trainer(defaults, algorithm, learningDefaults, neuralDefaults), b = new Trainer(defaults, algorithm, learningDefaults, neuralDefaults);
    const original = structuredClone(a.policy);
    for (let i = 0; i < 6; i++) { a.run(); b.run(); }
    assert.deepEqual(a.policy, b.policy); assert.notDeepEqual(a.policy, original);
    const frozen = structuredClone(a.policy), score = evaluatePolicy(defaults, -810001, a.policy);
    assert.ok(Number.isFinite(score.score)); assert.deepEqual(a.policy, frozen);
    assert.equal(a.episodes, 6);
  }
});

test('neural replay matches evaluation with 1–5 cars and respects legal actions/capacity/outages', () => {
  for (let cars = 1; cars <= 5; cars++) {
    const config = { ...defaults, cars, capacity: 2, enabled: [true, false, true, false, true] };
    const trainer = new Trainer(config, 'ppo', learningDefaults, neuralDefaults);
    trainer.run();
    const live = new Simulation(config, 991);
    for (let t = 0; t < 360; t++) {
      live.step((s, car, stops) => { const stop = policyStop(s, car, stops, trainer.policy); assert.ok(stops.map(actionId).includes(actionId(stop))); return stop; });
      for (const car of live.cars) { assert.ok(car.passengers.length <= 2); if (!car.enabled) assert.equal(car.position, 0); }
      const m = live.metrics(); assert.equal(m.waiting + m.riding + m.delivered, live.people.length);
    }
    assert.deepEqual(live.metrics(), evaluatePolicy(config, 991, trainer.policy));
  }
});

test('imitation warm start updates the actor then switches to PPO without resetting it', () => {
  const trainer = new Trainer(defaults, 'ppo', learningDefaults, { ...neuralDefaults, pretrain: 2 });
  const before = structuredClone(trainer.policy);
  trainer.run(); trainer.run(); assert.equal(trainer.episodes, 0); assert.equal(trainer.pretrainingEpisodes, 2);
  assert.notDeepEqual(trainer.policy, before); assert.equal(trainer.phase, 'Learning');
  trainer.run(); assert.equal(trainer.episodes, 1); assert.equal(trainer.pretrainingEpisodes, 2);
});

test('weighted PDDL changes its first stop when old-call weight increases and exports a valid plan', () => {
  const stops = [{ floor: 2, direction: 1, inside: false, age: 0 }, { floor: 10, direction: -1, inside: false, age: 300 }];
  const near = planStops(0, stops, 1, 2, 0, 300, { waitWeight: 1, tailWeight: 0, rideWeight: 0 });
  const old = planStops(0, stops, 1, 2, 0, 300, { waitWeight: 1, tailWeight: 4, rideWeight: 0 });
  assert.equal(near.firstStop?.floor, 2); assert.equal(old.firstStop?.floor, 10);
  validatePlan(parsePddl(old.domain, old.problem), old.actions);
});

test('changing the discount discards replay rewards computed with the old discount', () => {
  const settings = { ...neuralDefaults, variedTraffic: false };
  const trainer = new Trainer({ ...defaults, demand: 1 }, 'ddqn', learningDefaults, settings);
  for (let i = 0; i < 5; i++) trainer.run();
  const updates = trainer.updates; assert.ok(updates > 0);
  trainer.configure({ ...learningDefaults, gamma: 0.8 }, settings);
  const result = trainer.run();
  assert.ok(result.decisions < neuralDefaults.batch);
  assert.equal(trainer.updates, updates, 'must refill replay before updating with the new discount');
});


test('shared stop scorer gradients match finite differences and commute with action permutations', () => {
  const n = sharedNetwork(2, 3, 3, 3, random(8));
  const x = Float32Array.of(0.1, -0.2, 1, 0.4, 0.8, 1, -0.1, 0.7, 0, 0, 0);
  const dy = Float32Array.of(0.3, -0.2, 1, 0.4), { hidden, output } = forward(n, x), gradient = new Float32Array(n.weights.length);
  backward(n, x, hidden, dy, gradient);
  const loss = () => forward(n, x).output.reduce((sum, y, i) => sum + y * dy[i], 0);
  for (let i = 0; i < n.weights.length; i++) {
    const original = n.weights[i]; n.weights[i] = original + 0.001; const plus = loss();
    n.weights[i] = original - 0.001; const minus = loss(); n.weights[i] = original;
    close(gradient[i], (plus - minus) / 0.002);
  }
  const swapped = x.slice(); swapped.set(x.subarray(5, 8), 2); swapped.set(x.subarray(2, 5), 5);
  const result = forward(n, swapped).output;
  close(result[0], output[1]); close(result[1], output[0]); close(result[3], output[3]);
  assert.equal(output[2], 0, 'masked stops have no scorer contribution');
});

test('predictive search cannot distinguish hidden destinations or inspect the real future', () => {
  const a = new Simulation({ ...defaults, pattern: 'mixed' }, 17), b = new Simulation({ ...defaults, pattern: 'mixed' }, 999);
  a.addPassenger(0, 10); a.addPassenger(20, 0);
  b.addPassenger(0, 40); b.addPassenger(20, -5);
  const before = structuredClone({ people: a.people, cars: a.cars, time: a.time, cost: a.cost });
  assert.deepEqual(predictiveStop(a, a.cars[0], a.candidates(a.cars[0])), predictiveStop(b, b.cars[0], b.candidates(b.cars[0])));
  assert.deepEqual({ people: a.people, cars: a.cars, time: a.time, cost: a.cost }, before);
});
