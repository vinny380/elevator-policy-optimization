import { EPISODE_SECONDS, type Simulation, type Car } from './engine';
import { heuristicStop } from './policy';
import type { Stop } from './pddl';

export interface RolloutSettings { horizon: number; samples: number; uncertainty: number }
export const rolloutDefaults: RolloutSettings = { horizon: 150, samples: 4, uncertainty: 1 };
export function predictiveStop(sim: Simulation, car: Car, candidates: Stop[], settings = rolloutDefaults): Stop {
  if (candidates.length === 1) return candidates[0];
  // Bounded rollout search: six diverse first stops, common independently sampled futures,
  // bounded horizon, LOOK continuation. Replan when the next car needs a stop.
  const shortlist: Stop[] = [];
  const add = (s: Stop) => { if (!shortlist.includes(s)) shortlist.push(s); };
  for (let strategy = 0; strategy < 4; strategy++) add(heuristicStop(sim, car, candidates, strategy));
  for (const stop of [...candidates].sort((a, b) => b.age - a.age)) if (shortlist.length < 6) add(stop);
  let best = shortlist[0], bestCost = 0;
  let reference: number[] = [];
  for (const stop of shortlist) {
    const costs: number[] = [];
    for (let sample = 0; sample < settings.samples; sample++) {
      const forecast = sim.forecast(177013 + sim.time * 31 + car.id * 503 + sample * 7919);
      const selected = forecast.cars[car.id];
      selected.target = stop.floor; selected.pickupDirection = stop.inside ? null : stop.direction;
      if (Math.abs(stop.floor - selected.position) > 0.01) selected.direction = Math.sign(stop.floor - selected.position);
      else if (!stop.inside) selected.direction = stop.direction;
      const horizon = sim.time < EPISODE_SECONDS ? Math.min(settings.horizon, EPISODE_SECONDS - sim.time) : settings.horizon;
      for (let t = 0; t < horizon; t++) forecast.step(heuristicStop);
      costs.push(forecast.cost - sim.cost);
    }
    if (!reference.length) { reference = costs; continue; }
    const difference = costs.map((cost, i) => cost - reference[i]);
    const mean = difference.reduce((a, b) => a + b, 0) / difference.length;
    const se = difference.length < 2 ? 0 : Math.sqrt(difference.reduce((s, d) => s + (d - mean) ** 2, 0) / (difference.length - 1) / difference.length);
    // Keep LOOK unless the simulated saving also covers sampling uncertainty.
    const cost = mean + settings.uncertainty * se;
    if (cost < bestCost) { bestCost = cost; best = stop; }
  }
  return best;
}
