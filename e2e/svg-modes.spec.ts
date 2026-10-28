import { test, expect, type Page } from '@playwright/test';
import { pressMenuItem } from './toolbar';

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

const FIXTURE = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
  <g id="grp">
    <path id="p" d="M20 20 L100 20 L100 100 Z" fill="#6291e0"/>
    <polygon id="g" points="120,20 180,20 150,80" fill="#aa0000"/>
  </g>
  <rect id="r" x="20" y="130" width="60" height="50" fill="#888"/>
</svg>`;

const MODES = ['mode-select', 'points', 'mode-shapes'];
const pressed = (page: Page) => page.evaluate((ids) => ids.filter((id) => document.getElementById(id)!.getAttribute('aria-pressed') === 'true'), MODES);

test.describe('SVG Editor modes', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html');
    await expect(page.locator('.svg-container svg')).toBeVisible();
    await setContent(page, FIXTURE);
    await expect(page.locator('.svg-container #r')).toBeVisible();
  });

  test('should hold each mode\'s tools in the drawing\'s strip, one mode pressed at a time', async ({ page }) => {
    expect(await pressed(page)).toEqual(['mode-select']);
    for (const id of ['select-tools', 'turn-tools', 'path-tools']) await expect(page.locator(`#${id}`)).toBeVisible();
    for (const id of ['point-tools', 'shape-tools']) await expect(page.locator(`#${id}`)).toBeHidden();
    await page.locator('#points').click();
    expect(await pressed(page)).toEqual(['points']);
    for (const id of ['point-tools', 'turn-tools']) await expect(page.locator(`#${id}`)).toBeVisible();
    for (const id of ['select-tools', 'shape-tools', 'path-tools']) await expect(page.locator(`#${id}`)).toBeHidden();
    await expect(page.locator('#preview-status')).toHaveText('Tap a path, polygon, polyline, or line to edit its points');
    await page.locator('#mode-shapes').click();
    expect(await pressed(page)).toEqual(['mode-shapes']);
    await expect(page.locator('#shape-tools')).toBeVisible();
    for (const id of ['select-tools', 'point-tools', 'turn-tools', 'path-tools']) await expect(page.locator(`#${id}`)).toBeHidden();
    await expect(page.locator('#preview-status')).toHaveText('Pick a shape, then drag or tap on the drawing');
    // Escape goes back to Select
    await page.keyboard.press('Escape');
    expect(await pressed(page)).toEqual(['mode-select']);
  });

  test('should edit the points of the element tapped in Points, straight through its group', async ({ page }) => {
    await page.locator('#points').click();
    await page.locator('.svg-container #g').click();
    expect(await editorSelection(page)).toMatch(/^<polygon id="g"/);
    await expect(page.locator('.points rect')).toHaveCount(3);
    await page.locator('.svg-container #p').click();
    expect(await editorSelection(page)).toMatch(/^<path id="p"/);
    await expect(page.locator('.points rect')).toHaveCount(3);
    // a tap on nothing lets it go, and Points stays
    const empty = await at(page, 150, 160);
    await page.mouse.click(empty.x, empty.y);
    await expect(page.locator('.points rect')).toHaveCount(0);
    expect(await pressed(page)).toEqual(['points']);
  });

  test('should offer To path in Points for a shape that has no points until it is a path', async ({ page }) => {
    await page.locator('#points').click();
    await page.locator('.svg-container #r').click();
    await expect(page.locator('#preview-status')).toHaveText(/A rect has no points to edit until it is a path/);
    await expect(page.locator('#path-tools')).toBeVisible();
    await expect(page.locator('#point-add')).toBeDisabled();
    await page.locator('#topath').click();
    await expect(page.locator('.points rect')).toHaveCount(4);
  });

  test('should follow the code\'s cursor into another element\'s points', async ({ page }) => {
    await page.locator('.svg-container #p').click();
    await page.locator('.svg-container #p').click();
    await page.keyboard.press('Enter');
    await expect(page.locator('.points rect')).toHaveCount(3);
    await page.evaluate(() => {
      const view = (window as any).svgEditor.editor;
      const at = view.state.doc.toString().indexOf('<polygon') + 3;
      view.dispatch({ selection: { anchor: at } });
    });
    await expect(page.locator('.points [data-point="0"]')).toBeVisible();
    expect(await page.locator('.points rect').count()).toBe(3);
    const marker = (await page.locator('.points [data-point="0"]').boundingBox())!;
    const first = await at(page, 120, 20);
    expect(Math.abs(marker.x + marker.width / 2 - first.x)).toBeLessThan(1);
  });

  test('should write a shape under way and edit its points when Points is picked', async ({ page }) => {
    await page.locator('#mode-shapes').click();
    await page.locator('#draw-polyline').click();
    for (const [x, y] of [[130, 120], [180, 150], [140, 190]] as [number, number][]) {
      const p = await at(page, x, y);
      await page.mouse.click(p.x, p.y);
    }
    await page.locator('#points').click();
    expect(await getSource(page)).toContain('<polyline points="130,120 180,150 140,190"');
    expect(await editorSelection(page)).toMatch(/^<polyline points="130,120/);
    await expect(page.locator('.points rect')).toHaveCount(3);
  });

  test('should stop editing a path\'s points when an undo puts the rect it was back', async ({ page }) => {
    await page.locator('#points').click();
    await page.locator('.svg-container #r').click();
    await page.locator('#topath').click();
    await expect(page.locator('.points rect')).toHaveCount(4);
    await page.locator('#undo').click();
    await expect(page.locator('.svg-container #r')).toHaveJSProperty('tagName', 'rect');
    await expect(page.locator('.points rect')).toHaveCount(0);
    await expect(page.locator('#point-several')).toBeDisabled();
    await expect(page.locator('#path-tools')).toBeVisible();
  });

  test('should outline in Points what a tap would pick, and pick a text run\'s text', async ({ page }) => {
    await setContent(page, FIXTURE.replace('</svg>', '  <text id="t" x="120" y="150" font-size="20"><tspan id="run">Hi</tspan></text>\n</svg>'));
    await page.locator('#points').click();
    const path = (await page.locator('.svg-container #p').boundingBox())!;
    await page.mouse.move(path.x + path.width - 6, path.y + 6);
    // the path's own box, give or take the outline's margin, not its group's, twice as wide
    const hover = (await page.locator('.select-overlay .hover-box').boundingBox())!;
    const group = (await page.locator('.svg-container #grp').boundingBox())!;
    expect(Math.abs(hover.width - path.width)).toBeLessThan(10);
    expect(group.width - hover.width).toBeGreaterThan(50);
    await page.locator('.svg-container #run').click();
    expect(await editorSelection(page)).toMatch(/^<text id="t"/);
  });

  test('should remove the selection with the Delete button, there to press only with something selected', async ({ page }) => {
    const remove = page.locator('#delete');
    await expect(remove).toBeDisabled();
    await page.locator('.svg-container #r').click();
    await expect(remove).toBeEnabled();
    await remove.click();
    expect(await getSource(page)).not.toContain('<rect id="r"');
    await expect(remove).toBeDisabled();
  });
});

