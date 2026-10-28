import { test, expect, type Page } from '@playwright/test';
import { pressMenuItem } from './toolbar';

async function setContent(page: Page, content: string) {
  await page.evaluate((content) => {
    const view = (window as any).svgEditor.editor;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: content } });
  }, content);
}

/** Where a point in the drawing's own units is on the page. */
const at = (page: Page, x: number, y: number) =>
  page.evaluate(([x, y]) => {
    const svg = document.querySelector('.svg-container svg') as SVGSVGElement;
    const p = new DOMPoint(x, y).matrixTransform(svg.getScreenCTM()!);
    return { x: p.x, y: p.y };
  }, [x, y] as [number, number]);

const box = async (page: Page, selector: string) => (await page.locator(selector).boundingBox())!;

const FIXTURE = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
  <rect id="box" x="20" y="20" width="60" height="60" fill="#6291e0"/>
  <circle id="dot" cx="150" cy="150" r="30" fill="#aa0000"/>
</svg>`;

test.describe('SVG Editor layout', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html');
    await expect(page.locator('.svg-container svg')).toBeVisible();
    await setContent(page, FIXTURE);
  });

  test('should put one bar across the top of the app, over both panes, side by side or stacked', async ({ page }) => {
    const viewport = page.viewportSize()!;
    for (const stacked of [false, true]) {
      if (stacked) await pressMenuItem(page, 'flip');
      const bar = await box(page, '#appbar');
      expect(bar.x).toBe(0);
      expect(bar.y).toBe(0);
      expect(bar.width).toBe(viewport.width);
      for (const pane of ['#editor', '#preview']) expect((await box(page, pane)).y).toBeGreaterThanOrEqual(bar.y + bar.height);
    }
  });

  test('should end each pane with a strip as tall as the bar, side by side in one line', async ({ page }) => {
    const bar = await box(page, '#appbar nav');
    const code = await box(page, '#svg-status-bar');
    const drawing = await box(page, '#context-bar');
    expect(code.height).toBe(bar.height);
    expect(drawing.height).toBe(bar.height);
    expect(code.y).toBe(drawing.y);
    expect(code.y + code.height).toBe(page.viewportSize()!.height);
    expect(await page.locator('#svg-status-bar').textContent()).toMatch(/svg valid/i);
  });

  test('should keep the app\'s buttons in reach with the code pane squeezed away', async ({ page }) => {
    const dragbar = await box(page, '#dragbar');
    await page.mouse.move(dragbar.x + dragbar.width / 2, dragbar.y + dragbar.height / 2);
    await page.mouse.down();
    await page.mouse.move(5, dragbar.y + dragbar.height / 2, { steps: 4 });
    await page.mouse.up();
    expect((await box(page, '#editor')).width).toBeLessThan(page.viewportSize()!.width * 0.15);
    for (const id of ['file-menu', 'view-menu', 'undo', 'redo', 'mode-select', 'points', 'mode-shapes', 'zoomin', 'zoomout', 'xray']) await expect(page.locator(`#${id}`)).toBeInViewport();
  });

  test('should say what the tool in hand does, what a drag does as it goes, and then what it did', async ({ page }) => {
    const status = page.locator('#preview-status');
    await page.locator('#mode-shapes').click();
    await page.locator('#draw-rect').click();
    await expect(status).toHaveText('Drag across the drawing to draw a rectangle, or tap to place one');
    await expect(status).toBeVisible();
    const a = await at(page, 100, 20);
    const b = await at(page, 180, 60);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 4 });
    await expect(status).toHaveText('rect x="100" y="20" width="80" height="40"');
    await page.mouse.up();
    await expect(status).toHaveText('rect drawn');
    // with nothing in hand, Shapes says how to go on once that has been said
    await expect(status).toHaveText('Pick a shape, then drag or tap on the drawing', { timeout: 5000 });
  });

  test('should bring the standing hint back after what was done has been said', async ({ page }) => {
    const status = page.locator('#preview-status');
    await setContent(page, FIXTURE.replace('<circle id="dot" cx="150" cy="150" r="30" fill="#aa0000"/>', '<path id="p" d="M120 120 L180 120 L150 180 Z"/>'));
    await page.locator('.svg-container #p').click();
    await page.locator('#points').click();
    await expect(status).toHaveText(/^Drag a point; tap the outline/, { timeout: 5000 });
  });

  test('should say what went wrong, in the colour for it', async ({ page }) => {
    await setContent(page, FIXTURE.replace('</svg>', ''));
    await page.locator('#mode-shapes').click();
    await page.locator('#draw-rect').click();
    const p = await at(page, 120, 40);
    await page.mouse.click(p.x, p.y);
    const status = page.locator('#preview-status');
    await expect(status).toHaveText(/The code has an error/);
    await expect(status).toHaveClass(/error/);
    // the error colour that reads on the bar, not the drawing's own error's look
    await expect(status).toHaveCSS('color', 'rgb(159, 7, 18)');
    await expect(status).not.toHaveCSS('padding-top', '16px');
    await expect(status).not.toHaveCSS('text-align', 'center');
  });

  test('should take a tool\'s hint away with the tool, and say how to go on before a shape has points enough', async ({ page }) => {
    const status = page.locator('#preview-status');
    await page.locator('#mode-shapes').click();
    await page.locator('#draw-rect').click();
    await page.locator('#draw-rect').click();
    await expect(status).toHaveText('Pick a shape, then drag or tap on the drawing', { timeout: 5000 });
    await page.locator('#draw-polyline').click();
    const p = await at(page, 100, 20);
    await page.mouse.click(p.x, p.y);
    await expect(status).toHaveText('Tap to place the next point', { timeout: 5000 });
  });
});

