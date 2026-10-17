import { collectiveStop, greedy, type Car, type Simulation, type QTable } from './engine';
import type { Stop } from './pddl';
import { argmax, forward, type Network } from './network';

export type Algorithm = 'tabular' | 'ddqn' | 'ppo';
export const ALGORITHM_NAMES: Record<Algorithm, string> = { tabular: 'Tabular Q-learning', ddqn: 'Dueling Double DQN', ppo: 'PPO' };
export interface Policy { algorithm: Algorithm; q: QTable; network?: Network }
export const ACTIONS = 46 * 3;
// Each floor has onboard destination, upward call and downward call actions.
export function actionId(stop: Stop) { return (stop.floor + 5) * 3 + (stop.inside ? 0 : stop.direction > 0 ? 1 : 2); }
export const CONTEXT_FEATURES = 24;
export const STOP_FEATURES = 18;
export const OBSERVATIONS = CONTEXT_FEATURES + ACTIONS * STOP_FEATURES;
export function observe(sim: Simulation, selected: Car, legal = sim.candidates(selected)) {
  const waiting = sim.waiting(), c = sim.config;
  const active = sim.cars.filter(car => car.enabled);
  const oldest = waiting.reduce((m, p) => Math.max(m, sim.time - p.arrived), 0);
  const x = new Float32Array(OBSERVATIONS);
  x.set([
    Math.min(sim.time, 360) / 360, c.floors / 40, c.capacity / 16, c.speed / 3, c.doors / 10, c.demand / 30,
    c.waitWeight / 4, c.tailWeight / 4, c.rideWeight / 4, active.length / 5,
    waiting.length / 32, oldest / 360, selected.passengers.length / c.capacity, selected.direction,
    (selected.position + 5) / 45, legal.length / 16,
    ...['night', 'morning', 'evening', 'mixed'].map(pattern => Number(c.pattern === pattern)),
    active.reduce((n, car) => n + car.passengers.length, 0) / (active.length * c.capacity),
    active.filter(car => car.target !== null).length / active.length,
    waiting.filter(p => p.from <= 0).length / 16,
    waiting.reduce((n, p) => n + sim.time - p.arrived, 0) / 3600,
  ]);
  const look = collectiveStop(selected.position, selected.direction, legal);
  for (const stop of legal) {
    const distance = Math.abs(stop.floor - selected.position), heading = Math.sign(stop.floor - selected.position);
    const queue = waiting.filter(p => p.from === stop.floor && Math.sign(p.to - p.from) === stop.direction);
    const onboard = selected.passengers.map(id => sim.people[id]);
    const passing = onboard.filter(p => (p.to - selected.position) * heading >= 0 && (p.to - stop.floor) * heading < 0).length;
    const otherDistance = Math.min(45, ...active.filter(car => car.id !== selected.id).map(car => Math.abs((car.target ?? car.position) - stop.floor)));
    x.set([
      1, distance / 45, (stop.floor - selected.position) / 45, Number(stop.inside), stop.direction,
      stop.age / 360, (stop.count ?? 1) / 16, (stop.ageSum ?? stop.age) / 3600,
      Number(heading === selected.direction || heading === 0), Number(stop.direction === selected.direction),
      passing / c.capacity, Number(stop === look), otherDistance / 45,
      (Math.ceil(distance / c.speed) + c.doors) / 60,
      Math.min(queue.length, c.capacity - selected.passengers.length) / c.capacity,
      (stop.floor + 5) / 45,
      Number(onboard.some(p => p.to === stop.floor)),
      queue.reduce((n, p) => n + c.waitWeight / 60 + 2 * c.tailWeight * (sim.time - p.arrived) / 3600, 0),
    ], CONTEXT_FEATURES + actionId(stop) * STOP_FEATURES);
  }
  return x;
}
export function qValues(output: Float32Array) {
  const values = new Float32Array(ACTIONS); let mean = 0;
  for (let a = 0; a < ACTIONS; a++) mean += output[a] / ACTIONS;
  for (let a = 0; a < ACTIONS; a++) values[a] = output[ACTIONS] + output[a] - mean;
  return values;
}
export function policyStop(sim: Simulation, car: Car, candidates: Stop[], policy: Policy): Stop {
  if (!policy.network) return heuristicStop(sim, car, candidates, greedy(policy.q, sim.stateKey()));
  const output = forward(policy.network, observe(sim, car, candidates)).output;
  const values = policy.algorithm === 'ddqn' ? qValues(output) : output;
  const a = argmax(values, candidates.map(actionId));
  return candidates.find(s => actionId(s) === a)!;
}
export function heuristicStop(_sim: Simulation, car: Car, candidates: Stop[], action = 0): Stop {
  if (action === 0) return collectiveStop(car.position, car.direction, candidates)!;
  const cost = (s: Stop) => {
    const d = Math.abs(s.floor - car.position);
    return action === 2 ? d * 0.2 - s.age * 0.1 - Number(s.inside) * 3 : action === 3 ? d - s.age * 0.12 + ((s.floor - car.position) * car.direction < 0 ? 8 : 0) - Number(s.inside) * 8 : d - Number(s.inside) * 2;
  };
  return [...candidates].sort((a, b) => cost(a) - cost(b) || a.floor - b.floor)[0];
}
