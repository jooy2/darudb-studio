/*
 * The window background, shared by the three processes.
 *
 * The main process paints a window with it before the page exists. Each value
 * is the top stop of the page gradient, `--plass-bg-from`, for the matching
 * scheme, as `global.css` sets it in the colors of DaruDB. When the two
 * disagree, a new window shows one color and then settles on another.
 *
 * They are written out because a window is painted before there is a
 * stylesheet to read them from, so a change to them in `global.css` has to be
 * copied here as well.
 *
 * See `src/common/ipc.ts` for what may live in this folder.
 * */
export const backgroundColors = {
  dark: '#1d1712',
  light: '#f7f1e8',
} as const;

/*
 * The color of text, `--plass-fg` in `global.css`, which the system draws the
 * window's own buttons in on Windows and Linux, over the header.
 * */
export const foregroundColors = {
  dark: '#f1e9de',
  light: '#2b2118',
} as const;
