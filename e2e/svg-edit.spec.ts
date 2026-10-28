import { test, expect, type Page, type Locator } from '@playwright/test';

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

/** Where a point in an element's own units is on the page. */
const onPage = (page: Page, selector: string, x: number, y: number) =>
  page.evaluate(([selector, x, y]) => {
    const el = document.querySelector(selector) as SVGGraphicsElement;
    const p = new DOMPoint(x, y).matrixTransform(el.getScreenCTM()!);
    return { x: p.x, y: p.y };
  }, [selector, x, y] as [string, number, number]);

/** Press at a locator's centre (or an offset from it), travel, release. */
async function drag(page: Page, from: Locator, dx: number, dy: number, opts: { shift?: boolean; offset?: { x: number; y: number }; cancel?: boolean } = {}) {
  const box = (await from.boundingBox())!;
  const x = box.x + (opts.offset?.x ?? box.width / 2);
  const y = box.y + (opts.offset?.y ?? box.height / 2);
  await page.mouse.move(x, y);
  await page.mouse.down();
  if (opts.shift) await page.keyboard.down('Shift');
  await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 4 });
  await page.mouse.move(x + dx, y + dy, { steps: 4 });
  if (opts.cancel) await page.keyboard.press('Escape');
  if (opts.shift) await page.keyboard.up('Shift');
  await page.mouse.up();
}

// at 200 user units across 200 pixels, one pixel is one unit
const FIXTURE = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
  <rect id="box" x="20" y="20" width="60" height="60" fill="#6291e0"/>
  <circle id="dot" cx="150" cy="150" r="30" fill="#aa0000"/>
