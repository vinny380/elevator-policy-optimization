import artifact from './models/ppo-reference.json';
import type { Config } from './engine';
import type { SavedPolicy } from './comparison';

// Frozen, measured checkpoint. New browser training always starts a separate run.
export function referencePolicies(config: Config): SavedPolicy[] {
  if (Object.entries(artifact.config).some(([key, value]) => JSON.stringify(config[key as keyof Config]) !== JSON.stringify(value))) return [];
  return [{
    id: 'reference-ppo-209', name: 'PPO · trained reference', seed: artifact.neural.seed,
    episode: artifact.training.selectedEpisode, score: artifact.training.selectionScore,
    learning: { ...artifact.learning }, neural: { ...artifact.neural },
    policy: { algorithm: 'ppo', q: {}, network: { ...artifact.policy.network, weights: Float32Array.from(artifact.policy.network.weights) } },
  }];
}
