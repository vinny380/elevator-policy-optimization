import fs from 'node:fs';
import { defaults, learningDefaults } from '../src/engine.ts';
import { Trainer, evaluatePolicy, neuralDefaults } from '../src/learning.ts';
import { compare, policyName, type SavedPolicy } from '../src/comparison.ts';
import type { Algorithm } from '../src/policy.ts';

const args = process.argv.slice(2);
function argument(key: string, fallback: string) { const i = args.indexOf(key); return i < 0 ? fallback : args[i + 1]; }
const episodes = Number(argument('--episodes', '200')), runs = Number(argument('--runs', '3'));
if (!Number.isInteger(episodes) || episodes < 5 || episodes > 100000 || !Number.isInteger(runs) || runs < 1 || runs > 20) throw new Error('Use --episodes 5..100000 and --runs 1..20');
const output = argument('--output', '.context/benchmark.json');
const config = { ...defaults };
const variants: { algorithm: Algorithm; pretrain: number }[] = [{ algorithm: 'tabular', pretrain: 0 }, { algorithm: 'ddqn', pretrain: 0 }, { algorithm: 'ppo', pretrain: 0 }, { algorithm: 'ppo', pretrain: 20 }];
const policies: SavedPolicy[] = [], training: object[] = [];
for (const variant of variants) for (let run = 0; run < runs; run++) {
  const seed = 7 + run * 101, settings = { ...neuralDefaults, ...variant, seed };
  const trainer = new Trainer(config, variant.algorithm, learningDefaults, settings), started = performance.now();
  let best: SavedPolicy | undefined;
  while (trainer.episodes < episodes) {
    trainer.run();
    const count = trainer.episodes + trainer.pretrainingEpisodes;
    if (count % (variant.algorithm === 'tabular' ? 20 : 5) === 0 || trainer.episodes === episodes) {
      const score = [910001, 910002, 910003, 910004].reduce((sum, evalSeed) => sum + evaluatePolicy(config, evalSeed, trainer.policy).score, 0) / 4;
      if (!best || score > best.score) best = { id: `${variant.algorithm}-${variant.pretrain}-${seed}`, name: policyName(trainer.policy, seed, variant.pretrain), policy: structuredClone(trainer.policy), episode: count, score, seed, learning: learningDefaults, neural: settings };
    }
  }
  policies.push(best!);
  const row = { name: best!.name, algorithm: variant.algorithm, seed, episodes: trainer.episodes, pretraining: trainer.pretrainingEpisodes, decisions: trainer.decisions, updates: trainer.updates, seconds: (performance.now() - started) / 1000, selectedEpisode: best!.episode, selectionScore: best!.score };
  training.push(row); console.log(JSON.stringify(row));
}
const result = compare(config, policies, null, undefined, args.includes('--stress'));
fs.mkdirSync(output.substring(0, output.lastIndexOf('/')) || '.', { recursive: true });
fs.writeFileSync(output, JSON.stringify({ config, learning: learningDefaults, neural: neuralDefaults, budget: { episodes, runs }, training, result }, null, 2));
console.table(result.rows.map(r => ({ policy: r.name, wait: r.metrics.meanWait.toFixed(1), p95: r.metrics.p95.toFixed(1), score: r.metrics.score.toFixed(3), waitSE: r.waitSE.toFixed(2), milliseconds: r.milliseconds.toFixed(1) })));
console.log(`Measured results: ${output}`);
