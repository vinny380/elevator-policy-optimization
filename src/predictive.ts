import { type Simulation, type Car } from './engine';
import { heuristicStop } from './policy';
import type { Stop } from './pddl';

export function predictiveStop(sim: Simulation, car: Car, candidates: Stop[]): Stop {
  if (candidates.length === 1) return candidates[0];
  // Bounded rollout search: six diverse first stops, two common sampled futures,
  // 45 seconds each, LOOK continuation. Replan when the next car needs a stop.
  const shortlist: Stop[] = [];
  const add = (s: Stop) => { if (!shortlist.includes(s)) shortlist.push(s); };
  for (let strategy = 0; strategy < 4; strategy++) add(heuristicStop(sim, car, candidates, strategy));
  for (const stop of [...candidates].sort((a, b) => b.age - a.age)) if (shortlist.length < 6) add(stop);
  let best = shortlist[0], bestCost = Infinity;
  for (const stop of shortlist) {
    let cost = 0;
    for (let sample = 0; sample < 2; sample++) {
      const forecast = sim.forecast(177013 + sim.time * 31 + car.id * 503 + sample * 7919);
      const selected = forecast.cars[car.id];
      selected.target = stop.floor; selected.pickupDirection = stop.inside ? null : stop.direction;
      if (Math.abs(stop.floor - selected.position) > 0.01) selected.direction = Math.sign(stop.floor - selected.position);
      else if (!stop.inside) selected.direction = stop.direction;
      const horizon = sim.time < 360 ? Math.min(45, 360 - sim.time) : 45;
      for (let t = 0; t < horizon; t++) forecast.step(heuristicStop);
      cost += forecast.cost - sim.cost;
    }
    if (cost < bestCost) { bestCost = cost; best = stop; }
  }
  return best;
}
