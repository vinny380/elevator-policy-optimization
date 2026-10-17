import test from 'node:test';
import assert from 'node:assert/strict';
import { collectiveStop, defaults, episode, learningDefaults, qUpdate, Simulation, type Config, type QTable } from './engine.ts';

const config = (patch: Partial<Config> = {}): Config => ({ ...defaults, enabled: [...defaults.enabled], ...patch });

test('same seed and policy produce identical passenger arrivals and outcomes', () => {
  const a = new Simulation(config()); const b = new Simulation(config());
  for (let i = 0; i < 360; i++) { a.step(); b.step(); }
  assert.deepEqual(a.people, b.people); assert.deepEqual(a.cars, b.cars); assert.deepEqual(a.metrics(), b.metrics());
});

test('different policies get the same passenger stream, independent of their decisions', () => {
  const a = new Simulation(config({ pattern: 'mixed', demand: 20 }));
  const b = new Simulation(config({ pattern: 'mixed', demand: 20 }));
  for (let i = 0; i < 360; i++) { a.step(0); b.step(2); }
  const arrivals = (s: Simulation) => s.people.map(({ from, to, arrived }) => ({ from, to, arrived }));
  assert.deepEqual(arrivals(a), arrivals(b));
});

test('night scenario picks up G on the ascent from P5 and delivers to 10', () => {
  const sim = new Simulation(config({ demand: 1 }));
  let pickedUpAfterParking = false; let sawParking = false;
  for (let i = 0; i < 150; i++) {
    sim.step(0, false);
    if (sim.cars[0].position === -5) sawParking = true;
    if (sim.people[1].boarded !== null) pickedUpAfterParking = sawParking;
  }
  assert.ok(pickedUpAfterParking); assert.notEqual(sim.people[1].delivered, null);
  assert.ok(sim.people[1].boarded! < 50, 'G should be collected before another visit to floor 30');
});

test('collective control eventually delivers a closed workload for fleets of one to five', () => {
  for (let cars = 1; cars <= 5; cars++) {
    const sim = new Simulation(config({ cars, enabled: [true, true, true, true, true], pattern: 'mixed', capacity: 2 }));
    for (const [from, to] of [[0, 40], [40, -5], [-5, 30], [0, 10], [10, 0], [35, 4], [2, 33], [0, 40]]) sim.addPassenger(from, to);
    for (let t = 0; t < 1800 && sim.metrics().delivered < sim.people.length; t++) sim.step(0, false);
    assert.equal(sim.metrics().delivered, sim.people.length, `Fleet of ${cars}`);
  }
});

test('capacity, floor bounds, passenger conservation, and outages hold under all strategies including PDDL', () => {
  for (let action = 0; action <= 4; action++) {
    const sim = new Simulation(config({ cars: 5, enabled: [true, false, true, false, true], capacity: 2, pattern: 'mixed', demand: 30 }));
    for (let i = 0; i < 700; i++) {
      sim.step(action);
      const onboardIds = sim.cars.flatMap(c => c.passengers);
      assert.equal(new Set(onboardIds).size, onboardIds.length);
      for (const car of sim.cars) {
        assert.ok(car.position >= -5 && car.position <= 40);
        assert.ok(car.passengers.length <= 2);
        if (!car.enabled) { assert.equal(car.position, 0); assert.equal(car.passengers.length, 0); }
      }
      const m = sim.metrics(); assert.equal(m.waiting + m.riding + m.delivered, sim.people.length);
      for (const p of sim.people) {
        if (p.boarded !== null) assert.ok(p.boarded >= p.arrived);
        if (p.delivered !== null) assert.ok(p.delivered >= p.boarded!);
      }
    }
  }
});

