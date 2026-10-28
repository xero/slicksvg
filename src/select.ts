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

/** The cursor for a resize handle: a two-headed arrow pointing the way the
 * handle pulls on screen, taken along the element's own axes. A corner of a
 * wide element still gets a diagonal, and the handles of a rotated element
 * point the way they face rather than the way their names say. */
export function handleCursor(handle: string, corners: Point[]): string {
	const [nw, ne, , sw] = corners;
	const unit = (p: Point, q: Point): Point=>{
		const d = Math.hypot(q.x - p.x, q.y - p.y);
		return d > 0 ? {x: (q.x - p.x) / d, y: (q.y - p.y) / d} : {x: 0, y: 0};
	};
	const across = unit(nw, ne);
	const down = unit(nw, sw);
	const x = (handle.includes('e') ? 1 : 0) - (handle.includes('w') ? 1 : 0);
	const y = (handle.includes('s') ? 1 : 0) - (handle.includes('n') ? 1 : 0);
	const dir = {x: across.x * x + down.x * y, y: across.y * x + down.y * y};
	const deg = ((Math.atan2(dir.y, dir.x) * 180) / Math.PI + 360) % 180;
	if (deg < 22.5 || deg >= 157.5) return 'ew-resize';
	if (deg < 67.5) return 'nwse-resize';
	if (deg < 112.5) return 'ns-resize';
	return 'nesw-resize';
}
