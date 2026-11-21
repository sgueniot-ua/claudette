export interface WindowParams {
  scrollTop: number;
  viewport: number;
  rowHeight: number;
  total: number;
  overscan: number;
}

// Half-open range [start, end) of row offsets to render: the visible rows plus
// `overscan` rows on each side, clamped to [0, total].
export function computeWindow({
  scrollTop,
  viewport,
  rowHeight,
  total,
  overscan,
}: WindowParams): { start: number; end: number } {
  const firstVisible = Math.floor(Math.max(0, scrollTop) / rowHeight);
  const lastVisible = Math.ceil((Math.max(0, scrollTop) + Math.max(0, viewport)) / rowHeight);
  return {
    start: Math.min(total, Math.max(0, firstVisible - overscan)),
    end: Math.min(total, Math.max(0, lastVisible + overscan)),
  };
}
