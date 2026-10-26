import { describe, it, expect } from 'vitest';
import {
  parseTransform, listMatrix, multiply, invert, applyToPoint, decimalsFor, fmt, shifted,
  planMove, planResize, axisMaps, resizedBox, planRotate, planFlip, parentCenter,
  type ResizeRequest, type Rect,
} from '../src/geometry';

/** Parse a document and return the element with id "t", or the last element. */
function el(markup: string, extra = ''): Element {
  const doc = new DOMParser().parseFromString(
    `<svg xmlns="http://www.w3.org/2000/svg">${extra}${markup}</svg>`, 'image/svg+xml');
  const found = doc.getElementById('t') ?? doc.documentElement.lastElementChild;
  if (!found) throw new Error('no element');
  return found;
}

const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 6);

describe('parseTransform', () => {
  it('should read each function with its arguments and position', () => {
    const value = 'translate(364,94) rotate(30 10 20)';
    const list = parseTransform(value)!;
    expect(list.map((f) => f.name)).toEqual(['translate', 'rotate']);
    expect(list[0].args).toEqual([364, 94]);
    expect(list[1].args).toEqual([30, 10, 20]);
    expect(value.slice(list[1].start, list[1].end)).toBe('rotate(30 10 20)');
  });

  it('should accept comma separators between functions and exponents in numbers', () => {
    expect(parseTransform('scale(2) , translate(1e1 -.5)')!.map((f) => f.args)).toEqual([[2], [10, -0.5]]);
  });

  it('should be empty for an empty value', () => {
    expect(parseTransform('  ')).toEqual([]);
  });

  it('should refuse anything it cannot read rather than guess', () => {
    expect(parseTransform('translate(1,2) wobble(3)')).toBeNull();
    expect(parseTransform('rotate(1, 2)')).toBeNull();
    expect(parseTransform('matrix(1 0 0 1 5)')).toBeNull();
  });
});

describe('matrices', () => {
  it('should compose in SVG order, the rightmost function applying first', () => {
    const m = listMatrix(parseTransform('translate(10 0) scale(2)')!);
    expect(applyToPoint(m, 1, 1)).toEqual({ x: 12, y: 2 });
  });

  it('should keep the centre fixed when rotating about it', () => {
    const m = listMatrix(parseTransform('rotate(90 50 50)')!);
    const p = applyToPoint(m, 50, 50);
    close(p.x, 50); close(p.y, 50);
    const q = applyToPoint(m, 60, 50);
    close(q.x, 50); close(q.y, 60);
  });

  it('should invert back to the identity', () => {
    const m = listMatrix(parseTransform('translate(3 4) rotate(30) scale(2 3)')!);
    const id = multiply(invert(m)!, m);
    close(id.a, 1); close(id.b, 0); close(id.c, 0); close(id.d, 1); close(id.e, 0); close(id.f, 0);
  });

  it('should have no inverse for a degenerate matrix', () => {
    expect(invert({ a: 0, b: 0, c: 0, d: 0, e: 1, f: 1 })).toBeNull();
  });
});

describe('number formatting', () => {
  it('should drop float noise, trailing zeros, and negative zero', () => {
    expect(fmt(0.1 + 0.2)).toBe('0.3');
    expect(fmt(40)).toBe('40');
    expect(fmt(-0.0000001)).toBe('0');
  });

  it('should write whole numbers at 1:1 and more places only when zoomed in', () => {
    expect(decimalsFor(1)).toBe(0);
    expect(decimalsFor(0.25)).toBe(0);
    expect(decimalsFor(3)).toBe(0);
    expect(decimalsFor(4)).toBe(1);
    expect(decimalsFor(40)).toBe(2);
    expect(decimalsFor(1e9)).toBe(4);
  });

  it('should shift a value keeping as many places as it had', () => {
    expect(shifted(121.31122970581055, 5)).toBe('126.31122970581055');
    expect(shifted(0.1, 0.2)).toBe('0.3');
    expect(shifted(40, 25)).toBe('65');
    expect(shifted(1.5e-7, 0)).toBe('1.5e-7');
  });
});

