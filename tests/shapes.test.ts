import { describe, it, expect } from 'vitest';
import { shapePathData, asPathChanges, plainLength, conversionBlocked, type Length } from '../src/shapes';
import { startTags, applyChanges } from '../src/source-map';
import { parsePathData, pathPoints } from '../src/path-data';

/** Lengths from attribute text, as plain numbers. */
const lengths = (attrs: Record<string, string>): Record<string, Length | undefined> =>
  Object.fromEntries(Object.entries(attrs).map(([name, text]) => [name, plainLength(text)!]));
const d = (tag: string, attrs: Record<string, string>, points: string | null = null) => {
  const made = shapePathData(tag, lengths(attrs), points);
  return made.ok ? made.d : made.reason;
};
const anchors = (path: string) => pathPoints(parsePathData(path)!).filter(p => p.slot === 'end').map(p => [p.x, p.y]);

describe('Plain lengths', () => {
  it('should read numbers and px, and nothing with other units', () => {
    expect(plainLength('10.5')).toEqual({ value: 10.5, places: 1 });
    expect(plainLength(' 20px ')).toEqual({ value: 20, places: 0 });
    expect(plainLength('1e2')).toEqual({ value: 100, places: 0 });
    expect(plainLength('50%')).toBeNull();
    expect(plainLength('2mm')).toBeNull();
    expect(plainLength('auto')).toBeNull();
  });
});

describe('Shapes as path data', () => {
  it('should draw a rect from its corner, round the way the spec runs it', () => {
    expect(d('rect', { x: '10', y: '20', width: '100', height: '50' })).toBe('M10 20 H110 V70 H10 Z');
    expect(d('rect', { width: '10.5', height: '5' })).toBe('M0 0 H10.5 V5 H0 Z');
  });

  it('should round a rect\'s corners with cubics, one radius serving for both and none more than half a side', () => {
    expect(d('rect', { x: '0', y: '0', width: '100', height: '50', rx: '10' })).toBe(
      'M10 0 H90 C95.52 0 100 4.48 100 10 V40 C100 45.52 95.52 50 90 50 H10 C4.48 50 0 45.52 0 40 V10 C0 4.48 4.48 0 10 0 Z');
    // a pill: the ends take all of the height, and the sides have no straight part
    expect(d('rect', { width: '100', height: '20', ry: '50' })).toBe(
      'M50 0 C77.61 0 100 4.48 100 10 C100 15.52 77.61 20 50 20 C22.39 20 0 15.52 0 10 C0 4.48 22.39 0 50 0 Z');
    expect(anchors(d('rect', { width: '100', height: '50', rx: '10' }))).toHaveLength(8);
  });

  it('should refuse a rect that draws nothing, and count a negative radius as none', () => {
    expect(d('rect', { width: '0', height: '50' })).toMatch(/draws nothing/);
    expect(d('rect', { height: '50' })).toMatch(/draws nothing/);
    expect(d('rect', { width: '10', height: '10', rx: '-2' })).toBe('M0 0 H10 V10 H0 Z');
  });

  it('should draw a circle and an ellipse as four cubics from the rightmost point', () => {
    expect(d('circle', { cx: '50', cy: '50', r: '40' })).toBe(
      'M90 50 C90 72.09 72.09 90 50 90 C27.91 90 10 72.09 10 50 C10 27.91 27.91 10 50 10 C72.09 10 90 27.91 90 50 Z');
    expect(anchors(d('circle', { cx: '50', cy: '50', r: '40' }))).toEqual([[90, 50], [50, 90], [10, 50], [50, 10]]);
    expect(d('ellipse', { rx: '20', ry: '10' })).toBe(
      'M20 0 C20 5.52 11.05 10 0 10 C-11.05 10 -20 5.52 -20 0 C-20 -5.52 -11.05 -10 0 -10 C11.05 -10 20 -5.52 20 0 Z');
    // one radius serves for both
    expect(d('ellipse', { rx: '20' })).toBe(d('circle', { r: '20' }));
    expect(d('circle', { cx: '5' })).toMatch(/no radius/);
  });

  it('should write a circle\'s handles finely enough for its size', () => {
    expect(d('circle', { r: '4000' })).toContain('C4000 2209 2209 4000 0 4000');
    expect(d('circle', { r: '0.5' })).toContain('C0.5 0.2761 0.2761 0.5 0 0.5');
  });

  it('should draw a line, a polygon, and a polyline with their own numbers', () => {
    expect(d('line', { x1: '1.5', y1: '2', x2: '30', y2: '40' })).toBe('M1.5 2 L30 40');
    expect(d('line', {})).toBe('M0 0 L0 0');
    expect(d('polygon', {}, '0,0 10,0 10,10')).toBe('M0,0 10,0 10,10Z');
    expect(d('polyline', {}, '0,0 10,0 10,10')).toBe('M0,0 10,0 10,10');
    expect(d('polygon', {}, '0,0 10')).toMatch(/do not pair up/);
  });
});

describe('Making a shape a path', () => {
  const edit = (src: string, index: number, path: string) => applyChanges(src, asPathChanges(src, startTags(src)[index], path));

  it('should put d where the first geometry attribute stood, keeping every other attribute', () => {
    const src = '<svg><rect id="r" x="10" fill="red" y="20" width="100" height="50" rx="5" transform="rotate(5)"/></svg>';
    expect(edit(src, 1, 'M0 0Z')).toBe('<svg><path id="r" d="M0 0Z" fill="red" transform="rotate(5)"/></svg>');
  });

  it('should rename a closing tag, and add d to a shape with no geometry written', () => {
    expect(edit('<svg><circle r="5"><title>dot</title></circle></svg>', 1, 'M5 0Z')).toBe('<svg><path d="M5 0Z"><title>dot</title></path></svg>');
    expect(edit('<svg><line stroke="red"/></svg>', 1, 'M0 0 L0 0')).toBe('<svg><path stroke="red" d="M0 0 L0 0"/></svg>');
  });

  it('should keep its quotes, and give a d the shape never drew with the new one', () => {
    expect(edit("<svg><polygon points='0,0 1,1' class='p'/></svg>", 1, 'M0,0 1,1Z')).toBe("<svg><path d='M0,0 1,1Z' class='p'/></svg>");
    expect(edit('<svg><rect d="M9 9" width="1" height="1"/></svg>', 1, 'M0 0Z')).toBe('<svg><path d="M0 0Z"/></svg>');
  });
});

describe('Shapes that would not draw the same as paths', () => {
  const first = (src: string, tag: string) => new DOMParser().parseFromString(src, 'image/svg+xml').getElementsByTagName(tag)[0];
  const svg = (inner: string) => `<svg xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;

  it('should refuse a shape whose geometry CSS sets', () => {
    expect(conversionBlocked(first(svg('<rect style="width: 50px" height="10"/>'), 'rect'))).toMatch(/set by CSS/);
    expect(conversionBlocked(first(svg('<style>circle { r: 5px }</style><circle r="2"/>'), 'circle'))).toMatch(/set by CSS/);
    expect(conversionBlocked(first(svg('<rect style="fill: red" width="5" height="5"/>'), 'rect'))).toBeNull();
  });

  it('should refuse a shape whose geometry is animated, but not one animated otherwise', () => {
    expect(conversionBlocked(first(svg('<rect width="5" height="5"><animate attributeName="width" to="9" dur="1s"/></rect>'), 'rect'))).toMatch(/animated/);
    expect(conversionBlocked(first(svg('<rect width="5" height="5"><animate attributeName="opacity" to="0" dur="1s"/></rect>'), 'rect'))).toBeNull();
  });
});
