import { collectiveStop, greedy, type Car, type Simulation, type QTable } from './engine';
import type { Stop } from './pddl';
import { argmax, forward, type Network } from './network';

export type Algorithm = 'tabular' | 'ddqn' | 'ppo';
export const ALGORITHM_NAMES: Record<Algorithm, string> = { tabular: 'Tabular Q-learning', ddqn: 'Dueling Double DQN', ppo: 'PPO' };
export interface Policy { algorithm: Algorithm; q: QTable; network?: Network }
export const ACTIONS = 46 * 3;
// Each floor has onboard destination, upward call and downward call actions.
export function actionId(stop: Stop) { return (stop.floor + 5) * 3 + (stop.inside ? 0 : stop.direction > 0 ? 1 : 2); }
export function observe(sim: Simulation, selected: Car) {
  const x: number[] = [];
  const waiting = sim.waiting();
  for (let floor = -5; floor <= 40; floor++) {
    x.push(Number(floor <= sim.config.floors));
    for (const direction of [1, -1]) {
      const queue = waiting.filter(p => p.from === floor && Math.sign(p.to - p.from) === direction);
      x.push(queue.length / 16, queue.reduce((age, p) => Math.max(age, sim.time - p.arrived), 0) / 360);
    }
    for (let id = 0; id < 5; id++) x.push(Number(sim.cars[id]?.passengers.some(p => sim.people[p].to === floor) ?? false));
  }
  for (let id = 0; id < 5; id++) {
    const c = sim.cars[id];
    x.push(c ? 1 : 0, Number(c?.enabled ?? false), c ? (c.position + 5) / 45 : 0, c?.direction ?? 0,
      c?.passengers.length ? c.passengers.length / sim.config.capacity : 0, c?.target == null ? -1 : (c.target + 5) / 45,
      c?.pickupDirection ?? 0, (c?.door ?? 0) / 10, Number(id === selected.id));
  }
  const c = sim.config;
  x.push(Math.min(sim.time, 360) / 360, c.floors / 40, c.capacity / 16, c.speed / 3, c.doors / 10, c.demand / 30,
    c.waitWeight / 4, c.tailWeight / 4, c.rideWeight / 4);
  for (const pattern of ['night', 'morning', 'evening', 'mixed']) x.push(Number(c.pattern === pattern));
  return Float32Array.from(x);
}
export const OBSERVATIONS = 46 * 10 + 5 * 9 + 13;
export function qValues(output: Float32Array) {
  const values = new Float32Array(ACTIONS); let mean = 0;
  for (let a = 0; a < ACTIONS; a++) mean += output[a] / ACTIONS;
  for (let a = 0; a < ACTIONS; a++) values[a] = output[ACTIONS] + output[a] - mean;
  return values;
}
export function policyStop(sim: Simulation, car: Car, candidates: Stop[], policy: Policy): Stop {
  if (!policy.network) return heuristicStop(sim, car, candidates, greedy(policy.q, sim.stateKey()));
  const output = forward(policy.network, observe(sim, car)).output;
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
