import { test, expect, type Page, type Locator } from '@playwright/test';

const getSource = (page: Page) =>
  page.evaluate(() => (window as any).svgEditor.editor.state.doc.toString() as string);

async function setContent(page: Page, content: string) {
  await page.evaluate((content) => {
    const view = (window as any).svgEditor.editor;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: content } });
  }, content);
}

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

    await page.locator('#flipx').click();
    expect(await getSource(page)).toContain('transform="matrix(-1 0 0 1 100 0) rotate(180 50 50)"');
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

    // the keyboard does the same from the canvas, and the copy of a copy gets a fresh id
    await page.keyboard.press('ControlOrMeta+d');
    expect(await getSource(page)).toContain('<rect id="box-copy-copy" x="40" y="40"');

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
    await expect(page.locator('[data-handle="se"]')).toBeHidden();
    expect(await page.evaluate(() => {
      const state = (window as any).svgEditor.editor.state;
      return state.doc.sliceString(state.selection.main.from, state.selection.main.to) as string;
    })).toMatch(/^<circle/);

    await page.locator('.svg-container circle').click({ modifiers: ['ControlOrMeta'] });
    await expect(more).toBeHidden();
    await expect(page.locator('[data-handle="se"]')).toBeVisible();
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

    await page.locator('#rotate').click();
    expect(await getSource(page)).toContain('fill="#6291e0" transform="rotate(90 50 50)"');
    expect(await getSource(page)).toContain('fill="#aa0000" transform="rotate(90 150 150)"');
    await page.locator('#undo').click();

    await page.locator('.svg-preview-wrapper').focus();
    await page.keyboard.press('Delete');
    expect(await getSource(page)).toBe('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">\n</svg>');
    await page.locator('#undo').click();
    expect(await getSource(page)).toBe(FIXTURE);
  });
});
