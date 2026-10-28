import { useHello } from './fixtures';
import { test, expect, type Page } from '@playwright/test';

/** The text the editor currently has selected. */
const editorSelection = (page: Page) =>
  page.evaluate(() => {
    const state = (window as any).svgEditor.editor.state;
    const { from, to } = state.selection.main;
    return state.doc.sliceString(from, to) as string;
  });

async function setContent(page: Page, content: string) {
  await page.evaluate((content) => {
    const view = (window as any).svgEditor.editor;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: content } });
  }, content);
}

async function setCursor(page: Page, needle: string, offset = 0) {
  await page.evaluate(({ needle, offset }) => {
    const view = (window as any).svgEditor.editor;
    view.dispatch({ selection: { anchor: view.state.doc.toString().indexOf(needle) + offset } });
  }, { needle, offset });
}

/** The selection box's bounding rectangle in page pixels. */
const boxRect = (page: Page) =>
  page.evaluate(() => {
    const r = document.querySelector('.select-overlay .select-box')!.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });

const elementRect = (page: Page, selector: string) =>
  page.evaluate((selector) => {
    const r = document.querySelector(selector)!.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  }, selector);

function expectClose(a: { x: number; y: number; width: number; height: number }, b: typeof a) {
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    expect(Math.abs(a[key] - b[key]), key).toBeLessThan(2);
  }
}

// the default drawing has its text over the circle's centre, so clicks aim
// at the circle's left side; the nested drawing has a second top-level
// element so the outer group is not skipped as a lone wrapper
const NESTED = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
  <circle id="pin" cx="180" cy="20" r="8"/>
  <g id="outer">
    <g id="inner">
      <rect id="box" x="20" y="20" width="60" height="60" fill="#6291e0"/>
    </g>
    <circle id="dot" cx="150" cy="150" r="30" fill="#aa0000"/>
  </g>
</svg>`;

test.describe('SVG Editor Preview Selection', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html');
    await expect(page.locator('.svg-container svg')).toBeVisible();
    await useHello(page);
  });

  test('should select an element on click and select its start tag in the editor', async ({ page }) => {
    const box = page.locator('.select-overlay .select-box');
    await expect(box).toBeHidden();

    await page.locator('.svg-container circle').click({ position: { x: 20, y: 80 } });
    await expect(box).toBeVisible();
    expect(await editorSelection(page)).toBe('<circle cx="100" cy="100" r="80" fill="#6291e0" stroke="#295da9" stroke-width="2"/>');
    expectClose(await boxRect(page), await elementRect(page, '.svg-container circle'));
  });

  test('should walk from a group into its parts with repeated clicks', async ({ page }) => {
    await setContent(page, NESTED);
    const rect = page.locator('.svg-container rect');
    await expect(rect).toBeVisible();

    await rect.click();
    expect(await editorSelection(page)).toBe('<g id="outer">');
    await rect.click();
    expect(await editorSelection(page)).toBe('<g id="inner">');
    await rect.click();
    expect(await editorSelection(page)).toMatch(/^<rect id="box"/);
    await rect.click();
    expect(await editorSelection(page)).toBe('<g id="outer">');
  });

  test('should pick a sibling at the same level once inside a group', async ({ page }) => {
    await setContent(page, NESTED);
    const rect = page.locator('.svg-container rect');
    await rect.click();
    await rect.click();
    expect(await editorSelection(page)).toBe('<g id="inner">');

    await page.locator('.svg-container circle#dot').click();
    expect(await editorSelection(page)).toMatch(/^<circle id="dot"/);
  });

  test('should clear the selection on a click on empty canvas or Escape', async ({ page }) => {
    const box = page.locator('.select-overlay .select-box');
    await page.locator('.svg-container circle').click({ position: { x: 20, y: 80 } });
    await expect(box).toBeVisible();

    // empty canvas beside the centred drawing, clear of the toolbar at the top
    const wrapper = page.locator('.svg-preview-wrapper');
    const area = await wrapper.boundingBox();
    await wrapper.click({ position: { x: 10, y: area!.height / 2 } });
    await expect(box).toBeHidden();

    await page.locator('.svg-container circle').click({ position: { x: 20, y: 80 } });
    await expect(box).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(box).toBeHidden();
  });

  test('should follow the editor cursor into an element', async ({ page }) => {
    const box = page.locator('.select-overlay .select-box');
    await setCursor(page, '<text', 3);
    await expect(box).toBeVisible();
    expectClose(await boxRect(page), await elementRect(page, '.svg-container text'));

    // the root svg is the canvas, not a selectable thing
    await setCursor(page, '<svg', 2);
    await expect(box).toBeHidden();
  });

  test('should keep the box on the element through zoom and pan', async ({ page }) => {
    await page.locator('.svg-container circle').click({ position: { x: 20, y: 80 } });
    await page.locator('#zoomin').click();
    await page.locator('#zoomin').click();
    await page.waitForTimeout(300);
    expectClose(await boxRect(page), await elementRect(page, '.svg-container circle'));

    const wrapper = page.locator('.svg-preview-wrapper');
    const area = await wrapper.boundingBox();
    await page.mouse.move(area!.x + 10, area!.y + 10);
    await page.mouse.down();
    await page.mouse.move(area!.x + 60, area!.y + 40, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    expectClose(await boxRect(page), await elementRect(page, '.svg-container circle'));
    // a drag is a pan, not a click: the selection is still the circle
    expect(await editorSelection(page)).toMatch(/^<circle/);
  });

  test('should show what the next click would pick on hover', async ({ page }) => {
    const hover = page.locator('.select-overlay .hover-box');
    await expect(hover).toBeHidden();
    await page.locator('.svg-container circle').hover({ position: { x: 20, y: 80 } });
    await expect(hover).toBeVisible();
    await expect(page.locator('.svg-preview-wrapper')).toHaveCSS('cursor', 'pointer');

    await page.locator('.svg-container circle').click({ position: { x: 20, y: 80 } });
    await expect(hover).toBeHidden();
  });
});
