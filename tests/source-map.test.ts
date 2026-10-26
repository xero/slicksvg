import { describe, it, expect } from 'vitest';
import {
  scanTags, startTags, attributesOf, readAttribute, planAttributeEdits, applyChanges, stampSource, SOURCE_ATTR,
} from '../src/source-map';

const root = (source: string) => startTags(source)[0];

describe('Source map tag scanner', () => {
  it('should list open, self-closing, and closing tags in order', () => {
    const tags = scanTags('<svg><g><rect/><path d="M0 0" /></g></svg>');
    expect(tags.map(t => `${t.kind}:${t.name}`)).toEqual([
      'open:svg', 'open:g', 'self:rect', 'self:path', 'close:g', 'close:svg',
    ]);
  });

  it('should record where each tag starts and ends', () => {
    const source = '<svg><rect x="1"/></svg>';
    const [svg, rect] = scanTags(source);
    expect(source.slice(svg.start, svg.end)).toBe('<svg>');
    expect(source.slice(rect.start, rect.end)).toBe('<rect x="1"/>');
  });

  it('should skip tags inside comments, CDATA, and processing instructions', () => {
    const source = '<?xml version="1.0"?>\n<!DOCTYPE svg>\n<svg><!-- <rect/> --><style><![CDATA[ a > b { } ]]></style><circle/></svg>';
    expect(scanTags(source).map(t => `${t.kind}:${t.name}`)).toEqual([
      'open:svg', 'open:style', 'close:style', 'self:circle', 'close:svg',
    ]);
  });

  it('should let a quoted attribute value contain ">"', () => {
    const [, path] = scanTags('<svg><path d="M0 0 L1 1" data-note="a > b"/></svg>');
    expect(path.kind).toBe('self');
    expect(path.end).toBe('<svg><path d="M0 0 L1 1" data-note="a > b"/>'.length);
  });

  it('should end the scan at a tag left unterminated while typing', () => {
    expect(scanTags('<svg><rect x="1').map(t => t.name)).toEqual(['svg']);
    expect(scanTags('<svg><rect x="1" ').map(t => t.name)).toEqual(['svg']);
    // a stray "<" inside a tag is swallowed up to the next ">", as a browser would
    expect(scanTags('<svg><rect x="1" <circle/></svg>').map(t => `${t.kind}:${t.name}`)).toEqual(['open:svg', 'self:rect', 'close:svg']);
  });

  it('should keep namespaced and camelCase names, lowercased', () => {
    expect(scanTags('<svg><sodipodi:namedview/><clipPath/></svg>').map(t => t.name)).toEqual(['svg', 'sodipodi:namedview', 'clippath', 'svg']);
  });

  it('should number start tags by source order', () => {
    const tags = startTags('<svg><g><rect/></g><circle/></svg>');
    expect(tags.map(t => [t.ordinal, t.name, t.selfClosing])).toEqual([
      [0, 'svg', false], [1, 'g', false], [2, 'rect', true], [3, 'circle', true],
    ]);
  });
});

