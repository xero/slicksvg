import { test, expect, type Page } from '@playwright/test';

/** The pan and zoom the app wrote into the drawing's transform. */
async function view(page: Page) {
  return page.locator('.svg-container').evaluate(el => {
    const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
    return { zoom: m.a, panX: m.e, panY: m.f };
  });
}

/** The middle of the preview canvas, which the drawing is scaled about. */
async function paneCenter(page: Page) {
  const box = await page.locator('.svg-preview-wrapper').boundingBox();
  if (!box) throw new Error('no preview');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Within layout rounding: the drawing's middle may sit on a half pixel. */
const near = (actual: number, expected: number) => expect(Math.abs(actual - expected)).toBeLessThan(1.5);

/** Real touches through the DevTools protocol, which names a finger by its id:
 * a touchEnd lifts the fingers it lists, and a touchMove moves only those. A
 * move is sent twice so Chromium's touch resampling settles on the spot. */
async function fingers(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  type Finger = { x: number; y: number; id?: number };
  const send = (type: 'touchStart' | 'touchMove' | 'touchEnd', touchPoints: Finger[]) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
  return {
    down: (points: Finger[]) => send('touchStart', points),
    move: async (points: Finger[]) => { await send('touchMove', points); await send('touchMove', points); },
    up: (points: Finger[] = []) => send('touchEnd', points),
  };
}

test.describe('zooming the preview', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html');
    await expect(page.locator('.svg-container')).toBeVisible();
  });

  test('Ctrl+wheel zooms the drawing about the pointer and leaves the page alone', async ({ page }) => {
    const { x: cx, y: cy } = await paneCenter(page);
    // aim well off centre, so the anchor shows
    const [ax, ay] = [cx - 120, cy + 40];
    const before = await view(page);
    expect(before.zoom).toBe(1);
    await page.mouse.move(ax, ay);
    await page.keyboard.down('Control');
    for (let i = 0; i < 4; i++) await page.mouse.wheel(0, -100);
    await page.keyboard.up('Control');

    const after = await view(page);
    expect(after.zoom).toBeGreaterThan(1.5);
    // the spot of the drawing that was under the pointer is still under it
    const spot = { x: (ax - cx - before.panX) / before.zoom, y: (ay - cy - before.panY) / before.zoom };
    near(after.panX + after.zoom * spot.x + cx, ax);
    near(after.panY + after.zoom * spot.y + cy, ay);
    // the page itself did not zoom or scroll
    expect(await page.evaluate(() => [window.visualViewport?.scale ?? 1, window.scrollX, window.scrollY])).toEqual([1, 0, 0]);

    await expect(page.locator('#preview-status')).toHaveText(/^Zoom(ed to)? \d+%$/);
    await expect(page.locator('#test-announcements')).toHaveText(/^Zoomed to \d+%$/);
  });

  test('Ctrl+wheel down zooms out and stops at the floor', async ({ page }) => {
    const { x, y } = await paneCenter(page);
    await page.mouse.move(x, y);
    await page.keyboard.down('Control');
    for (let i = 0; i < 20; i++) await page.mouse.wheel(0, 100);
    await page.keyboard.up('Control');
    const v = await view(page);
    expect(v.zoom).toBeCloseTo(0.1, 2);
  });

  test('the wheel on its own pans, and sideways with Shift', async ({ page }) => {
    const { x, y } = await paneCenter(page);
    await page.mouse.move(x, y);
    const before = await view(page);
    await page.mouse.wheel(0, 120);
    let v = await view(page);
    expect(v.zoom).toBe(before.zoom);
    near(v.panY, before.panY - 120);
    near(v.panX, before.panX);

    await page.keyboard.down('Shift');
    await page.mouse.wheel(0, 80);
    await page.keyboard.up('Shift');
    v = await view(page);
    near(v.panX, before.panX - 80);
    near(v.panY, before.panY - 120);
    expect(await page.evaluate(() => [window.scrollX, window.scrollY])).toEqual([0, 0]);
  });

  test('the toolbar still zooms about the middle of the drawing', async ({ page }) => {
    const { x, y } = await paneCenter(page);
    // pan the drawing off centre first, so the two anchors differ
    await page.mouse.move(x, y);
    await page.mouse.wheel(-100, -50);
    const before = await view(page);
    near(before.panX, 100);
    await page.getByRole('button', { name: /zoom in/i }).click();
    // the toolbar's zoom eases in
    await expect.poll(async () => (await view(page)).zoom).toBeCloseTo(1.2, 5);
    const after = await view(page);
    expect(after.panX).toBeCloseTo(before.panX, 5);
    expect(after.panY).toBeCloseTo(before.panY, 5);
    await expect(page.locator('#test-announcements')).toHaveText('Zoomed in to 120%');
  });
});

