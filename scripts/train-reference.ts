import fs from 'node:fs';
import path from 'node:path';
import { defaults, learningDefaults } from '../src/engine.ts';
import { Trainer, evaluatePolicy, neuralDefaults } from '../src/learning.ts';
import { selectionCases } from '../src/evaluation.ts';

// These settings were fixed using development validation, before the final test.
const neural = { ...neuralDefaults, seed: 209, pretrain: 100 };
const trainer = new Trainer(defaults, 'ppo', learningDefaults, neural), cases = selectionCases(defaults, true);
let score = -Infinity, selectedEpisode = 0, policy = structuredClone(trainer.policy);
for (let episode = 1; episode <= 2100; episode++) {
  trainer.run();
  if (episode % 20 !== 0) continue;
  const evaluation = cases.reduce((s, c) => s + evaluatePolicy(c.config, c.seed, trainer.policy).score, 0) / cases.length;
  if (evaluation > score) { score = evaluation; selectedEpisode = episode; policy = structuredClone(trainer.policy); }
  if (episode % 200 === 0) console.log(JSON.stringify({ episode, evaluation, best: score, selectedEpisode }));
}
const output = process.argv[2] ?? '.context/ppo-reference.json';
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify({ version: 1, config: defaults,
  training: { totalEpisodes: 2100, imitationEpisodes: 100, selectionSeeds: [...new Set(cases.map(c => c.seed))], selectionTrials: cases.length,
    selectionInterval: 20, selectedEpisode, selectionScore: score,
    chosenUsing: '96 validation trials, seeds -660001 through -660012; best of three PPO and three DDQN runs. Final benchmark seeds were not used.' },
  learning: learningDefaults, neural, policy: { ...policy, network: { ...policy.network!, weights: Array.from(policy.network!.weights) } },
}, null, 2) + '\n');
console.log(`Saved ${output}`);
