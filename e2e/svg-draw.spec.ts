import { test, expect, type Page } from '@playwright/test';

const getSource = (page: Page) =>
  page.evaluate(() => (window as any).svgEditor.editor.state.doc.toString() as string);

const editorSelection = (page: Page) =>
  page.evaluate(() => {
    const state = (window as any).svgEditor.editor.state;
    return state.doc.sliceString(state.selection.main.from, state.selection.main.to) as string;
  });

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

/** Press at one point of the drawing, travel to another, release; with keys held, or Escape before release. */
async function drawDrag(page: Page, from: [number, number], to: [number, number], opts: { keys?: string[]; cancel?: boolean } = {}) {
  const a = await at(page, ...from);
  const b = await at(page, ...to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  for (const key of opts.keys ?? []) await page.keyboard.down(key);
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 });
  await page.mouse.move(b.x, b.y, { steps: 4 });
  if (opts.cancel) await page.keyboard.press('Escape');
  for (const key of opts.keys ?? []) await page.keyboard.up(key);
  await page.mouse.up();
}

// at 200 user units across 200 pixels, one pixel is one unit
const FIXTURE = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
  <rect id="box" x="20" y="20" width="60" height="60" fill="#6291e0"/>
  <circle id="dot" cx="150" cy="150" r="30" fill="#aa0000"/>
