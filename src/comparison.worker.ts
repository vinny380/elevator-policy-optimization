import { compare, type SavedPolicy } from './comparison';
import type { Config } from './engine';
export type ComparisonMessage = { type: 'progress'; completed: number; total: number } | { type: 'done'; result: ReturnType<typeof compare> } | { type: 'error'; message: string };
self.onmessage = ({ data }: MessageEvent<{ config: Config; policies: SavedPolicy[]; checkpoint: number | null; stress: boolean }>) => {
  try {
    const result = compare(data.config, data.policies, data.checkpoint, (completed, total) => postMessage({ type: 'progress', completed, total }), data.stress);
    postMessage({ type: 'done', result });
  } catch (error) { postMessage({ type: 'error', message: error instanceof Error ? error.message : 'Comparison failed' }); }
};
