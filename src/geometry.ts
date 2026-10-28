// --- Geometry: moving, resizing, rotating and flipping an element by
// rewriting its attributes.
//
// Ported from editsvgcode by Nikolay Belykh (editsvgcode.com, MIT License)
// and extended with rotation and flipping. The preview shows the drawing and
// the source is the document, so a gesture has to come out as the edit a
// person would have typed: x="40" becomes x="65", a traced path's
// translate(364,94) becomes translate(389,94). Nothing is re-serialized, and
// nothing here touches the DOM's rendering APIs: the caller converts screen
// pixels into user units, and this module decides which attributes change
// and to what. The same plan is shown on the live preview while dragging and
// written to the source on release, so what was seen is what gets saved.
//
// Every function reads the SOURCE element, from a strict parse of the text,
// never the preview's copy, which carries highlights of its own.

/** An affine matrix in SVG's order: x' = a·x + c·y + e, y' = b·x + d·y + f. */
export interface Matrix {a: number; b: number; c: number; d: number; e: number; f: number}
export interface Point {x: number; y: number}
export interface Rect {x: number; y: number; width: number; height: number}

export const IDENTITY: Matrix = {a: 1, b: 0, c: 0, d: 1, e: 0, f: 0};

/** m·n: n applied first, then m. */
export function multiply(m: Matrix, n: Matrix): Matrix {
	return {
		a: m.a * n.a + m.c * n.b,
		b: m.b * n.a + m.d * n.b,
		c: m.a * n.c + m.c * n.d,
		d: m.b * n.c + m.d * n.d,
		e: m.a * n.e + m.c * n.f + m.e,
		f: m.b * n.e + m.d * n.f + m.f,
	};
}

export function invert(m: Matrix): Matrix | null {
	const det = m.a * m.d - m.b * m.c;
	if (!det || !Number.isFinite(det)) return null;
	return {
		a: m.d / det,
		b: -m.b / det,
		c: -m.c / det,
		d: m.a / det,
		e: (m.c * m.f - m.d * m.e) / det,
		f: (m.b * m.e - m.a * m.f) / det,
	};
}

export function applyToPoint(m: Matrix, x: number, y: number): Point {
	return {x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f};
}

/** A displacement through the matrix: the linear part only, no translation. */
export function applyToVector(m: Matrix, x: number, y: number): Point {
	return {x: m.a * x + m.c * y, y: m.b * x + m.d * y};
}

/** Screen pixels per user unit under a matrix, for picking how finely to round. */
export function pixelsPerUnit(m: Matrix): number {
	return Math.sqrt(Math.abs(m.a * m.d - m.b * m.c));
}

/**
 * Decimal places worth writing when one screen pixel spans `1 / pxPerUnit`
 * units: whole numbers until a unit is about three pixels wide, then one
 * place, two from about thirty. So 125% writes whole numbers, not cx="334.1";
 * a step of one unit there is still finer than a hand on a mouse is steady.
 */
export function decimalsFor(pxPerUnit: number): number {
	if (!(pxPerUnit > 0) || !Number.isFinite(pxPerUnit)) return 0;
	return Math.min(4, Math.max(0, Math.ceil(Math.log10(pxPerUnit) - 0.5)));
}

export function roundTo(n: number, decimals: number): number {
	const r = Number(n.toFixed(decimals));
	return Object.is(r, -0) ? 0 : r;
}

/** A number as an attribute value: no float noise, no trailing zeros, no "-0". */
export function fmt(n: number, decimals = 6): string {
	return String(roundTo(n, decimals));
}

/** Decimal places a number was written with. */
export function placesOf(n: number): number {
	const parts = String(n).toLowerCase().split('e');
	const fraction = parts[0].split('.').at(1) ?? '';
	return Math.max(0, fraction.length - Number(parts.at(1) ?? 0));
}

/**
 * `value + delta`, written as finely as the value was. A move should change a
 * coordinate by the distance moved and nothing else: a traced path's
 * `translate(121.31122970581055,…)` keeps its digits rather than being
 * rounded to six places by a drag that only shifted it by 5.
 */
export function shifted(value: number, delta: number): string {
	if (delta === 0) return String(value);
	return fmt(value + delta, Math.min(15, Math.max(6, placesOf(value))));
}

// ---------------------------------------------------------------------------
// The transform attribute
// ---------------------------------------------------------------------------

export interface TransformFn {
	name: 'matrix' | 'translate' | 'scale' | 'rotate' | 'skewX' | 'skewY';
	args: number[];
	/** Where this function sits in the attribute value, so one can be
	 * replaced without rewriting the others. */
	start: number;
	end: number;
}

const ARG_COUNTS: Record<TransformFn['name'], number[]> = {
	matrix: [6], translate: [1, 2], scale: [1, 2], rotate: [1, 3], skewX: [1], skewY: [1],
};

/** The functions in a transform attribute, or null when it does not parse: an
 * attribute this cannot read is one it must not rewrite. */
export function parseTransform(value: string): TransformFn[] | null {
	const out: TransformFn[] = [];
	const re = /\s*(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)\s*,?/y;
	let i = 0;
	while (i < value.length) {
		if (/^\s*$/.test(value.slice(i))) break;
		re.lastIndex = i;
		const m = re.exec(value);
		if (!m) return null;
		const name = m[1] as TransformFn['name'];
		const raw = m[2].trim();
		const args = raw === '' ? [] : raw.split(/\s*,\s*|\s+/).map(Number);
		if (args.some(n=>!Number.isFinite(n)) || !ARG_COUNTS[name].includes(args.length)) return null;
		const start = m.index + m[0].indexOf(m[1]);
		out.push({name, args, start, end: value.indexOf(')', start) + 1});
		i = re.lastIndex;
	}
	return out;
}

