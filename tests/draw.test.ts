import { describe, it, expect } from 'vitest';
import {
  dragBox, boxedShape, drawnShape, placedShape, shapeMarkup, spacedClose, snapAngle, pointsList, draggedAnchor, penPathData,
  paintOf, strokeWidthFor, byPoints, pointsNeeded, SHAPE_KINDS, NEW_SHAPE_COLOR, type Anchor,
} from '../src/draw';

const plain = { constrain: false, fromCenter: false, decimals: 0 };

describe('Drawing a shape with a drag', () => {
  it('should span the box from the press to the pointer, whichever way the drag went', () => {
    expect(dragBox({ x: 10, y: 20 }, { x: 50, y: 80 }, false, false)).toEqual({ left: 10, top: 20, right: 50, bottom: 80 });
    expect(dragBox({ x: 50, y: 80 }, { x: 10, y: 20 }, false, false)).toEqual({ left: 10, top: 20, right: 50, bottom: 80 });
    expect(dragBox({ x: 50, y: 20 }, { x: 10, y: 80 }, false, false)).toEqual({ left: 10, top: 20, right: 50, bottom: 80 });
  });

  it('should make a square box as big as the longer side, toward where the drag went', () => {
    expect(dragBox({ x: 10, y: 10 }, { x: 50, y: 20 }, true, false)).toEqual({ left: 10, top: 10, right: 50, bottom: 50 });
    expect(dragBox({ x: 10, y: 10 }, { x: -20, y: 15 }, true, false)).toEqual({ left: -20, top: 10, right: 10, bottom: 40 });
    expect(dragBox({ x: 10, y: 10 }, { x: 10, y: -5 }, true, false)).toEqual({ left: 10, top: -5, right: 25, bottom: 10 });
  });

  it('should reach as far the other way from the press when drawing from the middle', () => {
    expect(dragBox({ x: 50, y: 50 }, { x: 70, y: 40 }, false, true)).toEqual({ left: 30, top: 40, right: 70, bottom: 60 });
    expect(dragBox({ x: 50, y: 50 }, { x: 70, y: 40 }, true, true)).toEqual({ left: 30, top: 30, right: 70, bottom: 70 });
  });

  it('should write a rect by its corner and size, a circle and an ellipse by their middle and radii', () => {
    expect(drawnShape('rect', { x: 10, y: 20 }, { x: 50, y: 80 }, plain)).toEqual({ x: '10', y: '20', width: '40', height: '60' });
    expect(drawnShape('ellipse', { x: 10, y: 20 }, { x: 50, y: 80 }, plain)).toEqual({ cx: '30', cy: '50', rx: '20', ry: '30' });
    expect(drawnShape('ellipse', { x: 10, y: 20 }, { x: 50, y: 80 }, { ...plain, constrain: true })).toEqual({ cx: '40', cy: '50', rx: '30', ry: '30' });
    expect(Object.keys(drawnShape('rect', { x: 0, y: 0 }, { x: 1, y: 1 }, plain))).toEqual(['x', 'y', 'width', 'height']);
  });

  it('should keep a circle round, as big as the longer side of the drag', () => {
    expect(drawnShape('circle', { x: 10, y: 20 }, { x: 50, y: 30 }, plain)).toEqual({ cx: '30', cy: '40', r: '20' });
    expect(drawnShape('circle', { x: 50, y: 50 }, { x: 60, y: 80 }, { ...plain, fromCenter: true })).toEqual({ cx: '50', cy: '50', r: '30' });
  });

  it('should round to the precision the zoom shows, keeping a rect\'s far corner where the pointer put it', () => {
    expect(drawnShape('rect', { x: 10.26, y: 20.04 }, { x: 50.71, y: 80.35 }, { ...plain, decimals: 1 })).toEqual({ x: '10.3', y: '20', width: '40.4', height: '60.3' });
    expect(drawnShape('rect', { x: 10.4, y: 20.4 }, { x: 50.6, y: 80.6 }, plain)).toEqual({ x: '10', y: '20', width: '41', height: '61' });
    expect(drawnShape('ellipse', { x: 0.123, y: 0 }, { x: 1.2, y: 0.5 }, { ...plain, decimals: 2 })).toEqual({ cx: '0.66', cy: '0.25', rx: '0.54', ry: '0.25' });
  });

  it('should give a size the drag left at nothing one step of the precision', () => {
    expect(drawnShape('rect', { x: 10, y: 20 }, { x: 50, y: 20.2 }, plain)).toEqual({ x: '10', y: '20', width: '40', height: '1' });
    expect(drawnShape('ellipse', { x: 10, y: 20 }, { x: 10, y: 60 }, { ...plain, decimals: 2 })).toEqual({ cx: '10', cy: '40', rx: '0.01', ry: '20' });
    expect(boxedShape('circle', { left: 5, top: 5, right: 5, bottom: 5 }, 0)).toEqual({ cx: '5', cy: '5', r: '1' });
  });
});

