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

/** Squeeze the code pane away, dragging the bar between the panes to the page's edge. */
async function squeezeCode(page: Page) {
  const dragbar = await box(page, '#dragbar');
  await page.mouse.move(dragbar.x + dragbar.width / 2, dragbar.y + dragbar.height / 2);
  await page.mouse.down();
  await page.mouse.move(5, dragbar.y + dragbar.height / 2, { steps: 4 });
  await page.mouse.up();
}

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
    const code = await box(page, '#code-bar');
    const drawing = await box(page, '#context-bar');
    expect(code.height).toBe(bar.height);
    expect(drawing.height).toBe(bar.height);
    expect(code.y).toBe(drawing.y);
    expect(code.y + code.height).toBe(page.viewportSize()!.height);
    expect(await page.locator('#svg-status').textContent()).toMatch(/svg valid/i);
  });

  test('should keep the app\'s buttons in reach with the code pane squeezed away', async ({ page }) => {
    await squeezeCode(page);
    expect((await box(page, '#editor')).width).toBeLessThan(page.viewportSize()!.width * 0.15);
    for (const id of ['file-menu', 'view-menu', 'undo', 'redo', 'mode-select', 'points', 'mode-shapes', 'zoomin', 'zoomout', 'xray']) await expect(page.locator(`#${id}`)).toBeInViewport();
  });

  test('should say what the tool in hand does, what a drag does as it goes, and then what it did', async ({ page }) => {
    const status = page.locator('#message');
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
    const status = page.locator('#message');
    await setContent(page, FIXTURE.replace('<circle id="dot" cx="150" cy="150" r="30" fill="#aa0000"/>', '<path id="p" d="M120 120 L180 120 L150 180 Z"/>'));
    await page.locator('.svg-container #p').click();
    await page.locator('#points').click();
    await expect(status).toHaveText(/^Drag a point; tap an edge/, { timeout: 5000 });
  });

  test('should close off the drawing\'s tools, and say every message in the code\'s strip, beside its icon', async ({ page }) => {
    await expect(page.locator('#context-bar nav')).toHaveCSS('border-right-width', '1px');
    const status = page.locator('#message');
    await page.locator('#mode-shapes').click();
    await page.locator('#draw-path').click();
    await expect(status).toHaveText(/^Tap to place points, drag to pull a curve/);
    await expect(status).not.toHaveClass(/above/);
    await expect(page.locator('#code-bar #message')).toHaveCount(1);
    await expect(page.locator('#context-bar #message')).toHaveCount(0);
    const icon = await box(page, '#svg-status');
    const said = await box(page, '#message');
    const strip = await box(page, '#code-bar');
    expect(said.x).toBeGreaterThanOrEqual(icon.x + icon.width);
    expect(said.y).toBeGreaterThanOrEqual(strip.y);
    expect(said.y + said.height).toBeLessThanOrEqual(strip.y + strip.height);
    // in Points, editing a path's points, the standing hint is said there too
    await page.locator('#points').click();
    await page.locator('.svg-container #box').click();
    await page.locator('#topath').click();
    await expect(status).toHaveText(/^Drag a point; tap an edge/, { timeout: 5000 });
    await expect(status).not.toHaveClass(/above/);
  });

  test('should raise a message longer than three lines over the foot of the drawing, or of the code when it has more room', async ({ page }) => {
    await page.setViewportSize({ width: 700, height: 720 });
    const status = page.locator('#message');
    // more than three lines across a strip the width of the page
    const long = 'The code has an error, so this element cannot be edited here. Fix the code first, then try again, and once more after that if it still will not go. '.repeat(3);
    await page.evaluate((long) => (window as any).svgEditor.say(long), long);
    await expect(page.locator('#context-bar #message')).toHaveClass(/above/);
    let said = await box(page, '#message');
    expect(said.y + said.height).toBeLessThanOrEqual((await box(page, '#context-bar')).y);
    // stacked, with the drawing squeezed short, the code's pane has the room
    await pressMenuItem(page, 'flip');
    const dragbar = await box(page, '#dragbar');
    await page.mouse.move(dragbar.x + dragbar.width / 2, dragbar.y + dragbar.height / 2);
    await page.mouse.down();
    await page.mouse.move(dragbar.x + dragbar.width / 2, 700, { steps: 4 });
    await page.mouse.up();
    await page.evaluate((long) => (window as any).svgEditor.say(long), long);
    await expect(page.locator('#code-bar #message')).toHaveClass(/above/);
    said = await box(page, '#message');
    expect(said.y).toBeGreaterThanOrEqual((await box(page, '#editor')).y);
    expect(said.y + said.height).toBeLessThanOrEqual((await box(page, '#code-bar')).y);
  });

  test('should keep the code\'s own error in its strip, cut to three lines, not over the code it is about', async ({ page }) => {
    await page.setViewportSize({ width: 700, height: 720 });
    await page.evaluate(() => (window as any).svgEditor.updateStatusBar('error', 'SVG error: Opening and ending tag mismatch: rect line 1 and svg, and a good deal more besides, which goes on and on past three lines of the strip'));
    const status = page.locator('#code-bar #message');
    await expect(status).toHaveClass(/error/);
    await expect(status).not.toHaveClass(/above/);
    const said = await box(page, '#message');
    const strip = await box(page, '#code-bar');
    expect(said.y).toBeGreaterThanOrEqual(strip.y);
    expect(said.y + said.height).toBeLessThanOrEqual(strip.y + strip.height);
  });

  test('should say a message over the foot of the drawing while the code pane is squeezed too narrow for it, and let presses through', async ({ page }) => {
    await squeezeCode(page);
    await page.locator('#mode-shapes').click();
    await page.locator('#draw-polygon').click();
    const status = page.locator('#message');
    await expect(status).toHaveText('Tap to place each corner of the polygon, then tap the first again or press Done to close it');
    await expect(page.locator('#context-bar #message')).toHaveClass(/above/);
    const said = await box(page, '#message');
    const strip = await box(page, '#context-bar');
    expect(said.y + said.height).toBeLessThanOrEqual(strip.y);
    expect(said.x).toBeGreaterThanOrEqual(strip.x);
    await expect(status).toHaveCSS('pointer-events', 'none');
    // with the code pane opened up again, it goes back beside the code's icon
    await pressMenuItem(page, 'flip');
    await expect(page.locator('#code-bar #message')).not.toHaveClass(/above/);
  });

  test('should say what went wrong, in the colour for it', async ({ page }) => {
    await setContent(page, FIXTURE.replace('</svg>', ''));
    await page.locator('#mode-shapes').click();
    await page.locator('#draw-rect').click();
    const p = await at(page, 120, 40);
    await page.mouse.click(p.x, p.y);
    const status = page.locator('#message');
    await expect(status).toHaveText(/The code has an error/);
    await expect(status).toHaveClass(/error/);
    // the error colour that reads on the bar, not the drawing's own error's look
    await expect(status).toHaveCSS('color', 'rgb(159, 7, 18)');
    await expect(status).not.toHaveCSS('padding-top', '16px');
    await expect(status).not.toHaveCSS('text-align', 'center');
    // the error's colours fill the icon's corner, and only that
    await expect(page.locator('#svg-status')).toHaveCSS('background-color', 'rgb(254, 242, 242)');
    await expect(page.locator('#code-bar')).toHaveCSS('background-color', 'rgb(213, 214, 219)');
    await expect(status).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  });

  test('should take a tool\'s hint away with the tool, and say how to go on before a shape has points enough', async ({ page }) => {
    const status = page.locator('#message');
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

test.describe('SVG Editor gutter and grip', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html');
    await expect(page.locator('.svg-container svg')).toBeVisible();
  });

  test('should size the line numbers to the longest, with no gutter kept for errors, and mark an error\'s line on its number', async ({ page }) => {
    const numbers = page.locator('.cm-gutter.cm-lineNumbers');
    await expect(page.locator('.cm-gutter-lint')).toHaveCount(0);
    await setContent(page, '<svg xmlns="http://www.w3.org/2000/svg"/>');
    const one = (await numbers.boundingBox())!.width;
    // a figure and its padding, not the editor's least of two figures' room
    expect(one).toBeLessThan(18);
    await setContent(page, `<svg xmlns="http://www.w3.org/2000/svg">${'\n<g/>'.repeat(120)}\n</svg>`);
    await expect.poll(async () => (await numbers.boundingBox())!.width).toBeGreaterThan(one + 10);
    await setContent(page, '<svg xmlns="http://www.w3.org/2000/svg">\n  <rect>\n</svg>');
    const marked = page.locator('.cm-lineNumbers .cm-error-line');
    await expect(marked).toHaveText('3');
    await expect(marked).toHaveCSS('color', 'rgb(255, 255, 255)');
    // the number alone, not the fold gutter's cell beside it
    await expect(page.locator('.cm-error-line')).toHaveCount(1);
  });

  test('should put a grip in the middle of the bar between the panes, in a colour of its own, turned with the layout', async ({ page }) => {
    const grip = () => page.evaluate(() => {
      const bar = document.getElementById('dragbar')!;
      const css = getComputedStyle(bar, '::after');
      const bg = (el: Element) => getComputedStyle(el).backgroundColor;
      return {
        width: css.width, height: css.height, radius: css.borderRadius,
        color: css.backgroundColor, bar: bg(bar), editor: bg(document.querySelector('.cm-editor')!), preview: bg(document.getElementById('preview')!),
      };
    });
    for (const dark of [false, true]) {
      if (dark) await pressMenuItem(page, 'dark');
      const g = await grip();
      expect([g.width, g.height, g.radius]).toEqual(['10px', '50px', '0px']);
      // read again until the theme's colours have faded in
      await expect.poll(async () => {
        const now = await grip();
        return [now.bar, now.editor, now.preview].filter((other) => other === now.color).length;
      }).toBe(0);
    }
    await pressMenuItem(page, 'flip');
    const g = await grip();
    expect([g.width, g.height]).toEqual(['50px', '10px']);
  });
});

test.describe('SVG Editor layout on a portrait tablet', () => {
  test.use({ viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true });

  test('should say a tool\'s hint in the code\'s strip, side by side and stacked, the drawing\'s tools taking none of its room', async ({ page }) => {
    await page.goto('/index.html');
    await expect(page.locator('.svg-container svg')).toBeVisible();
    await setContent(page, FIXTURE);
    await page.locator('#mode-shapes').tap();
    await page.locator('#draw-polygon').tap();
    const status = page.locator('#code-bar #message');
    await expect(status).toHaveText(/^Tap to place each corner of the polygon/);
    await expect(status).not.toHaveClass(/above/);
    // stacked, the code's strip is the full width, in the middle of the screen
    await pressMenuItem(page, 'flip', 'tap');
    await expect(status).not.toHaveClass(/above/);
    expect((await box(page, '#code-bar')).width).toBe(820);
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