export function fnMatrix(fn: TransformFn): Matrix {
	const arg = (i: number): number | undefined=>fn.args.at(i);
	const p = arg(0) ?? 0;
	const q = arg(1);
	const r = arg(2);
	switch (fn.name) {
		case 'matrix': {
			const [a, b, c, d, e, f] = fn.args;
			return {a, b, c, d, e, f};
		}
		case 'translate': return {...IDENTITY, e: p, f: q ?? 0};
		case 'scale': return {...IDENTITY, a: p, d: q ?? p};
		case 'rotate': {
			const rad = (p * Math.PI) / 180;
			const cos = Math.cos(rad);
			const sin = Math.sin(rad);
			const rot = {a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0};
			if (q === undefined) return rot;
			const cx = q;
			const cy = r ?? 0;
			return multiply(multiply({...IDENTITY, e: cx, f: cy}, rot), {...IDENTITY, e: -cx, f: -cy});
		}
		case 'skewX': return {...IDENTITY, c: Math.tan((p * Math.PI) / 180)};
		case 'skewY': return {...IDENTITY, b: Math.tan((p * Math.PI) / 180)};
	}
}

export function listMatrix(list: TransformFn[]): Matrix {
	return list.reduce((m, fn)=>multiply(m, fnMatrix(fn)), IDENTITY);
}

/** Arguments joined the way the original function joined them, so a rewrite
 * of `translate(364,94)` stays comma-separated. */
function joinArgs(original: string, args: string[]): string {
	return args.join(original.includes(',') ? ',' : ' ');
}

/** A turn by `degrees` about a point. */
export function turnMatrix(degrees: number, c: Point): Matrix {
	return fnMatrix({name: 'rotate', args: [degrees, c.x, c.y], start: 0, end: 0});
}

// ---------------------------------------------------------------------------
// A transform in its simplest form
// ---------------------------------------------------------------------------

/** The parts of a transform in its simplest form, in the order they are written. */
const SIMPLE_PARTS: TransformFn['name'][] = ['translate', 'rotate', 'scale'];

/** Whether a transform is written in its simplest form's parts, in their order. */
const isSimple = (list: TransformFn[]): boolean=>list.every((fn, i)=>{
	const at = SIMPLE_PARTS.indexOf(fn.name);
	return at >= 0 && (i === 0 || at > SIMPLE_PARTS.indexOf(list[i - 1].name));
});

export interface SimplestRequest {
	/** The element's box in its own units. It turns about the middle, and the
	 * size says how finely a turn or a scale must be written; without it they
	 * are written finely enough for a large one. */
	box: Rect | null;
	/** The transform it had, whose numbers are kept where they still hold. */
	was: TransformFn[];
	/** Places a shift is written to, in the parent's units. */
	decimals: number;
	/** The point in the parent's units an edit turned the element about. */
	pivot?: Point;
	/** Whether the arguments are written with commas. */
	comma?: boolean;
}

/**
 * Write `m`, which takes an element's own units to its parent's, as simply
 * as it can be written: a translate, a rotate, and a scale, each only when
 * it does something, a mirror being a scale below nothing along one axis.
 * The rotate is about the point the edit turned it about, or the one it was
 * about before, or else the middle of the element as its scale leaves it,
 * and the translate is then how far that has moved. A slant with a lean in
 * it, which those three cannot say, is one matrix. Null when `m` flattens
 * the element, which has no such form.
 *
 * Each part is written finely enough that it puts the element's box out by
 * no more than half a unit of a shift's last place. A part that is still
 * what it was keeps the number it was written with, and a translate that
 * moved keeps the digits it had, so a move changes the translate alone.
 */
