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

/** Drag the marker of point `index` by (dx, dy) screen pixels. */
async function dragPoint(page: Page, index: number, dx: number, dy: number) {
  const box = (await page.locator(`.points [data-point="${index}"]`).boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 4 });
  await page.mouse.move(x + dx, y + dy, { steps: 4 });
  await page.mouse.up();
}

/** The page point for a position in the drawing's user units, at 1:1. */
async function at(page: Page, x: number, y: number) {
  const svg = (await page.locator('.svg-container svg').boundingBox())!;
  return { x: svg.x + x, y: svg.y + y };
}

const FIXTURE = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
  <path id="p" d="M20 20 L100 20 L100 100 Z" fill="#6291e0"/>
  <polygon id="g" points="120,120 180,120 150,180" fill="#aa0000"/>
</svg>`;

test.describe('SVG Editor Point Editing', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html');
    await expect(page.locator('.svg-container svg')).toBeVisible();
    await setContent(page, FIXTURE);
    await expect(page.locator('.svg-container path')).toBeVisible();
  });

  test('should enter point editing with Enter and leave it with Escape, keeping the selection', async ({ page }) => {
    const button = page.locator('#points');
    await expect(button).toBeDisabled();
    await page.locator('.svg-container path').click();
    await expect(button).toBeEnabled();
    await expect(page.locator('[data-handle="se"]')).toBeVisible();

    await page.keyboard.press('Enter');
    await expect(page.locator('.points rect')).toHaveCount(3);
    await expect(page.locator('[data-handle="se"]')).toBeHidden();
    await expect(button).toHaveAttribute('aria-pressed', 'true');

    await page.keyboard.press('Escape');
    await expect(page.locator('.points rect')).toHaveCount(0);
    await expect(page.locator('.select-overlay .select-box')).toBeVisible();
    await expect(button).toHaveAttribute('aria-pressed', 'false');
  });

  test('should move a point by dragging its marker, and select its numbers in the editor', async ({ page }) => {
    await page.locator('.svg-container path').click();
    await page.keyboard.press('Enter');
    await dragPoint(page, 1, 20, 10);
    expect(await getSource(page)).toBe(FIXTURE.replace('L100 20', 'L120 30'));
    expect(await editorSelection(page)).toBe('120 30');
    await expect(page.locator('.points rect.selected')).toHaveCount(1);

    await page.locator('#undo').click();
    expect(await getSource(page)).toBe(FIXTURE);
  });

  test('should add a point where the outline is double-clicked', async ({ page }) => {
    const path = page.locator('.svg-container path');
    await path.click();
    await path.dblclick();
    await expect(page.locator('.points rect')).toHaveCount(3);

    const spot = await at(page, 60, 20);
    await page.mouse.dblclick(spot.x, spot.y);
    expect(await getSource(page)).toBe(FIXTURE.replace('L100 20', 'L60 20 L100 20'));
    await expect(page.locator('.points rect')).toHaveCount(4);
    expect(await editorSelection(page)).toBe('60 20');
  });

  test('should remove the selected point with Delete and nudge it with the arrows', async ({ page }) => {
    await page.locator('.svg-container path').click();
    await page.keyboard.press('Enter');
    await page.locator('.points [data-point="1"]').click();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowDown');
    expect(await getSource(page)).toBe(FIXTURE.replace('L100 20', 'L102 21'));

    await page.keyboard.press('Delete');
    expect(await getSource(page)).toBe(FIXTURE.replace('L100 20 L100 100', 'L100 100'));
    await expect(page.locator('.points rect')).toHaveCount(2);
  });

  test('should edit a polygon\'s points the same way', async ({ page }) => {
    const polygon = page.locator('.svg-container polygon');
    await polygon.click();
    await polygon.dblclick();
    await expect(page.locator('.points rect')).toHaveCount(3);

    await dragPoint(page, 2, 0, -10);
    expect(await getSource(page)).toBe(FIXTURE.replace('150,180', '150,170'));

    const spot = await at(page, 150, 120);
    await page.mouse.dblclick(spot.x, spot.y);
    expect(await getSource(page)).toBe(FIXTURE.replace('120,120 180,120 150,180', '120,120 150,120 180,120 150,170'));

    await page.keyboard.press('Delete');
    expect(await getSource(page)).toBe(FIXTURE.replace('150,180', '150,170'));
  });

  test('should show curve handles and move them without moving the anchors', async ({ page }) => {
    await setContent(page, FIXTURE.replace('M20 20 L100 20 L100 100 Z', 'M20 100 C20 20 100 20 100 100 S180 180 180 60'));
    // inside the first lobe of the filled shape
    const inside = await at(page, 60, 70);
    await page.mouse.click(inside.x, inside.y);
    await page.keyboard.press('Enter');
    await expect(page.locator('.points circle')).toHaveCount(3);
    await expect(page.locator('.points line')).toHaveCount(3);

    await dragPoint(page, 1, 10, 10);
    expect(await getSource(page)).toContain('d="M20 100 C30 30 100 20 100 100 S180 180 180 60"');

    // an S segment writes only its second handle, so that is the pair the editor selects
    await page.locator('.points [data-point="4"]').click();
    expect(await editorSelection(page)).toBe('180 180');
  });

  test('should leave point editing when another element is selected', async ({ page }) => {
    await page.locator('.svg-container path').click();
    await page.keyboard.press('Enter');
    await expect(page.locator('.points rect')).toHaveCount(3);
    await page.locator('.svg-container polygon').click();
    await expect(page.locator('.points rect')).toHaveCount(0);
    await expect(page.locator('[data-handle="se"]')).toBeVisible();
  });

  test('should add a point to a path inside a group with a double-click', async ({ page }) => {
    await setContent(page, `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
  <g id="grp">
    <path id="p" d="M20 20 L100 20 L100 100 Z" fill="#6291e0"/>
    <rect id="box" x="120" y="120" width="40" height="40" fill="#aa0000"/>
  </g>
  <circle id="far" cx="180" cy="20" r="8" fill="#888"/>