describe('Drawing a line with a drag', () => {
  it('should run from the press to the pointer, or from the middle as far the other way too', () => {
    expect(drawnShape('line', { x: 10, y: 20 }, { x: 50, y: 80 }, plain)).toEqual({ x1: '10', y1: '20', x2: '50', y2: '80' });
    expect(drawnShape('line', { x: 50, y: 50 }, { x: 70, y: 40 }, { ...plain, fromCenter: true })).toEqual({ x1: '30', y1: '60', x2: '70', y2: '40' });
  });

  it('should keep a constrained line at a multiple of 45 degrees, as long as the drag', () => {
    expect(drawnShape('line', { x: 10, y: 10 }, { x: 50, y: 14 }, { ...plain, constrain: true })).toEqual({ x1: '10', y1: '10', x2: '50', y2: '10' });
    expect(drawnShape('line', { x: 0, y: 0 }, { x: 30, y: 28 }, { ...plain, constrain: true, decimals: 1 })).toEqual({ x1: '0', y1: '0', x2: '29', y2: '29' });
    expect(drawnShape('line', { x: 10, y: 10 }, { x: 12, y: -30 }, { ...plain, constrain: true })).toEqual({ x1: '10', y1: '10', x2: '10', y2: '-30' });
  });

  it('should keep the ends a step apart when the precision would put them together', () => {
    expect(drawnShape('line', { x: 10, y: 10 }, { x: 10.2, y: 10.3 }, plain)).toEqual({ x1: '10', y1: '10', x2: '11', y2: '10' });
  });

  it('should turn a point about another to the nearest step, keeping its distance', () => {
    const p = snapAngle({ x: 0, y: 0 }, { x: 10, y: 1 });
    expect(p.x).toBeCloseTo(Math.hypot(10, 1));
    expect(p.y).toBeCloseTo(0);
    const q = snapAngle({ x: 5, y: 5 }, { x: 5, y: 15 }, 90);
    expect([q.x, q.y].map((n) => Math.round(n * 1e9) / 1e9)).toEqual([5, 15]);
  });
});

describe('Placing a shape with a tap', () => {
  it('should place a level line as long as the size, with its middle on the tap', () => {
    expect(placedShape('line', { x: 100, y: 80 }, 50, 0)).toEqual({ x1: '75', y1: '80', x2: '125', y2: '80' });
  });

  it('should centre a shape of a round size on the tap, an ellipse two thirds as tall as it is wide', () => {
    expect(placedShape('rect', { x: 100, y: 100 }, 50, 0)).toEqual({ x: '75', y: '75', width: '50', height: '50' });
    expect(placedShape('circle', { x: 100.4, y: 99.6 }, 50.3, 0)).toEqual({ cx: '100', cy: '100', r: '25' });
    expect(placedShape('ellipse', { x: 100, y: 100 }, 60, 0)).toEqual({ cx: '100', cy: '100', rx: '30', ry: '20' });
    expect(placedShape('rect', { x: 12, y: 12 }, 6.637, 1)).toEqual({ x: '8.7', y: '8.7', width: '6.6', height: '6.6' });
  });
});