describe('Source map attributes', () => {
  it('should read attributes in either quote style', () => {
    const source = `<svg width="10" height='20'/>`;
    expect(readAttribute(source, root(source), 'width')).toBe('10');
    expect(readAttribute(source, root(source), 'height')).toBe('20');
    expect(readAttribute(source, root(source), 'viewBox')).toBeNull();
  });

  it('should not find an attribute name inside another value', () => {
    const source = '<svg data-note="width=5"/>';
    expect(readAttribute(source, root(source), 'width')).toBeNull();
    expect(attributesOf(source, root(source)).map(a => a.name)).toEqual(['data-note']);
  });

  it('should rewrite an existing attribute in place, keeping its quotes', () => {
    const source = `<svg width='10' height="20">\n  <rect width="5"/>\n</svg>`;
    const edits = planAttributeEdits(source, root(source), [{ name: 'width', value: '30' }]);
    expect(applyChanges(source, edits)).toBe(`<svg width='30' height="20">\n  <rect width="5"/>\n</svg>`);
  });

  it('should add a missing attribute before the tag closes', () => {
    const open = '<svg width="10">\n</svg>';
    expect(applyChanges(open, planAttributeEdits(open, root(open), [{ name: 'transform', value: 'rotate(90)' }])))
      .toBe('<svg width="10" transform="rotate(90)">\n</svg>');
    const self = '<rect x="1"/>';
    expect(applyChanges(self, planAttributeEdits(self, root(self), [{ name: 'y', value: '2' }])))
      .toBe('<rect x="1" y="2"/>');
    const spaced = '<rect x="1" />';
    expect(applyChanges(spaced, planAttributeEdits(spaced, root(spaced), [{ name: 'y', value: '2' }])))
      .toBe('<rect x="1" y="2" />');
  });

  it('should add several new attributes in one insertion', () => {
    const source = '<svg>\n</svg>';
    const edits = planAttributeEdits(source, root(source), [
      { name: 'width', value: '300' }, { name: 'height', value: '400' }, { name: 'viewBox', value: '0 0 300 400' },
    ]);
    expect(edits).toHaveLength(1);
    expect(applyChanges(source, edits)).toBe('<svg width="300" height="400" viewBox="0 0 300 400">\n</svg>');
  });

  it('should remove an attribute together with the space before it', () => {
    const source = '<svg width="10" transform="rotate(90)" height="20"/>';
    const edits = planAttributeEdits(source, root(source), [{ name: 'transform', value: null }]);
    expect(applyChanges(source, edits)).toBe('<svg width="10" height="20"/>');
    expect(planAttributeEdits(source, root(source), [{ name: 'viewBox', value: null }])).toEqual([]);
  });

  it('should leave an attribute alone when the value is unchanged', () => {
    const source = '<svg width="10"/>';
    expect(planAttributeEdits(source, root(source), [{ name: 'width', value: '10' }])).toEqual([]);
  });

  it('should escape a value so the tag still parses', () => {
    const source = '<text data-label="a"/>';
    const edits = planAttributeEdits(source, root(source), [{ name: 'data-label', value: 'say "hi" & <go>' }]);
    expect(applyChanges(source, edits)).toBe('<text data-label="say &quot;hi&quot; &amp; &lt;go>"/>');
  });

  it('should edit the tag it is given and no other', () => {
    const source = '<svg width="10"><rect width="5"/></svg>';
    const rect = startTags(source)[1];
    expect(applyChanges(source, planAttributeEdits(source, rect, [{ name: 'width', value: '6' }])))
      .toBe('<svg width="10"><rect width="6"/></svg>');
  });
});

describe('Source map preview stamping', () => {
  it('should stamp every element with its ordinal', () => {
    const stamped = stampSource('<svg xmlns="http://www.w3.org/2000/svg"><g><rect/></g><circle/></svg>');
    expect(stamped).not.toBeNull();
    const doc = new DOMParser().parseFromString(stamped as string, 'image/svg+xml');
    const stamps = Array.from(doc.querySelectorAll(`[${SOURCE_ATTR}]`)).map(el => `${el.tagName}=${el.getAttribute(SOURCE_ATTR)}`);
    expect(stamps).toEqual(['svg=0', 'g=1', 'rect=2', 'circle=3']);
  });

  it('should keep ordinals aligned with the scanner across comments', () => {
    const source = '<svg xmlns="http://www.w3.org/2000/svg"><!-- <rect/> --><circle/></svg>';
    const doc = new DOMParser().parseFromString(stampSource(source) as string, 'image/svg+xml');
    expect(doc.querySelector('circle')?.getAttribute(SOURCE_ATTR)).toBe('1');
    expect(startTags(source)[1].name).toBe('circle');
  });

  it('should return null for source that is not well-formed XML', () => {
    expect(stampSource('<svg><rect></svg>')).toBeNull();
    expect(stampSource('not svg at all')).toBeNull();
  });
});