describe('planMove', () => {
  it('should shift a rectangle by its x and y', () => {
    expect(planMove(el('<rect x="40" y="10" width="5" height="5"/>'), 25, -5))
      .toEqual({ ok: true, attrs: { x: '65', y: '5' } });
  });

  it('should leave an axis alone when the move does not cross it', () => {
    expect(planMove(el('<rect x="40" y="10.25" width="5" height="5"/>'), 3, 0))
      .toEqual({ ok: true, attrs: { x: '43' } });
  });

  it('should treat a missing position as 0', () => {
    expect(planMove(el('<rect width="5" height="5"/>'), 3, 4))
      .toEqual({ ok: true, attrs: { x: '3', y: '4' } });
  });

  it('should move circles, ellipses, and lines by their geometry', () => {
    expect(planMove(el('<circle cx="10" cy="10" r="5"/>'), 1, 2)).toEqual({ ok: true, attrs: { cx: '11', cy: '12' } });
    expect(planMove(el('<ellipse cx="10" cy="10" rx="5" ry="3"/>'), 1, 2)).toEqual({ ok: true, attrs: { cx: '11', cy: '12' } });
    expect(planMove(el('<line x1="0" y1="0" x2="10" y2="20"/>'), 5, 5))
      .toEqual({ ok: true, attrs: { x1: '5', x2: '15', y1: '5', y2: '25' } });
  });

  it('should shift every value of a text positioned glyph by glyph, and use a transform when runs place themselves', () => {
    expect(planMove(el('<text x="10 20 30" y="5">abc</text>'), 2, 0)).toEqual({ ok: true, attrs: { x: '12 22 32' } });
    expect(planMove(el('<text x="10" y="5"><tspan x="10" y="20">a</tspan></text>'), 2, 3))
      .toEqual({ ok: true, attrs: { transform: 'translate(2 3)' } });
  });

  it('should update a leading translate in place, keeping its comma and its digits', () => {
    expect(planMove(el('<path d="M0 0" transform="translate(364,94)"/>'), 25, -4))
      .toEqual({ ok: true, attrs: { transform: 'translate(389,90)' } });
    expect(planMove(el('<path d="M0 0" transform="translate(121.31122970581055,-0.511744499206543)"/>'), 5, 0))
      .toEqual({ ok: true, attrs: { transform: 'translate(126.31122970581055,-0.511744499206543)' } });
    expect(planMove(el('<g transform="translate(10 10) rotate(45)"/>'), 5, 0))
      .toEqual({ ok: true, attrs: { transform: 'translate(15 10) rotate(45)' } });
    expect(planMove(el('<g transform="translate(10)"/>'), 5, 0)).toEqual({ ok: true, attrs: { transform: 'translate(15)' } });
  });

  it('should move a leading matrix by its translation', () => {
    expect(planMove(el('<text transform="matrix(1 0 0 1 120.5 40.2)">a</text>'), 10, -0.2))
      .toEqual({ ok: true, attrs: { transform: 'matrix(1 0 0 1 130.5 40)' } });
  });

  it('should put a translate in front of a path or a transform that does not start with one', () => {
    expect(planMove(el('<path d="M0 0 L5 5"/>'), 7, 8)).toEqual({ ok: true, attrs: { transform: 'translate(7 8)' } });
    expect(planMove(el('<polygon points="0,0 1,1 1,0" transform="scale(2)"/>'), 7, 8))
      .toEqual({ ok: true, attrs: { transform: 'translate(7 8) scale(2)' } });
  });

  it('should move rotated and scaled rectangles in their own units', () => {
    expect(planMove(el('<rect x="0" y="0" width="10" height="10" transform="rotate(90)"/>'), 5, 0))
      .toEqual({ ok: true, attrs: { y: '-5' } });
    expect(planMove(el('<rect x="10" y="10" width="5" height="5" transform="scale(2)"/>'), 10, 0))
      .toEqual({ ok: true, attrs: { x: '15' } });
  });

  it('should fall back to a transform when a position is not a plain number or CSS sets it', () => {
    expect(planMove(el('<rect x="10%" y="5" width="5" height="5"/>'), 1, 1)).toEqual({ ok: true, attrs: { transform: 'translate(1 1)' } });
    expect(planMove(el('<rect class="c" x="1" y="1" width="5" height="5"/>', '<style>.c { x: 3px; }</style>'), 1, 1))
      .toEqual({ ok: true, attrs: { transform: 'translate(1 1)' } });
  });

  it('should refuse an element whose transform CSS controls, an animated one, or an unreadable transform', () => {
    expect(planMove(el('<rect style="transform: rotate(3deg)" width="5" height="5"/>'), 1, 1).ok).toBe(false);
    expect(planMove(el('<path id="t" d="M0 0"/>', '<style>#t { transform: scale(2); }</style>'), 1, 1).ok).toBe(false);
    expect(planMove(el('<rect width="5" height="5"><animate attributeName="x" to="9"/></rect>'), 1, 1).ok).toBe(false);
    expect(planMove(el('<rect width="5" height="5" transform="translate(1,"/>'), 1, 1).ok).toBe(false);
  });

  it('should still move an element with a transform origin of its own', () => {
    expect(planMove(el('<rect transform-origin="center" x="5" y="5" width="5" height="5"/>'), 1, 0))
      .toEqual({ ok: true, attrs: { x: '6' } });
  });

  it('should change nothing for a zero move', () => {
    expect(planMove(el('<rect x="1" width="5" height="5"/>'), 0, 0)).toEqual({ ok: true, attrs: {} });
  });
});

