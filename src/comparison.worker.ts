import { compare } from './comparison';
import type { Config, QTable } from './engine';
export type ComparisonMessage = { type: 'progress'; completed: number; total: number } | { type: 'done'; result: ReturnType<typeof compare> } | { type: 'error'; message: string };
self.onmessage = ({ data }: MessageEvent<{ config: Config; q: QTable | null; checkpoint: number | null }>) => {
  try {
    const result = compare(data.config, data.q, data.checkpoint, (completed, total) => postMessage({ type: 'progress', completed, total }));
    postMessage({ type: 'done', result });
  } catch (error) { postMessage({ type: 'error', message: error instanceof Error ? error.message : 'Comparison failed' }); }
};
