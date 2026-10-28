import type { Page } from '@playwright/test';

/** The app bar's menu each of its menu items is in. */
export const MENU_OF: Record<string, string> = {
  upload: 'file-menu', download: 'file-menu', resolution: 'file-menu',
  dark: 'view-menu', flip: 'view-menu',
};

/** Press an item in one of the app bar's menus, opening its menu first. */
export async function pressMenuItem(page: Page, id: string, how: 'click' | 'tap' = 'click') {
  await page.locator(`#${MENU_OF[id]}`)[how]();
  await page.locator(`#${id}`)[how]();
}

/** Where a control is to be found on screen: its own button, or the button of the menu it is in. */
export const onScreen = (id: string) => `#${(MENU_OF[id.replace(/^#/, '')] ?? id.replace(/^#/, ''))}`;