const req = (over: Partial<ResizeRequest>): ResizeRequest => ({
  handle: 'se', dx: 0, dy: 0, keepAspect: false,
  bbox: { x: 0, y: 0, width: 0, height: 0 }, minSize: 1, decimals: 0, ...over,
});

describe('axisMaps', () => {
  const box: Rect = { x: 10, y: 10, width: 100, height: 50 };

  it('should pin the opposite corner', () => {
    expect(resizedBox(box, axisMaps(box, req({ handle: 'se', dx: 20, dy: 10 })))).toEqual({ x: 10, y: 10, width: 120, height: 60 });
    expect(resizedBox(box, axisMaps(box, req({ handle: 'nw', dx: 20, dy: 10 })))).toEqual({ x: 30, y: 20, width: 80, height: 40 });
  });

  it('should leave the other axis alone for a side handle', () => {
    expect(resizedBox(box, axisMaps(box, req({ handle: 'e', dx: 20, dy: 99 })))).toEqual({ x: 10, y: 10, width: 120, height: 50 });
  });

  it('should keep the aspect ratio from a corner or grow about the middle from a side', () => {
    expect(resizedBox(box, axisMaps(box, req({ handle: 'se', dx: 100, dy: 0, keepAspect: true })))).toEqual({ x: 10, y: 10, width: 200, height: 100 });
    expect(resizedBox(box, axisMaps(box, req({ handle: 'e', dx: 100, keepAspect: true })))).toEqual({ x: 10, y: -15, width: 200, height: 100 });
  });

  it('should flip when dragged past the opposite side and never shrink below the minimum', () => {
    const maps = axisMaps(box, req({ handle: 'e', dx: -150 }));
    expect(maps.x.k).toBeLessThan(0);
    expect(resizedBox(box, maps)).toEqual({ x: -40, y: 10, width: 50, height: 50 });
    expect(resizedBox(box, axisMaps(box, req({ handle: 'e', dx: -100, minSize: 2 }))).width).toBeCloseTo(2, 9);
    expect(axisMaps({ x: 0, y: 5, width: 10, height: 0 }, req({ handle: 'se', dx: 10, dy: 10 })).y.k).toBe(1);
  });
});

