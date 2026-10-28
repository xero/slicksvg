// --- Shapes as paths: the path data that draws what a rect, circle,
// ellipse, line, polygon, or polyline draws, and the edit that makes one a
// path. There is no way back: a path is not made a shape again.
//
// The path starts where the shape's own outline does and runs the same way,
// as the SVG spec lays each shape out, so a dashed stroke falls the same.
// Round corners and circles are drawn with cubic curves rather than arcs,
// since every point tool can take hold of a cubic: four cubics draw a circle
// to within 0.03% of its radius.
import {cssSets, fmt, placesOf} from './geometry';
import {pointsAsPathData} from './path-data';
import {attributesOf, planAttributeEdits, renameAttribute, renameElement, type StartTag, type TextChange} from './source-map';

/** A length in user units, and the decimal places to write numbers made from it with. */
export interface Length {
	value: number;
	places: number;
}

/** The attributes each kind of shape draws itself with, which a path says in its `d` instead. */
export const GEOMETRY: Record<string, string[] | undefined> = {
	rect: ['x', 'y', 'width', 'height', 'rx', 'ry'],
	circle: ['cx', 'cy', 'r'],
	ellipse: ['cx', 'cy', 'rx', 'ry'],
	line: ['x1', 'y1', 'x2', 'y2'],
	polygon: ['points'],
	polyline: ['points'],
};

/** The elements that can be made paths. */
export const SHAPES = Object.keys(GEOMETRY);

/** Why a shape would not draw the same as a path, or null: CSS that sets its
 * geometry, which the path would not have, or an animation of it, which
 * would be left with nothing to animate. */
export function conversionBlocked(el: Element): string | null {
	const tag = el.tagName.toLowerCase();
	const names = GEOMETRY[tag] ?? [];
	if (names.some(name=>name !== 'points' && cssSets(el, name))) return `This ${tag}'s geometry is set by CSS, so it cannot be made a path here. Change its style in the code instead.`;
	const animated = Array.from(el.children).some(c=>/^(animate|set)$/i.test(c.tagName) && names.includes(c.getAttribute('attributeName') ?? ''));
	return animated ? `This ${tag}'s geometry is animated, so it cannot be made a path here.` : null;
}

/** A length written as a plain number, or in px, which a path can say as it is. */
export function plainLength(text: string): Length | null {
	const m = /^\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)(?:px)?\s*$/i.exec(text);
	if (!m) return null;
	const value = Number(m[1]);
	return {value, places: placesOf(value)};
}

/** How far a quarter circle's cubic handles reach along its tangents, as a share of the radius. */
const KAPPA = (4 / 3) * (Math.SQRT2 - 1);

/** Places enough to put a curve's handles within a thousandth of the size of what they draw. */
const placesFor = (size: number): number=>Math.min(6, Math.max(0, Math.ceil(3 - Math.log10(size))));

export type ShapePath = {ok: true; d: string} | {ok: false; reason: string};

/**
 * The path data that draws the same as a shape, from its geometry: `lengths`
 * has each length attribute the shape has, absent or `auto` ones left out,
 * and `points` its points. SVG's own rules fill in the rest: a missing
 * position is 0, a rect's one corner radius serves for both and neither is
 * more than half its side, an ellipse's one radius serves for both. A shape
 * that draws nothing is refused.
 */