test.describe('SVG Editor menus', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html');
    await expect(page.locator('.svg-container svg')).toBeVisible();
    await setContent(page, FIXTURE);
  });

  test('should open a menu under its button, close it with an item, and mark its button as having one', async ({ page }) => {
    const trigger = page.locator('#view-menu');
    const menu = page.locator('#view-items');
    await expect(menu).toBeHidden();
    // a corner cut into the button says there is more under it
    expect(await trigger.evaluate((b) => getComputedStyle(b, '::after').clipPath)).toMatch(/polygon/);
    await trigger.click();
    await expect(menu).toBeVisible();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const [t, m] = [(await trigger.boundingBox())!, (await menu.boundingBox())!];
    expect(Math.abs(m.y - (t.y + t.height))).toBeLessThan(1);
    expect(Math.abs(m.x - t.x)).toBeLessThan(1);
    await page.locator('#dark').click();
    await expect(menu).toBeHidden();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('body')).toHaveClass(/dark/);
    // a setting that is on says so
    await trigger.click();
    await expect(page.locator('#dark')).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('#flip')).toHaveAttribute('aria-checked', 'false');
    await page.locator('#flip').click();
    await expect(page.locator('body')).toHaveClass(/vertical/);
    await trigger.click();
    await expect(page.locator('#flip')).toHaveAttribute('aria-checked', 'true');
  });

  test('should close a menu with a press elsewhere that presses or selects nothing else', async ({ page }) => {
    await page.locator('#file-menu').click();
    await expect(page.locator('#file-items')).toBeVisible();
    await page.locator('.svg-container #r').click();
    await expect(page.locator('#file-items')).toBeHidden();
    await expect(page.locator('.select-overlay .select-box')).toBeHidden();
    // nor does it press another button
    await page.locator('#file-menu').click();
    await page.locator('#mode-shapes').click();
    await expect(page.locator('#file-items')).toBeHidden();
    await expect(page.locator('#mode-shapes')).toHaveAttribute('aria-pressed', 'false');
    // and the button that opened it closes it again
    await page.locator('#file-menu').click();
    await page.locator('#file-menu').click();
    await expect(page.locator('#file-items')).toBeHidden();
  });

  test('should open one menu at a time, close with Escape and give its button the keys, and move along with the arrows', async ({ page }) => {
    await page.locator('#file-menu').click();
    await page.locator('#view-menu').click();
    await expect(page.locator('#file-items')).toBeHidden();
    await expect(page.locator('#view-items')).toBeHidden();
    await page.locator('#view-menu').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#view-items')).toBeVisible();
    await expect(page.locator('#dark')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('#flip')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('#dark')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator('#view-items')).toBeHidden();
    await expect(page.locator('#view-menu')).toBeFocused();
    // Escape closed the menu and nothing else: the selection stays
    await page.locator('.svg-container #r').click();
    await page.locator('#file-menu').click();
    await page.keyboard.press('Escape');
    await expect(page.locator('.select-overlay .select-box')).toBeVisible();
  });

  test('should give the keys back to a menu\'s button when an item is pressed from them, open on the down arrow, and close when the keys tab away', async ({ page }) => {
    await page.locator('#view-menu').focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('#view-items')).toBeVisible();
    await expect(page.locator('#dark')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#view-items')).toBeHidden();
    await expect(page.locator('#view-menu')).toBeFocused();
    await expect(page.locator('body')).toHaveClass(/dark/);
    await page.keyboard.press('Enter');
    await expect(page.locator('#view-items')).toBeVisible();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await expect(page.locator('#view-items')).toBeHidden();
  });

  test('should close a menu with a right press and still take the next click', async ({ page }) => {
    await page.locator('#file-menu').click();
    const svg = (await page.locator('.svg-container svg').boundingBox())!;
    await page.mouse.click(svg.x + 150, svg.y + 160, { button: 'right' });
    await expect(page.locator('#file-items')).toBeHidden();
    await page.locator('#zoomin').click();
    await expect(page.locator('#zoom-reset')).toHaveText('120%');
  });

  test('should open the resolution dialog from the File menu', async ({ page }) => {
    await pressMenuItem(page, 'resolution');
    await expect(page.locator('dialog')).toBeVisible();
  });
});