</svg>`);
    const path = page.locator('.svg-container path');
    await path.click();
    await path.click();
    expect(await editorSelection(page)).toMatch(/^<path id="p"/);
    await page.keyboard.press('Enter');
    await expect(page.locator('.points rect')).toHaveCount(3);

    const spot = await at(page, 60, 20);
    await page.mouse.dblclick(spot.x, spot.y);
    expect(await getSource(page)).toContain('d="M20 20 L60 20 L100 20 L100 100 Z"');
    await expect(page.locator('.points rect')).toHaveCount(4);
  });

  test('should put the point tools in the preview bar while editing', async ({ page }) => {
    const tools = page.locator('#point-tools');
    await expect(tools).toBeHidden();
    await page.locator('.svg-container path').click();
    await page.locator('#points').click();
    await expect(tools).toBeVisible();
    await expect(page.locator('#dark')).toBeHidden();
    await expect(page.locator('#flip')).toBeHidden();
    await expect(page.locator('#zoomin')).toBeVisible();

    const remove = page.locator('#point-delete');
    await expect(remove).toBeDisabled();
    await page.locator('.points [data-point="1"]').click();
    await expect(remove).toBeEnabled();
    await remove.click();
    expect(await getSource(page)).toBe(FIXTURE.replace('L100 20 L100 100', 'L100 100'));
    await expect(page.locator('.points rect')).toHaveCount(2);
    await expect(remove).toBeDisabled();

    await page.locator('#point-done').click();
    await expect(tools).toBeHidden();
    await expect(page.locator('#dark')).toBeVisible();
    await expect(page.locator('#points')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('[data-handle="se"]')).toBeVisible();
  });

  test('should take hold of a point pressed near its marker', async ({ page }) => {
    await page.locator('.svg-container path').click();
    await page.keyboard.press('Enter');
    // a few pixels off the marker of the point at 100,20
    const near = await at(page, 106, 25);
    await page.mouse.move(near.x, near.y);
    await page.mouse.down();
    await page.mouse.move(near.x + 10, near.y + 5, { steps: 4 });
    await page.mouse.move(near.x + 20, near.y + 10, { steps: 4 });
    await page.mouse.up();
    expect(await getSource(page)).toBe(FIXTURE.replace('L100 20', 'L120 30'));
  });

  test('should put a handle back into its anchor with Delete, and select the anchor', async ({ page }) => {
    await setContent(page, FIXTURE.replace('M20 20 L100 20 L100 100 Z', 'M20 100 C20 20 100 20 100 100 L180 100'));
    const inside = await at(page, 60, 70);
    await page.mouse.click(inside.x, inside.y);
    await page.keyboard.press('Enter');
    await expect(page.locator('.points circle')).toHaveCount(2);
    await page.locator('.points [data-point="2"]').click();
    await expect(page.locator('#point-delete')).toHaveAttribute('aria-label', 'delete handle');
    await page.keyboard.press('Delete');
    expect(await getSource(page)).toContain('d="M20 100 C20 20 100 100 100 100 L180 100"');
    // a handle on its anchor is hidden, and the anchor it went into is selected
    await expect(page.locator('.points circle')).toHaveCount(1);
    await expect(page.locator('.points rect.selected')).toHaveCount(1);
    expect(await editorSelection(page)).toBe('100 100');

    // with both handles in, the curve is a line and is written as one
    await page.locator('.points [data-point="1"]').click();
    await page.locator('#point-delete').click();
    expect(await getSource(page)).toContain('d="M20 100 L100 100 L180 100"');
    await expect(page.locator('.points circle')).toHaveCount(0);
  });

  test('should offer a closed path\'s first point once when its last curve ends on it', async ({ page }) => {
    await setContent(page, FIXTURE.replace('M20 20 L100 20 L100 100 Z', 'M20 20 L100 20 L100 100 C60 100 20 60 20 20 Z'));
    await page.locator('.svg-container path').click();
    await page.keyboard.press('Enter');
    await expect(page.locator('.points rect')).toHaveCount(3);
    await dragPoint(page, 0, 10, 0);
    expect(await getSource(page)).toContain('d="M30 20 L100 20 L100 100 C60 100 30 60 30 20 Z"');
  });

  test('should make a polygon\'s corner smooth, as a path, and make it a corner again', async ({ page }) => {
    await page.locator('.svg-container polygon').click();
    await page.keyboard.press('Enter');
    const smooth = page.locator('#point-smooth');
    await expect(smooth).toBeDisabled();
    await page.locator('.points [data-point="2"]').click();
    await expect(smooth).toBeEnabled();
    await expect(smooth).toHaveAttribute('aria-pressed', 'false');

    await smooth.click();
    expect(await getSource(page)).toContain('<path id="g" d="M120,120 180,120 C170 140 172 180 150 180C128 180 130 140 120 120 Z" fill="#aa0000"/>');
    await expect(smooth).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.points rect.selected')).toHaveCount(1);
    await expect(page.locator('.points circle')).toHaveCount(4);

    await smooth.click();
    expect(await getSource(page)).toContain('<path id="g" d="M120,120 180,120 L150 180L120 120 Z" fill="#aa0000"/>');
    await expect(smooth).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('.points circle')).toHaveCount(0);

    // one undo step each
    await page.locator('#undo').click();
    await page.locator('#undo').click();
    expect(await getSource(page)).toBe(FIXTURE);
  });

  test('should curve a segment picked on the outline, and straighten it again', async ({ page }) => {
    await page.locator('.svg-container path').click();
    await page.keyboard.press('Enter');
    const curve = page.locator('#point-curve');
    await expect(curve).toBeDisabled();
    const edge = await at(page, 60, 21);
    await page.mouse.click(edge.x, edge.y);
    await expect(page.locator('.spot path')).toHaveCount(1);
    await expect(curve).toBeEnabled();
    await expect(page.locator('#point-add')).toBeEnabled();

    await curve.click();
    expect(await getSource(page)).toBe(FIXTURE.replace('L100 20', 'C47 20 73 20 100 20'));
    await expect(curve).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.points circle')).toHaveCount(2);

    await curve.click();
    expect(await getSource(page)).toBe(FIXTURE);
    await expect(curve).toHaveAttribute('aria-pressed', 'false');

    // the closing line of the Z gets its curve before the Z
    const closing = await at(page, 60, 61);
    await page.mouse.click(closing.x, closing.y);
    await curve.click();
    expect(await getSource(page)).toBe(FIXTURE.replace('L100 100 Z', 'L100 100 C73 73 47 47 20 20 Z'));
    // the curve ends on the first point, which is offered once
    await expect(page.locator('.points rect')).toHaveCount(3);
  });

  test('should add a point on the picked spot', async ({ page }) => {
    await page.locator('.svg-container path').click();
    await page.keyboard.press('Enter');
    await expect(page.locator('#point-add')).toBeDisabled();
    const edge = await at(page, 100, 61);
    await page.mouse.click(edge.x, edge.y);
    await page.locator('#point-add').click();
    expect(await getSource(page)).toBe(FIXTURE.replace('L100 100', 'L100 61 L100 100'));
    expect(await editorSelection(page)).toBe('100 61');
    await expect(page.locator('.points rect.selected')).toHaveCount(1);
    await expect(page.locator('.spot path')).toHaveCount(0);
  });

  test('should keep a smooth point\'s handles in line while one is dragged, but not with Alt', async ({ page }) => {
    const wave = 'M20 100 C20 60 60 60 60 100 C60 140 100 140 100 100';
    await setContent(page, FIXTURE.replace('M20 20 L100 20 L100 100 Z', wave).replace('fill="#6291e0"', 'fill="none" stroke="#6291e0" stroke-width="6"'));
    const stroke = await at(page, 20, 90);
    await page.mouse.click(stroke.x, stroke.y);
    await page.keyboard.press('Enter');
    await expect(page.locator('.points rect')).toHaveCount(3);
    await page.locator('.points [data-point="3"]').click();
    await expect(page.locator('#point-smooth')).toHaveAttribute('aria-pressed', 'true');

    // the handle above the middle point, dragged right: the one below follows across
    await dragPoint(page, 2, 20, 0);
    expect(await getSource(page)).toContain('d="M20 100 C20 60 80 60 60 100 C40 140 100 140 100 100"');

    await page.keyboard.down('Alt');
    await dragPoint(page, 2, 0, -10);
    await page.keyboard.up('Alt');
    expect(await getSource(page)).toContain('d="M20 100 C20 60 80 50 60 100 C40 140 100 140 100 100"');
  });

  test('should bend a segment dragged by its outline, and keep it picked', async ({ page }) => {
    await page.locator('.svg-container path').click();
    await page.keyboard.press('Enter');
    const edge = await at(page, 60, 20);
    await page.mouse.move(edge.x, edge.y);
    await page.mouse.down();
    await page.mouse.move(edge.x, edge.y + 6, { steps: 4 });
    await page.mouse.move(edge.x, edge.y + 12, { steps: 4 });
    await page.mouse.up();
    // the line became a curve bowed down through the spot held; its handles share the move by where it was held
    expect(await getSource(page)).toMatch(/<path id="p" d="M20 20 C4\d 3\d 7\d 3\d 100 20 L100 100 Z"/);
    await expect(page.locator('.spot path')).toHaveCount(1);
    await expect(page.locator('#point-curve')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#undo').click();
    expect(await getSource(page)).toBe(FIXTURE);
  });

  test('should make a smooth point symmetric, its handles sharing one length', async ({ page }) => {
    await setContent(page, FIXTURE.replace('M20 20 L100 20 L100 100 Z', 'M20 100 C20 60 60 80 60 100 C60 140 100 140 100 100').replace('fill="#6291e0"', 'fill="none" stroke="#6291e0" stroke-width="6"'));
    const stroke = await at(page, 20, 90);
    await page.mouse.click(stroke.x, stroke.y);
    await page.keyboard.press('Enter');
    const symmetric = page.locator('#point-symmetric');
    await expect(symmetric).toBeDisabled();
    // an open end has one side, so there is nothing to match
    await page.locator('.points [data-point="0"]').click();
    await expect(symmetric).toBeDisabled();

    await page.locator('.points [data-point="3"]').click();
    await expect(symmetric).toBeEnabled();
    await symmetric.click();
    expect(await getSource(page)).toContain('d="M20 100 C20 60 60 70 60 100 C60 130 100 140 100 100"');
    await expect(page.locator('.points rect.selected')).toHaveCount(1);
    await expect(symmetric).toBeDisabled();
    await expect(page.locator('#point-smooth')).toHaveAttribute('aria-pressed', 'true');

    // and its handles go on mirroring each other
    await dragPoint(page, 2, 0, -10);
    expect(await getSource(page)).toContain('d="M20 100 C20 60 60 60 60 100 C60 140 100 140 100 100"');
  });

  test('should pick several points with the toggle, and drag them together', async ({ page }) => {
    await page.locator('.svg-container path').click();
    await page.keyboard.press('Enter');
    const several = page.locator('#point-several');
    await expect(several).toHaveAttribute('aria-pressed', 'false');
    await several.click();
    await expect(several).toHaveAttribute('aria-pressed', 'true');
    await page.locator('.points [data-point="1"]').click();
    await page.locator('.points [data-point="2"]').click();
    await expect(page.locator('.points rect.selected')).toHaveCount(2);
    await expect(page.locator('#test-announcements')).toHaveText('2 points selected');
    // the editor selects each one's numbers
    expect(await page.evaluate(() => {
      const state = (window as any).svgEditor.editor.state;
      return state.selection.ranges.map((r: any) => state.doc.sliceString(r.from, r.to));
    })).toEqual(['100 20', '100 100']);

    await dragPoint(page, 1, 10, 10);
    expect(await getSource(page)).toBe(FIXTURE.replace('L100 20 L100 100', 'L110 30 L110 110'));
    await expect(page.locator('.points rect.selected')).toHaveCount(2);
    await page.keyboard.press('ArrowLeft');
    expect(await getSource(page)).toBe(FIXTURE.replace('L100 20 L100 100', 'L109 30 L109 110'));
    await page.locator('#undo').click();
    await page.locator('#undo').click();
    expect(await getSource(page)).toBe(FIXTURE);
  });

  test('should take a picked point out with a tap, and let them all go with a tap elsewhere', async ({ page }) => {
    await page.locator('.svg-container path').click();
    await page.keyboard.press('Enter');
    await page.locator('#point-several').click();
    for (const i of [0, 1, 2]) await page.locator(`.points [data-point="${i}"]`).click();
    await expect(page.locator('.points rect.selected')).toHaveCount(3);
    await page.locator('.points [data-point="1"]').click();
    await expect(page.locator('.points rect.selected')).toHaveCount(2);
    await expect(page.locator('.points [data-point="1"]')).not.toHaveClass(/selected/);

    const empty = await at(page, 180, 30);
    await page.mouse.click(empty.x, empty.y);
    await expect(page.locator('.points rect.selected')).toHaveCount(0);
    // still editing the same element's points
    await expect(page.locator('#point-tools')).toBeVisible();
    await expect(page.locator('.points rect')).toHaveCount(3);
  });

  test('should take in the points a drag across the drawing covers, and smooth them all at once', async ({ page }) => {
    await page.locator('.svg-container polygon').click();
    await page.keyboard.press('Enter');
    await page.locator('#point-several').click();
    const from = await at(page, 110, 110);
    const to = await at(page, 190, 190);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
    await expect(page.locator('.marquee')).toBeVisible();
    await page.mouse.move(to.x, to.y, { steps: 4 });
    await page.mouse.up();
    await expect(page.locator('.marquee')).toBeHidden();
    await expect(page.locator('.points rect.selected')).toHaveCount(3);
    await expect(page.locator('#test-announcements')).toHaveText('3 points selected');

    const smooth = page.locator('#point-smooth');
    await expect(smooth).toHaveAttribute('aria-pressed', 'false');
    await smooth.click();
    expect(await getSource(page)).toMatch(/<path id="g" d="M120,120 C[^"]* Z" fill="#aa0000"\/>/);
    await expect(page.locator('#test-announcements')).toHaveText('3 points made smooth');
    await expect(page.locator('.points rect.selected')).toHaveCount(3);
    await expect(smooth).toHaveAttribute('aria-pressed', 'true');
    await smooth.click();
    await expect(page.locator('#test-announcements')).toHaveText('3 points made corners');
    await expect(page.locator('.points circle')).toHaveCount(0);
    // one step each
    await page.locator('#undo').click();
    await page.locator('#undo').click();
    expect(await getSource(page)).toBe(FIXTURE);
  });

  test('should delete several points at once, and add one with Ctrl or Cmd held', async ({ page }) => {
    await setContent(page, FIXTURE.replace('M20 20 L100 20 L100 100 Z', 'M20 20 L60 20 L100 20 L100 60 L100 100 Z'));
    await page.locator('.svg-container path').click();
    await page.keyboard.press('Enter');
    await page.locator('.points [data-point="1"]').click();
    await page.locator('.points [data-point="3"]').click({ modifiers: ['ControlOrMeta'] });
    await expect(page.locator('.points rect.selected')).toHaveCount(2);
    await expect(page.locator('#point-delete')).toHaveAttribute('aria-label', 'delete points');
    await page.keyboard.press('Delete');
    expect(await getSource(page)).toContain('d="M20 20 L100 20 L100 100 Z"');
    await expect(page.locator('#test-announcements')).toHaveText('2 points removed');
    // a plain click picks one point again
    await page.locator('.points [data-point="1"]').click();
    await page.locator('.points [data-point="2"]').click();
    await expect(page.locator('.points rect.selected')).toHaveCount(1);
  });

  test('should take in both handles of a curve together, when the first leaves it straight', async ({ page }) => {
    // the first handle lies on the chord, so taking in the second straightens the curve
    await setContent(page, FIXTURE.replace('M20 20 L100 20 L100 100 Z', 'M20 100 C40 100 100 60 100 100 L100 140 Z'));
    await page.locator('.svg-container path').click();
    await page.keyboard.press('Enter');
    await page.locator('#point-several').click();
    await page.locator('.points [data-point="2"]').click();
    await page.locator('.points [data-point="1"]').click();
    await expect(page.locator('.points circle.selected')).toHaveCount(2);
    await page.keyboard.press('Delete');
    expect(await getSource(page)).toContain('d="M20 100 L100 100 L100 140 Z"');
  });

  test('should let a drag across the drawing go with Escape, still editing points', async ({ page }) => {
    await page.locator('.svg-container polygon').click();
    await page.keyboard.press('Enter');
    await page.locator('#point-several').click();
    const from = await at(page, 110, 110);
    const to = await at(page, 190, 190);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 4 });
    await expect(page.locator('.marquee')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.marquee')).toBeHidden();
    await page.mouse.up();
    await expect(page.locator('#point-tools')).toBeVisible();
    await expect(page.locator('.points rect.selected')).toHaveCount(0);
  });

  test('should scale and turn several picked points with the box round them', async ({ page }) => {
    await page.locator('.svg-container path').click();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-handle="e"]')).toBeHidden();
    await page.locator('#point-several').click();
    for (const i of [0, 1, 2]) await page.locator(`.points [data-point="${i}"]`).click();
    await expect(page.locator('.select-overlay .group-box')).toBeVisible();

    // the box runs from 20 to 100 across, so 40 more from the right side is half as wide again
    const right = (await page.locator('[data-handle="e"]').boundingBox())!;
    await page.mouse.move(right.x + right.width / 2, right.y + right.height / 2);
    await page.mouse.down();
    await page.mouse.move(right.x + right.width / 2 + 20, right.y + right.height / 2, { steps: 4 });
    await page.mouse.move(right.x + right.width / 2 + 40, right.y + right.height / 2, { steps: 4 });
    await page.mouse.up();
    expect(await getSource(page)).toBe(FIXTURE.replace('M20 20 L100 20 L100 100 Z', 'M20 20 L140 20 L140 100 Z'));
    await expect(page.locator('#test-announcements')).toHaveText('3 points scaled');
    await expect(page.locator('.points rect.selected')).toHaveCount(3);

    // a quarter turn about the middle of the box, at 80,60, snapped with Shift
    const turn = (await page.locator('[data-handle="rotate"]').boundingBox())!;
    const [x, y] = [turn.x + turn.width / 2, turn.y + turn.height / 2];
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.keyboard.down('Shift');
    await page.mouse.move(x + 40, y + 30, { steps: 4 });
    await page.mouse.move(x + 76, y + 76, { steps: 4 });
    await page.keyboard.up('Shift');
    await page.mouse.up();
    expect(await getSource(page)).toBe(FIXTURE.replace('M20 20 L100 20 L100 100 Z', 'M120 0 L120 120 L40 120 Z'));
    await expect(page.locator('#test-announcements')).toHaveText('3 points turned 90 degrees');
    await expect(page.locator('.points rect.selected')).toHaveCount(3);

    await page.locator('#undo').click();
    await page.locator('#undo').click();
    expect(await getSource(page)).toBe(FIXTURE);
  });

  test('should turn and flip several picked points about the middle of their box from the toolbar', async ({ page }) => {
    // the box round the two right-hand points has its middle at 100,62.5
    await setContent(page, FIXTURE.replace('L100 100 Z', 'L100 105 Z'));
    await page.locator('.svg-container path').click();
    await page.keyboard.press('Enter');
    await page.locator('#point-several').click();
    for (const i of [1, 2]) await page.locator(`.points [data-point="${i}"]`).click();

    await page.locator('#rotate').click();
    expect(await getSource(page)).toContain('d="M20 20 L142.5 62.5 L57.5 62.5 Z"');
    await expect(page.locator('#test-announcements')).toHaveText('2 points turned 90 degrees');
    await expect(page.locator('.points rect.selected')).toHaveCount(2);
    // the middle's half is kept, so four quarter turns come back to the start
    for (let i = 0; i < 3; i++) await page.locator('#rotate').click();
    expect(await getSource(page)).toContain('d="M20 20 L100 20 L100 105 Z"');

    await page.locator('#flipx').click();
    expect(await getSource(page)).toContain('d="M20 20 L100 20 L100 105 Z"');
    await page.locator('#flipy').click();
    expect(await getSource(page)).toContain('d="M20 20 L100 105 L100 20 Z"');
    await expect(page.locator('#test-announcements')).toHaveText('2 points flipped vertically');
    await expect(page.locator('.points rect.selected')).toHaveCount(2);

    // a polygon's points too, and with one point picked the whole shape turns
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.locator('.svg-container polygon').click();
    await page.keyboard.press('Enter');
    await page.locator('#point-several').click();
    for (const i of [0, 2]) await page.locator(`.points [data-point="${i}"]`).click();
    await page.locator('#flipx').click();
    expect(await getSource(page)).toContain('points="150,120 180,120 120,180"');
    await page.locator('.points [data-point="0"]').click();
    await page.locator('#point-several').click();
    await page.locator('.points [data-point="0"]').click();
    await page.locator('#rotate').click();
    expect(await getSource(page)).toContain('points="150,120 180,120 120,180" fill="#aa0000" transform="rotate(90 150 150)"');
  });

  test('should keep a line end\'s written precision when nudged', async ({ page }) => {
    await setContent(page, FIXTURE.replace('<path id="p" d="M20 20 L100 20 L100 100 Z" fill="#6291e0"/>', '<line id="ln" x1="10.5" y1="40" x2="100" y2="40" stroke="#6291e0" stroke-width="8"/>'));
    // a line has no area, so Playwright will not click it by locator; aim at its stroke
    const middle = await at(page, 55, 40);
    await page.mouse.click(middle.x, middle.y);
    await page.keyboard.press('Enter');
    await page.locator('.points [data-point="0"]').click();
    await page.keyboard.press('ArrowRight');
    expect(await getSource(page)).toContain('<line id="ln" x1="11.5" y1="40"');
  });
});

test.describe('SVG Editor Point Editing on a touch screen', () => {
  test.use({ viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true });

  test('should make every button a fingertip wide, and scroll a bar too narrow for them', async ({ page }) => {
    await page.goto('/index.html');
    await expect(page.locator('.svg-container svg')).toBeVisible();
    for (const id of ['upload', 'zoomin', 'dark']) {
      const box = (await page.locator(`#${id}`).boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
    // side by side on a portrait tablet, the code's bar is narrower than its buttons
    const bar = page.locator('#editor nav');
    const [scroll, width] = await bar.evaluate((nav) => [nav.scrollWidth, nav.clientWidth]);
    expect(scroll).toBeGreaterThan(width);
    await page.locator('#xray').scrollIntoViewIfNeeded();
    await expect(page.locator('#xray')).toBeInViewport();
  });

  test('should take hold of a point a fingertip away from its marker', async ({ page }) => {
    await page.goto('/index.html');
    await expect(page.locator('.svg-container svg')).toBeVisible();
    await setContent(page, FIXTURE);
    await page.locator('.svg-container path').tap();
    await page.locator('#points').tap();
    await expect(page.locator('.points rect')).toHaveCount(3);
    // fifteen pixels off the marker of the point at 100,20, a touch's slip
    const marker = (await page.locator('.points [data-point="1"]').boundingBox())!;
    const x = marker.x + marker.width / 2 + 12;
    const y = marker.y + marker.height / 2 + 9;
    const cdp = await page.context().newCDPSession(page);
    const touch = (px: number, py: number) => [{ x: px, y: py, id: 1 }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: touch(x, y) });
    for (const step of [5, 10, 15, 20]) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: touch(x + step, y) });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(page.locator('#point-delete')).toBeEnabled();
    expect(await getSource(page)).toMatch(/d="M20 20 L\d+(\.\d+)? 20 L100 100 Z"/);
    expect(await getSource(page)).not.toContain('L100 20 ');
  });
});

