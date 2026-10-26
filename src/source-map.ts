// --- Source map: where each element of the SVG source lives in the text.
//
// The source text is the document and the preview is a rendering of it, so a
// change made anywhere else has to come out as the edit a person would have
// typed: `x="40"` becomes `x="65"` and nothing else moves. Everything here
// works on the raw text, so it keeps working while a document is half typed.

export interface Tag {
	kind: 'open' | 'close' | 'self';
	/** Lowercased, so it matches the preview DOM and querySelectorAll. */
	name: string;
	/** Offset of the "<". */
	start: number;
	/** Offset just past the ">". */
	end: number;
}

export interface StartTag {
	/** The element's position among all elements in source order. The same
	 * number a pre-order walk of the parsed document gives it, which is how a
	 * preview element is traced back to its tag. */
	ordinal: number;
	name: string;
	start: number;
	end: number;
	selfClosing: boolean;
}

export interface Attribute {
	name: string;
	value: string;
	/** Offset of the whitespace that precedes the name, relative to the tag. */
	start: number;
	/** Offset just past the value's closing quote, relative to the tag. */
	end: number;
	valueStart: number;
	valueEnd: number;
	quote: string;
}

export interface AttributeChange {
	name: string;
	/** Null removes the attribute. */
	value: string | null;
}

/** A splice into the source, in the shape CodeMirror's `changes` accepts. */
export interface TextChange {
	from: number;
	to: number;
	insert: string;
}

/** Attribute stamped on every preview element with its source ordinal. */
export const SOURCE_ATTR = 'data-slick-src';

const NAME = /[A-Za-z_][\w.:-]*/y;

/** Offset just past the ">" that closes the tag starting at `i`, or -1 when
 * the tag is unterminated. A quoted attribute value may contain ">". */
function endOfTag(source: string, i: number): number {
	for (let j = i; j < source.length; j++) {
		const c = source[j];
		if (c === '"' || c === '\'') {
			const close = source.indexOf(c, j + 1);
			if (close === -1) return -1;
			j = close;
		} else if (c === '>') {
			return j + 1;
		}
	}
	return -1;
}

/**
 * Every element tag in source order. Comments, CDATA sections, processing
 * instructions and doctype declarations are skipped, as the XML parser skips
 * them, so a tag inside a comment never shifts which element is which.
 * Lenient: an unterminated tag ends the scan rather than failing it.
 */
export function scanTags(source: string): Tag[] {
	const tags: Tag[] = [];
	let i = 0;
	while ((i = source.indexOf('<', i)) !== -1) {
		if (source.startsWith('<!--', i)) {
			const close = source.indexOf('-->', i + 4);
			i = close === -1 ? source.length : close + 3;
			continue;
		}
		if (source.startsWith('<![CDATA[', i)) {
			const close = source.indexOf(']]>', i + 9);
			i = close === -1 ? source.length : close + 3;
			continue;
		}
		if (source.startsWith('<?', i) || source.startsWith('<!', i)) {
			const close = source.indexOf('>', i);
			i = close === -1 ? source.length : close + 1;
			continue;
		}
		const closing = source[i + 1] === '/';
		NAME.lastIndex = i + (closing ? 2 : 1);
		const name = NAME.exec(source)?.[0];
		if (name === undefined) {
			i += 1;
			continue;
		}
		const end = endOfTag(source, NAME.lastIndex);
		if (end === -1) break;
		const self = !closing && source[end - 2] === '/';
		tags.push({kind: closing ? 'close' : self ? 'self' : 'open', name: name.toLowerCase(), start: i, end});
		i = end;
	}
	return tags;
}

/** The start tag of every element, in source order, numbered by that order. */
export function startTags(source: string): StartTag[] {
	return scanTags(source)
		.filter(tag=>tag.kind !== 'close')
		.map((tag, ordinal)=>({ordinal, name: tag.name, start: tag.start, end: tag.end, selfClosing: tag.kind === 'self'}));
}

