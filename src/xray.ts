// --- X-ray mode: map a cursor offset in the SVG source to the element it sits in
export type ElementRef = {tagName: string; index: number};

/**
 * Walks the tags in `svgCode` and returns the element that contains `cursorPos`:
 * the element whose opening, self-closing, or closing tag spans the cursor, or
 * the innermost open element when the cursor sits in text between tags.
 * `index` is the element's position among same-named elements in document
 * order, matching `querySelectorAll(tagName)` on the rendered preview.
 */
export function findElementAtCursor(svgCode: string, cursorPos: number): ElementRef | null {
	// lazy attribute match so a trailing "/" is seen by the self-closing group
	const tagRegex = /<(\/?)(\w+)(?:\s[^>]*?)?\s*(\/?)>/g;
	const stack: ElementRef[] = [];
	const tagCounts = new Map<string, number>();
	let match: RegExpExecArray | null;

	while ((match = tagRegex.exec(svgCode)) !== null) {
		const isClosing = !!match[1];
		const tagName = match[2].toLowerCase();
		const isSelfClosing = !!match[3];
		const matchStart = match.index;
		const matchEnd = tagRegex.lastIndex;

		// cursor sits in content before this tag: the enclosing element is the stack top
		if (matchStart > cursorPos) break;

		if (isClosing) {
			let closed: ElementRef | null = null;
			for (let i = stack.length - 1; i >= 0; i--) {
				if (stack[i].tagName === tagName) {
					closed = stack.splice(i, 1)[0];
					break;
				}
			}
			// cursor inside the closing tag: the element it closes
			if (cursorPos <= matchEnd) return closed;
			continue;
		}

		const index = tagCounts.get(tagName) ?? 0;
		tagCounts.set(tagName, index + 1);
		const element = {tagName, index};
		// cursor inside the opening or self-closing tag: that element
		if (cursorPos <= matchEnd) return element;
		if (!isSelfClosing) stack.push(element);
	}

	return stack.length > 0 ? stack[stack.length - 1] : null;
}
