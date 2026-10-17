import { episode, EPISODE_SECONDS, type Config, type Learning } from './engine';
import { Trainer, evaluatePolicy, validateSettings, type NeuralSettings } from './learning';
import type { Algorithm, Policy } from './policy';

export interface Point { episode: number; training: number; evaluation: number; baseline: number; wait: number; delivered: number }
export interface Checkpoint { episode: number; score: number; policy: Policy; learning: Learning; neural: NeuralSettings }
export type TrainingMessage = { type: 'progress'; episodes: number; steps: number; decisions: number; states: number; seconds: number; phase: string; pretraining: number; updates: number; point: Point; checkpoint: Checkpoint } | { type: 'error'; message: string };
export interface TrainingRequest { type: 'start' | 'pause' | 'resume'; config: Config; learning: Learning; algorithm: Algorithm; neural: NeuralSettings }
let running = false, generation = 0, start = 0, baseline = 0;
let trainer: Trainer;
const evaluationSeeds = [910001, 910002, 910003, 910004];
let batchScore = 0, batchCount = 0;
function batch(id: number) {
  if (!running || id !== generation) return;
  try {
    // Yield after each episode, so pause/settings messages are handled promptly.
    const result = trainer.run(); batchScore += result.score; batchCount++;
    const interval = trainer.algorithm === 'tabular' ? 20 : 5;
    if (batchCount >= interval) {
      const results = evaluationSeeds.map(seed => evaluatePolicy(trainer.config, seed, trainer.policy));
      const mean = (key: 'score' | 'meanWait' | 'delivered') => results.reduce((n, r) => n + r[key], 0) / results.length;
      // The x axis counts all measured episodes, including explicitly labeled imitation.
      const episodes = trainer.episodes + trainer.pretrainingEpisodes;
      const message: TrainingMessage = { type: 'progress', episodes, steps: episodes * EPISODE_SECONDS, decisions: trainer.decisions, states: trainer.size,
        seconds: (performance.now() - start) / 1000, phase: trainer.phase, pretraining: trainer.pretrainingEpisodes, updates: trainer.updates,
        point: { episode: episodes, training: batchScore / batchCount, evaluation: mean('score'), baseline, wait: mean('meanWait'), delivered: mean('delivered') },
        checkpoint: { episode: episodes, score: mean('score'), policy: trainer.policy, learning: trainer.learning, neural: trainer.settings } };
      postMessage(message); batchScore = 0; batchCount = 0;
    }
    setTimeout(() => batch(id), 0);
  } catch (error) { running = false; postMessage({ type: 'error', message: error instanceof Error ? error.message : 'Training failed' }); }
}
self.onmessage = (event: MessageEvent<TrainingRequest>) => {
  const data = event.data;
  if (data.type === 'pause') { running = false; generation++; return; }
  try {
    validateSettings(data.learning, data.neural);
    if (data.type === 'start') {
      running = false; generation++; trainer = new Trainer(data.config, data.algorithm, data.learning, data.neural);
      start = performance.now(); batchCount = 0; batchScore = 0;
      baseline = evaluationSeeds.reduce((n, seed) => n + episode(data.config, seed).score, 0) / evaluationSeeds.length;
    } else {
      if (!trainer) throw new Error('Start training before resuming');
      trainer.configure(data.learning, data.neural);
    }
    running = true; const id = ++generation; batch(id);
  } catch (error) { running = false; postMessage({ type: 'error', message: error instanceof Error ? error.message : 'Training failed' }); }
};