const ATTRIBUTE = /(\s+)([^\s=/>]+)\s*=\s*(["'])([\s\S]*?)\3/y;
const BARE = /\s+[^\s=/>]+(?=[\s/>])/y;

/** The attributes written in a start tag, with where each one sits in it. */
export function attributesOf(source: string, tag: StartTag): Attribute[] {
	const text = source.slice(tag.start, tag.end);
	const attrs: Attribute[] = [];
	NAME.lastIndex = 1;
	NAME.exec(text);
	let i = NAME.lastIndex;
	for (;;) {
		ATTRIBUTE.lastIndex = i;
		const m = ATTRIBUTE.exec(text);
		if (m) {
			const [whole, space, name, quote, value] = m;
			const valueEnd = m.index + whole.length - 1;
			attrs.push({name, value, start: m.index, end: m.index + whole.length, valueStart: valueEnd - value.length, valueEnd, quote});
			i = ATTRIBUTE.lastIndex;
			if (space === '') break;
			continue;
		}
		BARE.lastIndex = i;
		if (BARE.exec(text) === null) break;
		i = BARE.lastIndex;
	}
	return attrs;
}

/** The value of an attribute written in a start tag, or null when it is absent. */
export function readAttribute(source: string, tag: StartTag, name: string): string | null {
	return attributesOf(source, tag).find(attr=>attr.name === name)?.value ?? null;
}

function escapeValue(value: string, quote: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(new RegExp(quote, 'g'), quote === '"' ? '&quot;' : '&apos;');
}

/**
 * Attribute changes as splices into one start tag. An attribute the tag has
 * is rewritten in place, in its own quotes; one it lacks is added before the
 * tag closes; a null value removes one together with the space before it.
 * Nothing outside the start tag moves, so the rest of the document keeps the
 * formatting it had.
 */
export function planAttributeEdits(source: string, tag: StartTag, changes: AttributeChange[]): TextChange[] {
	const attrs = attributesOf(source, tag);
	const edits: TextChange[] = [];
	const added: string[] = [];
	for (const {name, value} of changes) {
		const existing = attrs.find(attr=>attr.name === name);
		if (existing) {
			if (value === null) {
				edits.push({from: tag.start + existing.start, to: tag.start + existing.end, insert: ''});
			} else if (value !== existing.value) {
				edits.push({from: tag.start + existing.valueStart, to: tag.start + existing.valueEnd, insert: escapeValue(value, existing.quote)});
			}
		} else if (value !== null) {
			added.push(`${name}="${escapeValue(value, '"')}"`);
		}
	}
	if (added.length > 0) {
		const at = tag.end - (tag.selfClosing ? 2 : 1);
		const spaced = /\s/.test(source[at - 1]);
		edits.push({from: at, to: at, insert: spaced ? `${added.join(' ')} ` : ` ${added.join(' ')}`});
	}
	return edits.sort((a, b)=>a.from - b.from);
}

/** `source` with `changes` applied, for callers without an editor. */
export function applyChanges(source: string, changes: TextChange[]): string {
	let out = source;
	for (const change of [...changes].sort((a, b)=>b.from - a.from)) {
		out = out.slice(0, change.from) + change.insert + out.slice(change.to);
	}
	return out;
}

/**
 * The source re-serialized with every element stamped with its ordinal, so a
 * preview element can be traced to the tag that produced it. Null when the
 * source is not well-formed XML, or when the parser and the scanner disagree
 * about the elements: the preview then renders the raw source and elements
 * are found by counting tag names instead.
 */
export function stampSource(source: string): string | null {
	const parsed = parseSource(source);
	if (!parsed) return null;
	for (const [i, el] of parsed.elements.entries()) el.setAttribute(SOURCE_ATTR, String(i));
	return new XMLSerializer().serializeToString(parsed.doc);
}

/**
 * The source parsed as XML, with its elements in source order: the same
 * order the tag scanner numbers them, so `elements[ordinal]` is the element
 * behind a start tag or a stamped preview element. Null when the source does
 * not parse or the parser and the scanner disagree about the elements.
 */
export function parseSource(source: string): {doc: Document; elements: Element[]} | null {
	const doc = new DOMParser().parseFromString(source, 'image/svg+xml');
	if (doc.getElementsByTagName('parsererror').length > 0) return null;
	const tags = startTags(source);
	const elements: Element[] = [];
	const walk = (el: Element): void=>{
		elements.push(el);
		for (const child of Array.from(el.children)) walk(child);
	};
	walk(doc.documentElement);
	if (elements.length !== tags.length) return null;
	if (elements.some((el, i)=>el.tagName.toLowerCase() !== tags[i].name)) return null;
	return {doc, elements};
}

/**
 * The whole extent of the element at `ordinal`: from its start tag to the
 * end of its closing tag, or of the tag itself when it is self-closing. Null
 * when no closing tag balances it.
 */
export function elementExtent(source: string, ordinal: number): {start: number; end: number} | null {
	const open: {ordinal: number; name: string; start: number}[] = [];
	let count = 0;
	for (const tag of scanTags(source)) {
		if (tag.kind === 'close') {
			for (let i = open.length - 1; i >= 0; i--) {
				if (open[i].name !== tag.name) continue;
				// closes this element, and anything left open inside it
				const [closed] = open.splice(i);
				if (closed.ordinal === ordinal) return {start: closed.start, end: tag.end};
				break;
			}
			continue;
		}
		const current = {ordinal: count, name: tag.name, start: tag.start};
		count += 1;
		if (tag.kind === 'self') {
			if (current.ordinal === ordinal) return {start: tag.start, end: tag.end};
			continue;
		}
		open.push(current);
	}
	return null;
}

/** The cut that removes the element at `ordinal`: the element itself, or the
 * whole line when it has the line to itself. */
export function removalRange(source: string, ordinal: number): TextChange | null {
	const extent = elementExtent(source, ordinal);
	if (!extent) return null;
	const lineStart = source.lastIndexOf('\n', extent.start - 1) + 1;
	const nextBreak = source.indexOf('\n', extent.end);
	const lineEnd = nextBreak === -1 ? source.length : nextBreak;
	const alone = /^\s*$/.test(source.slice(lineStart, extent.start)) && /^\s*$/.test(source.slice(extent.end, lineEnd));
	return alone
		? {from: lineStart, to: nextBreak === -1 ? lineEnd : nextBreak + 1, insert: ''}
		: {from: extent.start, to: extent.end, insert: ''};
}
