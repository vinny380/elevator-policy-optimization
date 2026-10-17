import type { Config } from './engine';
// Checkpoint selection only. Final test seeds belong to separate benchmark suites.
export const SELECTION_SEEDS = [910001, 910002, 910003, 910004];
export function selectionCases(config: Config, varied: boolean) {
  const scenarios = varied ? (['night', 'morning', 'evening', 'mixed'] as const).flatMap(pattern => [
    { ...config, pattern },
    { ...config, pattern, enabled: config.enabled.map((_, i) => i < config.cars) },
  ]) : [config];
  // Disabled padding beyond the installed fleet does not define another scenario.
  const key = (c: Config) => JSON.stringify({ ...c, enabled: c.enabled.slice(0, c.cars) });
  const unique = scenarios.filter((c, i) => scenarios.findIndex(other => key(other) === key(c)) === i);
  return unique.flatMap(config => SELECTION_SEEDS.map(seed => ({ config, seed })));
}
