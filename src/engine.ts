import { planStops, type PlanningSnapshot, type Stop } from './pddl';

export type Pattern = 'night' | 'morning' | 'evening' | 'mixed';
export interface Config {
  floors: number; cars: number; enabled: boolean[]; capacity: number;
  speed: number; doors: number; demand: number; pattern: Pattern; seed: number;
  waitWeight: number; tailWeight: number; rideWeight: number;
}
export const defaults: Config = {
  floors: 40, cars: 3, enabled: [true, false, false, true, true], capacity: 8,
  speed: 1.5, doors: 4, demand: 5, pattern: 'night', seed: 42,
  waitWeight: 1, tailWeight: 2, rideWeight: 0.25,
};
export interface Passenger {
  id: number; from: number; to: number; arrived: number;
  boarded: number | null; delivered: number | null; car: number | null;
}
export interface Car {
  id: number; position: number; target: number | null; direction: number;
  pickupDirection: number | null; door: number; enabled: boolean; passengers: number[]; reason: string;
}
export type StopSelector = (sim: Simulation, car: Car, candidates: Stop[]) => Stop;
export interface Metrics {
  waiting: number; riding: number; delivered: number; meanWait: number;
  p95: number; longest: number; cost: number; distance: number; score: number;
}
export const STRATEGIES = ['Collective', 'Nearest stop', 'Oldest call', 'Balanced'] as const;
export const MIN_FLOOR = -5;
export const EPISODE_SECONDS = 360;
export const PDDL_ACTION = 4;
export const BASELINE_NAME = 'Selective collective (LOOK)';
export function collectiveStop(position: number, direction: number, candidates: Stop[]): Stop | undefined {
  for (const heading of [direction, -direction]) {
    const ahead = candidates.filter(p => (p.floor - position) * heading >= 0);
    const matching = ahead.filter(p => p.inside || p.direction === heading);
    if (matching.length) return matching.sort((a, b) => Math.abs(a.floor - position) - Math.abs(b.floor - position))[0];
    // With only opposite-direction calls ahead, go to the farthest call and sweep back.
    if (ahead.length) return ahead.sort((a, b) => (b.floor - a.floor) * heading)[0];
  }
}
export function floorLabel(n: number) { return n < 0 ? `P${-n}` : n === 0 ? 'G' : String(n); }
export function random(seed: number) {
  let s = seed >>> 0;
  return () => { s += 0x6D2B79F5; let t = s; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
export function validateConfig(c: Config) {
  const ranges: [number, number, number][] = [[c.floors, 10, 40], [c.cars, 1, 5], [c.capacity, 2, 16], [c.speed, 0.5, 3], [c.doors, 2, 10], [c.demand, 1, 30], [c.waitWeight, 0, 4], [c.tailWeight, 0, 4], [c.rideWeight, 0, 4]];
  if (ranges.some(([x, a, b]) => !Number.isFinite(x) || x < a || x > b) || !Number.isInteger(c.floors) || !Number.isInteger(c.cars) || !Number.isInteger(c.capacity) || !Number.isInteger(c.seed) || !['night', 'morning', 'evening', 'mixed'].includes(c.pattern)) throw new Error('Invalid simulation configuration');
  if (c.enabled.length < c.cars || !c.enabled.slice(0, c.cars).some(Boolean)) throw new Error('Keep at least one elevator in service.');
}
export class Simulation {
  config: Config; cars: Car[]; people: Passenger[] = []; time = 0; cost = 0; distance = 0;
  lastPlan: PlanningSnapshot | null = null; plannerFallbacks = 0;
  private rng: () => number; private nextArrival: number;
  constructor(config: Config, seed = config.seed) {
    validateConfig(config); this.config = { ...config, enabled: [...config.enabled] }; this.rng = random(seed);
    this.cars = Array.from({ length: config.cars }, (_, id) => ({ id, position: 0, target: null, direction: 1, pickupDirection: null, door: 0, enabled: config.enabled[id], passengers: [], reason: config.enabled[id] ? 'Waiting for a call' : 'Out of service' }));
    if (config.pattern === 'night') {
      const car = this.cars.find(c => c.enabled)!;
      car.position = Math.min(30, config.floors); car.direction = -1;
      const rider = this.addPassenger(car.position, -5, 0);
      rider.boarded = 0; rider.car = car.id; car.passengers.push(rider.id);
      this.addPassenger(0, 10, 0);
    }
    this.nextArrival = this.arrivalInterval();
  }
  private arrivalInterval() { return -Math.log(Math.max(1e-9, 1 - this.rng())) * 60 / this.config.demand; }
  addPassenger(from: number, to: number, arrived = this.time) {
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < -5 || to < -5 || from > this.config.floors || to > this.config.floors || from === to) throw new Error('Invalid passenger journey');
    const p: Passenger = { id: this.people.length, from, to, arrived, boarded: null, delivered: null, car: null };
    this.people.push(p); return p;
  }
  private spawn(at: number) {
    const floor = () => 1 + Math.floor(this.rng() * this.config.floors);
    let from: number, to: number;
    if (this.config.pattern === 'morning') { from = this.rng() < 0.8 ? 0 : -1 - Math.floor(this.rng() * 5); to = floor(); }
    else if (this.config.pattern === 'evening') { from = floor(); to = this.rng() < 0.8 ? 0 : -1 - Math.floor(this.rng() * 5); }
    else if (this.config.pattern === 'night') { from = this.rng() < 0.6 ? 0 : floor(); to = from === 0 ? floor() : (this.rng() < 0.6 ? -5 : 0); }
    else { from = Math.floor(this.rng() * (this.config.floors + 6)) - 5; do { to = Math.floor(this.rng() * (this.config.floors + 6)) - 5; } while (to === from); }
    this.addPassenger(from, to, at);
  }
  waiting() { return this.people.filter(p => p.boarded === null); }
  readyForDecision() { return this.cars.some(c => c.enabled && c.target === null && c.door === 0); }
  stateKey() {
    const waiting = this.waiting();
    const calls = new Set(waiting.map(p => `${p.from}:${Math.sign(p.to - p.from)}`)).size;
    const oldest = waiting.reduce((m, p) => Math.max(m, this.time - p.arrived), 0);
    const cars = this.cars.filter(c => c.enabled);
    const load = cars.reduce((n, c) => n + c.passengers.length, 0) / (cars.length * this.config.capacity);
    const lobby = waiting.some(p => p.from <= 0);
    const high = cars.reduce((n, c) => n + c.position, 0) / cars.length > this.config.floors / 2;
    const ready = cars.find(c => c.target === null && c.door === 0);
    return [Math.min(3, Math.floor(calls / 3)), Math.min(3, Math.floor(oldest / 30)), Math.min(2, Math.floor(load * 3)), Number(lobby), Number(high), cars.length,
      ready?.direction ?? 0, ready ? Math.floor((ready.position + 5) / 10) : -1,
      Math.min(2, Math.floor(this.time / 120))].join(':');
  }
  candidates(car: Car, claimed = new Set(this.cars.filter(c => c.enabled && c.target !== null && c.pickupDirection !== null && c.passengers.length < this.config.capacity).map(c => `${c.target}:${c.pickupDirection}`))): Stop[] {
    const onboard = car.passengers.map(id => this.people[id]);
    const hall = this.waiting().filter(p => car.passengers.length < this.config.capacity &&
      (!onboard.length || Math.sign(p.to - p.from) === Math.sign(onboard[0].to - p.from)) &&
      !claimed.has(`${p.from}:${Math.sign(p.to - p.from)}`));
    const candidates = [...onboard.map(p => ({ floor: p.to, direction: Math.sign(p.to - car.position), age: this.time - p.arrived, inside: true })), ...hall.map(p => ({ floor: p.from, direction: Math.sign(p.to - p.from), age: this.time - p.arrived, inside: false }))];
    const unique = new Map<string, Stop>();
    for (const stop of candidates) {
      const key = `${stop.floor}:${stop.inside ? 0 : stop.direction}`;
      const previous = unique.get(key);
      if (previous) { previous.count = (previous.count ?? 1) + 1; previous.ageSum = (previous.ageSum ?? previous.age) + stop.age; previous.age = Math.max(previous.age, stop.age); }
      else unique.set(key, { ...stop, count: 1, ageSum: stop.age });
    }
    return [...unique.values()];
  }
  private chooseStop(car: Car, action: number | StopSelector, claimed: Set<string>) {
    const candidates = this.candidates(car, claimed);
    if (!candidates.length) { car.target = null; car.reason = 'No outstanding calls'; return; }
    let stop: Stop | undefined;
    if (typeof action === 'function') {
      const selected = action(this, car, candidates);
      stop = candidates.find(s => s.floor === selected.floor && s.inside === selected.inside && s.direction === selected.direction);
      if (!stop) throw new Error('Policy selected an illegal stop');
    }
    let fallback = false;
    if (action === PDDL_ACTION) {
      this.lastPlan = planStops(car.position, candidates, this.config.speed, this.config.doors, car.id, this.time, this.config);
      stop = this.lastPlan.firstStop ?? undefined;
      if (!stop) { this.plannerFallbacks++; fallback = true; }
    }
    if (action === 0 || fallback) stop = collectiveStop(car.position, car.direction, candidates);
    const cost = (p: typeof candidates[number]) => {
      const distance = Math.abs(p.floor - car.position);
      if (action === 2) return distance * 0.2 - p.age * 0.1 - Number(p.inside) * 3;
      if (action === 3) return distance - p.age * 0.12 + ((p.floor - car.position) * car.direction < 0 ? 8 : 0) - Number(p.inside) * 8;
      return distance - Number(p.inside) * (action === 1 ? 2 : 0);
    };
    if (!stop) stop = candidates.sort((a, b) => cost(a) - cost(b) || a.floor - b.floor)[0];
    car.target = stop.floor; car.pickupDirection = stop.inside ? null : stop.direction;
    if (Math.abs(stop.floor - car.position) > 0.01) car.direction = Math.sign(stop.floor - car.position);
    else if (!stop.inside) car.direction = stop.direction;
    car.reason = `${action === PDDL_ACTION ? (fallback ? 'PDDL limit → LOOK fallback' : 'PDDL plan') : typeof action === 'function' ? 'Policy' : STRATEGIES[action]} → ${floorLabel(stop.floor)} · ${stop.inside ? 'onboard destination' : 'hall call'}`;
    if (!stop.inside) claimed.add(`${stop.floor}:${stop.direction}`);
  }
  private arrive(car: Car) {
    for (const id of car.passengers) {
      const p = this.people[id];
      if (p.to === car.position) { p.delivered = this.time; p.car = null; }
    }
    car.passengers = car.passengers.filter(id => this.people[id].delivered === null);
    const waiting = this.waiting().filter(p => p.from === car.position);
    if (car.pickupDirection !== null) car.direction = car.pickupDirection;
    else if (car.passengers.length === 0 && waiting.length) {
      const demandAhead = this.waiting().some(p => (p.from - car.position) * car.direction > 0 ||
        (p.from === car.position && Math.sign(p.to - p.from) === car.direction));
      if (!demandAhead) car.direction = Math.sign(waiting[0].to - waiting[0].from);
    }
    for (const p of waiting) {
      if (car.passengers.length >= this.config.capacity) break;
      if (Math.sign(p.to - p.from) !== car.direction) continue;
      p.boarded = this.time; p.car = car.id; car.passengers.push(p.id);
    }
    car.target = null; car.pickupDirection = null; car.door = this.config.doors;
  }
  // A fixed one-second step makes reward and arrivals independent of rendering speed.
  step(action: number | StopSelector = 0, arrivals = true) {
    if (typeof action !== 'function' && (!Number.isInteger(action) || action < 0 || action > PDDL_ACTION)) throw new Error('Unknown routing strategy');
    const before = this.cost;
    if (arrivals) while (this.nextArrival <= this.time + 1) { this.spawn(this.nextArrival); this.nextArrival += this.arrivalInterval(); }
    for (const p of this.people) {
      if (p.boarded === null) {
        const w = Math.max(0, this.time - p.arrived), nextWait = this.time + 1 - p.arrived;
        this.cost += this.config.waitWeight * (nextWait - w) / 60 + this.config.tailWeight * (nextWait ** 2 - w ** 2) / 3600;
      } else if (p.delivered === null) this.cost += this.config.rideWeight / 60;
    }
    this.time++;
    const claimed = new Set<string>();
    for (const car of this.cars) if (car.enabled && car.target !== null && car.passengers.length < this.config.capacity) {
      if (car.pickupDirection !== null) claimed.add(`${car.target}:${car.pickupDirection}`);
    }
    for (const car of this.cars) {
      if (!car.enabled) continue;
      if (car.door > 0) { car.door--; continue; }
      if (car.target === null) this.chooseStop(car, action, claimed);
      if (car.target === null) continue;
      const delta = car.target - car.position;
      const move = Math.min(Math.abs(delta), this.config.speed);
      car.position += Math.sign(delta) * move; this.distance += move;
      if (Math.abs(car.position - car.target) < 0.0001) { car.position = car.target; this.arrive(car); }
    }
    return -(this.cost - before);
  }
  forecast(seed: number) {
    const copy = new Simulation(this.config, seed);
    copy.time = this.time; copy.cost = this.cost; copy.distance = this.distance;
    copy.cars = structuredClone(this.cars);
    copy.people = this.people.map(p => {
      if (p.boarded !== null) return { ...p };
      const direction = Math.sign(p.to - p.from);
      const destinations = Array.from({ length: this.config.floors + 6 }, (_, i) => i - 5).filter(f => Math.sign(f - p.from) === direction);
      // Condition the configured traffic prior on the observed hall-call direction.
      const weights = destinations.map(f => this.config.pattern === 'evening' ? (f === 0 ? 4 : f < 0 ? 0.2 : 0) : this.config.pattern === 'night' && p.from > 0 ? (f === -5 ? 3 : f === 0 ? 2 : 0) : this.config.pattern === 'morning' || (this.config.pattern === 'night' && p.from === 0) ? Number(f > 0) : 1);
      const total = weights.reduce((a, b) => a + b, 0);
      let draw = copy.rng() * (total || destinations.length), to = destinations.at(-1)!;
      for (let i = 0; i < destinations.length; i++) { draw -= total ? weights[i] : 1; if (draw < 0) { to = destinations[i]; break; } }
      return { ...p, to };
    });
    copy.nextArrival = copy.time + copy.arrivalInterval();
    return copy;
  }
  metrics(): Metrics {
    const waits = this.people.map(p => (p.boarded ?? this.time) - p.arrived).sort((a, b) => a - b);
    return { waiting: this.waiting().length, riding: this.people.filter(p => p.boarded !== null && p.delivered === null).length,
      delivered: this.people.filter(p => p.delivered !== null).length,
      meanWait: waits.reduce((a, b) => a + b, 0) / Math.max(1, waits.length),
      p95: waits[Math.max(0, Math.ceil(waits.length * 0.95) - 1)] ?? 0, longest: waits.at(-1) ?? 0,
      cost: this.cost, distance: this.distance, score: -this.cost / Math.max(1, this.people.length) };
  }
}

export type QTable = Record<string, number[]>;
export interface Learning { alpha: number; epsilon: number; gamma: number }
export const learningDefaults: Learning = { alpha: 0.12, epsilon: 0.2, gamma: 0.99 };
export function greedy(q: QTable, key: string) {
  const row = q[key]; if (!row) return 0;
  return row.indexOf(Math.max(...row));
}
export function qUpdate(q: QTable, key: string, action: number, reward: number, next: string, terminal: boolean, learning: Learning, elapsed = 1) {
  const row = q[key] ?? (q[key] = [0, 0, 0, 0]);
  const future = terminal ? 0 : Math.max(...(q[next] ?? [0, 0, 0, 0]));
  row[action] += learning.alpha * (reward + learning.gamma ** elapsed * future - row[action]);
}
// Credit a strategy for the entire interval until a car can choose another stop.
// Rewards and the bootstrap use the same per-second discount (semi-Markov Q-learning).
export function decisionStep(sim: Simulation, action: number, gamma: number, arrivals = true) {
  let reward = 0, elapsed = 0;
  do {
    reward += gamma ** elapsed * sim.step(action, arrivals);
    elapsed++;
  } while (sim.time < EPISODE_SECONDS && !sim.readyForDecision());
  return { reward, elapsed };
}
export function episode(config: Config, seed: number, q?: QTable, learning?: Learning, rng = random(seed + 100000)) {
  const sim = new Simulation(config, seed);
  let decisions = 0;
  while (sim.time < EPISODE_SECONDS) {
    const key = sim.stateKey();
    const action = q ? (learning && rng() < learning.epsilon ? Math.floor(rng() * 4) : greedy(q, key)) : 0;
    const { reward, elapsed } = decisionStep(sim, action, learning?.gamma ?? 1);
    decisions++;
    if (q && learning) qUpdate(q, key, action, reward, sim.stateKey(), sim.time === EPISODE_SECONDS, learning, elapsed);
  }
  return { ...sim.metrics(), decisions };
}