describe('planResize', () => {
  it('should rewrite the boxes of rects, ellipses, circles, and lines', () => {
    expect(planResize(el('<rect x="10" y="10" width="100" height="50"/>'), req({ handle: 'se', dx: 20, dy: 10 })))
      .toEqual({ ok: true, attrs: { width: '120', height: '60' } });
    expect(planResize(el('<rect x="10" y="10" width="100" height="50"/>'), req({ handle: 'w', dx: -5 })))
      .toEqual({ ok: true, attrs: { x: '5', width: '105' } });
    expect(planResize(el('<rect width="100" height="50" rx="10"/>'), req({ handle: 'e', dx: 100 })))
      .toEqual({ ok: true, attrs: { width: '200', rx: '20' } });
    expect(planResize(el('<ellipse cx="50" cy="50" rx="20" ry="10"/>'), req({ handle: 'e', dx: 10 })))
      .toEqual({ ok: true, attrs: { cx: '55', rx: '25' } });
    expect(planResize(el('<circle cx="50" cy="50" r="10"/>'), req({ handle: 'se', dx: 10, dy: 0 })))
      .toEqual({ ok: true, attrs: { cx: '55', cy: '55', r: '15' } });
    expect(planResize(el('<line x1="0" y1="0" x2="10" y2="10"/>'), req({ handle: 'se', dx: 10, dy: 0 })))
      .toEqual({ ok: true, attrs: { x2: '20' } });
  });

  it('should scale a path through a transform about the pinned corner, folding repeated resizes', () => {
    expect(planResize(el('<path d="M10 10 H110 V60 H10 Z"/>'), req({ handle: 'se', dx: 100, dy: 50, bbox: { x: 10, y: 10, width: 100, height: 50 } })))
      .toEqual({ ok: true, attrs: { transform: 'translate(-10 -10) scale(2)' } });
    expect(planResize(el('<path d="M0 0 H100 V50 H0 Z" transform="translate(364,94)"/>'), req({ handle: 'e', dx: 50, bbox: { x: 0, y: 0, width: 100, height: 50 } })))
      .toEqual({ ok: true, attrs: { transform: 'translate(364,94) scale(1.5,1)' } });
    expect(planResize(el('<path d="M0 0 H100 V50 H0 Z" transform="translate(5 5) scale(2)"/>'), req({ handle: 'se', dx: 100, dy: 50, bbox: { x: 0, y: 0, width: 100, height: 50 } })))
      .toEqual({ ok: true, attrs: { transform: 'translate(5 5) scale(4)' } });
    expect(planResize(el('<g transform="rotate(30)"><rect width="10" height="10"/></g>'), req({ handle: 'se', dx: 10, dy: 10, bbox: { x: 0, y: 0, width: 10, height: 10 } })))
      .toEqual({ ok: true, attrs: { transform: 'rotate(30) scale(2)' } });
  });

  it('should mirror past the opposite side and drop a transform that comes back to nothing', () => {
    expect(planResize(el('<path d="M0 0 H10 V10 H0 Z"/>'), req({ handle: 'e', dx: -20, bbox: { x: 0, y: 0, width: 10, height: 10 } })))
      .toEqual({ ok: true, attrs: { transform: 'scale(-1 1)' } });
    expect(planResize(el('<path d="M0 0 H10 V10 H0 Z" transform="scale(2)"/>'), req({ handle: 'se', dx: -5, dy: -5, bbox: { x: 0, y: 0, width: 10, height: 10 } })))
      .toEqual({ ok: true, attrs: { transform: null } });
  });

  it('should resize a rotated rectangle in its own frame', () => {
    expect(planResize(el('<rect x="0" y="0" width="10" height="10" transform="rotate(45 5 5)"/>'), req({ handle: 'e', dx: 10 })))
      .toEqual({ ok: true, attrs: { width: '20' } });
  });

  it('should keep what the drag did not change exactly as written', () => {
    expect(planResize(el('<path d="M0 0 H10 V10 H0 Z" transform="translate(121.31122970581055,-0.511744499206543)"/>'), req({ handle: 'e', dx: 10, bbox: { x: 0, y: 0, width: 10, height: 10 } })))
      .toEqual({ ok: true, attrs: { transform: 'translate(121.31122970581055,-0.511744499206543) scale(2,1)' } });
    expect(planResize(el('<path d="M0 0 H2048 V2048 H0 Z" transform="scale(0.00048828125)"/>'), req({ handle: 'se', dx: 2.048, dy: 2.048, bbox: { x: 0, y: 0, width: 2048, height: 2048 } })))
      .toEqual({ ok: true, attrs: { transform: 'scale(0.00048877)' } });
  });

  it('should refuse CSS-positioned elements, a transform origin, and a nested svg', () => {
    expect(planResize(el('<rect style="transform:none" width="5" height="5"/>'), req({ dx: 1 })).ok).toBe(false);
    expect(planResize(el('<path transform-origin="50 50" d="M0 0 H10 V10 Z"/>'), req({ dx: 1 })).ok).toBe(false);
    expect(planResize(el('<path id="t" d="M0 0 H10 V10 Z"/>', '<style>#t { transform-box: fill-box; }</style>'), req({ dx: 1 })).ok).toBe(false);
    expect(planResize(el('<svg x="0" y="0" width="48" height="48" viewBox="0 0 24 24"/>'), req({ dx: 1 })).ok).toBe(false);
    expect(planMove(el('<svg x="5" y="5" width="48" height="48" viewBox="0 0 24 24"/>'), 1, 2)).toEqual({ ok: true, attrs: { x: '6', y: '7' } });
  });
});