describe('Drawing a shape a point at a time', () => {
  const corner = (x: number, y: number): Anchor => ({ x, y, in: null, out: null });

  it('should say which shapes are drawn a point at a time, and with how few points', () => {
    expect(SHAPE_KINDS.filter(byPoints)).toEqual(['polyline', 'polygon', 'path']);
    expect([pointsNeeded('polyline'), pointsNeeded('polygon'), pointsNeeded('path')]).toEqual([2, 3, 2]);
  });

  it('should list a polyline\'s or polygon\'s points as x,y pairs to the precision', () => {
    expect(pointsList([{ x: 10, y: 20 }, { x: 30.26, y: -4.04 }], 1)).toEqual('10,20 30.3,-4');
    expect(pointsList([], 0)).toBe('');
  });

  it('should drag an anchor\'s way out to the pointer and its way in as far the other way', () => {
    expect(draggedAnchor({ x: 10, y: 10 }, { x: 20, y: 5 })).toEqual({ x: 10, y: 10, out: { x: 20, y: 5 }, in: { x: 0, y: 15 } });
  });

  it('should join anchors without handles with lines, and close back to the first with Z alone', () => {
    const anchors = [corner(10, 10), corner(50, 10), corner(30, 40)];
    expect(penPathData(anchors, false, 0)).toBe('M10 10 L50 10 L30 40');
    expect(penPathData(anchors, true, 0)).toBe('M10 10 L50 10 L30 40 Z');
    expect(penPathData([corner(1, 2)], true, 0)).toBe('M1 2');
    expect(penPathData([], false, 0)).toBe('');
  });

  it('should curve a segment where either end has a handle toward the other', () => {
    const anchors = [corner(10, 10), draggedAnchor({ x: 50, y: 10 }, { x: 60, y: 30 }), corner(30, 50)];
    expect(penPathData(anchors, false, 0)).toBe('M10 10 C10 10 40 -10 50 10 C60 30 30 50 30 50');
  });

  it('should curve the way back to the first anchor when it bends, and still end with Z', () => {
    const anchors = [draggedAnchor({ x: 10, y: 10 }, { x: 20, y: 0 }), corner(50, 10), corner(30, 40)];
    expect(penPathData(anchors, true, 0)).toBe('M10 10 C20 0 50 10 50 10 L30 40 C30 40 0 20 10 10 Z');
  });

  it('should write a handle the precision puts on its anchor as no handle', () => {
    const anchors = [corner(10, 10), draggedAnchor({ x: 50, y: 10 }, { x: 50.2, y: 10.3 })];
    expect(penPathData(anchors, false, 0)).toBe('M10 10 L50 10');
    expect(penPathData(anchors, false, 1)).toBe('M10 10 C10 10 49.8 9.7 50 10');
  });
});