test.describe('SVG Editor pulling handles out of a point', () => {
  test.use({ viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true });

  async function editPoints(page: Page, selector: string) {
    await page.goto('/index.html');
    await expect(page.locator('.svg-container svg')).toBeVisible();
    await setContent(page, FIXTURE);
    await page.locator(`.svg-container ${selector}`).tap();
    await page.locator('#points').tap();
    await expect(page.locator('.points rect')).toHaveCount(3);
  }

  /** A finger on the marker of point `index`, held for `hold` ms, then moved by (dx, dy). */
  async function fingerDrag(page: Page, index: number, dx: number, dy: number, hold = 0) {
    const marker = (await page.locator(`.points [data-point="${index}"]`).boundingBox())!;
    const x = marker.x + marker.width / 2;
    const y = marker.y + marker.height / 2;
    const cdp = await page.context().newCDPSession(page);
    const touch = (px: number, py: number) => [{ x: px, y: py, id: 1 }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: touch(x, y) });
    if (hold) await page.waitForTimeout(hold);
    for (const k of [0.25, 0.5, 0.75, 1]) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: touch(x + dx * k, y + dy * k) });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }

  test('should drag a point a finger lands right on', async ({ page }) => {
    await editPoints(page, '#p');
    await fingerDrag(page, 1, 20, 10);
    expect(await getSource(page)).toBe(FIXTURE.replace('L100 20', 'L120 30'));
  });

  test('should pull handles out of a corner a finger holds, and keep the corner where it was', async ({ page }) => {
    await editPoints(page, '#p');
    await fingerDrag(page, 1, 20, 0, 650);
    expect(await getSource(page)).toBe(FIXTURE.replace('L100 20 L100 100', 'C47 20 80 20 100 20 C120 20 100 73 100 100'));
    await expect(page.locator('.points circle')).toHaveCount(4);
    await expect(page.locator('.points rect.selected')).toHaveCount(1);
    await expect(page.locator('#point-smooth')).toHaveAttribute('aria-pressed', 'true');
  });

  test('should bend a polygon\'s edge with a finger, making it a path', async ({ page }) => {
    await editPoints(page, 'polygon');
    const svg = (await page.locator('.svg-container svg').boundingBox())!;
    const x = svg.x + 150;
    const y = svg.y + 120;
    const cdp = await page.context().newCDPSession(page);
    const touch = (px: number, py: number) => [{ x: px, y: py, id: 1 }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: touch(x, y) });
    for (const dy of [-3, -6, -9, -12]) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: touch(x, y + dy) });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    expect(await getSource(page)).toContain('<path id="g" d="M120,120 C140 104 160 104 180 120 L150,180Z" fill="#aa0000"/>');
  });

  test('should pick several points with taps and a finger drawn across them', async ({ page }) => {
    await editPoints(page, '#p');
    await page.locator('#point-several').tap();
    const marker = async (i: number) => {
      const box = (await page.locator(`.points [data-point="${i}"]`).boundingBox())!;
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    };
    const first = await marker(0);
    await page.touchscreen.tap(first.x, first.y);
    await expect(page.locator('.points rect.selected')).toHaveCount(1);
    // a finger drawn round the other two takes them in as well
    const a = await marker(1);
    const b = await marker(2);
    const cdp = await page.context().newCDPSession(page);
    const touch = (px: number, py: number) => [{ x: px, y: py, id: 1 }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: touch(a.x + 30, a.y - 30) });
    for (const k of [0.25, 0.5, 0.75, 1]) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: touch(a.x + 30 - 50 * k, a.y - 30 + (b.y - a.y + 60) * k) });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(page.locator('.points rect.selected')).toHaveCount(3);
    // nothing was panned or moved
    expect(await getSource(page)).toBe(FIXTURE);
  });

  test('should make a polygon a path when handles are pulled out of its corner', async ({ page }) => {
    await editPoints(page, 'polygon');
    await fingerDrag(page, 2, 20, 0, 650);
    expect(await getSource(page)).toContain('<path id="g" d="M120,120 180,120 C170 140 130 180 150 180C170 180 130 140 120 120 Z" fill="#aa0000"/>');
    await expect(page.locator('.svg-container polygon')).toHaveCount(0);
    await page.locator('#undo').tap();
    expect(await getSource(page)).toBe(FIXTURE);
  });
});

test.describe('SVG Editor pulling handles with the mouse', () => {
  test('should pull handles out of a corner with Alt held', async ({ page }) => {
    await page.goto('/index.html');
    await expect(page.locator('.svg-container svg')).toBeVisible();
    await setContent(page, FIXTURE);
    await page.locator('.svg-container path').click();
    await page.keyboard.press('Enter');
    await page.keyboard.down('Alt');
    await dragPoint(page, 1, 20, 0);
    await page.keyboard.up('Alt');
    expect(await getSource(page)).toBe(FIXTURE.replace('L100 20 L100 100', 'C47 20 80 20 100 20 C120 20 100 73 100 100'));
  });
});