describe('parentCenter', () => {
  it('should map the local box centre through the element\'s own transform', () => {
    expect(parentCenter(el('<rect x="0" y="0" width="10" height="10"/>'), { x: 0, y: 0, width: 10, height: 10 })).toEqual({ x: 5, y: 5 });
    expect(parentCenter(el('<rect transform="translate(5 5) scale(2)"/>'), { x: 0, y: 0, width: 10, height: 10 })).toEqual({ x: 15, y: 15 });
    expect(parentCenter(el('<rect transform="translate(1,"/>'), { x: 0, y: 0, width: 10, height: 10 })).toBeNull();
  });
});

describe('planRotate', () => {
  const c = { x: 50, y: 50 };

  it('should put a rotate about the centre in front of the transform', () => {
    expect(planRotate(el('<rect x="40" y="40" width="20" height="20"/>'), 90, c)).toEqual({ ok: true, attrs: { transform: 'rotate(90 50 50)' } });
    expect(planRotate(el('<path d="M0 0" transform="translate(5 5) scale(2)"/>'), 45, c))
      .toEqual({ ok: true, attrs: { transform: 'rotate(45 50 50) translate(5 5) scale(2)' } });
  });

  it('should add to a leading rotate about the same centre instead of stacking', () => {
    expect(planRotate(el('<rect transform="rotate(90 50 50)"/>'), 90, c)).toEqual({ ok: true, attrs: { transform: 'rotate(180 50 50)' } });
    expect(planRotate(el('<rect transform="rotate(30 50 50) scale(2)"/>'), 90, c)).toEqual({ ok: true, attrs: { transform: 'rotate(120 50 50) scale(2)' } });
    expect(planRotate(el('<rect transform="rotate(270 50 50)"/>'), 90, c)).toEqual({ ok: true, attrs: { transform: null } });
    expect(planRotate(el('<rect transform="rotate(-30 50 50)"/>'), 30, c)).toEqual({ ok: true, attrs: { transform: null } });
  });

  it('should stack in front of a rotate about a different centre', () => {
    expect(planRotate(el('<rect transform="rotate(90 10 10)"/>'), 90, c)).toEqual({ ok: true, attrs: { transform: 'rotate(90 50 50) rotate(90 10 10)' } });
  });

  it('should write the centre and angle to the given precision', () => {
    expect(planRotate(el('<rect/>'), 33.3333, { x: 12.345, y: 6.789 }, 1)).toEqual({ ok: true, attrs: { transform: 'rotate(33.3 12.3 6.8)' } });
  });

  it('should refuse a transform origin or a CSS transform', () => {
    expect(planRotate(el('<rect transform-origin="center"/>'), 90, c).ok).toBe(false);
    expect(planRotate(el('<rect style="transform: scale(2)"/>'), 90, c).ok).toBe(false);
  });
});

describe('planFlip', () => {
  const c = { x: 50, y: 50 };

  it('should mirror across the vertical or horizontal line through the centre', () => {
    expect(planFlip(el('<rect/>'), 'x', c)).toEqual({ ok: true, attrs: { transform: 'matrix(-1 0 0 1 100 0)' } });
    expect(planFlip(el('<rect/>'), 'y', c)).toEqual({ ok: true, attrs: { transform: 'matrix(1 0 0 -1 0 100)' } });
    expect(planFlip(el('<rect transform="scale(2)"/>'), 'x', c)).toEqual({ ok: true, attrs: { transform: 'matrix(-1 0 0 1 100 0) scale(2)' } });
  });

  it('should take a mirror back off when flipped across the same line again', () => {
    expect(planFlip(el('<rect transform="matrix(-1 0 0 1 100 0)"/>'), 'x', c)).toEqual({ ok: true, attrs: { transform: null } });
    expect(planFlip(el('<rect transform="matrix(-1 0 0 1 100 0) scale(2)"/>'), 'x', c)).toEqual({ ok: true, attrs: { transform: 'scale(2)' } });
    expect(planFlip(el('<rect transform="matrix(-1 0 0 1 100 0)"/>'), 'y', c))
      .toEqual({ ok: true, attrs: { transform: 'matrix(1 0 0 -1 0 100) matrix(-1 0 0 1 100 0)' } });
  });

  it('should keep the mirror a true mirror: the centre stays put', () => {
    const list = parseTransform(planFlip(el('<rect/>'), 'x', { x: 30, y: 10 }).ok ? 'matrix(-1 0 0 1 60 0)' : '')!;
    expect(applyToPoint(listMatrix(list), 30, 10)).toEqual({ x: 30, y: 10 });
    expect(applyToPoint(listMatrix(list), 40, 10)).toEqual({ x: 20, y: 10 });
  });
});
