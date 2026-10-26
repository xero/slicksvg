import { describe, it, expect, beforeEach } from 'vitest';
import { findSvgTarget, selectionChain, nextInChain, isGraphical, ordinalOf } from '../src/select';

const markup = `<div class="svg-container"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
  <defs><filter id="f"/></defs>
  <g id="wrap">
    <g id="a"><rect id="r"/><circle id="c"/></g>
    <text id="t">Hi <tspan id="s">there</tspan></text>
  </g>
</svg></div>`;

const byId = (id: string) => document.getElementById(id) as Element;

describe('Preview selection picking', () => {
  let root: SVGSVGElement;

  beforeEach(() => {
    document.body.innerHTML = markup;
    root = document.querySelector('svg') as SVGSVGElement;
  });

  it('should tell drawn elements from definitions', () => {
    expect(isGraphical(byId('a'))).toBe(true);
    expect(isGraphical(byId('r'))).toBe(true);
    expect(isGraphical(document.querySelector('defs') as Element)).toBe(false);
    expect(isGraphical(byId('f'))).toBe(false);
  });

  it('should find the drawn element under a press, and nothing on the canvas itself', () => {
    expect(findSvgTarget(byId('r'), root)).toBe(byId('r'));
    expect(findSvgTarget(root, root)).toBeNull();
    expect(findSvgTarget(document.querySelector('.svg-container'), root)).toBeNull();
    expect(findSvgTarget(null, root)).toBeNull();
  });

  it('should build the chain from the top-level item down to the leaf, skipping a lone wrapper', () => {
    // #wrap is the only drawn child of the root, so the chain starts below it
    expect(selectionChain(byId('r'), root)).toEqual([byId('a'), byId('r')]);
    expect(selectionChain(byId('t'), root)).toEqual([byId('t')]);
  });

  it('should treat a text run as part of its text element', () => {
    expect(selectionChain(byId('s'), root)).toEqual([byId('t')]);
  });

  it('should return an empty chain for an element outside the root', () => {
    const stray = document.createElement('div');
    expect(selectionChain(stray, root)).toEqual([]);
  });

  it('should walk one level deeper with each click, then wrap to the top', () => {
    const chain = selectionChain(byId('r'), root);
    expect(nextInChain(chain, null)).toBe(byId('a'));
    expect(nextInChain(chain, byId('a'))).toBe(byId('r'));
    expect(nextInChain(chain, byId('r'))).toBe(byId('a'));
  });

  it('should stay at the current level when a sibling is clicked', () => {
    // the circle is selected; a click on its sibling rect picks the rect, not the group
    expect(nextInChain(selectionChain(byId('r'), root), byId('c'))).toBe(byId('r'));
    // the selection is elsewhere entirely: start from the top of the chain
    expect(nextInChain(selectionChain(byId('r'), root), byId('t'))).toBe(byId('a'));
    expect(nextInChain([], byId('t'))).toBeNull();
  });

  it('should resolve an element to its source ordinal by stamp, or by counting names', () => {
    const container = document.querySelector('.svg-container') as Element;
    const source = '<svg><rect/><rect/></svg>';
    container.innerHTML = '<svg><rect/><rect data-slick-src="7"/></svg>';
    const [first, second] = Array.from(container.querySelectorAll('rect'));
    expect(ordinalOf(second, container, source)).toBe(7);
    expect(ordinalOf(first, container, source)).toBe(1);
    expect(ordinalOf(document.createElement('div'), container, source)).toBeNull();
  });
});
