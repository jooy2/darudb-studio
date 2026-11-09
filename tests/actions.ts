import { expect } from '@playwright/test';
import type { Page } from 'playwright';
import { mainChannels } from '../src/common/ipc';
import { sendMain } from './ipc';

/*
 * What the tests do through the application menu and the settings, which the
 * windows have no button of their own for.
 * */

/*
 * Does what the menu entry `id` does for the window of `page`, as a click on
 * it in the native menu or the window's own menu bar would.
 * */
export const runMenuEntry = (page: Page, id: string): Promise<void> =>
  sendMain(page, mainChannels.invokeMenuEntry, id);

/* Asks to close the project of `page`, as the File menu does; a held edit asks first */
export const askToCloseProject = (page: Page): Promise<void> =>
  runMenuEntry(page, 'file.close-project');

/* Closes the project of `page`, back to the list */
export const closeProject = async (page: Page): Promise<void> => {
  await askToCloseProject(page);
  await expect(page.getByTestId('project-list')).toBeVisible();
};

/*
 * Picks a theme in the settings dialog, and closes it again. The choices are
 * found by their place, the system's, then light, then dark, so the window's
 * language does not matter.
 * */
export const chooseTheme = async (page: Page, theme: 'light' | 'dark'): Promise<void> => {
  await page.getByTestId('btn-settings').click();

  const dialog = page.getByTestId('settings-dialog');

  await dialog
    .getByTestId('settings-theme')
    .getByRole('radio')
    .nth(theme === 'dark' ? 2 : 1)
    .click();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
};