export function simplestTransform(m: Matrix, req: SimplestRequest): string | null {
	const det = m.a * m.d - m.b * m.c;
	if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
	const {box, was, decimals, pivot} = req;
	const sep = req.comma ? ',' : ' ';
	const tolerance = 0.5 * 10 ** -decimals;
	const middle = box ? {x: box.x + box.width / 2, y: box.y + box.height / 2} : {x: 0, y: 0};
	// a box with no size, as one not drawn gives, says nothing of how finely to write the parts
	const sized = box && (box.width > 0 || box.height > 0) ? box : null;
	const radius = sized ? Math.hypot(sized.width, sized.height) / 2 : 1000;
	// places enough that a unit of the last one moves the box by no more than the tolerance
	const placesFor = (reach: number): number=>reach <= 0 ? 0 : Math.min(12, Math.max(0, Math.ceil(decimals + Math.log10(reach) - 1e-9)));
	// what it had, part by part, when it was written this way
	const simple = isSimple(was);
	const had = (name: TransformFn['name']): number[] | undefined=>simple ? was.find(fn=>fn.name === name)?.args ?? [] : undefined;
	const [oldShift, oldTurn, oldScale] = [had('translate'), had('rotate'), had('scale')];
	// the slant as a turn, then a lean, then a scale along each axis: R(θ)·[[sx, h], [0, sy]]
	let sx = Math.hypot(m.a, m.b);
	let theta = (Math.atan2(m.b, m.a) * 180) / Math.PI;
	let sy = det / sx;
	let lean = (m.a * m.c + m.b * m.d) / sx;
	// a mirror is a scale below nothing along x rather than y when that leaves less of a turn,
	// and a scale below nothing along both stays one when it was and leaves less of a turn;
	// within a rounding of a quarter turn either way leaves as much, so it stays as it was
	// written, and rounding never tips it from one to the other
	const [wasX, wasY] = [oldScale?.at(0) ?? 1, oldScale?.at(-1) ?? 1];
	const band = 0.5 * 10 ** -placesFor((radius * Math.max(Math.abs(sx), Math.abs(sy)) * Math.PI) / 180) + 1e-9;
	const quarter = Math.abs(Math.abs(theta) - 90) <= band;
	const flipped = det < 0
		? (wasX * wasY < 0 && quarter ? wasX < 0 : Math.abs(theta) > 90)
		: wasX < 0 && wasY < 0 && (quarter || Math.abs(theta) > 90);
	if (flipped) {
		theta += theta > 0 ? -180 : 180;
		[sx, sy, lean] = [-sx, -sy, -lean];
	}
	if (theta <= -180) theta += 360;
	// a matrix that leans by barely enough to be one stays one, though rounding it as it was written leaned it a little less
	const leaning = was.length === 1 && was[0].name === 'matrix' ? 0.9 * tolerance : tolerance;
	if (Math.abs(lean) * radius > leaning) {
		// as far from the origin as the box reaches, the slant is still in place
		const far = sized ? Math.max(...[[sized.x, sized.y], [sized.x + sized.width, sized.y + sized.height], [sized.x, sized.y + sized.height], [sized.x + sized.width, sized.y]].map(([x, y])=>Math.hypot(x, y))) : radius;
		const slant = [m.a, m.b, m.c, m.d].map(n=>String(roundTo(n, Math.max(6, placesFor(far)))));
		return `matrix(${[...slant, fmt(m.e, decimals), fmt(m.f, decimals)].join(sep)})`;
	}

	const keep = (now: number, then: number | undefined, places: number): number=>then !== undefined && Math.abs(now - then) <= 0.5 * 10 ** -places ? then : roundTo(now, places);
	// a scale keeps three figures, so that a small element is never scaled to nothing
	const scalePlaces = (k: number): number=>Math.max(placesFor(radius), Math.min(12, 2 - Math.floor(Math.log10(Math.abs(k)))));
	const sxw = keep(sx, oldScale && (oldScale.at(0) ?? 1), scalePlaces(sx));
	const syw = keep(sy, oldScale && (oldScale.at(-1) ?? 1), scalePlaces(sy));
	// a turn that is the one it had, the whole way round from it or not, is written as it was
	const turnPlaces = placesFor((radius * Math.max(Math.abs(sxw), Math.abs(syw)) * Math.PI) / 180);
	const thenTurn = oldTurn && (oldTurn.at(0) ?? 0);
	const turn = thenTurn !== undefined && Math.abs(((theta - thenTurn) % 360 + 540) % 360 - 180) <= 0.5 * 10 ** -turnPlaces ? thenTurn : roundTo(theta, turnPlaces);
	const scaled = (p: Point): Point=>({x: p.x * sxw, y: p.y * syw});

	// the shift that puts the middle where `m` puts it, after the scale and a turn about `q`
	const [cos, sin] = [Math.cos((turn * Math.PI) / 180), Math.sin((turn * Math.PI) / 180)];
	const s = scaled(middle);
	const there = applyToPoint(m, middle.x, middle.y);
	const shiftFor = (q: Point): Point=>({
		x: there.x - (q.x + cos * (s.x - q.x) - sin * (s.y - q.y)),
		y: there.y - (q.y + sin * (s.x - q.x) + cos * (s.y - q.y)),
	});

	// the point it turns about, where the scale has put it: the first of the
	// one it had, the one the edit turned it about, and its middle that
	// needs no translate, or else the one it had, or its middle. An edit that
	// leaves the turn as it was keeps the point too, even where a move
	// happens to need no translate about the middle.
	let about = {x: 0, y: 0};
	if (turn % 360 !== 0) {
		const aboutPlaces = Math.max(2, decimals + 1);
		const round = (p: Point): Point=>({x: roundTo(p.x, aboutPlaces), y: roundTo(p.y, aboutPlaces)});
		const inverse = invert(m);
		const then = oldTurn && oldTurn.length > 0 ? {x: oldTurn.at(1) ?? 0, y: oldTurn.at(2) ?? 0} : null;
		const fromPivot = pivot && inverse ? round(scaled(applyToPoint(inverse, pivot.x, pivot.y))) : null;
		const own = box ? round(scaled(middle)) : null;
		const still = (q: Point | null): q is Point=>q !== null && ((t)=>Math.abs(t.x) < tolerance && Math.abs(t.y) < tolerance)(shiftFor(q));
		// a middle that needs a translate anyway is near enough to a hundredth of the element's size
		const roughly = (p: Point): Point=>((places)=>({x: roundTo(p.x, places), y: roundTo(p.y, places)}))(Math.min(aboutPlaces, Math.max(0, Math.ceil(-Math.log10(radius / 100)))));
		const kept = then && turn === thenTurn;
		about = (kept ? [then, fromPivot] : [then, fromPivot, own]).find(still) ?? then ?? (box ? roughly(scaled(middle)) : null) ?? fromPivot ?? about;
	}

	const shift = (now: number, then: number | undefined): string=>then === undefined ? fmt(now, decimals) : shifted(then, roundTo(now - then, decimals));
	const moved = shiftFor(about);
	const tx = shift(moved.x, oldShift && (oldShift.at(0) ?? 0));
	const ty = shift(moved.y, oldShift && (oldShift.at(1) ?? 0));

	const parts: string[] = [];
	if (Number(tx) !== 0 || Number(ty) !== 0) parts.push(oldShift?.length === 1 && Number(ty) === 0 ? `translate(${tx})` : `translate(${tx}${sep}${ty})`);
	if (turn % 360 !== 0) parts.push(about.x === 0 && about.y === 0 && oldTurn?.length !== 3 ? `rotate(${turn})` : `rotate(${[turn, about.x, about.y].join(sep)})`);
	if (sxw !== 1 || syw !== 1) parts.push(sxw === syw ? `scale(${sxw})` : `scale(${sxw}${sep}${syw})`);
	return parts.join(' ');
}

