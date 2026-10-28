import { describe, it, expect } from 'vitest';
import { toHex, paintFrom, styleSets, setStyleProperty, removeStyleProperty, strokeFirst, widthRange, writtenWidth } from '../src/paint';

describe('Reading a paint', () => {
  it('should give a colour as the #rrggbb a colour picker takes, from the forms a browser computes and the hex ones written by hand', () => {
    expect(toHex('rgb(255, 0, 0)')).toBe('#ff0000');
    expect(toHex('rgba(98, 145, 224, 0.5)')).toBe('#6291e0');
    expect(toHex('rgb(98 145 224 / 50%)')).toBe('#6291e0');
    expect(toHex('#ABC')).toBe('#aabbcc');
    expect(toHex('#6291e0')).toBe('#6291e0');
    expect(toHex('#6291e080')).toBe('#6291e0');
  });

  it('should have no colour for a transparent one, or one it cannot read', () => {
    expect(toHex('rgba(0, 0, 0, 0)')).toBeNull();
    expect(toHex('red')).toBeNull();
    expect(toHex('url("#grad")')).toBeNull();
  });

  it('should say a paint is a colour, none, or something else, such as a gradient', () => {
    expect(paintFrom('rgb(0, 0, 0)')).toEqual({ kind: 'color', hex: '#000000' });
    expect(paintFrom('none')).toEqual({ kind: 'none' });
    expect(paintFrom('rgba(0, 0, 0, 0)')).toEqual({ kind: 'none' });
    expect(paintFrom('url("#grad") none')).toEqual({ kind: 'other' });
    expect(paintFrom('context-stroke')).toEqual({ kind: 'other' });
  });
});

describe('Writing a paint into a style', () => {
  it('should tell whether an inline style sets a property, whatever its case and spacing', () => {
    expect(styleSets('fill:red', 'fill')).toBe(true);
    expect(styleSets('opacity: .5; FILL : red;', 'fill')).toBe(true);
    expect(styleSets('fill-opacity: .5', 'fill')).toBe(false);
    expect(styleSets(null, 'fill')).toBe(false);
  });

  it('should set a property where the style set it, keeping the rest as written', () => {
    expect(setStyleProperty('fill:red', 'fill', '#00ff00')).toBe('fill: #00ff00');
    expect(setStyleProperty('opacity:.5; fill: red ;stroke:blue', 'fill', '#00ff00')).toBe('opacity:.5; fill: #00ff00;stroke:blue');
    expect(setStyleProperty('fill:red;fill:blue', 'fill', '#000000')).toBe('fill: #000000');
  });

  it('should add a property a style did not set at its end', () => {
    expect(setStyleProperty('opacity:.5', 'stroke', '#000000')).toBe('opacity:.5; stroke: #000000');
    expect(setStyleProperty('opacity:.5;', 'stroke', '#000000')).toBe('opacity:.5; stroke: #000000');
    expect(setStyleProperty('', 'stroke-width', '2')).toBe('stroke-width: 2');
  });
});

describe('The stroke width slider', () => {
  it('should run from nothing to twenty times a new line\'s width, in tenths of it', () => {
    expect(widthRange(200, 2)).toEqual({ min: 0, max: 40, step: 0.2, decimals: 1 });
    expect(widthRange(24, 1.5)).toEqual({ min: 0, max: 4, step: 0.02, decimals: 2 });
    expect(widthRange(1000, 10)).toEqual({ min: 0, max: 200, step: 1, decimals: 0 });
  });

  it('should reach twice a width wider than that, and fall back for a drawing with no size', () => {
    expect(widthRange(200, 50).max).toBe(100);
    expect(widthRange(0, 1)).toEqual({ min: 0, max: 20, step: 0.1, decimals: 1 });
    expect(widthRange(200, NaN).max).toBe(40);
  });

  it('should write a width to the slider\'s precision, and none below nothing', () => {
    expect(writtenWidth(2.4000000001, 1)).toBe('2.4');
    expect(writtenWidth(3, 2)).toBe('3');
    expect(writtenWidth(0, 1)).toBe('0');
    expect(writtenWidth(-1, 1)).toBeNull();
    expect(writtenWidth(NaN, 1)).toBeNull();
  });
});

describe('Taking a paint out of a style', () => {
  it('should take a property out of a style, keeping the rest as written, and leave nothing when it was all', () => {
    expect(removeStyleProperty('paint-order: stroke', 'paint-order')).toBeNull();
    expect(removeStyleProperty('paint-order: stroke;', 'paint-order')).toBeNull();
    expect(removeStyleProperty('opacity: .5; paint-order: stroke', 'paint-order')).toBe('opacity: .5');
    expect(removeStyleProperty('paint-order:stroke; fill: red', 'paint-order')).toBe('fill: red');
    expect(removeStyleProperty('fill: red', 'paint-order')).toBe('fill: red');
  });

  it('should tell a paint order that puts the stroke under the fill', () => {
    expect(strokeFirst('stroke')).toBe(true);
    expect(strokeFirst('stroke fill markers')).toBe(true);
    expect(strokeFirst('normal')).toBe(false);
    expect(strokeFirst('fill stroke')).toBe(false);
  });
});
