// Small CPU network shared by worker training and deterministic browser inference.
// One tanh layer; output semantics (dueling Q or actor + critic) live in learning.ts.
export interface Network { inputs: number; hidden: number; outputs: number; weights: Float32Array; context?: number; candidate?: number }
export function network(inputs: number, hidden: number, outputs: number, rng: () => number): Network {
  const weights = new Float32Array(inputs * hidden + hidden + hidden * outputs + outputs);
  const n = { inputs, hidden, outputs, weights };
  for (let h = 0; h < hidden; h++) for (let i = 0; i < inputs; i++) weights[h * inputs + i] = (rng() * 2 - 1) * Math.sqrt(6 / (inputs + hidden));
  const offset = inputs * hidden + hidden;
  for (let o = 0; o < outputs; o++) for (let h = 0; h < hidden; h++) weights[offset + o * hidden + h] = (rng() * 2 - 1) * Math.sqrt(6 / (hidden + outputs));
  return n;
}
export function forward(n: Network, x: Float32Array) {
  if (n.candidate) return sharedForward(n, x);
  const { inputs: I, hidden: H, outputs: O, weights: w } = n;
  if (x.length !== I) throw new Error('Observation shape does not match network');
  const hidden = new Float32Array(H), output = new Float32Array(O), b = I * H, v = b + H, c = v + H * O;
  for (let h = 0; h < H; h++) { let sum = w[b + h]; for (let i = 0; i < I; i++) sum += w[h * I + i] * x[i]; hidden[h] = Math.tanh(sum); }
  for (let o = 0; o < O; o++) { let sum = w[c + o]; for (let h = 0; h < H; h++) sum += w[v + o * H + h] * hidden[h]; output[o] = sum; }
  return { hidden, output };
}
export function backward(n: Network, x: Float32Array, hidden: Float32Array, dy: Float32Array, gradient: Float32Array) {
  if (n.candidate) { sharedBackward(n, x, hidden, dy, gradient); return; }
  const { inputs: I, hidden: H, outputs: O, weights: w } = n, b = I * H, v = b + H, c = v + H * O;
  const dh = new Float32Array(H);
  for (let o = 0; o < O; o++) {
    gradient[c + o] += dy[o];
    for (let h = 0; h < H; h++) { gradient[v + o * H + h] += dy[o] * hidden[h]; dh[h] += dy[o] * w[v + o * H + h]; }
  }
  for (let h = 0; h < H; h++) {
    const d = dh[h] * (1 - hidden[h] ** 2); gradient[b + h] += d;
    for (let i = 0; i < I; i++) gradient[h * I + i] += d * x[i];
  }
}
export class Adam {
  private m: Float32Array; private v: Float32Array; private t = 0;
  constructor(n: Network) { this.m = new Float32Array(n.weights.length); this.v = new Float32Array(n.weights.length); }
  step(n: Network, gradient: Float32Array, rate: number, count = 1) {
    this.t++; let norm = 0;
    for (const g of gradient) norm += (g / count) ** 2;
    const scale = Math.min(1, 1 / Math.max(1e-12, Math.sqrt(norm))) / count;
    const b1 = 1 - 0.9 ** this.t, b2 = 1 - 0.999 ** this.t;
    for (let i = 0; i < gradient.length; i++) {
      const g = gradient[i] * scale;
      if (!Number.isFinite(g)) throw new Error('Non-finite training gradient; lower the learning rate and restart.');
      this.m[i] = 0.9 * this.m[i] + 0.1 * g; this.v[i] = 0.999 * this.v[i] + 0.001 * g * g;
      n.weights[i] -= rate * (this.m[i] / b1) / (Math.sqrt(this.v[i] / b2) + 1e-8);
    }
  }
}
export function argmax(values: ArrayLike<number>, legal: number[]) {
  if (!legal.length) throw new Error('No legal actions');
  return legal.reduce((best, a) => values[a] > values[best] ? a : best, legal[0]);
}
export function probabilities(logits: ArrayLike<number>, legal: number[]) {
  const p = new Float32Array(logits.length), max = logits[argmax(logits, legal)]; let total = 0;
  for (const a of legal) { p[a] = Math.exp(logits[a] - max); total += p[a]; }
  for (const a of legal) p[a] /= total;
  return p;
}
export function sample(p: Float32Array, legal: number[], rng: () => number) {
  let draw = rng(); for (const a of legal) { draw -= p[a]; if (draw < 0) return a; } return legal.at(-1)!;
}

// One scorer is reused for every legal stop. The critic has its own parameters,
// so critic gradients do not change the actor's representation.
export function sharedNetwork(context: number, candidate: number, actions: number, hidden: number, rng: () => number): Network {
  const scorer = network(context + candidate, hidden, 1, rng), critic = network(context, hidden, 1, rng);
  const weights = new Float32Array(scorer.weights.length + critic.weights.length);
  weights.set(scorer.weights); weights.set(critic.weights, scorer.weights.length);
  return { inputs: context + candidate * actions, hidden, outputs: actions + 1, weights, context, candidate };
}
function heads(n: Network) {
  const C = n.context!, F = n.candidate!, H = n.hidden, split = (C + F) * H + H + H + 1;
  return {
    scorer: { inputs: C + F, hidden: H, outputs: 1, weights: n.weights.subarray(0, split) },
    critic: { inputs: C, hidden: H, outputs: 1, weights: n.weights.subarray(split) }, split,
  };
}
function sharedForward(n: Network, x: Float32Array) {
  if (x.length !== n.inputs) throw new Error('Observation shape does not match network');
  const C = n.context!, F = n.candidate!, H = n.hidden, actions = n.outputs - 1;
  const { scorer, critic } = heads(n), output = new Float32Array(n.outputs), hidden = new Float32Array(H * n.outputs);
  const input = new Float32Array(C + F); input.set(x.subarray(0, C));
  for (let a = 0; a < actions; a++) {
    const offset = C + a * F; if (!x[offset]) continue;
    input.set(x.subarray(offset, offset + F), C);
    const result = forward(scorer, input); output[a] = result.output[0]; hidden.set(result.hidden, a * H);
  }
  const result = forward(critic, x.subarray(0, C)); output[actions] = result.output[0]; hidden.set(result.hidden, actions * H);
  return { hidden, output };
}
function sharedBackward(n: Network, x: Float32Array, hidden: Float32Array, dy: Float32Array, gradient: Float32Array) {
  const C = n.context!, F = n.candidate!, H = n.hidden, actions = n.outputs - 1;
  const { scorer, critic, split } = heads(n), input = new Float32Array(C + F), delta = new Float32Array(1);
  input.set(x.subarray(0, C));
  for (let a = 0; a < actions; a++) {
    const offset = C + a * F; if (!x[offset] || dy[a] === 0) continue;
    input.set(x.subarray(offset, offset + F), C); delta[0] = dy[a];
    backward(scorer, input, hidden.subarray(a * H, (a + 1) * H), delta, gradient.subarray(0, split));
  }
  delta[0] = dy[actions];
  backward(critic, x.subarray(0, C), hidden.subarray(actions * H), delta, gradient.subarray(split));
}