test('LOOK sweeps matching calls and turns at the farthest opposite-direction call', () => {
  const call = (floor: number, direction: number) => ({ floor, direction, inside: false, age: 0 });
  assert.equal(collectiveStop(0, 1, [call(10, -1), call(30, -1)])?.floor, 30);
  assert.equal(collectiveStop(0, 1, [call(10, 1), call(30, -1)])?.floor, 10);
  assert.equal(collectiveStop(30, -1, [call(10, -1), call(20, -1)])?.floor, 20);
  assert.equal(collectiveStop(20, 1, [call(10, -1), call(5, -1)])?.floor, 10);
});

test('LOOK does not reverse at a drop-off while there is still demand ahead', () => {
  const sim = new Simulation(config({ pattern: 'mixed' }));
  const rider = sim.addPassenger(0, 10); rider.boarded = 0; rider.car = 0;
  sim.cars[0].passengers.push(rider.id);
  const downCall = sim.addPassenger(10, 0); sim.addPassenger(30, 40);
  for (let t = 0; t < 7; t++) sim.step(0, false);
  assert.equal(rider.delivered, 7);
  assert.equal(downCall.boarded, null);
  assert.equal(sim.cars[0].direction, 1);
});

test('squared waiting penalty accrues even for a passenger not yet served', () => {
  const sim = new Simulation(config({ pattern: 'mixed', waitWeight: 1, tailWeight: 2, rideWeight: 0 }));
  sim.addPassenger(40, 0); sim.cars[0].door = 100;
  for (let i = 0; i < 60; i++) sim.step(0, false);
  assert.equal(sim.people[0].boarded, null); assert.ok(Math.abs(sim.cost - 3) < 1e-9);
  assert.equal(sim.metrics().meanWait, 60); assert.equal(sim.metrics().p95, 60);
});

test('incremental rewards equal the objective including arrivals between ticks', () => {
  const sim = new Simulation(config({ pattern: 'mixed', demand: 20 }));
  for (let i = 0; i < 360; i++) sim.step();
  const objective = sim.people.reduce((sum, p) => {
    const wait = (p.boarded ?? sim.time) - p.arrived;
    const ride = p.boarded === null ? 0 : (p.delivered ?? sim.time) - p.boarded;
    return sum + sim.config.waitWeight * wait / 60 + sim.config.tailWeight * (wait / 60) ** 2 + sim.config.rideWeight * ride / 60;
  }, 0);
  assert.ok(Math.abs(sim.cost - objective) < 1e-7, `${sim.cost} vs ${objective}`);
});

test('a car can travel down to collect an up call without an extra empty door cycle', () => {
  const sim = new Simulation(config({ pattern: 'mixed' }));
  sim.cars[0].position = 10;
  const p = sim.addPassenger(0, 30);
  for (let i = 0; i < 7; i++) sim.step(1, false);
  assert.equal(p.boarded, 7);
});

test('Q-learning applies a temporal-difference update and drops bootstrap at terminal states', () => {
  const q: QTable = { next: [2, 3, 4, 5] };
  qUpdate(q, 'now', 2, -1, 'next', false, { alpha: 0.5, gamma: 0.9, epsilon: 0 });
  assert.equal(q.now[2], 1.75);
  qUpdate(q, 'terminal', 0, -1, 'next', true, { alpha: 0.5, gamma: 0.9, epsilon: 0 });
  assert.equal(q.terminal[0], -0.5);
});

test('training changes the policy table and evaluation does not mutate it', () => {
  const q: QTable = {};
  for (let i = 0; i < 5; i++) episode(config(), 42 + i, q, learningDefaults);
  assert.ok(Object.keys(q).length > 0); assert.ok(Object.values(q).some(row => row.some(value => value !== 0)));
  const before = structuredClone(q);
  const result = episode(config(), 910001, q);
  assert.deepEqual(q, before); assert.ok(Number.isFinite(result.score));
});

test('rejects configurations with no active cars and invalid floor bounds', () => {
  assert.throws(() => new Simulation(config({ enabled: [false, false, false] })), /at least one/);
  assert.throws(() => new Simulation(config({ floors: 100 })), /Invalid/);
  assert.throws(() => new Simulation(config({ speed: NaN })), /Invalid/);
});
