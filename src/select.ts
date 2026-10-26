// --- Selection: which preview element a click picks, and how it maps back to
// the source. Pure DOM helpers; the overlay and the events live in app.ts.
import {SOURCE_ATTR, startTags} from './source-map';

export type Point = {x: number; y: number};

/** Elements that draw nothing on their own: definitions, metadata, and the like. */
const NON_GRAPHICAL = /^(defs|desc|title|metadata|style|script|lineargradient|radialgradient|pattern|clippath|mask|marker|symbol|filter|fe\w+|stop|animate\w*|set|mpath|font\w*|glyph\w*|missing-glyph|hkern|vkern|view|cursor)$/i;

export function isGraphical(el: Element): boolean {
	return !NON_GRAPHICAL.test(el.tagName);
}

/** The drawn element under an event target, or null when the press landed on
 * the root <svg> itself or outside the drawing. */
export function findSvgTarget(target: EventTarget | null, root: SVGSVGElement): Element | null {
	let el: Element | null = target instanceof Element && root.contains(target) ? target : null;
	while (el && el !== root) {
		if (el instanceof SVGElement && el.tagName.toLowerCase() !== 'svg') return el;
		el = el.parentElement;
	}
	return null;
}

/**
 * What clicks at a point can select, top-level item first and the leaf last:
 * one level deeper with each click on the selection, the way a drawing
 * program walks from a group into its parts. A text run belongs to its text
 * element, and a wrapper with a single drawn child is skipped, since the
 * child is all there is to see.
 */
export function selectionChain(leaf: Element, root: Element): Element[] {
	let el: Element | null = leaf;
	while (el && el !== root && /^(tspan|textpath)$/i.test(el.tagName)) el = el.parentElement;
	const chain: Element[] = [];
	for (; el && el !== root; el = el.parentElement) chain.unshift(el);
	if (el !== root) return [];
	while (chain.length > 1 && Array.from(chain[0].parentElement?.children ?? []).filter(isGraphical).length === 1) {
		chain.shift();
	}
	return chain;
}

/** The element the next click picks: the top of the chain when nothing is
 * selected, the next level down when the selection is in the chain, and the
 * sibling at the same level when the selection sits beside the chain. */
export function nextInChain(chain: Element[], current: Element | null): Element | null {
	if (chain.length === 0) return null;
	if (!current) return chain[0];
	const at = chain.indexOf(current);
	if (at >= 0) return chain[(at + 1) % chain.length];
	const parentAt = current.parentElement ? chain.indexOf(current.parentElement) : -1;
	return (parentAt >= 0 ? chain.at(parentAt + 1) : undefined) ?? chain[0];
}

/** The source ordinal of a preview element: its stamp when the source
 * parsed, else its place among same-named elements matched against the tag
 * scanner, which is how x-ray finds elements too. */
export function ordinalOf(el: Element, container: Element, source: string): number | null {
	const stamp = el.getAttribute(SOURCE_ATTR);
	if (stamp !== null) return Number(stamp);
	const name = el.tagName.toLowerCase();
	const index = Array.from(container.querySelectorAll(name)).indexOf(el);
	if (index < 0) return null;
	return startTags(source).filter(tag=>tag.name === name).at(index)?.ordinal ?? null;
}

/** The element's bounding box as four corners in `origin`'s pixel space, so
 * a rotated element gets a rotated box. Null when there is no box to show. */
export function boxCorners(el: Element, origin: Element): Point[] | null {
	if (!(el instanceof SVGGraphicsElement)) return null;
	let bb: DOMRect;
	try {
		bb = el.getBBox();
	} catch {
		return null;
	}
	const ctm = el.getScreenCTM();
	if (!ctm) return null;
	const o = origin.getBoundingClientRect();
	const corners = [[bb.x, bb.y], [bb.x + bb.width, bb.y], [bb.x + bb.width, bb.y + bb.height], [bb.x, bb.y + bb.height]];
	return corners.map(([x, y])=>{
		const p = new DOMPoint(x, y).matrixTransform(ctm);
		return {x: p.x - o.left, y: p.y - o.top};
	});
}
