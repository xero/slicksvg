import { describe, it, expect } from 'vitest';
import { findElementAtCursor } from '../src/xray';

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
  <g id="outer">
    <g id="inner">
      <path id="p1" d="M0 0"/>
      <path id="p2" d="M1 1"></path>
    </g>
    <rect id="r1" width="1" height="1" />
  </g>
  <text id="t1">hi</text>
</svg>`;

// cursor placed at the first occurrence of `needle`, shifted by `offset`
const at = (needle: string, offset = 0) => findElementAtCursor(svg, svg.indexOf(needle) + offset);

describe('X-ray cursor-to-element lookup', () => {
  it('should resolve the root svg from inside its opening tag', () => {
    expect(findElementAtCursor(svg, 0)).toEqual({ tagName: 'svg', index: 0 });
    expect(at('viewBox', 2)).toEqual({ tagName: 'svg', index: 0 });
  });

  it('should resolve a group from inside its opening tag rather than its parent', () => {
    expect(at('id="outer"', 4)).toEqual({ tagName: 'g', index: 0 });
    expect(at('id="inner"', 4)).toEqual({ tagName: 'g', index: 1 });
  });

  it('should resolve the element right after its opening tag closes', () => {
    expect(at('<g id="inner">', '<g id="inner">'.length)).toEqual({ tagName: 'g', index: 1 });
  });

  it('should resolve self-closing elements, with or without a space before the slash', () => {
    expect(at('id="p1"', 4)).toEqual({ tagName: 'path', index: 0 });
    expect(at('id="r1"', 4)).toEqual({ tagName: 'rect', index: 0 });
  });

  it('should keep tracking the open-element stack after self-closing elements', () => {
    // whitespace before the rect follows a self-closing path and a closed inner group
    expect(at('<rect id="r1"', -2)).toEqual({ tagName: 'g', index: 0 });
    expect(at('<text id="t1"', -2)).toEqual({ tagName: 'svg', index: 0 });
  });

  it('should index repeated tag names in document order', () => {
    expect(at('id="p2"', 4)).toEqual({ tagName: 'path', index: 1 });
  });

  it('should resolve the enclosing element from whitespace and text between tags', () => {
    expect(at('<path id="p2"', -3)).toEqual({ tagName: 'g', index: 1 });
    expect(at('hi')).toEqual({ tagName: 'text', index: 0 });
  });

  it('should resolve the element a closing tag closes', () => {
    expect(at('</g>', 2)).toEqual({ tagName: 'g', index: 1 });
    expect(at('</g>', '</g>'.length)).toEqual({ tagName: 'g', index: 1 });
    expect(at('</path>', 3)).toEqual({ tagName: 'path', index: 1 });
    expect(at('</svg>', 1)).toEqual({ tagName: 'svg', index: 0 });
  });

  it('should fall back to the innermost unclosed element at the end of the document', () => {
    const partial = '<svg><g><path d="M0 0"/>\n  ';
    expect(findElementAtCursor(partial, partial.length)).toEqual({ tagName: 'g', index: 0 });
  });

  it('should return null when the cursor is outside any element', () => {
    expect(findElementAtCursor('', 0)).toBeNull();
    expect(findElementAtCursor('  \n', 1)).toBeNull();
    expect(findElementAtCursor(svg + '\n', svg.length + 1)).toBeNull();
  });

  it('should lowercase tag names so they match querySelectorAll', () => {
    const code = '<svg><clipPath id="c"><rect/></clipPath></svg>';
    expect(findElementAtCursor(code, code.indexOf('id="c"'))).toEqual({ tagName: 'clippath', index: 0 });
  });
});
