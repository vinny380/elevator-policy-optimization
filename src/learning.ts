import { Simulation, EPISODE_SECONDS, episode, random, type Config, type Learning } from './engine';
import { ACTIONS, OBSERVATIONS, actionId, observe, qValues, heuristicStop, policyStop, type Algorithm, type Policy } from './policy';
import { network, forward, backward, Adam, argmax, probabilities, sample, type Network } from './network';

export interface NeuralSettings { rate: number; clip: number; entropy: number; batch: number; epochs: number; targetEvery: number; pretrain: number; seed: number }
export const neuralDefaults: NeuralSettings = { rate: 0.0003, clip: 0.2, entropy: 0.01, batch: 32, epochs: 4, targetEvery: 100, pretrain: 0, seed: 7 };
export interface Transition { x: Float32Array; legal: number[]; action: number; reward: number; elapsed: number; next: Float32Array; nextLegal: number[]; terminal: boolean; logp: number; value: number }
export interface Decision { x: Float32Array; legal: number[]; action: number; time: number; logp: number; value: number }
export function makeTransitions(events: Decision[], rewards: number[], gamma: number): Transition[] {
  return events.map((event, i) => {
    const next = events[i + 1], end = next?.time ?? rewards.length; let reward = 0;
    for (let t = event.time; t < end; t++) reward += gamma ** (t - event.time) * rewards[t];
    return { ...event, reward, elapsed: end - event.time, next: next?.x ?? new Float32Array(OBSERVATIONS), nextLegal: next?.legal ?? [], terminal: !next };
  });
}
export function doubleTarget(t: Transition, online: Network, target: Network, gamma: number) {
  if (t.terminal) return t.reward;
  const choice = argmax(qValues(forward(online, t.next).output), t.nextLegal);
  return t.reward + gamma ** t.elapsed * qValues(forward(target, t.next).output)[choice];
}
export function advantages(transitions: Transition[], gamma: number, lambda = 0.95) {
  const advantage = new Float32Array(transitions.length), returns = new Float32Array(transitions.length); let gae = 0;
  for (let i = transitions.length - 1; i >= 0; i--) {
    const t = transitions[i], discount = t.terminal ? 0 : gamma ** t.elapsed;
    const delta = t.reward + discount * (transitions[i + 1]?.value ?? 0) - t.value;
    gae = delta + discount * lambda * gae;
    advantage[i] = gae; returns[i] = gae + t.value;
  }
  return { advantage, returns };
}
// Derivative of the negative clipped surrogate with respect to log π(a|s).
export function clippedDerivative(ratio: number, advantage: number, clip: number) {
  return (advantage >= 0 && ratio > 1 + clip) || (advantage < 0 && ratio < 1 - clip) ? 0 : -advantage * ratio;
}
export function ppoGradient(output: Float32Array, t: Transition, advantage: number, returns: number, settings: NeuralSettings) {
  const p = probabilities(output, t.legal), dy = new Float32Array(ACTIONS + 1);
  const ratio = Math.exp(Math.log(Math.max(1e-30, p[t.action])) - t.logp);
  const derivative = clippedDerivative(ratio, advantage, settings.clip);
  let entropy = 0;
  for (const a of t.legal) entropy -= p[a] * Math.log(Math.max(1e-30, p[a]));
  for (const a of t.legal) dy[a] = derivative * (Number(a === t.action) - p[a]) + settings.entropy * p[a] * (Math.log(Math.max(1e-30, p[a])) + entropy);
  dy[ACTIONS] = 0.5 * (output[ACTIONS] - returns);
  return dy;
}
export function validateSettings(l: Learning, n: NeuralSettings) {
  if (![l.alpha, l.epsilon, l.gamma].every(v => Number.isFinite(v) && v >= 0 && v <= 1) ||
    !Number.isFinite(n.rate) || n.rate < 0.00001 || n.rate > 0.01 || !Number.isFinite(n.clip) || n.clip < 0.05 || n.clip > 0.4 ||
    !Number.isFinite(n.entropy) || n.entropy < 0 || n.entropy > 0.1 || ![16, 32, 64].includes(n.batch) ||
    !Number.isInteger(n.epochs) || n.epochs < 1 || n.epochs > 8 || !Number.isInteger(n.targetEvery) || n.targetEvery < 10 || n.targetEvery > 1000 ||
    !Number.isInteger(n.pretrain) || n.pretrain < 0 || n.pretrain > 100 || !Number.isInteger(n.seed)) throw new Error('Invalid learning settings');
}
export class Trainer {
  policy: Policy; target?: Network; optimizer?: Adam;
  episodes = 0; decisions = 0; updates = 0; pretrainingEpisodes = 0;
  private replay: Transition[] = []; private cursor = 0; private rng: () => number;
  constructor(public config: Config, public algorithm: Algorithm, public learning: Learning, public settings: NeuralSettings) {
    validateSettings(learning, settings);
    if (!['tabular', 'ddqn', 'ppo'].includes(algorithm)) throw new Error('Unknown learning algorithm');
    this.rng = random(settings.seed);
    this.policy = { algorithm, q: {} };
    if (algorithm !== 'tabular') {
      this.policy.network = network(OBSERVATIONS, 32, ACTIONS + 1, this.rng);
      this.target = structuredClone(this.policy.network); this.optimizer = new Adam(this.policy.network);
    }
  }
  configure(learning: Learning, settings: NeuralSettings) {
    validateSettings(learning, settings);
    // Stored interval rewards depend on gamma; never mix discounts in replay.
    if (learning.gamma !== this.learning.gamma) { this.replay = []; this.cursor = 0; }
    this.learning = learning; this.settings = settings;
  }
  get size() { return this.policy.network?.weights.length ?? Object.keys(this.policy.q).length; }
  get phase() { return this.algorithm === 'ppo' && this.pretrainingEpisodes < this.settings.pretrain ? 'Imitating LOOK' : 'Learning'; }
  run() {
    const seed = this.config.seed + this.episodes + this.pretrainingEpisodes + 1;
    if (this.algorithm === 'tabular') {
      const result = episode(this.config, seed, this.policy.q, this.learning, this.rng);
      this.episodes++; this.decisions += result.decisions; return result;
    }
    const sim = new Simulation(this.config, seed), events: Decision[] = [], rewards: number[] = [];
    const imitate = this.phase === 'Imitating LOOK';
    while (sim.time < EPISODE_SECONDS) {
      const reward = sim.step((s, car, candidates) => {
        const x = observe(s, car), legal = candidates.map(actionId), output = forward(this.policy.network!, x).output;
        const p = this.algorithm === 'ppo' ? probabilities(output, legal) : null;
        const action = imitate ? actionId(heuristicStop(s, car, candidates)) : p ? sample(p, legal, this.rng) : this.rng() < this.learning.epsilon ? legal[Math.floor(this.rng() * legal.length)] : argmax(qValues(output), legal);
        events.push({ x, legal, action, time: s.time, logp: p ? Math.log(Math.max(1e-30, p[action])) : 0, value: output[ACTIONS] });
        return candidates.find(stop => actionId(stop) === action)!;
      });
      rewards.push(reward);
    }
    // Decisions occur after a tick's cost accrues, before its car movement. The next
    // tick's cost is the first consequence. Simultaneous car choices have zero duration.
    const transitions = makeTransitions(events, rewards, this.learning.gamma);
    this.decisions += transitions.length;
    if (imitate) { this.imitate(transitions); this.pretrainingEpisodes++; }
    else {
      this.episodes++;
      if (this.algorithm === 'ddqn') {
        for (const t of transitions) { this.replay[this.cursor] = t; this.cursor = (this.cursor + 1) % 4096; }
        // Train between episodes; all behavior samples in an episode use a frozen network.
        for (let i = 0; i < Math.max(1, Math.ceil(transitions.length / 4)); i++) if (this.replay.length >= this.settings.batch) this.dqnUpdate();
      } else this.ppoUpdate(transitions);
    }
    return { ...sim.metrics(), decisions: transitions.length };
  }
  private dqnUpdate() {
    const n = this.policy.network!, gradient = new Float32Array(n.weights.length);
    for (let i = 0; i < this.settings.batch; i++) {
      const t = this.replay[Math.floor(this.rng() * this.replay.length)], { hidden, output } = forward(n, t.x);
      const error = qValues(output)[t.action] - doubleTarget(t, n, this.target!, this.learning.gamma);
      const derivative = Math.max(-1, Math.min(1, error)), dy = new Float32Array(ACTIONS + 1);
      for (let a = 0; a < ACTIONS; a++) dy[a] = derivative * (Number(a === t.action) - 1 / ACTIONS);
      dy[ACTIONS] = derivative;
      backward(n, t.x, hidden, dy, gradient);
    }
    this.optimizer!.step(n, gradient, this.settings.rate, this.settings.batch); this.updates++;
    if (this.updates % this.settings.targetEvery === 0) this.target = structuredClone(n);
  }
  private imitate(transitions: Transition[]) {
    this.minibatches(transitions.length, indices => {
      const n = this.policy.network!, gradient = new Float32Array(n.weights.length);
      for (const i of indices) {
        const t = transitions[i], { hidden, output } = forward(n, t.x), dy = probabilities(output, t.legal);
        dy[t.action] -= 1; dy[ACTIONS] = 0;
        backward(n, t.x, hidden, dy, gradient);
      }
      this.optimizer!.step(n, gradient, this.settings.rate, indices.length); this.updates++;
    });
  }
  private ppoUpdate(transitions: Transition[]) {
    if (!transitions.length) return;
    const { advantage, returns } = advantages(transitions, this.learning.gamma);
    const mean = advantage.reduce((a, b) => a + b, 0) / advantage.length;
    const sd = Math.sqrt(advantage.reduce((s, a) => s + (a - mean) ** 2, 0) / advantage.length + 1e-8);
    this.minibatches(transitions.length, indices => {
      const n = this.policy.network!, gradient = new Float32Array(n.weights.length);
      for (const i of indices) {
        const t = transitions[i], { hidden, output } = forward(n, t.x);
        backward(n, t.x, hidden, ppoGradient(output, t, (advantage[i] - mean) / sd, returns[i], this.settings), gradient);
      }
      this.optimizer!.step(n, gradient, this.settings.rate, indices.length); this.updates++;
    });
  }
  private minibatches(length: number, update: (indices: number[]) => void) {
    const indices = Array.from({ length }, (_, i) => i);
    for (let epoch = 0; epoch < this.settings.epochs; epoch++) {
      for (let i = length - 1; i > 0; i--) { const j = Math.floor(this.rng() * (i + 1)); [indices[i], indices[j]] = [indices[j], indices[i]]; }
      for (let i = 0; i < length; i += this.settings.batch) update(indices.slice(i, i + this.settings.batch));
    }
  }
}
export function evaluatePolicy(config: Config, seed: number, policy: Policy) {
  if (policy.algorithm === 'tabular') return episode(config, seed, policy.q);
  const sim = new Simulation(config, seed);
  for (let t = 0; t < EPISODE_SECONDS; t++) sim.step((s, car, stops) => policyStop(s, car, stops, policy));
  return sim.metrics();
}
