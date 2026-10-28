import { describe, it, expect } from 'vitest';
import { ZOOM_MAX, ZOOM_MIN, ZOOM_STEP, clampZoom, zoomAbout, pinchView, wheelZoomFactor, wheelPan, type View } from '../src/view';

/** Where a spot of the drawing, in drawing pixels from its middle, lands on
 * screen (from the middle of the pane) under a view. */
const onScreen = (v: View, x: number, y: number) => [v.panX + v.zoom * x, v.panY + v.zoom * y];

describe('clampZoom', () => {
  it('keeps the zoom between its limits', () => {
    expect(clampZoom(0.01)).toBe(ZOOM_MIN);
    expect(clampZoom(999)).toBe(ZOOM_MAX);
    expect(clampZoom(2.5)).toBe(2.5);
  });
});

describe('zoomAbout', () => {
  it('scales by the factor', () => {
    expect(zoomAbout({ zoom: 1, panX: 0, panY: 0 }, 2, 0, 0)).toEqual({ zoom: 2, panX: 0, panY: 0 });
  });

  it('keeps the spot under the anchor where it was', () => {
    const before = { zoom: 1.5, panX: 40, panY: -20 };
    // the spot of the drawing under the anchor, in drawing pixels
    const spot = [(100 - before.panX) / before.zoom, (60 - before.panY) / before.zoom] as const;
    const after = zoomAbout(before, 2, 100, 60);
    expect(after.zoom).toBe(3);
    const [x, y] = onScreen(after, ...spot);
    expect(x).toBeCloseTo(100);
    expect(y).toBeCloseTo(60);
  });

  it('zooms about the middle of the drawing without moving it', () => {
    const before = { zoom: 2, panX: 30, panY: 50 };
    expect(zoomAbout(before, ZOOM_STEP, before.panX, before.panY)).toEqual({ zoom: 2.4, panX: 30, panY: 50 });
  });

  it('still anchors when the zoom hits a limit', () => {
    const before = { zoom: 40, panX: 0, panY: 0 };
    const after = zoomAbout(before, 2, 200, 0);
    expect(after.zoom).toBe(ZOOM_MAX);
    // only the ratio actually applied moves the pan
    expect(after.panX).toBeCloseTo(200 - 200 * (ZOOM_MAX / 40));
    const floor = zoomAbout({ zoom: ZOOM_MIN, panX: 10, panY: 10 }, 0.5, 0, 0);
    expect(floor).toEqual({ zoom: ZOOM_MIN, panX: 10, panY: 10 });
  });
});

describe('pinchView', () => {
  const start = { zoom: 1, panX: 0, panY: 0 };

  it('zooms by how much the fingers spread', () => {
    const v = pinchView(start, { x: 0, y: 0, spread: 50 }, { x: 0, y: 0, spread: 150 });
    expect(v).toEqual({ zoom: 3, panX: 0, panY: 0 });
  });

  it('keeps the spot between the fingers between them as they spread and move', () => {
    const from = { x: 80, y: -40, spread: 100 };
    const to = { x: 120, y: 10, spread: 250 };
    const spot = [(from.x - start.panX) / start.zoom, (from.y - start.panY) / start.zoom] as const;
    const v = pinchView(start, from, to);
    expect(v.zoom).toBe(2.5);
    const [x, y] = onScreen(v, ...spot);
    expect(x).toBeCloseTo(to.x);
    expect(y).toBeCloseTo(to.y);
  });

  it('pans without zooming when the fingers move together', () => {
    const v = pinchView({ zoom: 2, panX: 5, panY: 5 }, { x: 0, y: 0, spread: 60 }, { x: 30, y: -10, spread: 60 });
    expect(v).toEqual({ zoom: 2, panX: 35, panY: -5 });
  });

  it('does not zoom from fingers that began on one spot', () => {
    const v = pinchView(start, { x: 0, y: 0, spread: 0 }, { x: 0, y: 0, spread: 90 });
    expect(v.zoom).toBe(1);
  });

  it('measures from the start of the pinch, not step by step', () => {
    const from = { x: 0, y: 0, spread: 100 };
    const a = pinchView(start, from, { x: 0, y: 0, spread: 120 });
    const b = pinchView(start, from, { x: 0, y: 0, spread: 100 });
    expect(a.zoom).toBeCloseTo(1.2);
    expect(b).toEqual(start);
  });
});

describe('wheelZoomFactor', () => {
  it('zooms in for a wheel rolled up and out for one rolled down', () => {
    expect(wheelZoomFactor(-5, 0)).toBeGreaterThan(1);
    expect(wheelZoomFactor(5, 0)).toBeLessThan(1);
    expect(wheelZoomFactor(0, 0)).toBe(1);
  });

  it('turns the small steps of a trackpad pinch into small factors', () => {
    expect(wheelZoomFactor(-10, 0)).toBeCloseTo(Math.exp(0.1));
    expect(wheelZoomFactor(10, 0)).toBeCloseTo(Math.exp(-0.1));
  });

  it('keeps a mouse notch to a toolbar step, in pixels, lines, or pages', () => {
    expect(wheelZoomFactor(100, 0)).toBeCloseTo(1 / ZOOM_STEP);
    expect(wheelZoomFactor(-100, 0)).toBeCloseTo(ZOOM_STEP);
    expect(wheelZoomFactor(3, 1)).toBeCloseTo(1 / ZOOM_STEP);
    expect(wheelZoomFactor(-1, 2)).toBeCloseTo(ZOOM_STEP);
  });
});

describe('wheelPan', () => {
  it('moves the drawing against the scroll, as a page moves', () => {
    expect(wheelPan({ deltaX: 20, deltaY: 100, deltaMode: 0, shiftKey: false })).toEqual([-20, -100]);
  });

  it('scales lines and pages to pixels', () => {
    expect(wheelPan({ deltaX: 0, deltaY: 3, deltaMode: 1, shiftKey: false })).toEqual([-0, -48]);
    expect(wheelPan({ deltaX: 0, deltaY: 1, deltaMode: 2, shiftKey: false })).toEqual([-0, -800]);
  });

  it('turns a vertical wheel sideways with Shift, unless the browser already did', () => {
    expect(wheelPan({ deltaX: 0, deltaY: 100, deltaMode: 0, shiftKey: true })).toEqual([-100, -0]);
    expect(wheelPan({ deltaX: 100, deltaY: 0, deltaMode: 0, shiftKey: true })).toEqual([-100, -0]);
  });
});
