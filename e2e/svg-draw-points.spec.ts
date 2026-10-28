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

/** Click at each point of the drawing in turn. */
async function clicks(page: Page, ...points: [number, number][]) {
  for (const [x, y] of points) {
    const p = await at(page, x, y);
    await page.mouse.click(p.x, p.y);
  }
}

/** Press at one point of the drawing, travel to another, release. */
async function dragAt(page: Page, from: [number, number], to: [number, number], opts: { keys?: string[] } = {}) {
  const a = await at(page, ...from);
  const b = await at(page, ...to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  for (const key of opts.keys ?? []) await page.keyboard.down(key);
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 });
  await page.mouse.move(b.x, b.y, { steps: 4 });
  for (const key of opts.keys ?? []) await page.keyboard.up(key);
  await page.mouse.up();
}

// at 200 user units across 200 pixels, one pixel is one unit; a stroke is a hundredth of that
const FIXTURE = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
  <rect id="box" x="20" y="20" width="60" height="60" fill="#6291e0"/>
  <circle id="dot" cx="150" cy="150" r="30" fill="#aa0000"/>
</svg>`;

/** The fixture with this markup as its last child. */
const withShape = (markup: string) => FIXTURE.replace('</svg>', `  ${markup}\n</svg>`);
const STROKE = 'fill="none" stroke="#999" stroke-width="2"';

/** The stand-in a shape under way is shown with. */
const standIn = (page: Page, tag: string) => page.locator(`.svg-container ${tag}:not([data-slick-src])`);

test.describe('SVG Editor drawing lines', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html');
    await expect(page.locator('.svg-container svg')).toBeVisible();
    await setContent(page, FIXTURE);
    await expect(page.locator('.svg-container #box')).toBeVisible();
  });

  test('should draw a line with a drag, stroked a hundredth of the drawing wide', async ({ page }) => {
    await page.locator('#draw-line').click();
    await dragAt(page, [100, 20], [180, 60]);
    const markup = '<line x1="100" y1="20" x2="180" y2="60" stroke="#999" stroke-width="2"/>';
    expect(await getSource(page)).toBe(withShape(markup));
    expect(await editorSelection(page)).toBe(markup);
    await expect(page.locator('#draw-line')).toHaveAttribute('aria-pressed', 'false');
  });

  test('should keep a line at a multiple of 45 degrees with Shift, and draw it from the middle with Alt', async ({ page }) => {
    await page.locator('#draw-line').click();
    // level, as long as the drag, give or take the half pixel a pointer is read to
    await dragAt(page, [100, 20], [180, 30], { keys: ['Shift'] });
    const level = /<line x1="100" y1="20" x2="18[01]" y2="20" stroke="#999" stroke-width="2"\/>/;
    expect(await getSource(page)).toMatch(level);
    const drawn = level.exec(await getSource(page))![0];
    await page.locator('#draw-line').click();
    await dragAt(page, [140, 100], [160, 110], { keys: ['Alt'] });
    expect(await getSource(page)).toBe(withShape(`${drawn}\n  <line x1="120" y1="90" x2="160" y2="110" stroke="#999" stroke-width="2"/>`));
  });

  test('should place a level line a quarter of the drawing long with a tap', async ({ page }) => {
    await page.locator('#draw-line').click();
    await clicks(page, [100, 100]);
    expect(await getSource(page)).toBe(withShape('<line x1="75" y1="100" x2="125" y2="100" stroke="#999" stroke-width="2"/>'));
  });
});

test.describe('SVG Editor drawing a point at a time', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html');
    await expect(page.locator('.svg-container svg')).toBeVisible();
    await setContent(page, FIXTURE);
    await expect(page.locator('.svg-container #box')).toBeVisible();
  });

  test('should draw a polyline a point at a click, and finish it with a click on the last point', async ({ page }) => {
    const tool = page.locator('#draw-polyline');
    await tool.click();
    await clicks(page, [100, 20], [140, 60], [180, 20]);
    // nothing is written until the shape is finished, but it shows as it will be
    expect(await getSource(page)).toBe(FIXTURE);
    await expect(standIn(page, 'polyline')).toHaveAttribute('points', '100,20 140,60 180,20');
    await expect(page.locator('#svg-status-bar')).toHaveText('polyline points="100,20 140,60 180,20"');
    await expect(page.locator('.sketch rect')).toHaveCount(3);
    await clicks(page, [180, 20]);
    const markup = `<polyline points="100,20 140,60 180,20" ${STROKE}/>`;
    expect(await getSource(page)).toBe(withShape(markup));
    expect(await editorSelection(page)).toBe(markup);
    await expect(tool).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('.sketch rect')).toHaveCount(0);
    await expect(standIn(page, 'polyline')).toHaveCount(0);
    await expect(page.locator('.select-box')).toBeVisible();
  });

  test('should finish a polyline with a double-click', async ({ page }) => {
    await page.locator('#draw-polyline').click();
    await clicks(page, [100, 20], [140, 60]);
    const p = await at(page, 180, 20);
    await page.mouse.dblclick(p.x, p.y);
    expect(await getSource(page)).toBe(withShape(`<polyline points="100,20 140,60 180,20" ${STROKE}/>`));
    await expect(page.locator('#error-announcements')).toHaveCount(0);
  });

  test('should bring a polyline back to its first point, and leave it open', async ({ page }) => {
    await page.locator('#draw-polyline').click();
    await clicks(page, [100, 20], [180, 20], [140, 80], [100, 20]);
    expect(await getSource(page)).toBe(withShape(`<polyline points="100,20 180,20 140,80 100,20" ${STROKE}/>`));
  });

  test('should close a polygon on its first point, filled', async ({ page }) => {
    await page.locator('#draw-polygon').click();
    await clicks(page, [100, 20], [180, 20], [140, 80]);
    await expect(page.locator('.sketch rect.first')).toHaveCount(1);
    await expect(standIn(page, 'polygon')).toHaveAttribute('fill', '#999');
    // a click a few pixels off the first point still closes it
    await clicks(page, [103, 22]);
    expect(await getSource(page)).toBe(withShape('<polygon points="100,20 180,20 140,80" fill="#999"/>'));
  });

  test('should not close a polygon of two points, nor put a point on top of its first', async ({ page }) => {
    await page.locator('#draw-polygon').click();
    await clicks(page, [100, 20], [180, 20], [100, 20]);
    await expect(page.locator('#error-announcements')).toHaveText('A polygon needs three points or more.');
    await expect(standIn(page, 'polygon')).toHaveAttribute('points', '100,20 180,20');
    await expect(page.locator('#draw-done')).toBeDisabled();
    await clicks(page, [140, 80]);
    await expect(page.locator('#draw-done')).toBeEnabled();
    await page.locator('#draw-done').click();
    expect(await getSource(page)).toBe(withShape('<polygon points="100,20 180,20 140,80" fill="#999"/>'));
  });

  test('should show the next segment where the pointer hovers, and move a point dragged before it lets go', async ({ page }) => {
    await page.locator('#draw-polyline').click();
    await clicks(page, [100, 20]);
    const hover = await at(page, 150, 50);
    await page.mouse.move(hover.x, hover.y, { steps: 2 });
    await expect(standIn(page, 'polyline')).toHaveAttribute('points', '100,20 150,50');
    await dragAt(page, [140, 60], [160, 80]);
    await expect(standIn(page, 'polyline')).toHaveAttribute('points', /^100,20 160,80/);
    await page.keyboard.press('Enter');
    expect(await getSource(page)).toBe(withShape(`<polyline points="100,20 160,80" ${STROKE}/>`));
  });

  test('should keep a point at a multiple of 45 degrees from the last with Shift', async ({ page }) => {
    await page.locator('#draw-polyline').click();
    await clicks(page, [100, 20]);
    const p = await at(page, 150, 26);
    await page.keyboard.down('Shift');
    await page.mouse.click(p.x, p.y);
    await page.keyboard.up('Shift');
    await page.keyboard.press('Enter');
    expect(await getSource(page)).toMatch(/<polyline points="100,20 150,20" /);
  });

  test('should take back the last point with Backspace, Mod+Z, or the button, and let the shape go with Escape', async ({ page }) => {
    const tool = page.locator('#draw-polygon');
    await tool.click();
    await clicks(page, [100, 20], [180, 20], [140, 80], [120, 100]);
    await expect(page.locator('#sketch-tools')).toBeVisible();
    await expect(page.locator('#dark')).toBeHidden();
    // the shape's own tool stays, the others make room
    await expect(page.locator('#draw-rect')).toBeHidden();
    await expect(tool).toBeVisible();
    await page.keyboard.press('Backspace');
    await expect(standIn(page, 'polygon')).toHaveAttribute('points', '100,20 180,20 140,80');
    await page.keyboard.press('ControlOrMeta+z');
    await expect(standIn(page, 'polygon')).toHaveAttribute('points', '100,20 180,20');
    await page.locator('#draw-back').click();
    await expect(standIn(page, 'polygon')).toHaveAttribute('points', '100,20');
    expect(await getSource(page)).toBe(FIXTURE);
    // Escape lets the shape go and keeps the tool; the next puts it down
    await page.keyboard.press('Escape');
    await expect(standIn(page, 'polygon')).toHaveCount(0);
    await expect(page.locator('#sketch-tools')).toBeHidden();
    await expect(page.locator('#dark')).toBeVisible();
    await expect(page.locator('#draw-rect')).toBeVisible();
    await expect(tool).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Escape');
    await expect(tool).toHaveAttribute('aria-pressed', 'false');
    expect(await getSource(page)).toBe(FIXTURE);
  });

  test('should take back the last point with the undo button too, which a shape under way enables', async ({ page }) => {
    // a fresh page has no history for the button to undo
    await page.reload();
    await expect(page.locator('.svg-container svg')).toBeVisible();
    const source = await getSource(page);
    await expect(page.locator('#undo')).toBeDisabled();
    await page.locator('#draw-polyline').click();
    await clicks(page, [20, 20], [60, 40]);
    await expect(page.locator('#undo')).toBeEnabled();
    await page.locator('#undo').click();
    await expect(standIn(page, 'polyline')).toHaveAttribute('points', '20,20');
    await page.locator('#undo').click();
    await expect(standIn(page, 'polyline')).toHaveCount(0);
    await expect(page.locator('#undo')).toBeDisabled();
    expect(await getSource(page)).toBe(source);
  });

  test('should keep the crosshair between points', async ({ page }) => {
    await page.locator('#draw-polygon').click();
    await clicks(page, [100, 20]);
    await expect(page.locator('.svg-preview-wrapper')).toHaveCSS('cursor', 'crosshair');
  });

  test('should keep a shape under way, and its tool, while the code does not parse', async ({ page }) => {
    const tool = page.locator('#draw-polyline');
    await tool.click();
    await clicks(page, [100, 20], [180, 20], [140, 80]);
    await setContent(page, FIXTURE.replace('</svg>', ''));
    await page.keyboard.press('Enter');
    await expect(page.locator('#error-announcements')).toHaveText(/cannot be written yet/);
    // closing it is refused too, without the point it would have closed with
    await clicks(page, [100, 20]);
    await tool.click();
    await expect(tool).toHaveAttribute('aria-pressed', 'true');
    await expect(standIn(page, 'polyline')).toHaveAttribute('points', '100,20 180,20 140,80');
    await setContent(page, FIXTURE);
    await page.locator('#draw-done').click();
    expect(await getSource(page)).toBe(withShape(`<polyline points="100,20 180,20 140,80" ${STROKE}/>`));
  });

  test('should edit the points of a shape under way, written, when the points button is pressed', async ({ page }) => {
    await setContent(page, FIXTURE.replace('<circle id="dot" cx="150" cy="150" r="30" fill="#aa0000"/>', '<path id="p" d="M120 120 L180 120 L150 180 Z"/>'));
    await page.locator('.svg-container #p').click();
    await page.locator('#draw-polyline').click();
    await clicks(page, [100, 20], [180, 20], [140, 80]);
    await page.locator('#points').click();
    await expect(page.locator('#point-tools')).toBeVisible();
    expect(await editorSelection(page)).toBe(`<polyline points="100,20 180,20 140,80" ${STROKE}/>`);
    await expect(page.locator('.points rect')).toHaveCount(3);
  });

  test('should write the shape under way when its tool is pressed again, and let one too short go quietly', async ({ page }) => {
    await page.locator('#draw-polyline').click();
    await clicks(page, [100, 20], [180, 60]);
    await page.locator('#draw-polyline').click();
    const polyline = `<polyline points="100,20 180,60" ${STROKE}/>`;
    expect(await getSource(page)).toBe(withShape(polyline));
    await expect(page.locator('#draw-polyline')).toHaveAttribute('aria-pressed', 'false');
    await page.locator('#draw-polygon').click();
    await clicks(page, [100, 120], [140, 120]);
    await page.locator('#draw-polygon').click();
    expect(await getSource(page)).toBe(withShape(polyline));
    await expect(page.locator('#draw-polygon')).toHaveAttribute('aria-pressed', 'false');
    await expect(standIn(page, 'polygon')).toHaveCount(0);
    await expect(page.locator('#error-announcements')).toHaveCount(0);
  });

  test('should keep the points where they are in the drawing when the view zooms between them', async ({ page }) => {
    await page.locator('#draw-polyline').click();
    await clicks(page, [100, 20]);
    const q = await at(page, 60, 140);
    await page.mouse.move(q.x, q.y);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -100);
    await page.keyboard.up('Control');
    await expect.poll(() => page.evaluate(() => (document.querySelector('.svg-container svg') as SVGSVGElement).getScreenCTM()!.a)).toBeGreaterThan(1.05);
    // the first point's marker followed the zoom
    const marker = (await page.locator('.sketch rect').first().boundingBox())!;
    const first = await at(page, 100, 20);
    expect(Math.abs(marker.x + marker.width / 2 - first.x)).toBeLessThan(1);
    await clicks(page, [180, 60]);
    await page.keyboard.press('Enter');
    expect(await getSource(page)).toBe(withShape(`<polyline points="100,20 180,60" ${STROKE}/>`));
  });

  test('should keep a shape under way when the code changes meanwhile', async ({ page }) => {
    await page.locator('#draw-polygon').click();
    await clicks(page, [100, 20], [180, 20], [140, 80]);
    const changed = FIXTURE.replace('#aa0000', '#00aa00');
    await setContent(page, changed);
    await expect(standIn(page, 'polygon')).toHaveAttribute('points', '100,20 180,20 140,80');
    await page.keyboard.press('Enter');
    expect(await getSource(page)).toBe(changed.replace('</svg>', '  <polygon points="100,20 180,20 140,80" fill="#999"/>\n</svg>'));
  });
});

test.describe('SVG Editor drawing paths with the pen', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html');
    await expect(page.locator('.svg-container svg')).toBeVisible();
    await setContent(page, FIXTURE);
    await expect(page.locator('.svg-container #box')).toBeVisible();
  });

  test('should place corners with clicks and end the path open with Enter, stroked', async ({ page }) => {
    await page.locator('#draw-path').click();
    await clicks(page, [100, 20], [180, 60]);
    await page.keyboard.press('Enter');
    const markup = `<path d="M100 20 L180 60" ${STROKE}/>`;
    expect(await getSource(page)).toBe(withShape(markup));
    expect(await editorSelection(page)).toBe(markup);
  });

  test('should pull a smooth curve out of a point dragged, and close the path on its first point, filled', async ({ page }) => {
    await page.locator('#draw-path').click();
    await clicks(page, [100, 20]);
    await dragAt(page, [180, 20], [180, 60]);
    // the point's handles show while the next is placed
    await expect(page.locator('.sketch circle')).toHaveCount(2);
    await clicks(page, [140, 100], [100, 20]);
    expect(await getSource(page)).toBe(withShape('<path d="M100 20 C100 20 180 -20 180 20 C180 60 140 100 140 100 Z" fill="#999"/>'));
  });

  test('should end a path of two corners open on its first point, and close one with a curve', async ({ page }) => {
    await page.locator('#draw-path').click();
    await clicks(page, [100, 20], [180, 20], [100, 20]);
    const open = `<path d="M100 20 L180 20" ${STROKE}/>`;
    expect(await getSource(page)).toBe(withShape(open));
    await page.locator('#draw-path').click();
    await clicks(page, [100, 120]);
    await dragAt(page, [180, 120], [180, 160]);
    await clicks(page, [100, 120]);
    expect(await getSource(page)).toBe(withShape(`${open}\n  <path d="M100 120 C100 120 180 80 180 120 C180 160 100 120 100 120 Z" fill="#999"/>`));
  });

  test('should show the curve a click where the pointer hovers would make', async ({ page }) => {
    await page.locator('#draw-path').click();
    await dragAt(page, [100, 20], [140, 20]);
    const hover = await at(page, 180, 60);
    await page.mouse.move(hover.x, hover.y, { steps: 2 });
    await expect(standIn(page, 'path')).toHaveAttribute('d', 'M100 20 C140 20 180 60 180 60');
  });

  test('should bend only the way out of the last point when it is dragged again, leaving a corner', async ({ page }) => {
    await page.locator('#draw-path').click();
    await clicks(page, [100, 20]);
    await dragAt(page, [180, 20], [180, 60]);
    await dragAt(page, [180, 20], [140, 20]);
    await clicks(page, [140, 100]);
    await page.keyboard.press('Enter');
    expect(await getSource(page)).toBe(withShape(`<path d="M100 20 C100 20 180 -20 180 20 C140 20 140 100 140 100" ${STROKE}/>`));
  });

  test('should keep the handles at a multiple of 45 degrees with Shift', async ({ page }) => {
    await page.locator('#draw-path').click();
    await clicks(page, [100, 20]);
    await dragAt(page, [180, 60], [184, 100], { keys: ['Shift'] });
    await page.keyboard.press('Enter');
    expect(await getSource(page)).toMatch(/<path d="M100 20 C100 20 180 20 180 60" /);
  });

  test('should edit the points of a path it drew with the point tools', async ({ page }) => {
    await page.locator('#draw-path').click();
    await clicks(page, [100, 20]);
    await dragAt(page, [180, 20], [180, 60]);
    await clicks(page, [140, 100]);
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await expect(page.locator('#point-tools')).toBeVisible();
    await expect(page.locator('.points rect')).toHaveCount(3);
  });
});

test.describe('SVG Editor drawing a point at a time by touch', () => {
  test.use({ viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true });

  test('should draw a polygon with taps and a path with a finger, finishing each from the bar', async ({ page }) => {
    await page.goto('/index.html');
    await expect(page.locator('.svg-container svg')).toBeVisible();
    await setContent(page, FIXTURE);
    await page.locator('#draw-polygon').tap();
    for (const [x, y] of [[100, 20], [180, 20], [140, 80]] as [number, number][]) {
      const p = await at(page, x, y);
      await page.touchscreen.tap(p.x, p.y);
    }
    // the button that finishes the shape is in reach without scrolling the bar
    await expect(page.locator('#draw-done')).toBeInViewport();
    await page.locator('#draw-done').tap();
    const polygon = '<polygon points="100,20 180,20 140,80" fill="#999"/>';
    await expect.poll(() => getSource(page)).toBe(withShape(polygon));
    await page.locator('#draw-path').tap();
    const start = await at(page, 100, 120);
    await page.touchscreen.tap(start.x, start.y);
    const cdp = await page.context().newCDPSession(page);
    const touch = (p: { x: number; y: number }) => [{ x: p.x, y: p.y, id: 1 }];
    const a = await at(page, 180, 120);
    const b = await at(page, 180, 160);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: touch(a) });
    for (const k of [0.25, 0.5, 0.75, 1]) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: touch({ x: a.x, y: a.y + (b.y - a.y) * k }) });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    // a tap on the first point closes the path
    await page.touchscreen.tap(start.x, start.y);
    await expect.poll(() => getSource(page)).toBe(withShape(`${polygon}\n  <path d="M100 120 C100 120 180 80 180 120 C180 160 100 120 100 120 Z" fill="#999"/>`));
  });
});
