import * as base from '@playwright/test';
import { _electron as electron, Page, ElectronApplication } from 'playwright';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import pkg from '../package.json' with { type: 'json' };
import TestUtil from './testUtil';

const { main } = pkg;

let appElectron: ElectronApplication;
let page: Page;
let userDataPath: string;

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
    },
  });
  page = await appElectron.firstWindow();

  await page.waitForLoadState('load');

  page.on('console', console.log);
  page.on('pageerror', console.log);

  const evaluateResult = await appElectron.evaluate(async ({ app, BrowserWindow }) => {
    const [currentWindow] = BrowserWindow.getAllWindows();

    // Fix window position for testing
    if (currentWindow) {
      currentWindow.setPosition(50, 50);
      currentWindow.setSize(1080, 560);
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
});

export const { expect } = base;
