import { episode, EPISODE_SECONDS, random, type Config, type Learning, type QTable } from './engine';

export interface Point { episode: number; training: number; evaluation: number; baseline: number; wait: number; delivered: number }
export interface Checkpoint { episode: number; score: number; q: QTable }
export type TrainingMessage = { type: 'progress'; episodes: number; steps: number; decisions: number; states: number; seconds: number; point: Point; checkpoint: Checkpoint } | { type: 'error'; message: string };
let running = false;
let config: Config;
let learning: Learning;
let q: QTable = {};
let episodes = 0;
let decisions = 0;
let start = 0;
let baseline = 0;
let generation = 0;
const evaluationSeeds = [910001, 910002, 910003, 910004];
function evaluate() {
  const results = evaluationSeeds.map(seed => episode(config, seed, q));
  return { score: results.reduce((n, r) => n + r.score, 0) / results.length, wait: results.reduce((n, r) => n + r.meanWait, 0) / results.length, delivered: results.reduce((n, r) => n + r.delivered, 0) / results.length };
}
function batch(id: number) {
  if (!running || id !== generation) return;
  try {
    let score = 0;
    for (let i = 0; i < 20; i++) {
      const seed = config.seed + episodes + 1;
      const result = episode(config, seed, q, learning, random(seed + 77231));
      score += result.score; decisions += result.decisions;
      episodes++;
    }
    const evaluation = evaluate();
    const message: TrainingMessage = { type: 'progress', episodes, steps: episodes * EPISODE_SECONDS, decisions, states: Object.keys(q).length,
      seconds: (performance.now() - start) / 1000,
      point: { episode: episodes, training: score / 20, evaluation: evaluation.score, baseline, wait: evaluation.wait, delivered: evaluation.delivered },
      checkpoint: { episode: episodes, score: evaluation.score, q } };
    postMessage(message);
    setTimeout(() => batch(id), 10);
  } catch (error) { running = false; postMessage({ type: 'error', message: error instanceof Error ? error.message : 'Training failed' }); }
}
self.onmessage = (event: MessageEvent<{ type: string; config: Config; learning: Learning }>) => {
  const data = event.data;
  if (data.type === 'pause') { running = false; generation++; return; }
  if (data.type === 'start') {
    running = false; generation++; config = data.config; learning = data.learning; q = {}; episodes = 0; decisions = 0; start = performance.now();
    baseline = evaluationSeeds.reduce((n, seed) => n + episode(config, seed).score, 0) / evaluationSeeds.length;
  } else if (data.type === 'resume') { learning = data.learning; }
  running = true; const id = ++generation; batch(id);
};