test.describe('pinching the preview', () => {
  test.use({ hasTouch: true });

  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html');
    await expect(page.locator('.svg-container')).toBeVisible();
  });

  test('two fingers zoom about the spot between them, then the one left pans', async ({ page }) => {
    const { x: cx, y: cy } = await paneCenter(page);
    const touch = await fingers(page);
    const before = await view(page);
    // fingers 40px apart, centred 60px left of the middle of the pane
    const [mx, my] = [cx - 60, cy + 20];
    await touch.down([{ x: mx - 20, y: my }, { x: mx + 20, y: my }]);
    // spread to 120px apart and drift 30px down together
    await touch.move([{ x: mx - 60, y: my + 30 }, { x: mx + 60, y: my + 30 }]);
    let v = await view(page);
    expect(v.zoom).toBeCloseTo(3, 5);
    const spot = { x: (mx - cx - before.panX) / before.zoom, y: (my - cy - before.panY) / before.zoom };
    near(v.panX + v.zoom * spot.x + cx, mx);
    near(v.panY + v.zoom * spot.y + cy, my + 30);
    await expect(page.locator('#preview-status')).toHaveText(/^Zoom(ed to)? 300%$/);

    // lift the left finger; the right one drags on and pans
    await touch.up([{ x: mx - 60, y: my + 30, id: 0 }]);
    const held = await view(page);
    await touch.move([{ x: mx + 110, y: my + 10, id: 1 }]);
    v = await view(page);
    expect(v.zoom).toBeCloseTo(held.zoom, 5);
    near(v.panX, held.panX + 50);
    near(v.panY, held.panY - 20);
    await touch.up();
    // nothing was selected by the fingers coming off
    await expect(page.locator('.select-overlay .select-box')).toBeHidden();
    await expect(page.locator('#test-announcements')).toHaveText('Zoomed to 300%');
  });

  test('a second finger turns a drag of the selection into a pinch, and the drag is kept', async ({ page }) => {
    const { x: cx, y: cy } = await paneCenter(page);
    const touch = await fingers(page);
    // the default drawing's circle, off its centre where the text sits
    const box = await page.locator('.svg-container circle').boundingBox();
    if (!box) throw new Error('no circle');
    const [px, py] = [box.x + 20, box.y + box.height / 2];
    await touch.down([{ x: px, y: py }]);
    await touch.up();
    await expect(page.locator('.select-overlay .select-box')).toBeVisible();

    await touch.down([{ x: px, y: py }]);
    await touch.move([{ x: px + 30, y: py }]);
    await expect(page.locator('#preview-status')).toHaveText(/^circle cx=/);
    const second = { x: cx + 100, y: cy };
    await touch.down([{ x: px + 30, y: py }, second]);
    const spread = Math.hypot(second.x - (px + 30), second.y - py);
    await touch.move([{ x: px - 20, y: py }, { x: cx + 150, y: cy }]);
    const pinched = await view(page);
    expect(pinched.zoom).toBeCloseTo(Math.hypot(cx + 150 - (px - 20), cy - py) / spread, 1);
    // the move stays on screen, unwritten, while the fingers are down
    await expect(page.locator('#editor .cm-content')).toContainText('cx="100"');
    await touch.up();
    // then it is written, as the drag left it, under the zoom the pinch reached
    await expect(page.locator('#editor .cm-content')).toContainText('cx="130"');
    await expect(page.locator('.select-overlay .select-box')).toBeVisible();
    expect((await view(page)).zoom).toBeCloseTo(pinched.zoom, 5);
  });
});