test.describe('SVG Editor layout on a portrait tablet', () => {
  test.use({ viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true });

  test('should raise the message above the strip when the tools leave no room for it, and let presses through', async ({ page }) => {
    await page.goto('/index.html');
    await expect(page.locator('.svg-container svg')).toBeVisible();
    await setContent(page, FIXTURE);
    await page.locator('#mode-shapes').tap();
    await page.locator('#draw-polygon').tap();
    const status = page.locator('#preview-status');
    await expect(status).toHaveClass(/above/);
    const said = await box(page, '#preview-status');
    const strip = await box(page, '#context-bar');
    expect(said.y + said.height).toBeLessThanOrEqual(strip.y);
    await expect(status).toHaveCSS('pointer-events', 'none');
    // stacked, the strip is the full width, with room beside the tools
    await pressMenuItem(page, 'flip', 'tap');
    await expect(status).not.toHaveClass(/above/);
  });

  test('should take a finger on a bar for a resting hand while the pencil is down on the drawing', async ({ page }) => {
    await page.goto('/index.html');
    await expect(page.locator('.svg-container svg')).toBeVisible();
    // Chromium has no pencil, so the touches say they are one, as Safari's do
    const pressed = (pencilDown: boolean) => page.evaluate((pencilDown) => {
      const wrapper = document.querySelector('.svg-preview-wrapper')!;
      const button = document.getElementById('zoomin')!;
      const touch = (id: number, target: Element, stylus: boolean) => {
        const r = target.getBoundingClientRect();
        const t = new Touch({ identifier: id, target, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 });
        if (stylus) Object.defineProperty(t, 'touchType', { value: 'stylus' });
        return t;
      };
      const pencil = touch(1, wrapper, true);
      if (pencilDown) wrapper.dispatchEvent(new TouchEvent('touchstart', { touches: [pencil], changedTouches: [pencil], bubbles: true, cancelable: true }));
      const finger = touch(2, button, false);
      const down = pencilDown ? [pencil, finger] : [finger];
      const went = button.dispatchEvent(new TouchEvent('touchstart', { touches: down, changedTouches: [finger], bubbles: true, cancelable: true }));
      const left = pencilDown ? [pencil] : [];
      button.dispatchEvent(new TouchEvent('touchend', { touches: left, changedTouches: [finger], bubbles: true, cancelable: true }));
      if (pencilDown) wrapper.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [pencil], bubbles: true, cancelable: true }));
      return went;
    }, pencilDown);
    expect(await pressed(true)).toBe(false);
    // once the pencil has lifted, a finger presses the bar as ever
    expect(await pressed(false)).toBe(true);
  });
});
