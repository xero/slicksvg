import { describe, it, expect } from 'vitest';
import { dragBox, boxedShape, drawnShape, placedShape, shapeMarkup, spacedClose, NEW_SHAPE_FILL } from '../src/draw';

const plain = { square: false, fromCenter: false, decimals: 0 };

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
    expect(drawnShape('ellipse', { x: 10, y: 20 }, { x: 50, y: 80 }, { ...plain, square: true })).toEqual({ cx: '40', cy: '50', rx: '30', ry: '30' });
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

describe('Placing a shape with a tap', () => {
  it('should centre a shape of a round size on the tap, an ellipse two thirds as tall as it is wide', () => {
    expect(placedShape('rect', { x: 100, y: 100 }, 50, 0)).toEqual({ x: '75', y: '75', width: '50', height: '50' });
    expect(placedShape('circle', { x: 100.4, y: 99.6 }, 50.3, 0)).toEqual({ cx: '100', cy: '100', r: '25' });
    expect(placedShape('ellipse', { x: 100, y: 100 }, 60, 0)).toEqual({ cx: '100', cy: '100', rx: '30', ry: '20' });
    expect(placedShape('rect', { x: 12, y: 12 }, 6.637, 1)).toEqual({ x: '8.7', y: '8.7', width: '6.6', height: '6.6' });
  });
});

describe('New shape markup', () => {
  it('should write the geometry, then the fill, closing as the source does', () => {
    expect(shapeMarkup('rect', { x: '1', y: '2', width: '3', height: '4' }, false)).toBe(`<rect x="1" y="2" width="3" height="4" fill="${NEW_SHAPE_FILL}"/>`);
    expect(shapeMarkup('circle', { cx: '1', cy: '2', r: '3' }, true)).toBe(`<circle cx="1" cy="2" r="3" fill="${NEW_SHAPE_FILL}" />`);
  });

  it('should tell which way the source mostly closes empty elements', () => {
    expect(spacedClose('<svg><rect /><circle /><path/></svg>')).toBe(true);
    expect(spacedClose('<svg><rect/><circle /><path d="M0 0"/></svg>')).toBe(false);
    expect(spacedClose('<svg></svg>')).toBe(false);
  });
});
