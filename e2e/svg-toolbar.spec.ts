import { test, expect, type Page } from '@playwright/test';

/** The contrast ratio of two CSS rgb() colours, as WCAG measures it. */
function contrast(a: string, b: string): number {
  const luminance = (css: string) => {
    const [r, g, b] = css.match(/[\d.]+/g)!.slice(0, 3).map(Number).map((c) => {
      const s = c / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Every toolbar button on screen: its name as shown and as said, its box, and its bar's. */
const buttons = (page: Page) =>
  page.evaluate(() => [...document.querySelectorAll('nav button')]
    .filter((b) => (b as HTMLElement).offsetParent !== null)
    .map((b) => {
      const box = b.getBoundingClientRect();
      const bar = b.closest('nav')!.getBoundingClientRect();
      const span = b.querySelector(':scope > span');
      return {
        id: b.id,
        shown: span?.textContent ?? '',
        spanWidth: span?.getBoundingClientRect().width ?? 0,
        said: b.getAttribute('aria-label') ?? span?.textContent ?? '',
        width: box.width, height: box.height, top: box.top, bottom: box.bottom, barTop: bar.top, barBottom: bar.bottom,
      };
    }));

/** Wait out the colour transitions, then read a button's colours and its bar's. */
async function colours(page: Page, id: string) {
  await page.waitForTimeout(300);
  return page.evaluate((id) => {
    const b = document.getElementById(id)!;
    const css = getComputedStyle(b);
    return { bg: css.backgroundColor, text: getComputedStyle(b.querySelector('span')!).color, bar: getComputedStyle(b.closest('nav')!).backgroundColor };
  }, id);
}

test.describe('SVG Editor toolbar buttons', () => {
  // wide enough for every button's name
  test.use({ viewport: { width: 2000, height: 800 } });

  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html');
    await expect(page.locator('.svg-container svg')).toBeVisible();
  });

  test('should name every button under its icon, a fingertip or more in size, filling its bar from top to bottom', async ({ page }) => {
    await expect(page.locator('#editor nav')).not.toHaveClass(/compact/);
    await expect(page.locator('#preview nav')).not.toHaveClass(/compact/);
    const all = await buttons(page);
    expect(all.length).toBeGreaterThan(20);
    for (const b of all) {
      expect(b.shown, b.id).not.toBe('');
      expect(b.spanWidth, b.id).toBeGreaterThan(1);
      expect(b.width, b.id).toBeGreaterThanOrEqual(44);
      expect(b.height, b.id).toBeGreaterThanOrEqual(44);
      expect(Math.abs(b.top - b.barTop), b.id).toBeLessThan(1);
      expect(Math.abs(b.bottom - b.barBottom), b.id).toBeLessThan(1);
    }
  });

  test('should be known by the name it shows, or by one that says it in full', async ({ page }) => {
    for (const b of await buttons(page)) expect(b.said.toLowerCase(), b.id).toContain(b.shown.toLowerCase());
    for (const name of ['Open', 'Save', 'Clean', 'X-ray', 'Rect', 'Theme', 'Layout', 'Zoom in']) {
      await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
    }
    await expect(page.getByRole('button', { name: 'Flip horizontal' })).toBeVisible();
  });

  test('should fill a pressed button with the accent, standing out from its bar, in both themes', async ({ page }) => {
    await page.locator('#xray').click();
    await page.mouse.move(1000, 600);
    const light = await colours(page, 'xray');
    expect(light.bg).toBe('rgb(41, 89, 170)');
    expect(contrast(light.bg, light.bar)).toBeGreaterThanOrEqual(3);
    expect(contrast(light.text, light.bg)).toBeGreaterThanOrEqual(4.5);
    await page.locator('#dark').click();
    await page.mouse.move(1000, 600);
    const dark = await colours(page, 'xray');
    expect(dark.bg).toBe('rgb(125, 207, 255)');
    expect(contrast(dark.bg, dark.bar)).toBeGreaterThanOrEqual(3);
    expect(contrast(dark.text, dark.bg)).toBeGreaterThanOrEqual(4.5);
    await expect(page.locator('#xray')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#xray').click();
    await expect(page.locator('#xray')).toHaveAttribute('aria-pressed', 'false');
  });

  test('should write the names in colours that read against the bar in both themes', async ({ page }) => {
    const light = await colours(page, 'optimize');
    expect(contrast(light.text, light.bar)).toBeGreaterThanOrEqual(4.5);
    await page.locator('#dark').click();
    await page.mouse.move(1000, 600);
    const dark = await colours(page, 'optimize');
    expect(contrast(dark.text, dark.bar)).toBeGreaterThanOrEqual(4.5);
  });

  test('should ring the button the keys are on, and not one pressed with the pointer', async ({ page }) => {
    await page.locator('#zoomin').click();
    await expect(page.locator('#zoomin')).toHaveCSS('outline-style', 'none');
    await page.locator('#upload').focus();
    await page.keyboard.press('Tab');
    const focused = page.locator('nav button:focus');
    await expect(focused).toHaveCSS('outline-style', 'solid');
    await expect(focused).toHaveCSS('outline-color', 'rgb(41, 89, 170)');
  });
});

test.describe('SVG Editor dialog buttons', () => {
  test('should make the dialog\'s buttons a fingertip in size, apart, and ringed for the keys', async ({ page }) => {
    await page.goto('/index.html');
    await expect(page.locator('.svg-container svg')).toBeVisible();
    await page.locator('#resolution').click();
    const update = page.locator('dialog #resize');
    const cancel = page.locator('dialog #cancel');
    // the dialog grows open, so it is measured once it has
    await expect.poll(async () => (await cancel.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    const [a, b] = [(await update.boundingBox())!, (await cancel.boundingBox())!];
    for (const box of [a, b]) {
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
    expect(b.x - (a.x + a.width)).toBeGreaterThanOrEqual(4);
    await page.locator('#height').focus();
    await page.keyboard.press('Tab');
    await expect(update).toBeFocused();
    await expect(update).toHaveCSS('outline-style', 'solid');
  });
});

test.describe('SVG Editor toolbars too narrow for their names', () => {
  // side by side, each pane is too narrow for all its buttons' names
  test.use({ viewport: { width: 1100, height: 800 } });

  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html');
    await expect(page.locator('.svg-container svg')).toBeVisible();
  });

  test('should show the icons alone, still a fingertip wide and still named, and the names again when there is room', async ({ page }) => {
    await expect(page.locator('#editor nav')).toHaveClass(/compact/);
    const optimize = (await buttons(page)).find((b) => b.id === 'optimize')!;
    expect(optimize.spanWidth).toBeLessThanOrEqual(1);
    expect(optimize.width).toBeGreaterThanOrEqual(44);
    await expect(page.getByRole('button', { name: 'Clean', exact: true })).toBeVisible();
    await page.setViewportSize({ width: 2000, height: 800 });
    await expect(page.locator('#editor nav')).not.toHaveClass(/compact/);
  });

  test('should name the buttons again when the ones that crowded the bar make way', async ({ page }) => {
    const bar = page.locator('#preview nav');
    await expect(bar).toHaveClass(/compact/);
    // a shape under way leaves its own tool, take-back, Done, and the zoom
    await page.locator('#draw-polygon').click();
    const svg = (await page.locator('.svg-container svg').boundingBox())!;
    await page.mouse.click(svg.x + 20, svg.y + 20);
    await expect(bar).not.toHaveClass(/compact/);
    await page.keyboard.press('Escape');
    await expect(bar).toHaveClass(/compact/);
  });
});
