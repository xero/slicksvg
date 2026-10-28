import { test, expect, type Page } from '@playwright/test';

async function setContent(page: Page, content: string) {
  await page.evaluate((content) => {
    const view = (window as any).svgEditor.editor;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: content } });
  }, content);
}

const code = (page: Page) => page.evaluate(() => (window as any).svgEditor.editor.state.doc.toString() as string);

/** Where a point in the drawing's own units is on the page. */
const at = (page: Page, x: number, y: number) =>
  page.evaluate(([x, y]) => {
    const svg = document.querySelector('.svg-container svg') as SVGSVGElement;
    const p = new DOMPoint(x, y).matrixTransform(svg.getScreenCTM()!);
    return { x: p.x, y: p.y };
  }, [x, y] as [number, number]);

/** A picker or the slider moved through some values, quickly, and let go on
 * the last, or with `letGo` false, still held. */
const move = (page: Page, id: string, values: string[], letGo = true) =>
  page.evaluate(([id, values, letGo]) => {
    const input = document.getElementById(id) as HTMLInputElement;
    for (const value of values) {
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (letGo) input.dispatchEvent(new Event('change', { bubbles: true }));
  }, [id, values, letGo] as [string, string[], boolean]);

async function drag(page: Page, from: [number, number], to: [number, number]) {
  const a = await at(page, ...from);
  const b = await at(page, ...to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.up();
}

const FIXTURE = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
  <style>.green{fill:#00aa00}</style>
  <defs><linearGradient id="grad"><stop offset="0" stop-color="#fff"/></linearGradient></defs>
  <rect id="box" x="10" y="10" width="50" height="50" fill="#6291e0"/>
  <circle id="dot" class="green" cx="150" cy="50" r="30"/>
  <g id="pair" fill="#333333"><rect id="plain" x="10" y="120" width="30" height="30"/><rect id="own" x="60" y="120" width="30" height="30" fill="#aa0000"/></g>
  <ellipse id="oval" cx="150" cy="150" rx="30" ry="20" style="fill: red; opacity: .8"/>
  <rect id="shaded" x="110" y="90" width="20" height="20" fill="url(#grad)"/>
</svg>`;

test.describe('SVG Editor paint tools', () => {
  test.use({ viewport: { width: 1600, height: 800 } });

  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html');
    await expect(page.locator('.svg-container svg')).toBeVisible();
    await setContent(page, FIXTURE);
  });

  test('should lay the browser\'s own colour picker over Fill and Stroke, for a press to open', async ({ page }) => {
    for (const id of ['fill', 'stroke']) {
      const tool = (await page.locator(`#paint-${id}`).boundingBox())!;
      const picker = (await page.locator(`#${id}-color`).boundingBox())!;
      expect(picker).toEqual(tool);
      const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.id, [tool.x + tool.width / 2, tool.y + tool.height / 2]);
      expect(hit).toBe(`${id}-color`);
      await expect(page.locator(`#${id}-color`)).toHaveAttribute('type', 'color');
    }
  });

  test('should keep the paint tools at the end of the drawing\'s strip in every mode, and put them away while a shape is under way', async ({ page }) => {
    const strip = (await page.locator('#context-bar').boundingBox())!;
    for (const mode of ['mode-select', 'points', 'mode-shapes']) {
      await page.locator(`#${mode}`).click();
      await expect(page.locator('#paint-tools')).toBeVisible();
      const width = (await page.locator('#paint-width').boundingBox())!;
      expect(Math.abs(width.x + width.width - (strip.x + strip.width))).toBeLessThan(2);
    }
    await page.locator('#draw-polyline').click();
    const p = await at(page, 100, 100);
    await page.mouse.click(p.x, p.y);
    await expect(page.locator('#paint-tools')).toBeHidden();
    await page.keyboard.press('Escape');
    await expect(page.locator('#paint-tools')).toBeVisible();
  });

  test('should show the selection\'s paint on the swatches, and the colours new shapes get with nothing selected', async ({ page }) => {
    await expect(page.locator('#fill-color')).toHaveValue('#999999');
    await expect(page.locator('#paint-stroke')).toHaveClass(/none/);
    await expect(page.locator('#no-stroke')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('.svg-container #dot').click();
    // painted green by the style sheet, which is what shows
    await expect(page.locator('#fill-color')).toHaveValue('#00aa00');
    await expect(page.locator('#fill-color')).toHaveAttribute('aria-label', 'Fill colour, #00aa00');
    await expect(page.locator('#paint-fill')).toHaveCSS('--swatch', '#00aa00');
    await expect(page.locator('#no-fill')).toHaveAttribute('aria-pressed', 'false');
    await page.locator('.svg-container #shaded').click();
    await expect(page.locator('#paint-fill')).toHaveClass(/other/);
    await expect(page.locator('#fill-color')).toHaveAttribute('aria-label', 'Fill colour, a gradient or pattern');
  });

  test('should show a colour on the drawing as the picker moves, and write it into the code once, when it is let go', async ({ page }) => {
    await page.locator('.svg-container #box').click();
    await move(page, 'fill-color', ['#110000', '#ff00ff'], false);
    await expect(page.locator('.svg-container #box')).toHaveCSS('fill', 'rgb(255, 0, 255)');
    await expect(page.locator('#paint-fill')).toHaveCSS('--swatch', '#ff00ff');
    await expect(page.locator('#message')).toHaveText('fill="#ff00ff"');
    expect(await code(page)).toContain('fill="#6291e0"');
    // where a style sheet paints it, it shows in its style as it will be written
    await page.locator('.svg-container #dot').click();
    expect(await code(page)).toContain('fill="#ff00ff"');
    // at once, so no pause between them keeps the steps apart
    await move(page, 'fill-color', ['#00ffff']);
    await expect(page.locator('.svg-container #dot')).toHaveCSS('fill', 'rgb(0, 255, 255)');
    expect(await code(page)).toContain('style="fill: #00ffff"');
    await page.locator('#undo').click();
    await page.locator('#undo').click();
    expect(await code(page)).toContain('<rect id="box" x="10" y="10" width="50" height="50" fill="#6291e0"/>');
  });

  test('should write a paint shown but never settled once its picker or the slider lets go of the keys', async ({ page }) => {
    await page.locator('.svg-container #box').click();
    await page.locator('#fill-color').focus();
    await move(page, 'fill-color', ['#ff00ff'], false);
    expect(await code(page)).toContain('fill="#6291e0"');
    await page.locator('#fill-color').blur();
    expect(await code(page)).toContain('fill="#ff00ff"');
    await page.locator('#stroke-color').fill('#000000');
    await page.locator('#paint-width').click();
    await page.locator('#width-range').focus();
    await move(page, 'width-range', ['4.2'], false);
    await expect(page.locator('.svg-container #box')).toHaveCSS('stroke-width', '4.2px');
    expect(await code(page)).not.toContain('stroke-width');
    await page.keyboard.press('Escape');
    expect(await code(page)).toContain('stroke="#000000" stroke-width="4.2"');
  });

  test('should begin a step of its own when a picker left open moves again with something else selected', async ({ page }) => {
    await page.locator('.svg-container #box').click();
    await move(page, 'fill-color', ['#110000', '#ff00ff']);
    await page.locator('.svg-container #dot').click();
    await move(page, 'fill-color', ['#002200', '#00ffff']);
    expect(await code(page)).toContain('style="fill: #00ffff"');
    await page.locator('#undo').click();
    const undone = await code(page);
    expect(undone).toContain('<circle id="dot" class="green" cx="150" cy="50" r="30"/>');
    expect(undone).toContain('fill="#ff00ff"');
  });

  test('should go back to the drawing\'s own width for new strokes once another file is opened', async ({ page }) => {
    await page.locator('#paint-width').click();
    await page.locator('#width-value').fill('3');
    await page.locator('#width-value').press('Enter');
    await page.keyboard.press('Escape');
    await page.evaluate(() => (window as any).svgEditor.loadSVGContent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 1000 1000"></svg>'));
    await page.locator('#mode-shapes').click();
    await page.locator('#draw-line').click();
    await drag(page, [100, 500], [600, 500]);
    // a hundredth of a drawing 1000 across
    expect(await code(page)).toContain('stroke-width="10"');
  });

  test('should fill the selection with the colour picked, as one step while the picker keeps moving', async ({ page }) => {
    await page.locator('.svg-container #box').click();
    await move(page, 'fill-color', ['#110000', '#220000', '#ff00ff']);
    expect(await code(page)).toContain('<rect id="box" x="10" y="10" width="50" height="50" fill="#ff00ff"/>');
    await expect(page.locator('#message')).toHaveText('rect filled #ff00ff');
    await page.locator('#undo').click();
    expect(await code(page)).toContain('fill="#6291e0"');
  });

  test('should write a paint where it shows: in an element\'s style, when its style or a style sheet sets it', async ({ page }) => {
    await page.locator('.svg-container #dot').click();
    await page.locator('#fill-color').fill('#ff00ff');
    expect(await code(page)).toContain('<circle id="dot" class="green" cx="150" cy="50" r="30" style="fill: #ff00ff"/>');
    await page.locator('.svg-container #oval').click();
    await page.locator('#fill-color').fill('#0000ff');
    expect(await code(page)).toContain('style="fill: #0000ff; opacity: .8"');
    await expect(page.locator('.svg-container #oval')).toHaveCSS('fill', 'rgb(0, 0, 255)');
  });

  test('should paint the whole of a group, and what inside it paints itself, but nothing it would paint anyway', async ({ page }) => {
    await page.locator('.svg-container #plain').click();
    await expect(page.locator('#fill-color')).toHaveValue('#333333');
    await page.locator('#fill-color').fill('#ff00ff');
    const written = await code(page);
    expect(written).toContain('<g id="pair" fill="#ff00ff"><rect id="plain" x="10" y="120" width="30" height="30"/><rect id="own" x="60" y="120" width="30" height="30" fill="#ff00ff"/></g>');
    await expect(page.locator('.svg-container #own')).toHaveCSS('fill', 'rgb(255, 0, 255)');
  });

  test('should stroke the selection, take its stroke away with No stroke, and give it back in the picker\'s colour', async ({ page }) => {
    await page.locator('.svg-container #box').click();
    await expect(page.locator('#no-stroke')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#stroke-color').fill('#00ff00');
    expect(await code(page)).toContain('fill="#6291e0" stroke="#00ff00"');
    await expect(page.locator('#message')).toHaveText('rect stroked #00ff00');
    await expect(page.locator('#no-stroke')).toHaveAttribute('aria-pressed', 'false');
    await page.locator('#no-stroke').click();
    expect(await code(page)).toContain('stroke="none"');
    await expect(page.locator('#message')).toHaveText('rect has no stroke');
    await expect(page.locator('#paint-stroke')).toHaveClass(/none/);
    await page.locator('#no-stroke').click();
    expect(await code(page)).toContain('stroke="#00ff00"');
    await page.locator('#no-fill').click();
    expect(await code(page)).toContain('fill="none" stroke="#00ff00"');
    await expect(page.locator('#no-fill')).toHaveAttribute('aria-pressed', 'true');
  });

  test('should open Width over the strip, its slider set for the drawing, and write the width slid to or typed', async ({ page }) => {
    await page.locator('.svg-container #box').click();
    await page.locator('#stroke-color').fill('#000000');
    await page.locator('#paint-width').click();
    const pop = page.locator('#width-pop');
    await expect(pop).toBeVisible();
    await expect(page.locator('#paint-width')).toHaveAttribute('aria-expanded', 'true');
    const shown = (await pop.boundingBox())!;
    expect(shown.y + shown.height).toBeLessThanOrEqual((await page.locator('#context-bar').boundingBox())!.y);
    // on one row, with room for it, against the screen's edge
    const [slider, behind] = [(await page.locator('#width-range').boundingBox())!, (await page.locator('#stroke-behind').boundingBox())!];
    expect(Math.abs(behind.y - slider.y)).toBeLessThan(slider.height);
    expect(shown.x + shown.width).toBeLessThanOrEqual(1600);
    // a drawing 200 across: a new line is 2 wide, and the slider runs to twenty times that
    const range = page.locator('#width-range');
    await expect(range).toHaveAttribute('max', '40');
    await expect(range).toHaveAttribute('step', '0.2');
    await expect(range).toHaveValue('1');
    await move(page, 'width-range', ['2.2', '3.4', '4.6']);
    expect(await code(page)).toContain('stroke="#000000" stroke-width="4.6"');
    await expect(page.locator('#width-value')).toHaveValue('4.6');
    await expect(page.locator('#message')).toHaveText('rect stroke width 4.6');
    await page.locator('#width-value').fill('7.25');
    await page.locator('#width-value').press('Enter');
    expect(await code(page)).toContain('stroke-width="7.25"');
    await expect(page.locator('#paint-width')).toHaveAttribute('aria-label', 'Stroke width, 7.25');
    // the slide was one step, and the typed width another
    await page.locator('#width-value').press('Escape');
    await expect(pop).toBeHidden();
    await expect(page.locator('#paint-width')).toBeFocused();
    await page.locator('#undo').click();
    await page.locator('#undo').click();
    expect(await code(page)).toContain('stroke="#000000"/>');
  });

  test('should say a width cannot show on what has no stroke', async ({ page }) => {
    await page.locator('.svg-container #box').click();
    await page.locator('#paint-width').click();
    await page.locator('#width-value').fill('3');
    await page.locator('#width-value').press('Enter');
    expect(await code(page)).toContain('stroke-width="3"');
    await expect(page.locator('#message')).toHaveText('rect stroke width 3, with no stroke to show it: pick a Stroke colour');
  });

  test('should paint the shapes drawn next with the colours and width picked with nothing selected', async ({ page }) => {
    await page.locator('#fill-color').fill('#ff0000');
    await expect(page.locator('#message')).toHaveText('New shapes are filled #ff0000');
    await page.locator('#stroke-color').fill('#0000ff');
    await page.locator('#paint-width').click();
    await page.locator('#width-value').fill('3');
    await page.locator('#width-value').press('Enter');
    await expect(page.locator('#message')).toHaveText('New strokes are 3 wide');
    await page.keyboard.press('Escape');
    await page.locator('#mode-shapes').click();
    await page.locator('#draw-rect').click();
    await drag(page, [20, 160], [60, 190]);
    expect(await code(page)).toContain('<rect x="20" y="160" width="40" height="30" fill="#ff0000" stroke="#0000ff" stroke-width="3"/>');
    // the new shape is selected, so No stroke takes its stroke away, and the next ones'
    await page.locator('#no-stroke').click();
    await expect(page.locator('#message')).toHaveText('rect has no stroke');
    await page.locator('#draw-line').click();
    await drag(page, [100, 180], [140, 180]);
    // a line has no fill, so with no stroke it takes the fill's colour
    expect(await code(page)).toContain('<line x1="100" y1="180" x2="140" y2="180" stroke="#ff0000" stroke-width="3"/>');
  });

  test('should put the selection\'s stroke behind its fill from Width, as paint-order in its style, and back in front again', async ({ page }) => {
    await page.locator('.svg-container #box').click();
    await page.locator('#stroke-color').fill('#000000');
    await page.locator('#paint-width').click();
    const behind = page.locator('#stroke-behind');
    await expect(behind).toHaveAttribute('aria-pressed', 'false');
    await behind.click();
    expect(await code(page)).toContain('<rect id="box" x="10" y="10" width="50" height="50" fill="#6291e0" stroke="#000000" style="paint-order: stroke"/>');
    await expect(page.locator('.svg-container #box')).toHaveCSS('paint-order', 'stroke');
    await expect(behind).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#message')).toHaveText('rect: stroke behind the fill');
    // the popup stays open for the width
    await expect(page.locator('#width-pop')).toBeVisible();
    await behind.click();
    expect(await code(page)).toContain('<rect id="box" x="10" y="10" width="50" height="50" fill="#6291e0" stroke="#000000"/>');
    await expect(page.locator('#message')).toHaveText('rect: stroke in front of the fill');
    await page.keyboard.press('Escape');
    await page.locator('#undo').click();
    expect(await code(page)).toContain('style="paint-order: stroke"');
  });

  test('should keep a style\'s other declarations, and hold a stroke in front against its group\'s order', async ({ page }) => {
    await setContent(page, `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
  <g id="behind" style="paint-order: stroke" stroke="#000"><rect id="inner" x="10" y="10" width="50" height="50" fill="#6291e0" style="opacity: .5"/></g>
  <ellipse id="oval" cx="150" cy="150" rx="30" ry="20" fill="red" stroke="#000" paint-order="stroke"/>
</svg>`);
    await page.locator('.svg-container #inner').click();
    await page.locator('.svg-container #inner').click();
    await page.locator('#paint-width').click();
    await expect(page.locator('#stroke-behind')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#stroke-behind').click();
    // its group would still put it behind, so it says otherwise for itself
    expect(await code(page)).toContain('<rect id="inner" x="10" y="10" width="50" height="50" fill="#6291e0" style="opacity: .5; paint-order: normal"/>');
    await page.keyboard.press('Escape');
    // an attribute's order is taken over by the style
    await page.locator('.svg-container #oval').click();
    await page.locator('#paint-width').click();
    await page.locator('#stroke-behind').click();
    expect(await code(page)).toContain('<ellipse id="oval" cx="150" cy="150" rx="30" ry="20" fill="red" stroke="#000"/>');
  });

  test('should put the strokes of the shapes drawn next behind their fills', async ({ page }) => {
    await page.locator('#stroke-color').fill('#0000ff');
    await page.locator('#paint-width').click();
    await page.locator('#stroke-behind').click();
    await expect(page.locator('#message')).toHaveText('New shapes\' strokes go behind their fills');
    // and with a shape selected that has no stroke, it says the order cannot show
    await page.keyboard.press('Escape');
    await page.locator('.svg-container #box').click();
    await page.locator('#paint-width').click();
    await page.locator('#stroke-behind').click();
    await expect(page.locator('#message')).toHaveText('rect: stroke behind the fill, which shows only with a fill and a stroke');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.locator('#mode-shapes').click();
    await page.locator('#draw-rect').click();
    await drag(page, [20, 160], [60, 190]);
    expect(await code(page)).toContain('<rect x="20" y="160" width="40" height="30" fill="#999" stroke="#0000ff" stroke-width="2" style="paint-order: stroke"/>');
  });
});