</svg>`;

test.describe('SVG Editor Preview Editing', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html');
    await expect(page.locator('.svg-container svg')).toBeVisible();
    await setContent(page, FIXTURE);
    await expect(page.locator('.svg-container rect')).toBeVisible();
  });

  test('should move the selection by dragging it, rewriting only its position', async ({ page }) => {
    const rect = page.locator('.svg-container rect');
    await rect.click();
    await drag(page, rect, 40, 30);

    expect(await getSource(page)).toBe(FIXTURE.replace('x="20" y="20"', 'x="60" y="50"'));
    await expect(page.locator('.svg-container rect')).toHaveAttribute('x', '60');

    // one undo takes the whole drag back
    await page.locator('#undo').click();
    expect(await getSource(page)).toBe(FIXTURE);
  });

  test('should not move an unselected shape: dragging it pans', async ({ page }) => {
    await drag(page, page.locator('.svg-container rect'), 40, 30);
    expect(await getSource(page)).toBe(FIXTURE);
  });

  test('should put a drag back when Escape is pressed before release', async ({ page }) => {
    const rect = page.locator('.svg-container rect');
    await rect.click();
    await drag(page, rect, 40, 30, { cancel: true });
    expect(await getSource(page)).toBe(FIXTURE);
    await expect(rect).toHaveAttribute('x', '20');
    await expect(page.locator('#svg-status-bar')).toHaveText('SVG valid');
  });

  test('should read the edit out in the status bar while dragging', async ({ page }) => {
    const rect = page.locator('.svg-container rect');
    await rect.click();
    const box = (await rect.boundingBox())!;
    await page.mouse.move(box.x + 30, box.y + 30);
    await page.mouse.down();
    await page.mouse.move(box.x + 55, box.y + 40, { steps: 5 });
    await expect(page.locator('#svg-status-bar')).toHaveText('rect x="45" y="30"');
    await page.mouse.up();
    await expect(page.locator('#svg-status-bar')).toHaveText('SVG valid');
  });

  test('should nudge the selection with the arrow keys, ten units with Shift', async ({ page }) => {
    await page.locator('.svg-container rect').click();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Shift+ArrowLeft');
    expect(await getSource(page)).toBe(FIXTURE.replace('x="20" y="20"', 'x="12" y="21"'));
  });

  test('should join a run of nudges along one axis into one undo step', async ({ page }) => {
    await page.locator('.svg-container rect').click();
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
    expect(await getSource(page)).toBe(FIXTURE.replace('x="20"', 'x="23"'));
    await page.locator('#undo').click();
    expect(await getSource(page)).toBe(FIXTURE);
  });

  test('should keep the proportions from a corner and stretch one axis from a side, with Shift the other way round', async ({ page }) => {
    await page.locator('.svg-container rect').click();
    await expect(page.locator('[data-handle="se"]')).toBeVisible();
    await drag(page, page.locator('[data-handle="se"]'), 20, 10);
    expect(await getSource(page)).toBe(FIXTURE.replace('width="60" height="60"', 'width="80" height="80"'));

    await page.locator('#undo').click();
    await drag(page, page.locator('[data-handle="se"]'), 20, 10, { shift: true });
    expect(await getSource(page)).toBe(FIXTURE.replace('width="60" height="60"', 'width="80" height="70"'));

    await page.locator('#undo').click();
    await drag(page, page.locator('[data-handle="e"]'), 30, 0);
    expect(await getSource(page)).toBe(FIXTURE.replace('width="60" height="60"', 'width="90" height="60"'));

    await page.locator('#undo').click();
    await drag(page, page.locator('[data-handle="e"]'), 30, 0, { shift: true });
    expect(await getSource(page)).toBe(FIXTURE.replace('x="20" y="20" width="60" height="60"', 'x="20" y="5" width="90" height="90"'));
  });

  test('should pull a circle out of round from a side handle, and keep it round from a corner', async ({ page }) => {
    await page.locator('.svg-container circle').click();
    await drag(page, page.locator('[data-handle="e"]'), 30, 0);
    expect(await getSource(page)).toContain('<circle id="dot" cx="150" cy="150" r="30" fill="#aa0000" transform="translate(-60 0) scale(1.5 1)"/>');

    await page.locator('#undo').click();
    await drag(page, page.locator('[data-handle="se"]'), 30, 0);
    expect(await getSource(page)).toContain('<circle id="dot" cx="165" cy="165" r="45" fill="#aa0000"/>');
  });

  test('should turn the selection with the rotate handle', async ({ page }) => {
    const rect = page.locator('.svg-container rect');
    await rect.click();
    const handle = (await page.locator('[data-handle="rotate"]').boundingBox())!;
    const box = (await rect.boundingBox())!;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const radius = cy - (handle.y + handle.height / 2);
    // a quarter turn: from straight above the centre to straight to its right,
    // with Shift snapping to 15 degrees so a sub-pixel start cannot skew it
    await page.mouse.move(cx, cy - radius);
    await page.mouse.down();
    await page.keyboard.down('Shift');
    await page.mouse.move(cx + radius * 0.7, cy - radius * 0.7, { steps: 4 });
    await page.mouse.move(cx + radius, cy, { steps: 4 });
    await page.keyboard.up('Shift');
    await page.mouse.up();
    expect(await getSource(page)).toBe(FIXTURE.replace('fill="#6291e0"/>', 'fill="#6291e0" transform="rotate(90 50 50)"/>'));
  });

  test('should rotate and flip the selection from the toolbar, or the whole drawing with nothing selected', async ({ page }) => {
    await page.locator('.svg-container rect').click();
    await page.locator('#rotate').click();
    expect(await getSource(page)).toContain('<rect id="box" x="20" y="20" width="60" height="60" fill="#6291e0" transform="rotate(90 50 50)"/>');
    await page.locator('#rotate').click();
    expect(await getSource(page)).toContain('transform="rotate(180 50 50)"');

    // a half turn and a flip across the upright line are a flip across the level one
    await page.locator('#flipx').click();
    expect(await getSource(page)).toContain('fill="#6291e0" transform="translate(0 100) scale(1 -1)"');
    await page.locator('#flipx').click();
    expect(await getSource(page)).toContain('transform="rotate(180 50 50)"');

    await page.keyboard.press('Escape');
    await page.locator('#rotate').click();
    await expect(page.locator('.svg-container svg')).toHaveAttribute('transform', 'rotate(90)');
  });

  test('should delete the selection with its line, and undo brings it back', async ({ page }) => {
    await page.locator('.svg-container circle').click();
    await page.keyboard.press('Delete');
    expect(await getSource(page)).toBe(FIXTURE.replace('  <circle id="dot" cx="150" cy="150" r="30" fill="#aa0000"/>\n', ''));
    await expect(page.locator('.svg-container circle')).toHaveCount(0);
    await expect(page.locator('.select-overlay .select-box')).toBeHidden();

    await page.locator('#undo').click();
    expect(await getSource(page)).toBe(FIXTURE);
  });

  test('should refuse to edit while the code does not parse', async ({ page }) => {
    await page.locator('.svg-container rect').click();
    await setContent(page, FIXTURE.replace('</svg>', ''));
    await page.locator('.svg-container rect').click();
    await drag(page, page.locator('.svg-container rect'), 40, 30);
    expect(await getSource(page)).toBe(FIXTURE.replace('</svg>', ''));
  });

  test('should duplicate the selection beside it with its own id, and select the copy', async ({ page }) => {
    const duplicate = page.locator('#duplicate');
    await expect(duplicate).toBeDisabled();
    await page.locator('.svg-container rect').click();
    await expect(duplicate).toBeEnabled();

    await duplicate.click();
    expect(await getSource(page)).toBe(FIXTURE.replace(
      'fill="#6291e0"/>\n',
      'fill="#6291e0"/>\n  <rect id="box-copy" x="30" y="30" width="60" height="60" fill="#6291e0"/>\n',
    ));
    expect(await page.evaluate(() => {
      const state = (window as any).svgEditor.editor.state;
      return state.doc.sliceString(state.selection.main.from, state.selection.main.to) as string;
    })).toMatch(/^<rect id="box-copy"/);

    // the keyboard does the same from the canvas, once, and the copy of a copy gets a fresh id
    await page.locator('.svg-preview-wrapper').focus();
    await page.keyboard.press('ControlOrMeta+d');
    expect(await getSource(page)).toContain('<rect id="box-copy-copy" x="40" y="40"');
    expect((await getSource(page)).match(/<rect /g)).toHaveLength(3);

    await page.locator('#undo').click();
    await page.locator('#undo').click();
    expect(await getSource(page)).toBe(FIXTURE);
  });

  test('should add to the selection with Ctrl+click and take an element back out', async ({ page }) => {
    const more = page.locator('.select-overlay .select-more');
    await page.locator('.svg-container rect').click();
    await expect(page.locator('[data-handle="se"]')).toBeVisible();

    await page.locator('.svg-container circle').click({ modifiers: ['ControlOrMeta'] });
    await expect(more).toHaveCount(1);
    await expect(more).toBeVisible();
    // the handles go round them both
    await expect(page.locator('.select-overlay .group-box')).toBeVisible();
    expect(await page.evaluate(() => {
      const state = (window as any).svgEditor.editor.state;
      return state.doc.sliceString(state.selection.main.from, state.selection.main.to) as string;
    })).toMatch(/^<circle/);

    await page.locator('.svg-container circle').click({ modifiers: ['ControlOrMeta'] });
    await expect(more).toBeHidden();
    await expect(page.locator('.select-overlay .group-box')).toBeHidden();
    await expect(page.locator('[data-handle="se"]')).toBeVisible();
  });

  test('should scale a multiple selection together from the far side of the box round them', async ({ page }) => {
    await page.locator('.svg-container rect').click();
    await page.locator('.svg-container circle').click({ modifiers: ['ControlOrMeta'] });
    // the box runs from 20,20 to 180,180, so 16 pixels more at a corner is ten percent
    await drag(page, page.locator('[data-handle="se"]'), 16, 16);
    expect(await getSource(page)).toBe(FIXTURE.replace('width="60" height="60"', 'width="66" height="66"').replace('cx="150" cy="150" r="30"', 'cx="163" cy="163" r="33"'));
    await expect(page.locator('#test-announcements')).toHaveText('2 elements resized');
    await page.locator('#undo').click();
    expect(await getSource(page)).toBe(FIXTURE);
  });

  test('should turn a multiple selection together about the middle of the box round them', async ({ page }) => {
    await page.locator('.svg-container rect').click();
    await page.locator('.svg-container circle').click({ modifiers: ['ControlOrMeta'] });
    // from above the middle, at 100,100, round to its right: a quarter turn, to the nearest fifteen degrees with Shift
    await drag(page, page.locator('[data-handle="rotate"]'), 104, 104, { shift: true });
    const source = await getSource(page);
    expect(source).toContain('fill="#6291e0" transform="rotate(90 100 100)"');
    expect(source).toContain('fill="#aa0000" transform="rotate(90 100 100)"');
    await page.locator('#undo').click();
    expect(await getSource(page)).toBe(FIXTURE);
  });

  test('should move, nudge, rotate, and delete a multiple selection together', async ({ page }) => {
    const rect = page.locator('.svg-container rect');
    await rect.click();
    await page.locator('.svg-container circle').click({ modifiers: ['ControlOrMeta'] });

    await drag(page, rect, 10, 20);
    expect(await getSource(page)).toBe(FIXTURE.replace('x="20" y="20"', 'x="30" y="40"').replace('cx="150" cy="150"', 'cx="160" cy="170"'));
    await page.locator('#undo').click();
    expect(await getSource(page)).toBe(FIXTURE);

    await page.locator('.svg-preview-wrapper').focus();
    await page.keyboard.press('ArrowRight');
    expect(await getSource(page)).toBe(FIXTURE.replace('x="20"', 'x="21"').replace('cx="150"', 'cx="151"'));
    await page.locator('#undo').click();

    // the two turn as one, about the middle of the box round them both
    await page.locator('#rotate').click();
    expect(await getSource(page)).toContain('fill="#6291e0" transform="rotate(90 100 100)"');
    expect(await getSource(page)).toContain('fill="#aa0000" transform="rotate(90 100 100)"');
    await expect(page.locator('#test-announcements')).toHaveText('2 elements rotated 90 degrees');
    await page.locator('#undo').click();

    await page.locator('.svg-preview-wrapper').focus();
    await page.keyboard.press('Delete');
    expect(await getSource(page)).toBe('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">\n</svg>');
    await page.locator('#undo').click();
    expect(await getSource(page)).toBe(FIXTURE);
  });

  test('should flip a multiple selection together across the middle of the box round them', async ({ page }) => {
    await page.locator('.svg-container rect').click();
    await page.locator('.svg-container circle').click({ modifiers: ['ControlOrMeta'] });
    // the box runs from 20,20 to 180,180: the two change places across 100
    await page.locator('#flipx').click();
    expect(await getSource(page)).toContain('fill="#6291e0" transform="translate(200 0) scale(-1 1)"');
    expect(await getSource(page)).toContain('fill="#aa0000" transform="translate(200 0) scale(-1 1)"');
    await expect(page.locator('#test-announcements')).toHaveText('2 elements flipped horizontally');
    const box = (await page.locator('.svg-container rect').boundingBox())!;
    const svg = (await page.locator('.svg-container svg').boundingBox())!;
    expect(box.x - svg.x).toBeCloseTo(120, 0);
    // the same flip again takes the mirrors back off
    await page.locator('#flipx').click();
    expect(await getSource(page)).toBe(FIXTURE);

    await page.locator('#flipy').click();
    expect(await getSource(page)).toContain('fill="#6291e0" transform="translate(0 200) scale(1 -1)"');
    expect(await getSource(page)).toContain('fill="#aa0000" transform="translate(0 200) scale(1 -1)"');
    await page.locator('#undo').click();
    expect(await getSource(page)).toBe(FIXTURE);
  });

  test('should turn and flip the selection as the screen shows it in a drawing turned or flipped itself', async ({ page }) => {
    // the drawing is turned a quarter, so the rect's level is upright on screen
    await setContent(page, FIXTURE.replace('viewBox="0 0 200 200"', 'viewBox="0 0 200 200" transform="rotate(90)"'));
    await page.locator('.svg-container rect').click();
    const [corner, middle] = [await onPage(page, '#box', 20, 20), await onPage(page, '#box', 50, 50)];
    await page.locator('#flipx').click();
    expect(await getSource(page)).toContain('fill="#6291e0" transform="translate(0 100) scale(1 -1)"');
    // flipped across the upright line through its middle on screen
    const flipped = await onPage(page, '#box', 20, 20);
    expect(flipped.x).toBeCloseTo(2 * middle.x - corner.x, 1);
    expect(flipped.y).toBeCloseTo(corner.y, 1);

    // a mirrored drawing turns the other way round in its own units, and clockwise on screen
    await setContent(page, FIXTURE.replace('viewBox="0 0 200 200"', 'viewBox="0 0 200 200" transform="matrix(-1 0 0 1 0 0)"'));
    await page.locator('.svg-container rect').click();
    const [start, centre] = [await onPage(page, '#box', 20, 20), await onPage(page, '#box', 50, 50)];
    await page.locator('#rotate').click();
    expect(await getSource(page)).toContain('fill="#6291e0" transform="rotate(-90 50 50)"');
    const turned = await onPage(page, '#box', 20, 20);
    expect(turned.x).toBeCloseTo(centre.x - (start.y - centre.y), 1);
    expect(turned.y).toBeCloseTo(centre.y + (start.x - centre.x), 1);
  });

  test('should turn the selection as the screen shows it in a drawing stretched along one axis', async ({ page }) => {
    // the drawing is twice as tall on screen as in its units, where a quarter turn is no turn at all
    const stretched = FIXTURE.replace('viewBox="0 0 200 200"', 'viewBox="0 0 200 100" preserveAspectRatio="none"');
    await setContent(page, stretched);
    await page.locator('.svg-container rect').click();
    const [nw, se, centre] = [await onPage(page, '#box', 20, 20), await onPage(page, '#box', 80, 80), await onPage(page, '#box', 50, 50)];
    // in the drawing's own units the turn stretches the rect the other way, which its scale says
    await page.locator('#rotate').click();
    expect(await getSource(page)).toContain('fill="#6291e0" transform="translate(25 -50) rotate(90 25 100) scale(0.5 2)"/>');
    for (const [from, at] of [[nw, await onPage(page, '#box', 20, 20)], [se, await onPage(page, '#box', 80, 80)]]) {
      expect(at.x).toBeCloseTo(centre.x - (from.y - centre.y), 0);
      expect(at.y).toBeCloseTo(centre.y + (from.x - centre.x), 0);
    }
    // a second turn is taken into the first: half way round, and no stretch
    await page.locator('#rotate').click();
    expect(await getSource(page)).toContain('fill="#6291e0" transform="rotate(180 50 50)"/>');
    const half = await onPage(page, '#box', 20, 20);
    expect(half.x).toBeCloseTo(2 * centre.x - nw.x, 0);
    expect(half.y).toBeCloseTo(2 * centre.y - nw.y, 0);
    // and four come round to none
    await page.locator('#rotate').click();
    await page.locator('#rotate').click();
    expect(await getSource(page)).toBe(stretched);
  });

  test('should move a path\'s and a polygon\'s own points, unless their paint is laid out where they are', async ({ page }) => {
    const shapes = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
  <defs><linearGradient id="sky" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="200" y2="0"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#00f"/></linearGradient></defs>
  <path id="p" d="M20 20 L80 20 l0 60 H20 Z" fill="#6291e0"/>
  <polygon id="g" points="120,20 180,20 150,80" fill="#aa0000"/>
  <path id="lit" d="M20 120 H80 V180 H20 Z" fill="url(#sky)"/>
</svg>`;
    await setContent(page, shapes);
    const path = page.locator('.svg-container #p');
    await path.click();
    await drag(page, path, 10, 5);
    // only the numbers that place a point absolutely change; there is no transform
    expect(await getSource(page)).toBe(shapes.replace('d="M20 20 L80 20 l0 60 H20 Z"', 'd="M30 25 L90 25 l0 60 H30 Z"'));

    await page.locator('.svg-container #g').click();
    await page.keyboard.press('ArrowLeft');
    expect(await getSource(page)).toContain('points="119,20 179,20 149,80"');

    // a gradient laid out in the drawing's units would stay behind, so the move goes in a transform
    const lit = page.locator('.svg-container #lit');
    await lit.click();
    await drag(page, lit, 10, 0);
    expect(await getSource(page)).toContain('<path id="lit" d="M20 120 H80 V180 H20 Z" fill="url(#sky)" transform="translate(10 0)"/>');

    for (let i = 0; i < 3; i++) await page.locator('#undo').click();
    expect(await getSource(page)).toBe(shapes);
  });

  test('should keep a transform short however its handles, drags, and buttons are mixed', async ({ page }) => {
    await setContent(page, `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
  <path id="blob" d="M150 100 C150 128 128 150 100 150 C72 150 50 128 50 100 C50 72 72 50 100 50 C128 50 150 72 150 100 Z" fill="#6291e0"/>
</svg>`);
    const path = page.locator('.svg-container path');
    await path.click();
    const transform = async () => (/transform="([^"]*)"/.exec(await getSource(page)) ?? [])[1] ?? '';
    const short = /^(translate\([^)]*\))? ?(rotate\([^)]*\))? ?(scale\([^)]*\))?$/;
    const turn = async (degrees: number) => {
      // from the rotate handle, round the middle of the box by `degrees`, snapped with Shift
      const handle = (await page.locator('[data-handle="rotate"]').boundingBox())!;
      const box = (await page.locator('.select-overlay .select-box').boundingBox())!;
      const [cx, cy] = [box.x + box.width / 2, box.y + box.height / 2];
      const [hx, hy] = [handle.x + handle.width / 2, handle.y + handle.height / 2];
      const [r, from] = [Math.hypot(hx - cx, hy - cy), Math.atan2(hy - cy, hx - cx)];
      await page.mouse.move(hx, hy);
      await page.mouse.down();
      await page.keyboard.down('Shift');
      for (const k of [0.5, 1]) await page.mouse.move(cx + r * Math.cos(from + k * degrees * Math.PI / 180), cy + r * Math.sin(from + k * degrees * Math.PI / 180), { steps: 4 });
      await page.keyboard.up('Shift');
      await page.mouse.up();
    };

    await drag(page, page.locator('[data-handle="se"]'), 20, 10);
    expect(await transform()).toMatch(/^translate\([^)]*\) scale\([^)]*\)$/);
    await turn(30);
    expect(await transform()).toMatch(short);
    expect(await transform()).toContain('rotate(30 ');
    await drag(page, path, 15, -10);
    expect(await transform()).toMatch(short);
    await page.locator('#rotate').click();
    expect(await transform()).toMatch(short);
    expect(await transform()).toContain('rotate(120 ');
    await drag(page, page.locator('[data-handle="se"]'), 10, 10);
    expect(await transform()).toMatch(short);
    await turn(-15);
    expect(await transform()).toMatch(short);
    expect(await transform()).toContain('rotate(105 ');

    // each was one step, and taking them all back leaves nothing
    for (let i = 0; i < 6; i++) await page.locator('#undo').click();
    expect(await transform()).toBe('');
  });

  test('should write every transform in its simplest form when the drawing is optimized, drawing it where it was', async ({ page }) => {
    await setContent(page, '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200"><path d="M180 100 C180 144.18 144.18 180 100 180 C55.82 180 24.09 143.99 20 100 C16.3 60.2 66.77 88.84 78 72.1 C89.23 55.36 45.4 22.3 100 20 C144.14 18.14 180 55.82 180 100 Z" fill="#6291e0" stroke="#295da9" stroke-width="2" transform="rotate(14 92.49 81) translate(-11.5 -15.6) rotate(359 99.9 99.97) translate(-1.03 -7.42) scale(1.051 1.041)"/><text x="100" y="110" text-anchor="middle" fill="white" font-family="Arial" font-size="16"> Hello SVG </text></svg>');
    const path = page.locator('.svg-container path');
    const before = (await path.boundingBox())!;
    await page.locator('#optimize').click();
    const transform = (/<path[^>]*transform="([^"]*)"/.exec(await getSource(page)) ?? [])[1];
    expect(transform).toMatch(/^translate\([^)]*\) rotate\(13 [^)]*\) scale\(1\.051 1\.041\)$/);
    const after = (await path.boundingBox())!;
    for (const key of ['x', 'y', 'width', 'height'] as const) expect(Math.abs(after[key] - before[key])).toBeLessThan(0.05);
  });

  test('should move a group once when one of its children is selected with it', async ({ page }) => {
    await setContent(page, `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
  <g id="grp">
    <rect id="box" x="20" y="20" width="60" height="60" fill="#6291e0"/>
    <circle id="dot" cx="150" cy="150" r="30" fill="#aa0000"/>
  </g>
  <rect id="other" x="5" y="170" width="20" height="20" fill="#888"/>
</svg>`);
    const rect = page.locator('.svg-container rect#box');
    await rect.click();
    expect(await editorSelection(page)).toBe('<g id="grp">');
    await rect.click({ modifiers: ['ControlOrMeta'] });
    await expect(page.locator('.select-overlay .select-more')).toBeVisible();

    await page.locator('.svg-preview-wrapper').focus();
    await page.keyboard.press('ArrowRight');
    const source = await getSource(page);
    expect(source).toContain('<g id="grp" transform="translate(1 0)">');
    expect(source).toContain('<rect id="box" x="20" y="20"');
  });

  test('should not bring back an element that was let go when the selection is next edited', async ({ page }) => {
    await page.locator('.svg-container rect').click();
    await page.locator('.svg-container circle').click({ modifiers: ['ControlOrMeta'] });
    await page.locator('.svg-container circle').click({ modifiers: ['ControlOrMeta'] });
    await expect(page.locator('.select-overlay .select-more')).toBeHidden();

    await page.locator('.svg-preview-wrapper').focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    expect(await getSource(page)).toBe(FIXTURE.replace('x="20"', 'x="22"'));
  });

  test('should resize from a handle with a finger', async ({ page }) => {
    await page.locator('.svg-container rect').click();
    const handle = (await page.locator('[data-handle="e"]').boundingBox())!;
    const x = handle.x + handle.width / 2;
    const y = handle.y + handle.height / 2;
    await page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y)!;
      const touch = (cx: number) => new Touch({ identifier: 1, target: el, clientX: cx, clientY: y });
      const fire = (type: string, cx: number, down: boolean) => el.dispatchEvent(new TouchEvent(type, {
        bubbles: true, cancelable: true, touches: down ? [touch(cx)] : [], changedTouches: [touch(cx)],
      }));
      fire('touchstart', x, true);
      fire('touchmove', x + 15, true);
      fire('touchmove', x + 30, true);
      fire('touchend', x + 30, false);
    }, { x, y });
    expect(await getSource(page)).toBe(FIXTURE.replace('width="60" height="60"', 'width="90" height="60"'));
  });
});