export function shapePathData(tag: string, lengths: Record<string, Length | undefined>, points: string | null = null): ShapePath {
	const at = (name: string): number=>lengths[name]?.value ?? 0;
	// a negative radius is an error, and counts as not given
	const given = (name: string): number | null=>{
		const value = lengths[name]?.value;
		return value === undefined || value < 0 ? null : value;
	};
	const placesOfAll = (names: string[]): number=>Math.max(0, ...names.map(n=>lengths[n]?.places ?? 0));
	if (tag === 'polygon' || tag === 'polyline') {
		const d = points === null ? null : pointsAsPathData(points, tag === 'polygon');
		return d === null ? {ok: false, reason: `This ${tag}'s points do not pair up, so it has no outline to make a path of.`} : {ok: true, d};
	}
	if (tag === 'line') {
		const n = (name: string): string=>fmt(at(name), lengths[name]?.places ?? 0);
		return {ok: true, d: `M${n('x1')} ${n('y1')} L${n('x2')} ${n('y2')}`};
	}
	if (tag === 'rect') {
		const width = at('width');
		const height = at('height');
		if (!(width > 0) || !(height > 0)) return {ok: false, reason: 'This rect has no width or no height, so it draws nothing to make a path of.'};
		const rx = Math.min(given('rx') ?? given('ry') ?? 0, width / 2);
		const ry = Math.min(given('ry') ?? given('rx') ?? 0, height / 2);
		const [L, T] = [at('x'), at('y')];
		const [R, B] = [L + width, T + height];
		const round = rx > 0 && ry > 0;
		const places = Math.max(placesOfAll(GEOMETRY.rect ?? []), round ? placesFor(Math.min(rx, ry)) : 0);
		const n = (v: number): string=>fmt(v, places);
		const p = (x: number, y: number): string=>`${n(x)} ${n(y)}`;
		if (!round) return {ok: true, d: `M${p(L, T)} H${n(R)} V${n(B)} H${n(L)} Z`};
		const [kx, ky] = [KAPPA * rx, KAPPA * ry];
		// a side the corners take all of has no straight part to draw
		const across = width - 2 * rx > 1e-9;
		const down = height - 2 * ry > 1e-9;
		return {ok: true, d: [
			`M${p(L + rx, T)}`,
			across ? `H${n(R - rx)}` : '',
			`C${p(R - rx + kx, T)} ${p(R, T + ry - ky)} ${p(R, T + ry)}`,
			down ? `V${n(B - ry)}` : '',
			`C${p(R, B - ry + ky)} ${p(R - rx + kx, B)} ${p(R - rx, B)}`,
			across ? `H${n(L + rx)}` : '',
			`C${p(L + rx - kx, B)} ${p(L, B - ry + ky)} ${p(L, B - ry)}`,
			down ? `V${n(T + ry)}` : '',
			`C${p(L, T + ry - ky)} ${p(L + rx - kx, T)} ${p(L + rx, T)}`,
			'Z',
		].filter(Boolean).join(' ')};
	}
	if (tag === 'circle' || tag === 'ellipse') {
		const rx = (tag === 'circle' ? given('r') : given('rx') ?? given('ry')) ?? 0;
		const ry = (tag === 'circle' ? given('r') : given('ry') ?? given('rx')) ?? 0;
		if (!(rx > 0) || !(ry > 0)) return {ok: false, reason: `This ${tag} has no radius, so it draws nothing to make a path of.`};
		const [cx, cy] = [at('cx'), at('cy')];
		const places = Math.max(placesOfAll(GEOMETRY[tag] ?? []), placesFor(Math.min(rx, ry)));
		const n = (v: number): string=>fmt(v, places);
		const p = (x: number, y: number): string=>`${n(x)} ${n(y)}`;
		const [kx, ky] = [KAPPA * rx, KAPPA * ry];
		// from the rightmost point, the way the spec runs a circle round
		return {ok: true, d: [
			`M${p(cx + rx, cy)}`,
			`C${p(cx + rx, cy + ky)} ${p(cx + kx, cy + ry)} ${p(cx, cy + ry)}`,
			`C${p(cx - kx, cy + ry)} ${p(cx - rx, cy + ky)} ${p(cx - rx, cy)}`,
			`C${p(cx - rx, cy - ky)} ${p(cx - kx, cy - ry)} ${p(cx, cy - ry)}`,
			`C${p(cx + kx, cy - ry)} ${p(cx + rx, cy - ky)} ${p(cx + rx, cy)}`,
			'Z',
		].join(' ')};
	}
	return {ok: false, reason: `A ${tag} cannot be made a path.`};
}

/**
 * The edit that makes a shape a path drawn by `d`: the tag renamed, `d`
 * where the shape's first geometry attribute stood, and the rest of its
 * geometry taken out. Every other attribute stays as it was written.
 */
export function asPathChanges(source: string, tag: StartTag, d: string): TextChange[] {
	const names = GEOMETRY[tag.name] ?? [];
	const attrs = attributesOf(source, tag);
	const has = (name: string): boolean=>attrs.some(a=>a.name === name);
	// a d the shape had, which it never drew with, takes the new one
	const first = has('d') ? undefined : attrs.find(a=>names.includes(a.name));
	const renamed = first ? renameAttribute(source, tag, first.name, 'd', d) ?? [] : [];
	const edits = [
		...names.filter(name=>name !== first?.name && has(name)).map(name=>({name, value: null})),
		...(first ? [] : [{name: 'd', value: d}]),
	];
	return [...renameElement(source, tag, 'path'), ...renamed, ...planAttributeEdits(source, tag, edits)].sort((a, b)=>a.from - b.from);
}
