import type { Point } from './training.worker';
export function Chart({ points, selected, onSelect }: { points: Point[]; selected: number | null; onSelect: (episode: number) => void }) {
  const W = 340, H = 172, left = 36, top = 14, bottom = 24;
  const values = points.flatMap(p => [p.training, p.evaluation, p.baseline]);
  const min = Math.min(-1, ...values), max = Math.max(0, ...values);
  const range = Math.max(0.1, max - min);
  const maxEpisode = Math.max(100, points.at(-1)?.episode ?? 0);
  const minEpisode = points.length === 100 ? points[0].episode : 0;
  const x = (episode: number) => left + (episode - minEpisode) / (maxEpisode - minEpisode) * (W - left - 12);
  const y = (score: number) => top + (max - score) / range * (H - top - bottom);
  const line = (key: 'training' | 'evaluation') => points.map((p, i) => `${i ? 'L' : 'M'} ${x(p.episode)} ${y(p[key])}`).join(' ');
  return <div className="chart-wrap"><svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={points.length ? `Learning curve across ${maxEpisode} episodes. Higher reward is better. Cyan: evaluation; gray: training; dashed: LOOK baseline.` : 'Learning chart is empty. Start training to generate measured results.'}>
    {[0, 0.5, 1].map(t => { const score = max - range * t; return <g key={t}><line x1={left} x2={W - 10} y1={y(score)} y2={y(score)} stroke="var(--line)" strokeDasharray="3 5" /><text x={left - 8} y={y(score) + 3} textAnchor="end" className="chart-label">{score.toFixed(1)}</text></g>; })}
    <text x={left} y={H - 4} className="chart-label">{minEpisode.toLocaleString()}</text><text x={W - 10} y={H - 4} textAnchor="end" className="chart-label">{maxEpisode.toLocaleString()} episodes</text>
    {points.length > 0 && <><line x1={left} x2={W - 10} y1={y(points[0].baseline)} y2={y(points[0].baseline)} stroke="#b0a18c" strokeDasharray="4 4" /><path d={line('training')} stroke="#7287a5" opacity="0.65" fill="none" strokeWidth="1" /><path d={line('evaluation')} stroke="var(--accent)" fill="none" strokeWidth="2" />{points.map(p => <circle key={p.episode} cx={x(p.episode)} cy={y(p.evaluation)} r={p.episode === selected ? 4 : 1.8} fill={p.episode === selected ? '#fff' : 'var(--accent)'} className="checkpoint-dot" onClick={() => onSelect(p.episode)}><title>Episode {p.episode} · score {p.evaluation.toFixed(2)}</title></circle>)}</>}
  </svg>{!points.length && <div className="chart-empty"><span>No training yet</span></div>}</div>;
}
