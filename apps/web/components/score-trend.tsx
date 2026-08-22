/**
 * The score over time.
 *
 * The sparkline is decorative and marked aria-hidden; the numbers underneath it
 * are the real content. A trend a screen-reader user cannot read is not a trend
 * we are entitled to show.
 */
export interface TrendPoint {
  readonly assessmentId: string;
  readonly score: number;
  readonly assessedAt: string;
  readonly delta: number | null;
  readonly materialRegression: boolean;
}

export function ScoreTrend({ points }: { points: readonly TrendPoint[] }) {
  if (points.length === 0) return null;

  const oldestFirst = [...points].reverse();
  const scores = oldestFirst.map((point) => point.score);
  const min = Math.min(...scores, 0);
  const max = Math.max(...scores, 100);
  const width = 320;
  const height = 64;
  const step = oldestFirst.length > 1 ? width / (oldestFirst.length - 1) : 0;
  const path = oldestFirst
    .map((point, index) => {
      const x = index * step;
      const y = height - ((point.score - min) / (max - min || 1)) * height;
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <div className="space-y-4">
      {oldestFirst.length > 1 && (
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="h-16 w-full"
          role="presentation"
          aria-hidden="true"
          preserveAspectRatio="none"
        >
          <path d={path} fill="none" stroke="currentColor" strokeWidth="2" className="text-accent" />
        </svg>
      )}
      <ol className="space-y-2 text-sm">
        {points.map((point) => (
          <li key={point.assessmentId} className="flex flex-wrap items-baseline justify-between gap-3">
            <span className="font-medium">{point.score.toFixed(1)} / 100</span>
            <span className="text-muted">
              {new Date(point.assessedAt).toISOString().slice(0, 10)}
              {point.delta !== null && point.delta !== 0
                ? ` · ${point.delta > 0 ? '+' : ''}${point.delta.toFixed(1)} since the previous assessment`
                : ''}
              {point.materialRegression ? ' · material change' : ''}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
