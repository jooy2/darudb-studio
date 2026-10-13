/*
 * The rows a grid has selected, as ranges of row indexes rather than one entry
 * per row, so selecting every row of a large collection costs two numbers.
 *
 * Ranges are inclusive at both ends, sorted, and never touch or overlap: the
 * functions below return them in that shape whatever they are given.
 * */

export type Range = readonly [number, number];

export type Ranges = readonly Range[];

export const EMPTY: Ranges = [];

/* `ranges` sorted, with the ones that touch or overlap joined */
export const normalize = (ranges: Ranges): Ranges => {
  const sorted = ranges
    .map(([a, b]): Range => (a <= b ? [a, b] : [b, a]))
    .sort((x, y) => x[0] - y[0]);
  const joined: [number, number][] = [];

  for (const [start, end] of sorted) {
    const last = joined.at(-1);

    if (last && start <= last[1] + 1) {
      last[1] = Math.max(last[1], end);
    } else {
      joined.push([start, end]);
    }
  }

  return joined;
};

/* Every row from `a` to `b`, in either order */
export const between = (a: number, b: number): Ranges => [[Math.min(a, b), Math.max(a, b)]];

export const contains = (ranges: Ranges, index: number): boolean =>
  ranges.some(([start, end]) => index >= start && index <= end);

export const union = (a: Ranges, b: Ranges): Ranges => normalize([...a, ...b]);

/* `ranges` with `index` added, or taken out when it is in them */
export const toggle = (ranges: Ranges, index: number): Ranges => {
  if (!contains(ranges, index)) {
    return union(ranges, [[index, index]]);
  }

  return ranges.flatMap(([start, end]): Range[] => {
    if (index < start || index > end) {
      return [[start, end]];
    }

    return [
      ...(start < index ? [[start, index - 1] as const] : []),
      ...(index < end ? [[index + 1, end] as const] : []),
    ];
  });
};

/* `ranges` within `0` to `count - 1`, as a shorter list of rows leaves them */
export const clamp = (ranges: Ranges, count: number): Ranges =>
  ranges
    .map(([start, end]): Range => [Math.max(0, start), Math.min(count - 1, end)])
    .filter(([start, end]) => start <= end);

export const sizeOf = (ranges: Ranges): number =>
  ranges.reduce((total, [start, end]) => total + end - start + 1, 0);

/* The selected indexes in order, at most `limit` of them */
export const indexesOf = (ranges: Ranges, limit = Number.POSITIVE_INFINITY): number[] => {
  const found: number[] = [];

  for (const [start, end] of ranges) {
    for (let index = start; index <= end && found.length < limit; index += 1) {
      found.push(index);
    }
  }

  return found;
};