test.describe('SVG Editor zoom control', () => {
  test('should say how far in the view is between Out and In, and go back to its own size when pressed', async ({ page }) => {
    await page.goto('/index.html');
    await expect(page.locator('.svg-container svg')).toBeVisible();
    const reset = page.locator('#zoom-reset');
    await expect(reset).toHaveText('100%');
    await page.locator('#zoomin').click();
    await expect(reset).toHaveText('120%');
    await expect(reset).toHaveAttribute('aria-label', 'Reset zoom, at 120%');
    await page.locator('#zoomout').click();
    await page.locator('#zoomout').click();
    await expect(reset).toHaveText('83%');
    await reset.click();
    await expect(reset).toHaveText('100%');
    // a file opened starts at its own size, and the button says so
    await page.locator('#zoomin').click();
    await expect(reset).toHaveText('120%');
    const chooser = page.waitForEvent('filechooser');
    await pressMenuItem(page, 'upload');
    await (await chooser).setFiles({ name: 'a.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="5" height="5"/></svg>') });
    await expect(page.locator('.svg-container rect')).toBeVisible();
    await expect(reset).toHaveText('100%');
  });
});

test.describe('SVG Editor app bar on a portrait tablet', () => {
  test.use({ viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true });

  test('should fit every button of the app bar with its name, the menus at its start and the tools at its end', async ({ page }) => {
    await page.goto('/index.html');
    await expect(page.locator('.svg-container svg')).toBeVisible();
    const bar = page.locator('#appbar nav');
    await expect(bar).not.toHaveClass(/compact/);
    await expect(bar).not.toHaveClass(/more-end/);
    const box = async (s: string) => (await page.locator(s).boundingBox())!;
    const [nav, file, view, history, zoom] = [await box('#appbar nav'), await box('#file-menu'), await box('#view-menu'), await box('#history'), await box('#zoom')];
    expect(file.x - nav.x).toBeLessThan(20);
    expect(nav.x + nav.width - (zoom.x + zoom.width)).toBeLessThan(20);
    // the gap is in the middle, between the menus and the tools
    expect(history.x - (view.x + view.width)).toBeGreaterThan(100);
  });

  test('should set each group of the app bar apart by one edge, with none of a gap, and close the last off', async ({ page }) => {
    await page.goto('/index.html');
    await expect(page.locator('.svg-container svg')).toBeVisible();
    const edges = await page.evaluate(() => ['history', 'modes', 'tools', 'zoom'].map((id) => {
      const el = document.getElementById(id)!;
      const css = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, before: css.borderLeftWidth, after: css.borderRightWidth };
    }));
    for (let i = 1; i < edges.length; i++) {
      expect(Math.abs(edges[i].left - edges[i - 1].right)).toBeLessThan(0.5);
      expect(edges[i - 1].after).toBe('0px');
    }
    expect(edges.every((e) => e.before === '1px')).toBe(true);
    expect(edges.at(-1)!.after).toBe('1px');
  });

  test('should close up the gap when the bar is too narrow for it', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/index.html');
    await expect(page.locator('.svg-container svg')).toBeVisible();
    await expect(page.locator('#appbar nav')).toHaveClass(/compact/);
    const [view, history] = [(await page.locator('#view-menu').boundingBox())!, (await page.locator('#history').boundingBox())!];
    expect(history.x - (view.x + view.width)).toBeLessThanOrEqual(8);
  });
});
