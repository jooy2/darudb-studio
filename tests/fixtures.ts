import * as base from '@playwright/test';
import { _electron as electron, Page, ElectronApplication } from 'playwright';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import pkg from '../package.json' with { type: 'json' };
import TestUtil from './testUtil';

const { main } = pkg;

let appElectron: ElectronApplication;
let page: Page;
let userDataPath: string;

/*
 * What the main process wrote since the app started, a line each, for the
 * report of a test that failed. `DARUDB_STUDIO_LOG_IPC` has it write every call
 * from a window too, so a test that waited on one shows which never answered.
 * The oldest lines go once there are more than `KEPT_LINES`.
 * */
const KEPT_LINES = 5000;
let mainOutput: string[] = [];
let mainLinesDropped = 0;

const keepOutput = (chunk: Buffer): void => {
  mainOutput.push(
    ...chunk
      .toString('utf8')
      .split(/\r?\n/)
      .filter((line) => line !== ''),
  );

  if (mainOutput.length > KEPT_LINES) {
    mainLinesDropped += mainOutput.length - KEPT_LINES;
    mainOutput = mainOutput.slice(-KEPT_LINES);
  }
};

/* How many lines the main process has written in all, the ones dropped included */
const mainLinesWritten = (): number => mainLinesDropped + mainOutput.length;

const cwd = process.cwd();
const isCiProcess = process.env.CI === 'true';
const testPath = join(cwd, 'tests');
const testResultPath = join(testPath, 'results');
const testScreenshotPath = join(testResultPath, 'screenshots');

/*
 * Starts the built app on the user data folder of this run.
 *
 * `DARUDB_STUDIO_HIDDEN` keeps every window off the screen and the app out of
 * the Dock, so a run never takes the screen or the focus from whoever started
 * it. Playwright drives the hidden windows all the same. See
 * `src/main/constants.ts`.
 * */
const launchApp = async (): Promise<void> => {
  appElectron = await electron.launch({
    args: [
      main,
      ...(isCiProcess ? ['--no-sandbox'] : []),
      '--enable-logging',
      '--ignore-certificate-errors',
      '--ignore-ssl-errors',
      '--ignore-blocklist',
      '--ignore-gpu-blocklist',
    ],
    locale: 'en-US',
    colorScheme: 'light',
    env: {
      ...process.env,
      NODE_ENV: 'production',
      DARUDB_STUDIO_HIDDEN: '1',
      DARUDB_STUDIO_USER_DATA: userDataPath,
      DARUDB_STUDIO_LOG_IPC: '1',
    },
  });
  appElectron.process().stdout?.on('data', keepOutput);
  appElectron.process().stderr?.on('data', keepOutput);
  // Each test records a chunk of its own, kept only when it fails; see `test` below
  await appElectron.context().tracing.start({ snapshots: true, screenshots: false });
  page = await appElectron.firstWindow();

  await page.waitForLoadState('load');

  page.on('console', console.log);
  page.on('pageerror', console.log);

  const evaluateResult = await appElectron.evaluate(async ({ app, BrowserWindow, screen }) => {
    const [currentWindow] = BrowserWindow.getAllWindows();

    // Fix window position for testing, inside the screen: a window the app
    // opens again larger than the screen is fitted into it by Windows, as on a
    // runner whose screen is 1024 pixels wide
    if (currentWindow) {
      const { workArea } = screen.getDisplayMatching(currentWindow.getBounds());

      currentWindow.setBounds({
        x: workArea.x,
        y: workArea.y,
        width: Math.min(1080, workArea.width),
        height: Math.min(560, workArea.height),
      });
    }

    return {
      packaged: app.isPackaged,
      dataPath: app.getPath('userData'),
      visible: currentWindow?.isVisible() ?? false,
    };
  });

  base.expect(evaluateResult.packaged, 'app is not packaged').toBe(false);
  base
    .expect(evaluateResult.dataPath, 'app uses the user data folder of this run')
    .toBe(userDataPath);
  base.expect(evaluateResult.visible, 'window stays off the screen').toBe(false);
};

export const beforeAll = async () => {
  // A folder of its own, so a run starts without stored settings and never
  // touches the ones of the installed app
  userDataPath = mkdtempSync(join(tmpdir(), 'darudb-studio-test-'));

  await launchApp();
};

export const afterAll = async () => {
  await appElectron.close();

  rmSync(userDataPath, { recursive: true, force: true });
};

/*
 * Quits the app and starts it again on the same user data folder, for tests of
 * what the app keeps between launches. `beforeLaunch` runs while the app is
 * closed, to change the folder under it. Resolves with the new main window.
 * */
export const relaunchApp = async (beforeLaunch?: () => void): Promise<Page> => {
  await appElectron.close();

  beforeLaunch?.();

  await launchApp();

  return page;
};

/*
 * The running app, for tests that need more than the window they start in.
 * */
export const getApp = (): ElectronApplication => appElectron;

export const getUserDataPath = (): string => userDataPath;

type Fixtures = {
  util: TestUtil;
  diagnostics: void;
};

export const test = base.test.extend<Fixtures>({
  // eslint-disable-next-line no-empty-pattern
  page: async ({}, use) => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    await use(page);
  },
  util: async ({ page }, use, testInfo) => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    await use(new TestUtil(page, testInfo, testScreenshotPath));
  },
  /*
   * Every test that fails leaves, beside its screenshot, the trace of what it
   * did in the window, which `npx playwright show-trace` opens, and what the
   * main process wrote while it ran. The tests of a file share one app, so a
   * test that relaunches it keeps the trace of the new app alone.
   * */
  diagnostics: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use, testInfo) => {
      const firstLine = mainLinesWritten();
      const context = appElectron.context();

      await context.tracing.startChunk({ title: testInfo.title });

      await use();

      const failed = testInfo.status !== testInfo.expectedStatus;

      try {
        // The app this test relaunched has a trace of its own, started at its launch
        await appElectron
          .context()
          .tracing.stopChunk(failed ? { path: testInfo.outputPath('trace.zip') } : undefined);
      } catch {
        // The app was closed with its trace
      }

      if (failed) {
        const lines = mainOutput.slice(Math.max(0, firstLine - mainLinesDropped));
        const path = testInfo.outputPath('main-process.log');

        writeFileSync(path, `${lines.join('\n')}\n`);
        await testInfo.attach('main-process', { path, contentType: 'text/plain' });
      }
    },
    { auto: true },
  ],
});

export const { expect } = base;