describe('New shape paint', () => {
  it('should fill a shape that closes round an area, and stroke a line or an open shape without a fill', () => {
    // the pen to begin with: the grey fill, and no stroke
    const grey = (width: string) => ({ fill: NEW_SHAPE_COLOR, stroke: 'none', width });
    for (const kind of ['rect', 'circle', 'ellipse', 'polygon'] as const) expect(paintOf(kind, false, grey('2'))).toEqual({ fill: NEW_SHAPE_COLOR });
    expect(paintOf('path', true, grey('2'))).toEqual({ fill: NEW_SHAPE_COLOR });
    expect(paintOf('line', false, grey('2'))).toEqual({ stroke: NEW_SHAPE_COLOR, 'stroke-width': '2' });
    expect(paintOf('polyline', true, grey('0.2'))).toEqual({ fill: 'none', stroke: NEW_SHAPE_COLOR, 'stroke-width': '0.2' });
    expect(paintOf('path', false, grey('3'))).toEqual({ fill: 'none', stroke: NEW_SHAPE_COLOR, 'stroke-width': '3' });
  });

  it('should fill and stroke a new shape with the pen, and stroke a line or an open shape only', () => {
    const pen = { fill: '#ff0000', stroke: '#0000ff', width: '4' };
    expect(paintOf('rect', false, pen)).toEqual({ fill: '#ff0000', stroke: '#0000ff', 'stroke-width': '4' });
    expect(paintOf('path', true, pen)).toEqual({ fill: '#ff0000', stroke: '#0000ff', 'stroke-width': '4' });
    expect(paintOf('line', false, pen)).toEqual({ stroke: '#0000ff', 'stroke-width': '4' });
    expect(paintOf('path', false, pen)).toEqual({ fill: 'none', stroke: '#0000ff', 'stroke-width': '4' });
    expect(paintOf('circle', false, { ...pen, fill: 'none' })).toEqual({ fill: 'none', stroke: '#0000ff', 'stroke-width': '4' });
  });

  it('should put a new shape\'s stroke behind its fill when the pen says, and only where there is a fill', () => {
    const pen = { fill: '#ff0000', stroke: '#0000ff', width: '4', behind: true };
    expect(paintOf('rect', false, pen)).toEqual({ fill: '#ff0000', stroke: '#0000ff', 'stroke-width': '4', style: 'paint-order: stroke' });
    expect(paintOf('line', false, pen)).toEqual({ stroke: '#0000ff', 'stroke-width': '4' });
    expect(paintOf('path', false, pen)).toEqual({ fill: 'none', stroke: '#0000ff', 'stroke-width': '4' });
    expect(paintOf('rect', false, { ...pen, fill: 'none' })).toEqual({ fill: 'none', stroke: '#0000ff', 'stroke-width': '4' });
  });

  it('should draw no shape unseen: an open one in the fill\'s colour with no stroke, a closed one with neither in the grey', () => {
    expect(paintOf('line', false, { fill: '#ff0000', stroke: 'none', width: '1' })).toEqual({ stroke: '#ff0000', 'stroke-width': '1' });
    expect(paintOf('polyline', false, { fill: 'none', stroke: 'none', width: '1' })).toEqual({ fill: 'none', stroke: NEW_SHAPE_COLOR, 'stroke-width': '1' });
    expect(paintOf('rect', false, { fill: 'none', stroke: 'none', width: '1' })).toEqual({ fill: 'none', stroke: NEW_SHAPE_COLOR, 'stroke-width': '1' });
  });

  it('should stroke a hundredth of the drawing\'s size, to one figure', () => {
    expect(['200', '24', '1000', '512', '0'].map((n) => strokeWidthFor(Number(n)))).toEqual(['2', '0.2', '10', '5', '1']);
    expect(strokeWidthFor(Infinity)).toBe('1');
  });
});

describe('New shape markup', () => {
  it('should write the attributes in order, closing as the source does', () => {
    expect(shapeMarkup('rect', { x: '1', y: '2', width: '3', height: '4', fill: '#999' }, false)).toBe('<rect x="1" y="2" width="3" height="4" fill="#999"/>');
    expect(shapeMarkup('circle', { cx: '1', cy: '2', r: '3' }, true)).toBe('<circle cx="1" cy="2" r="3" />');
  });

  it('should tell which way the source mostly closes empty elements', () => {
    expect(spacedClose('<svg><rect /><circle /><path/></svg>')).toBe(true);
    expect(spacedClose('<svg><rect/><circle /><path d="M0 0"/></svg>')).toBe(false);
    expect(spacedClose('<svg></svg>')).toBe(false);
  });
});