/** Whether a transform's arguments are written with commas between them. */
export const commaIn = (value: string): boolean=>/\d\s*,\s*[-+.\d]/.test(value);

/** The change to the transform attribute that writes `text`, or none when it
 * is what is there already. */
function transformChange(el: Element, text: string): EditPlan {
	const value = (el.getAttribute('transform') ?? '').trim();
	if (text === value) return {ok: true, attrs: {}};
	return {ok: true, attrs: {transform: text || null}};
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

export type EditPlan =
	| {ok: true; attrs: Record<string, string | null>}
	| {ok: false; reason: string};

const NUMBER = /^\s*[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?\s*(?:px)?\s*$/i;
const NUMBER_LIST = /^\s*[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?(?:(?:\s*,\s*|\s+)[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)*\s*$/i;

const CSS_POSITIONED = 'This element is positioned by CSS, so it cannot be moved or resized here. Change its style in the code instead.';
const ORIGIN_SET = 'This element sets its own transform origin, so it cannot be resized or rotated here. Change it in the code instead.';
const ANIMATED = 'This element is animated, so it cannot be moved or resized here.';
const NESTED_SVG = 'A nested <svg> cannot be resized here. Change its width and height in the code instead.';
const UNREADABLE_TRANSFORM = 'This element\'s transform could not be read, so it cannot be moved or resized here.';

function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** CSS selectors in the document's own <style> blocks that set `property` on
 * any of `elements`: rules that will beat a presentation attribute. */
export function cssRulesOverriding(doc: Document, elements: Element[], property: string): string[] {
	const css = Array.from(doc.getElementsByTagName('style')).map(s=>s.textContent).join('\n');
	if (!css.trim()) return [];
	const hits: string[] = [];
	for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
		const selectorText = m[1].trim();
		const body = m[2];
		if (!new RegExp(`(^|[;\\s])${escapeRegExp(property)}\\s*:`).test(body)) continue;
		for (const one of selectorText.split(',').map(x=>x.trim()).filter(Boolean)) {
			let matches: boolean;
			try {
				matches = elements.some(el=>el.matches(one));
			} catch {
				continue; // a selector this engine cannot parse tells us nothing
			}
			if (matches && !hits.includes(one)) hits.push(one);
		}
	}
	return hits;
}

/** Does CSS, the element's own style or a rule in the document, set this property? */
export function cssSets(el: Element, property: string): boolean {
	const style = el.getAttribute('style');
	if (style && new RegExp(`(^|;)\\s*${property}\\s*:`, 'i').test(style)) return true;
	return cssRulesOverriding(el.ownerDocument, [el], property).length > 0;
}

/**
 * Why this element cannot be moved, or null. A CSS transform replaces the
 * attribute outright, so an edit would not land where the user put it.
 * Animation would take the attribute back on its next frame.
 */
function blockedReason(el: Element): string | null {
	if (cssSets(el, 'transform')) return CSS_POSITIONED;
	if (Array.from(el.children).some(c=>/^(animate|animatetransform|animatemotion|set)$/i.test(c.tagName))) return ANIMATED;
	return null;
}

/**
 * Why this element cannot be resized or rotated, or null: anything that
 * blocks a move, and a transform origin of its own, from CSS or the
 * attribute of that name. The origin is the point a transform acts about,
 * so a resize or a turn would leap away from the pointer. A move is
 * unaffected: a shift is the same about any origin.
 */
function originBlockedReason(el: Element): string | null {
	const blocked = blockedReason(el);
	if (blocked) return blocked;
	if (['transform-origin', 'transform-box'].some(p=>el.hasAttribute(p) || cssSets(el, p))) return ORIGIN_SET;
	return null;
}

function readTransform(el: Element): TransformFn[] | null {
	const value = el.getAttribute('transform');
	return value === null ? [] : parseTransform(value);
}

/** Attribute values that can be shifted or scaled as plain numbers, or null. */
function plainNumbers(el: Element, names: string[], {lists = false, required = [] as string[]} = {}): Record<string, number[]> | null {
	const out: Record<string, number[]> = {};
	for (const name of names) {
		const raw = el.getAttribute(name);
		if (raw === null) {
			if (required.includes(name)) return null;
			out[name] = [0];
			continue;
		}
		if (cssSets(el, name)) return null;
		if (NUMBER.test(raw)) {
			out[name] = [parseFloat(raw)];
			continue;
		}
		if (lists && NUMBER_LIST.test(raw)) {
			out[name] = raw.trim().split(/\s*,\s*|\s+/).map(Number);
			continue;
		}
		return null;
	}
	return out;
}

const shiftedList = (values: number[], delta: number): string=>values.map(v=>shifted(v, delta)).join(' ');

/** Which attributes carry an element's position along each axis. */
const MOVE_ATTRS: Record<string, {x: string[]; y: string[]}> = {
	rect: {x: ['x'], y: ['y']},
	image: {x: ['x'], y: ['y']},
	use: {x: ['x'], y: ['y']},
	svg: {x: ['x'], y: ['y']},
	foreignobject: {x: ['x'], y: ['y']},
	text: {x: ['x'], y: ['y']},
	circle: {x: ['cx'], y: ['cy']},
	ellipse: {x: ['cx'], y: ['cy']},
	line: {x: ['x1', 'x2'], y: ['y1', 'y2']},
};

/**
 * Move an element by (dx, dy), measured in its PARENT's user units, the
 * space its transform attribute maps into.
 *
 * In order of preference:
 *   1. a leading `translate(...)` or `matrix(...)` is where the author put
 *      the position, so that is what changes (every traced path has one),
 *      and the transform is written in its simplest form;
 *   2. an element with its own position attributes gets those shifted: by
 *      the move itself when its transform is one turn about a point, which
 *      moves along with it, or else by the move taken back into its own
 *      units through whatever turn or scale its transform applies;
 *   3. anything else (a path, a polygon, a group) has the move taken into
 *      its transform, written in its simplest form, which with nothing
 *      there before is a `translate`.
 * `box` is the element's own box, for the simplest form.
 */
export function planMove(el: Element, dx: number, dy: number, box: Rect | null = null): EditPlan {
	const blocked = blockedReason(el);
	if (blocked) return {ok: false, reason: blocked};
	const list = readTransform(el);
	if (!list) return {ok: false, reason: UNREADABLE_TRANSFORM};
	if (dx === 0 && dy === 0) return {ok: true, attrs: {}};
	const value = el.getAttribute('transform') ?? '';
	const first = list.at(0);

	const tag = el.tagName.toLowerCase();
	const spec = MOVE_ATTRS[tag] as {x: string[]; y: string[]} | undefined;
	// A <text> whose runs place themselves would leave them behind.
	const runsPlaceThemselves = tag === 'text' && el.querySelector('[x], [y]') !== null;
	const values = spec && !runsPlaceThemselves
		? plainNumbers(el, [...spec.x, ...spec.y], {lists: tag === 'text'})
		: null;
	const inverse = invert(listMatrix(list));
	if (spec && values && inverse && first?.name !== 'translate' && first?.name !== 'matrix') {
		const attrs: Record<string, string | null> = {};
		// a turn about a point of its own: the shape and the point move together, as far as the move
		const centred = list.length === 1 && first?.name === 'rotate' && first.args.length === 3 ? first : null;
		const local = centred ? {x: dx, y: dy} : applyToVector(inverse, dx, dy);
		for (const [names, delta] of [[spec.x, local.x], [spec.y, local.y]] as const) {
			if (roundTo(delta, 6) === 0) continue;
			for (const name of names) attrs[name] = shiftedList(values[name], delta);
		}
		if (centred) {
			const [angle, cx, cy] = centred.args;
			attrs.transform = value.slice(0, centred.start) + `rotate(${joinArgs(value.slice(centred.start, centred.end), [String(angle), shifted(cx, dx), shifted(cy, dy)])})` + value.slice(centred.end);
		}
		return {ok: true, attrs};
	}

	const moved = multiply({...IDENTITY, e: dx, f: dy}, listMatrix(list));
	const text = simplestTransform(moved, {box, was: list, decimals: Math.max(2, placesOf(dx), placesOf(dy)), comma: commaIn(value)});
	if (text !== null) return transformChange(el, text);
	// a transform that flattens the element has no simplest form: a translate in front takes the move
	if (first?.name === 'translate') {
		const [tx, ty = 0] = first.args;
		const args = first.args.length === 1 && dy === 0 ? [shifted(tx, dx)] : [shifted(tx, dx), shifted(ty, dy)];
		return {ok: true, attrs: {transform: value.slice(0, first.start) + `translate(${joinArgs(value.slice(first.start, first.end), args)})` + value.slice(first.end)}};
	}
	const translate = `translate(${fmt(dx)} ${fmt(dy)})`;
	return {ok: true, attrs: {transform: value.trim() ? `${translate} ${value.trim()}` : translate}};
}

export type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export interface ResizeRequest {
	handle: Handle;
	/** How far the handle was dragged, in the element's LOCAL units (before
	 * its own transform). Already rounded to what the zoom level can express. */
	dx: number;
	dy: number;
	keepAspect: boolean;
	/** The element's local bounding box, as the renderer measures it. Used
	 * for shapes whose geometry this module does not read itself. */
	bbox: Rect;
	/** Smallest extent a side may be dragged to, in local units. */
	minSize: number;
	/** Decimal places for the translation written into a transform. */
	decimals: number;
}

/** One axis of a resize: x' = anchor + (x − anchor) · k. */
export interface AxisMap {anchor: number; k: number}

/** A resize's two axes as one matrix. */
export function scaleMatrix(maps: {x: AxisMap; y: AxisMap}): Matrix {
	return {a: maps.x.k, b: 0, c: 0, d: maps.y.k, e: maps.x.anchor * (1 - maps.x.k), f: maps.y.anchor * (1 - maps.y.k)};
}

/**
 * Where each axis is pinned and how far it stretches, for a handle dragged
 * by (dx, dy). The side opposite the handle stays put; a side handle leaves
 * the other axis alone unless the aspect ratio is locked, in which case it
 * grows about its middle. Dragging past the opposite side makes k negative:
 * a flip, which a transform shows as a mirror image and a rectangle simply
 * absorbs.
 */
export function axisMaps(box: Rect, req: Pick<ResizeRequest, 'handle' | 'dx' | 'dy' | 'keepAspect' | 'minSize'>): {x: AxisMap; y: AxisMap} {
	const {handle} = req;
	const axis = (start: number, size: number, low: boolean, high: boolean, delta: number): AxisMap & {driven: boolean}=>{
		if (size <= 0) return {anchor: start, k: 1, driven: false};
		if (high) return {anchor: start, k: (size + delta) / size, driven: true};
		if (low) return {anchor: start + size, k: (size - delta) / size, driven: true};
		return {anchor: start + size / 2, k: 1, driven: false};
	};
	const x = axis(box.x, box.width, handle.includes('w'), handle.includes('e'), req.dx);
	const y = axis(box.y, box.height, handle.includes('n'), handle.includes('s'), req.dy);

	if (req.keepAspect && box.width > 0 && box.height > 0) {
		if (x.driven && y.driven) {
			const s = Math.max(Math.abs(x.k), Math.abs(y.k));
			x.k = Math.sign(x.k || 1) * s;
			y.k = Math.sign(y.k || 1) * s;
		} else if (x.driven) {
			y.k = Math.abs(x.k);
		} else if (y.driven) {
			x.k = Math.abs(y.k);
		}
	}
	const floor = (a: AxisMap, size: number): void=>{
		if (size > 0 && Math.abs(a.k) * size < req.minSize) a.k = Math.sign(a.k || 1) * (req.minSize / size);
	};
	floor(x, box.width);
	floor(y, box.height);
	return {x: {anchor: x.anchor, k: x.k}, y: {anchor: y.anchor, k: y.k}};
}

const mapAxis = (m: AxisMap, v: number): number=>m.anchor + (v - m.anchor) * m.k;

/** The box after a resize, normalized so width and height are never negative. */
export function resizedBox(box: Rect, maps: {x: AxisMap; y: AxisMap}): Rect {
	const x1 = mapAxis(maps.x, box.x);
	const x2 = mapAxis(maps.x, box.x + box.width);
	const y1 = mapAxis(maps.y, box.y);
	const y2 = mapAxis(maps.y, box.y + box.height);
	return {x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1)};
}

/** The box a shape's own attributes describe, when this module can read them. */
function nativeBox(el: Element): {box: Rect; values: Record<string, number[]>} | null {
	const tag = el.tagName.toLowerCase();
	if (tag === 'rect' || tag === 'image' || tag === 'foreignobject') {
		const v = plainNumbers(el, ['x', 'y', 'width', 'height'], {required: ['width', 'height']});
		if (!v) return null;
		if (tag === 'rect') {
			for (const r of ['rx', 'ry']) {
				if (el.getAttribute(r) === null) continue;
				const rv = plainNumbers(el, [r]);
				if (!rv) return null;
				v[r] = rv[r];
			}
		}
		return {box: {x: v.x[0], y: v.y[0], width: v.width[0], height: v.height[0]}, values: v};
	}
	if (tag === 'ellipse') {
		const v = plainNumbers(el, ['cx', 'cy', 'rx', 'ry'], {required: ['rx', 'ry']});
		if (!v) return null;
		return {box: {x: v.cx[0] - v.rx[0], y: v.cy[0] - v.ry[0], width: 2 * v.rx[0], height: 2 * v.ry[0]}, values: v};
	}
	if (tag === 'circle') {
		const v = plainNumbers(el, ['cx', 'cy', 'r'], {required: ['r']});
		if (!v) return null;
		return {box: {x: v.cx[0] - v.r[0], y: v.cy[0] - v.r[0], width: 2 * v.r[0], height: 2 * v.r[0]}, values: v};
	}
	if (tag === 'line') {
		const v = plainNumbers(el, ['x1', 'y1', 'x2', 'y2']);
		if (!v) return null;
		const [x1, y1, x2, y2] = [v.x1[0], v.y1[0], v.x2[0], v.y2[0]];
		return {box: {x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1)}, values: v};
	}
	return null;
}

/**
 * Resize an element by dragging one of its eight handles.
 *
 * Shapes defined by a box (rect, image, ellipse, circle, line) get their own
 * attributes rewritten, except a circle pulled out of round, which has no
 * attribute for that. Everything else (paths, polygons, text, groups) is
 * scaled by its transform: the scale-and-shift is taken into it, and it is
 * written in its simplest form, so repeated resizes keep one scale rather
 * than stacking a new one each time. A stroke scales along with the shape it
 * belongs to, as it would in any drawing program that scales objects.
 */
export function planResize(el: Element, req: ResizeRequest): EditPlan {
	const blocked = originBlockedReason(el);
	if (blocked) return {ok: false, reason: blocked};
	const list = readTransform(el);
	if (!list) return {ok: false, reason: UNREADABLE_TRANSFORM};
	const tag = el.tagName.toLowerCase();
	// Its width and height are in its parent's units but what it draws is in
	// its viewBox's, so neither the handles nor a scale would track the pointer.
	if (tag === 'svg') return {ok: false, reason: NESTED_SVG};

	const native = nativeBox(el);
	// a circle's r cannot say "oval": a corner keeps it round, and a side handle
	// stretches it through its transform like a path
	const corner = req.handle.length === 2;
	if (native && !(tag === 'circle' && !corner && !req.keepAspect)) {
		return scaledNatively(tag, native.values, native.box, axisMaps(native.box, {...req, keepAspect: req.keepAspect || tag === 'circle'}));
	}
	// the places the drag was rounded to are in the element's own units; the transform's shift is in its parent's
	const scale = Math.sqrt(Math.abs(((m)=>m.a * m.d - m.b * m.c)(listMatrix(list))));
	const decimals = scale > 0 ? Math.max(0, Math.ceil(req.decimals - Math.log10(scale) - 1e-9)) : req.decimals;
	const box = native ? native.box : req.bbox;
	return scaledByTransform(el, list, axisMaps(box, req), decimals, box);
}

/** A box shape's own attributes, after a scale along each axis, written
 * to `decimals` places or as finely as each was, when given. */
function scaledNatively(tag: string, v: Record<string, number[]>, box: Rect, maps: {x: AxisMap; y: AxisMap}, decimals?: number): EditPlan {
	const next = resizedBox(box, maps);
	const attrs: Record<string, string | null> = {};
	const set = (name: string, value: number): void=>{
		let places = decimals === undefined ? 6 : Math.max(decimals, placesOf(v[name][0]));
		// a size the scale left above nothing is not rounded down to it, which would draw nothing
		if (/^(width|height|r|rx|ry)$/.test(name)) while (value > 0 && roundTo(value, places) === 0 && places < 6) places += 1;
		if (roundTo(value, places) !== roundTo(v[name][0], places)) attrs[name] = fmt(value, places);
	};
	if (tag === 'ellipse' || tag === 'circle') {
		set('cx', next.x + next.width / 2);
		set('cy', next.y + next.height / 2);
		if (tag === 'circle') {
			set('r', next.width / 2);
		} else {
			set('rx', next.width / 2);
			set('ry', next.height / 2);
		}
	} else if (tag === 'line') {
		set('x1', mapAxis(maps.x, v.x1[0]));
		set('y1', mapAxis(maps.y, v.y1[0]));
		set('x2', mapAxis(maps.x, v.x2[0]));
		set('y2', mapAxis(maps.y, v.y2[0]));
	} else {
		set('x', next.x);
		set('y', next.y);
		set('width', next.width);
		set('height', next.height);
		if ('rx' in v) set('rx', v.rx[0] * Math.abs(maps.x.k));
		if ('ry' in v) set('ry', v.ry[0] * Math.abs(maps.y.k));
	}
	return {ok: true, attrs};
}

/** An element's transform, after a scale along each of its own axes, in its
 * simplest form; `decimals` are places in the parent's units. A transform
 * with no simplest form keeps a trailing translate and scale for it. */
function scaledByTransform(el: Element, list: TransformFn[], maps: {x: AxisMap; y: AxisMap}, decimals: number, box: Rect | null): EditPlan {
	const local: Matrix = {
		a: maps.x.k, b: 0, c: 0, d: maps.y.k,
		e: maps.x.anchor * (1 - maps.x.k),
		f: maps.y.anchor * (1 - maps.y.k),
	};
	const value = el.getAttribute('transform') ?? '';
	const text = simplestTransform(multiply(listMatrix(list), local), {box, was: list, decimals, comma: commaIn(value)});
	if (text !== null) return transformChange(el, text);
	const parts = [`translate(${fmt(local.e, decimals)} ${fmt(local.f, decimals)})`, `scale(${Number(local.a.toPrecision(6))} ${Number(local.d.toPrecision(6))})`];
	return {ok: true, attrs: {transform: [value.trim(), ...parts].filter(Boolean).join(' ')}};
}

/**
 * Scale an element as one of several scaled together: `m` is the scale, in
 * the element's PARENT units, about the point the group is scaled from. Seen
 * from the element's own units it is most often still a scale along its own
 * axes, which a box shape takes into its attributes and anything else into
 * the translate and scale at the end of its transform, as a resize does. An
 * element turned against the group's axes cannot be stretched along them by
 * either, so the scale goes in front of its transform as a matrix.
 */
export function planScaleAbout(el: Element, m: Matrix, decimals: number, box: Rect | null = null): EditPlan {
	const blocked = originBlockedReason(el);
	if (blocked) return {ok: false, reason: blocked};
	const list = readTransform(el);
	if (!list) return {ok: false, reason: UNREADABLE_TRANSFORM};
	const tag = el.tagName.toLowerCase();
	if (tag === 'svg') return {ok: false, reason: NESTED_SVG};
	const own = listMatrix(list);
	const inverse = invert(own);
	if (!inverse) return {ok: false, reason: UNREADABLE_TRANSFORM};
	const local = multiply(inverse, multiply(m, own));
	if (Math.abs(local.b) < 1e-9 && Math.abs(local.c) < 1e-9) {
		// x' = k·x + e is a scale by k about e / (1 − k)
		const axis = (k: number, e: number): AxisMap=>({k, anchor: Math.abs(1 - k) < 1e-12 ? 0 : e / (1 - k)});
		const maps = {x: axis(local.a, local.e), y: axis(local.d, local.f)};
		const native = nativeBox(el);
		if (native && (tag !== 'circle' || same(Math.abs(local.a), Math.abs(local.d)))) return scaledNatively(tag, native.values, native.box, maps, decimals);
		return scaledByTransform(el, list, maps, decimals, native ? native.box : box);
	}
	return planMatrix(el, m, decimals, box);
}

// ---------------------------------------------------------------------------
// Rotating and flipping
// ---------------------------------------------------------------------------

const same = (a: number, b: number): boolean=>Math.abs(a - b) < 1e-6;

/** What follows a transform function, less the comma that may separate it. */
const afterFunction = (value: string, end: number): string=>value.slice(end).replace(/^\s*,/, '').trim();

/** The centre of a local box in the element's PARENT units: where it sits
 * once the element's own transform has been applied. Null when the
 * transform cannot be read. */
export function parentCenter(el: Element, bbox: Rect): Point | null {
	const list = readTransform(el);
	if (!list) return null;
	return applyToPoint(listMatrix(list), bbox.x + bbox.width / 2, bbox.y + bbox.height / 2);
}

/**
 * Turn an element by `degrees` about `center`, given in its parent's units,
 * taken into its transform, which is written in its simplest form: a turn
 * about its own middle is a `rotate(a cx cy)` there, a later one adds to
 * it, and a full circle leaves nothing behind. A turn about the point an
 * earlier one was about, to within a unit of the last place that point was
 * written to, is about that point: a centre rounded as it was written is a
 * little off the true one, and the turn about it moves the true one by as
 * much again. `box` is the element's own box.
 */
export function planRotate(el: Element, degrees: number, center: Point, decimals = 2, box: Rect | null = null): EditPlan {
	const blocked = originBlockedReason(el);
	if (blocked) return {ok: false, reason: blocked};
	const list = readTransform(el);
	if (!list) return {ok: false, reason: UNREADABLE_TRANSFORM};
	const value = el.getAttribute('transform') ?? '';
	// where the point the transform turns about is in the parent: its place, moved by the translate before it
	const shift = list.at(0)?.name === 'translate' ? list[0].args : [];
	const turn = isSimple(list) ? list.find(fn=>fn.name === 'rotate') : undefined;
	const was = turn ? {x: (turn.args.at(1) ?? 0) + (shift.at(0) ?? 0), y: (turn.args.at(2) ?? 0) + (shift.at(1) ?? 0)} : null;
	const reach = 10 ** -Math.max(2, decimals) + 1e-9;
	const at = was && Math.abs(was.x - center.x) <= reach && Math.abs(was.y - center.y) <= reach ? was : center;
	const text = simplestTransform(multiply(turnMatrix(degrees, at), listMatrix(list)), {box, was: list, decimals, pivot: at, comma: commaIn(value)});
	if (text !== null) return transformChange(el, text);
	const front = `rotate(${fmt(degrees, decimals)} ${fmt(at.x, decimals)} ${fmt(at.y, decimals)})`;
	return {ok: true, attrs: {transform: [front, value.trim()].filter(Boolean).join(' ')}};
}

/**
 * Mirror an element across the vertical (axis "x") or horizontal (axis "y")
 * line through `center`, given in its parent's units: a matrix in front of
 * its transform. Mirroring across the same line again takes it back off.
 */
export function planFlip(el: Element, axis: 'x' | 'y', center: Point, decimals = 2, box: Rect | null = null): EditPlan {
	return planMatrix(el, mirrorAbout(axis, center), decimals, box);
}

/** A mirror across the vertical (axis "x") or horizontal (axis "y") line through a point. */
export function mirrorAbout(axis: 'x' | 'y', c: Point): Matrix {
	return axis === 'x' ? {a: -1, b: 0, c: 0, d: 1, e: 2 * c.x, f: 0} : {a: 1, b: 0, c: 0, d: -1, e: 0, f: 2 * c.y};
}

/**
 * Put `m`, a transform in the element's parent's units, through the
 * element's transform, which is written in its simplest form. This is how a
 * mirror is written, a scale of several elements across one that is turned
 * against them, and a turn where the parent is stretched or slanted against
 * the screen. Two that come to nothing leave nothing: the same mirror again
 * takes the first back off, and four quarter turns come round to none.
 * `box` is the element's own box.
 *
 * A transform with no simplest form has `m` in front as a matrix, its slant
 * to six places and its shift to `decimals`; a matrix already in front
 * takes the new one in, keeping the places it was written to.
 */
export function planMatrix(el: Element, m: Matrix, decimals = 2, box: Rect | null = null): EditPlan {
	const blocked = originBlockedReason(el);
	if (blocked) return {ok: false, reason: blocked};
	const list = readTransform(el);
	if (!list) return {ok: false, reason: UNREADABLE_TRANSFORM};
	const value = el.getAttribute('transform') ?? '';
	const simplest = simplestTransform(multiply(m, listMatrix(list)), {box, was: list, decimals, comma: commaIn(value)});
	if (simplest !== null) return transformChange(el, simplest);
	const round = (n: Matrix, slant: number, shift: number): Matrix=>({
		a: roundTo(n.a, slant), b: roundTo(n.b, slant), c: roundTo(n.c, slant), d: roundTo(n.d, slant), e: roundTo(n.e, shift), f: roundTo(n.f, shift),
	});
	// the new matrix as it would be written on its own
	const written = round(m, 6, decimals);
	const first = list.at(0);
	const leading = first?.name === 'matrix' ? fnMatrix(first) : null;
	const rest = first && leading ? afterFunction(value, first.end) : value.trim();
	const shift = Math.max(decimals, ...(leading ? [placesOf(leading.e), placesOf(leading.f)] : []));
	const both = leading ? round(multiply(written, leading), Math.max(6, ...[leading.a, leading.b, leading.c, leading.d].map(placesOf)), shift) : written;
	// nothing, but for what rounding each as it was written left: a slant to
	// six places is a mirror only to about that, and a shift to its last place
	const near = (n: number, to: number, by: number): boolean=>Math.abs(n - to) <= by;
	const none = near(both.a, 1, 1e-5) && near(both.b, 0, 1e-5) && near(both.c, 0, 1e-5) && near(both.d, 1, 1e-5)
		&& near(both.e, 0, 10 ** -shift + 1e-9) && near(both.f, 0, 10 ** -shift + 1e-9);
	const text = none ? '' : `matrix(${[both.a, both.b, both.c, both.d, both.e, both.f].join(' ')})`;
	const next = [text, rest].filter(Boolean).join(' ');
	if (next === value.trim()) return {ok: true, attrs: {}};
	return {ok: true, attrs: {transform: next || null}};
}