</svg>`;

/** The fixture with this markup as its last child. */
const withShape = (markup: string) => FIXTURE.replace('</svg>', `  ${markup}\n</svg>`);

test.describe('SVG Editor drawing shapes', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html');
    await expect(page.locator('.svg-container svg')).toBeVisible();
    await setContent(page, FIXTURE);
    await expect(page.locator('.svg-container #box')).toBeVisible();
    // the shape tools are Shapes'
    await page.locator('#mode-shapes').click();
  });

  test('should draw a rectangle with a drag as the drawing\'s last child, select it, and put the tool down', async ({ page }) => {
    const tool = page.locator('#draw-rect');
    await tool.click();
    await expect(tool).toHaveAttribute('aria-pressed', 'true');
    await drawDrag(page, [100, 20], [180, 60]);
    const markup = '<rect x="100" y="20" width="80" height="40" fill="#999"/>';
    expect(await getSource(page)).toBe(withShape(markup));
    await expect(tool).toHaveAttribute('aria-pressed', 'false');
    expect(await editorSelection(page)).toBe(markup);
    await expect(page.locator('.select-box')).toBeVisible();
    await expect(page.locator('.handles')).toBeVisible();
    // the canvas has the keys, so the new shape nudges and deletes straight away
    await page.keyboard.press('ArrowRight');
    expect(await getSource(page)).toBe(withShape(markup.replace('x="100"', 'x="101"')));
    await page.keyboard.press('Delete');
    expect(await getSource(page)).toBe(FIXTURE);
  });

  test('should show the shape and read it out while the drag goes on', async ({ page }) => {
    await page.locator('#draw-ellipse').click();
    const a = await at(page, 100, 20);
    const b = await at(page, 160, 60);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 4 });
    await expect(page.locator('.svg-container ellipse')).toHaveAttribute('rx', '30');
    await expect(page.locator('#preview-status')).toHaveText('ellipse cx="130" cy="40" rx="30" ry="20"');
    await page.mouse.up();
    expect(await getSource(page)).toBe(withShape('<ellipse cx="130" cy="40" rx="30" ry="20" fill="#999"/>'));
    await expect(page.locator('#svg-status-bar')).toHaveText('SVG valid');
  });

  test('should draw over another shape rather than select or move it', async ({ page }) => {
    await page.locator('.svg-container #box').click();
    await page.locator('#draw-circle').click();
    // a circle is as big as the longer side of the drag
    await drawDrag(page, [50, 50], [70, 60]);
    expect(await getSource(page)).toBe(withShape('<circle cx="60" cy="60" r="10" fill="#999"/>'));
    expect(await editorSelection(page)).toBe('<circle cx="60" cy="60" r="10" fill="#999"/>');
  });

  test('should draw a square with Shift, and from the middle with Alt', async ({ page }) => {
    await page.locator('#draw-rect').click();
    await drawDrag(page, [100, 20], [140, 30], { keys: ['Shift'] });
    const square = '<rect x="100" y="20" width="40" height="40" fill="#999"/>';
    expect(await getSource(page)).toBe(withShape(square));
    await page.locator('#draw-ellipse').click();
    await drawDrag(page, [100, 100], [130, 110], { keys: ['Alt'] });
    expect(await getSource(page)).toBe(withShape(`${square}\n  <ellipse cx="100" cy="100" rx="30" ry="10" fill="#999"/>`));
  });

  test('should place a shape a quarter the size of the drawing with a tap', async ({ page }) => {
    await page.locator('#draw-circle').click();
    const p = await at(page, 100, 100);
    await page.mouse.click(p.x, p.y);
    expect(await getSource(page)).toBe(withShape('<circle cx="100" cy="100" r="25" fill="#999"/>'));
    await expect(page.locator('#draw-circle')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('.select-box')).toBeVisible();
  });

  test('should put a drag back with Escape and keep the tool, then put the tool down with another', async ({ page }) => {
    const tool = page.locator('#draw-rect');
    await tool.click();
    await drawDrag(page, [100, 20], [180, 60], { cancel: true });
    expect(await getSource(page)).toBe(FIXTURE);
    await expect(page.locator('.svg-container rect')).toHaveCount(1);
    await expect(tool).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Escape');
    await expect(tool).toHaveAttribute('aria-pressed', 'false');
  });

  test('should keep the crosshair while the tool is in hand, after a drag taken back too', async ({ page }) => {
    const wrapper = page.locator('.svg-preview-wrapper');
    await page.locator('#draw-rect').click();
    await expect(wrapper).toHaveCSS('cursor', 'crosshair');
    await drawDrag(page, [100, 20], [180, 60], { cancel: true });
    await expect(wrapper).toHaveCSS('cursor', 'crosshair');
    await page.keyboard.press('Escape');
    await expect(wrapper).not.toHaveCSS('cursor', 'crosshair');
  });

  test('should place one shape with a double-click, and not try to edit its points', async ({ page }) => {
    await page.locator('#draw-rect').click();
    const p = await at(page, 100, 100);
    await page.mouse.dblclick(p.x, p.y);
    expect(await getSource(page)).toBe(withShape('<rect x="75" y="75" width="50" height="50" fill="#999"/>'));
    // the second click selects the new shape again
    await expect(page.locator('#test-announcements')).toHaveText('Selected rect');
    await expect(page.locator('#error-announcements')).toHaveCount(0);
    await expect(page.locator('#point-tools')).toBeHidden();
    // a double-click after that is the selection's own again
    await page.mouse.dblclick(p.x, p.y);
    await expect(page.locator('#error-announcements')).toHaveText(/no points to edit/);
  });

  test('should not draw with a right-click, on a handle or the drawing', async ({ page }) => {
    await page.locator('.svg-container #box').click();
    await page.locator('#draw-rect').click();
    const handle = (await page.locator('[data-handle="se"]').boundingBox())!;
    await page.mouse.click(handle.x + handle.width / 2, handle.y + handle.height / 2, { button: 'right' });
    const p = await at(page, 120, 40);
    await page.mouse.click(p.x, p.y, { button: 'right' });
    expect(await getSource(page)).toBe(FIXTURE);
    await expect(page.locator('#draw-rect')).toHaveAttribute('aria-pressed', 'true');
  });

  test('should let a drag go when the tool is put down or changed mid-drag', async ({ page }) => {
    const tool = page.locator('#draw-rect');
    await tool.click();
    const a = await at(page, 100, 20);
    const b = await at(page, 180, 60);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 4 });
    await expect(page.locator('.svg-container rect')).toHaveCount(2);
    // the canvas took the keys at the press, so the tool is pressed from the keys by focusing it
    await tool.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.svg-container rect')).toHaveCount(1);
    await page.mouse.move(b.x + 10, b.y + 10, { steps: 2 });
    await page.mouse.up();
    expect(await getSource(page)).toBe(FIXTURE);
    await expect(tool).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#error-announcements')).toHaveCount(0);
    // a tool changed mid-drag lets it go too, rather than draw the new shape with the old one's numbers
    await tool.click();
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 4 });
    await page.locator('#draw-circle').focus();
    await page.keyboard.press('Enter');
    await page.mouse.up();
    expect(await getSource(page)).toBe(FIXTURE);
    await expect(page.locator('#draw-circle')).toHaveAttribute('aria-pressed', 'true');
  });

  test('should keep the press where it was in the drawing when the view zooms mid-drag', async ({ page }) => {
    await page.locator('#draw-rect').click();
    const a = await at(page, 100, 100);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(a.x + 20, a.y + 20, { steps: 2 });
    // the wheel waits for the drag, but a zoom button can be pressed from the keys
    await page.locator('#zoomin').focus();
    await page.keyboard.press('Enter');
    const scale = () => page.evaluate(() => (document.querySelector('.svg-container svg') as SVGSVGElement).getScreenCTM()!.a);
    await expect.poll(scale).toBeGreaterThan(1.1);
    await page.waitForTimeout(600);
    // the pointer is where it was on screen, which now shows another spot of the drawing
    const corner = await page.evaluate(([x, y]) => {
      const p = new DOMPoint(x, y).matrixTransform((document.querySelector('.svg-container svg') as SVGSVGElement).getScreenCTM()!.inverse());
      return { x: p.x, y: p.y };
    }, [a.x + 30, a.y + 30] as [number, number]);
    await page.mouse.move(a.x + 30, a.y + 30, { steps: 2 });
    await page.mouse.up();
    const source = await getSource(page);
    const m = /<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" fill="#999"\/>/.exec(source)!;
    expect(Number(m[1])).toBe(100);
    expect(Number(m[2])).toBe(100);
    expect(Math.abs(Number(m[1]) + Number(m[3]) - corner.x)).toBeLessThan(1);
    expect(Math.abs(Number(m[2]) + Number(m[4]) - corner.y)).toBeLessThan(1);
  });

  test('should put the tool down when it is pressed again, or another taken up', async ({ page }) => {
    const rect = page.locator('#draw-rect');
    const circle = page.locator('#draw-circle');
    await rect.click();
    await circle.click();
    await expect(rect).toHaveAttribute('aria-pressed', 'false');
    await expect(circle).toHaveAttribute('aria-pressed', 'true');
    await circle.click();
    await expect(circle).toHaveAttribute('aria-pressed', 'false');
    // with no tool in hand, a drag across the drawing pans it again
    await drawDrag(page, [100, 20], [180, 60]);
    expect(await getSource(page)).toBe(FIXTURE);
  });

  test('should take the new shape back with one undo', async ({ page }) => {
    await page.locator('#draw-rect').click();
    await drawDrag(page, [100, 20], [180, 60]);
    expect(await getSource(page)).not.toBe(FIXTURE);
    await page.locator('#undo').click();
    expect(await getSource(page)).toBe(FIXTURE);
  });

  test('should draw in the drawing\'s own units, to the precision the zoom shows', async ({ page }) => {
    // two pixels to a unit, from 50,50
    const scaled = FIXTURE.replace('viewBox="0 0 200 200"', 'viewBox="50 50 100 100"');
    await setContent(page, scaled);
    await page.locator('#draw-rect').click();
    await drawDrag(page, [60, 60], [80, 70]);
    expect(await getSource(page)).toBe(scaled.replace('</svg>', '  <rect x="60" y="60" width="20" height="10" fill="#999"/>\n</svg>'));
    // zoomed in past three pixels a unit, a drag is written to a tenth
    await setContent(page, FIXTURE);
    for (let i = 0; i < 8; i++) await page.locator('#zoomin').click();
    await expect.poll(() => page.evaluate(() => (document.querySelector('.svg-container svg') as SVGSVGElement).getScreenCTM()!.a)).toBeGreaterThan(3.2);
    await page.locator('#draw-rect').click();
    await drawDrag(page, [100.25, 100.25], [110.5, 104.75]);
    expect(await getSource(page)).toMatch(/<rect x="100\.\d" y="100\.\d" width="10\.\d" height="4\.\d" fill="#999"\/>\n<\/svg>$/);
  });

  test('should refuse to draw while the code does not parse', async ({ page }) => {
    const broken = FIXTURE.replace('</svg>', '');
    await setContent(page, broken);
    await page.locator('#draw-rect').click();
    await drawDrag(page, [100, 20], [180, 60]);
    expect(await getSource(page)).toBe(broken);
  });

  test('should hide the shape tools while points are edited, and edit points when Enter is pressed with a tool in hand', async ({ page }) => {
    await setContent(page, FIXTURE.replace('<circle id="dot" cx="150" cy="150" r="30" fill="#aa0000"/>', '<path id="p" d="M120 120 L180 120 L150 180 Z"/>'));
    await page.locator('.svg-container #p').click();
    await page.locator('#points').click();
    await expect(page.locator('#shape-tools')).toBeHidden();
    await page.locator('#mode-shapes').click();
    await expect(page.locator('#shape-tools')).toBeVisible();
    // taking up a tool, Enter on the canvas edits the selection's points and puts the tool down
    await page.locator('#draw-rect').click();
    await page.locator('.svg-preview-wrapper').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#point-tools')).toBeVisible();
    await expect(page.locator('#draw-rect')).toHaveAttribute('aria-pressed', 'false');
  });
});

test.describe('SVG Editor drawing shapes by touch', () => {
  test.use({ viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true });

  test('should draw a shape with a finger, and place one with a tap', async ({ page }) => {
    await page.goto('/index.html');
    await expect(page.locator('.svg-container svg')).toBeVisible();
    await setContent(page, FIXTURE);
    await page.locator('#mode-shapes').tap();
    await page.locator('#draw-ellipse').tap();
    const cdp = await page.context().newCDPSession(page);
    const touch = (p: { x: number; y: number }) => [{ x: p.x, y: p.y, id: 1 }];
    const a = await at(page, 100, 20);
    const b = await at(page, 160, 60);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: touch(a) });
    for (const k of [0.25, 0.5, 0.75, 1]) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: touch({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k }) });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const ellipse = '<ellipse cx="130" cy="40" rx="30" ry="20" fill="#999"/>';
    await expect.poll(() => getSource(page)).toBe(withShape(ellipse));
    await expect(page.locator('#draw-ellipse')).toHaveAttribute('aria-pressed', 'false');
    await page.locator('#draw-rect').tap();
    const p = await at(page, 100, 100);
    await page.touchscreen.tap(p.x, p.y);
    await expect.poll(() => getSource(page)).toBe(withShape(`${ellipse}\n  <rect x="75" y="75" width="50" height="50" fill="#999"/>`));
  });
});
