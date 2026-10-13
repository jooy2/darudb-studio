/*
 * The window background, shared by the three processes.
 *
 * The main process paints a window with it before the page exists. Each value
 * is the top stop of the page gradient, `--plass-bg-from` in Plass UI, for the
 * matching scheme. When the two disagree, a new window shows one color and then
 * settles on another.
 *
 * Plass UI owns those tokens, so a version that changes them has to be copied
 * here as well. They are written out because a window is painted before there
 * is a stylesheet to read them from.
 *
 * See `src/common/ipc.ts` for what may live in this folder.
 * */
export const backgroundColors = {
  dark: '#111731',
  light: '#eef2fb',
} as const;

/*
 * The color of text, `--plass-fg` in Plass UI, which the system draws the
 * window's own buttons in on Windows and Linux, over the header.
 * */
export const foregroundColors = {
  dark: '#e7eaf3',
  light: '#1b1e27',
} as const;
