// --- X-ray mode: map a cursor offset in the SVG source to the element it sits in
import {scanTags} from './source-map';

export type ElementRef = {
	tagName: string;
	/** Position among same-named elements in document order, matching
	 * `querySelectorAll(tagName)` on the rendered preview. */
	index: number;
	/** Position among all elements in source order, matching the stamp the
	 * source map puts on each preview element. */
	ordinal: number;
};

/**
 * Walks the tags in `svgCode` and returns the element that contains
 * `cursorPos`: the element whose opening, self-closing, or closing tag spans
 * the cursor, or the innermost open element when the cursor sits in text
 * between tags. Lenient on purpose: it keeps working while the document is
 * being typed and its tags do not yet balance.
 */
export function findElementAtCursor(svgCode: string, cursorPos: number): ElementRef | null {
	const stack: ElementRef[] = [];
	const tagCounts = new Map<string, number>();
	let ordinal = 0;

	for (const tag of scanTags(svgCode)) {
		// cursor sits in content before this tag: the enclosing element is the stack top
		if (tag.start > cursorPos) break;

		if (tag.kind === 'close') {
			let closed: ElementRef | null = null;
			for (let i = stack.length - 1; i >= 0; i--) {
				if (stack[i].tagName === tag.name) {
					closed = stack.splice(i, 1)[0];
					break;
				}
			}
			// cursor inside the closing tag: the element it closes
			if (cursorPos <= tag.end) return closed;
			continue;
		}

		const index = tagCounts.get(tag.name) ?? 0;
		tagCounts.set(tag.name, index + 1);
		const element = {tagName: tag.name, index, ordinal};
		ordinal += 1;
		// cursor inside the opening or self-closing tag: that element
		if (cursorPos <= tag.end) return element;
		if (tag.kind === 'open') stack.push(element);
	}

	return stack.length > 0 ? stack[stack.length - 1] : null;
}
