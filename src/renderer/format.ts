/*
 * Numbers, times and paths as the screens write them, in the language the
 * window shows.
 * */

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 60 * 60 * 1000],
  ['month', 30 * 24 * 60 * 60 * 1000],
  ['week', 7 * 24 * 60 * 60 * 1000],
  ['day', 24 * 60 * 60 * 1000],
  ['hour', 60 * 60 * 1000],
  ['minute', 60 * 1000],
];

/* `time`, a timestamp in milliseconds, as how long ago it was: "3 days ago", "yesterday" */
export const formatRelativeTime = (time: number, language: string, now = Date.now()): string => {
  const format = new Intl.RelativeTimeFormat(language, { numeric: 'auto' });
  const elapsed = time - now;

  for (const [unit, length] of RELATIVE_UNITS) {
    if (Math.abs(elapsed) >= length) {
      return format.format(Math.round(elapsed / length), unit);
    }
  }

  return format.format(0, 'minute');
};

const BYTE_UNITS = ['byte', 'kilobyte', 'megabyte', 'gigabyte', 'terabyte'] as const;

/* `bytes` in the largest unit that keeps it at 1 or more: "12.5 MB" */
export const formatBytes = (bytes: number, language: string): string => {
  let unit = 0;
  let value = bytes;

  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }

  return new Intl.NumberFormat(language, {
    style: 'unit',
    unit: BYTE_UNITS[unit],
    unitDisplay: unit === 0 ? 'long' : 'short',
    maximumFractionDigits: unit === 0 ? 0 : 1,
  }).format(value);
};

/*
 * `path` split into its folder and its file name, on either separator, since
 * the renderer has no `path` module and a path may come from any system.
 * */
export const splitPath = (path: string): { folder: string; name: string } => {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));

  return cut < 0
    ? { folder: '', name: path }
    : { folder: path.slice(0, cut) || path.slice(0, 1), name: path.slice(cut + 1) };
};

/* The file name of `path` without its extension, as a name for what it holds */
export const fileStem = (path: string): string => {
  const { name } = splitPath(path);
  const dot = name.lastIndexOf('.');

  return dot > 0 ? name.slice(0, dot) : name;
};
