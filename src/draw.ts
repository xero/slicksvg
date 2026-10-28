// --- New shapes: the attributes of a shape drawn in the preview, and the
// markup it is written as. A rect, circle, ellipse, or line is drawn with
// one drag across the drawing, or placed with a tap; a polyline, polygon,
// or path is drawn a point at a time, a path's points with handles pulled
// out of them. Each says its geometry as the SVG spec names it, in the
// units of the drawing it lands in, to the precision the zoom shows.
import {fmt, roundTo, type Point} from './geometry';

/** The shapes drawn with one drag. */
export type DragKind = 'rect' | 'circle' | 'ellipse' | 'line';
/** The shapes drawn a point at a time. */
export type PointKind = 'polyline' | 'polygon' | 'path';
export type ShapeKind = DragKind | PointKind;

export const SHAPE_KINDS: ShapeKind[] = ['rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'path'];

/** Each shape's name, as its tool says it. */
export const SHAPE_NAMES: Record<ShapeKind, string> = {rect: 'rectangle', circle: 'circle', ellipse: 'ellipse', line: 'line', polyline: 'polyline', polygon: 'polygon', path: 'path'};

/** Whether a shape is drawn a point at a time, rather than with one drag. */
export const byPoints = (kind: ShapeKind): kind is PointKind=>kind === 'polyline' || kind === 'polygon' || kind === 'path';

/** The fewest points a shape drawn a point at a time can be written with. */
export const pointsNeeded = (kind: PointKind): number=>kind === 'polygon' ? 3 : 2;

/** The colour a new shape is filled with until another is picked: a grey
 * that shows on a light preview and a dark one alike, and on the colours
 * of the drawing. */
export const NEW_SHAPE_COLOR = '#999';

/** What new shapes are painted with: the fill and the stroke last picked,
 * each a colour or "none", the stroke's width, and whether the stroke goes
 * behind the fill. */
export interface Pen {
	fill: string;
	stroke: string;
	width: string;
	behind?: boolean;
}

/** The style that paints a stroke behind its fill, which then covers its inner half. */
export const STROKE_BEHIND = 'paint-order: stroke';

/** How a new shape is painted with the pen. One that closes round an area
 * is filled, and stroked as well while the pen has a stroke; a line, a
 * polyline, or a path left open is only stroked, and not filled, which a
 * polyline or path would be by default. No shape is drawn unseen: an open
 * one is stroked in the fill's colour while the pen has no stroke, and a
 * closed one with neither is stroked in the grey. */
export function paintOf(kind: ShapeKind, closed: boolean, pen: Pen): Record<string, string> {
	const stroke = pen.stroke === 'none' ? null : pen.stroke;
	const open = kind === 'line' || kind === 'polyline' || (kind === 'path' && !closed);
	if (open) {
		const seen = stroke ?? (pen.fill === 'none' ? NEW_SHAPE_COLOR : pen.fill);
		return kind === 'line' ? {stroke: seen, 'stroke-width': pen.width} : {fill: 'none', stroke: seen, 'stroke-width': pen.width};
	}
	// behind the fill only means something when there is a fill to be behind
	if (stroke) return {fill: pen.fill, stroke, 'stroke-width': pen.width, ...(pen.behind && pen.fill !== 'none' ? {style: STROKE_BEHIND} : {})};
	return pen.fill === 'none' ? {fill: 'none', stroke: NEW_SHAPE_COLOR, 'stroke-width': pen.width} : {fill: pen.fill};
}

/** A stroke a hundredth as wide as a drawing `size` across, to one figure,
 * so it shows the same in an icon and a poster. */
export function strokeWidthFor(size: number): string {
	return size > 0 && Number.isFinite(size) ? String(Number((size / 100).toPrecision(1))) : '1';
}

/** How a drag draws: constrained (a rect square, an ellipse round, a line
 * at a multiple of 45 degrees), and from the press as its middle rather
 * than a corner or an end. */
export interface DrawOptions {
	constrain: boolean;
	fromCenter: boolean;
	decimals: number;
}

/** `to` turned about `from` to the nearest multiple of `step` degrees, as far from it as it was. */
export function snapAngle(from: Point, to: Point, step = 45): Point {
	const length = Math.hypot(to.x - from.x, to.y - from.y);
	const unit = (step * Math.PI) / 180;
	const angle = Math.round(Math.atan2(to.y - from.y, to.x - from.x) / unit) * unit;
	return {x: from.x + length * Math.cos(angle), y: from.y + length * Math.sin(angle)};
}

/** The box a drag from `from` to `to` spans. A square one is as big as the
 * longer side of the drag, toward where it went. From the middle, the box
 * reaches as far the other way as the drag went. */
export function dragBox(from: Point, to: Point, square: boolean, fromCenter: boolean): {left: number; top: number; right: number; bottom: number} {
	let dx = to.x - from.x;
	let dy = to.y - from.y;
	if (square) {
		const side = Math.max(Math.abs(dx), Math.abs(dy));
		dx = (dx < 0 ? -1 : 1) * side;
		dy = (dy < 0 ? -1 : 1) * side;
	}
	if (fromCenter) return {left: from.x - Math.abs(dx), top: from.y - Math.abs(dy), right: from.x + Math.abs(dx), bottom: from.y + Math.abs(dy)};
	return {left: Math.min(from.x, from.x + dx), top: Math.min(from.y, from.y + dy), right: Math.max(from.x, from.x + dx), bottom: Math.max(from.y, from.y + dy)};
}

/** The attributes of a shape drawn across a box, in the order the spec
 * lists them. A rect's corners land on the precision's grid, where the
 * pointer put them; a circle or ellipse is its middle and its radii. A
 * size the drag left at nothing is one step of the precision, so the
 * shape can still be seen and taken hold of. */
export function boxedShape(kind: 'rect' | 'circle' | 'ellipse', box: {left: number; top: number; right: number; bottom: number}, decimals: number): Record<string, string> {
	const step = 10 ** -decimals;
	const size = (n: number): string=>fmt(Math.max(step, roundTo(n, decimals)), decimals);
	if (kind === 'rect') {
		const [left, top] = [roundTo(box.left, decimals), roundTo(box.top, decimals)];
		return {x: fmt(left, decimals), y: fmt(top, decimals), width: size(roundTo(box.right, decimals) - left), height: size(roundTo(box.bottom, decimals) - top)};
	}
	const cx = fmt((box.left + box.right) / 2, decimals);
	const cy = fmt((box.top + box.bottom) / 2, decimals);
	const [rx, ry] = [(box.right - box.left) / 2, (box.bottom - box.top) / 2];
	return kind === 'circle' ? {cx, cy, r: size(Math.max(rx, ry))} : {cx, cy, rx: size(rx), ry: size(ry)};
}

/** The ends of a line from `start` to `end`. Ends the precision would put
 * together are kept a step apart, so the line can still be seen. */
function lineEnds(start: Point, end: Point, decimals: number): Record<string, string> {
	const [x1, y1, x2, y2] = [start.x, start.y, end.x, end.y].map(n=>roundTo(n, decimals));
	const apart = x1 === x2 && y1 === y2 ? 10 ** -decimals : 0;
	return {x1: fmt(x1, decimals), y1: fmt(y1, decimals), x2: fmt(x2 + apart, decimals), y2: fmt(y2, decimals)};
}

/** The attributes of a shape drawn with a drag from `from` to `to`. A
 * circle is always round, as big as the longer side of the drag. A line
 * runs from the press to the pointer, or from the middle as far the other
 * way too. */
export function drawnShape(kind: DragKind, from: Point, to: Point, opts: DrawOptions): Record<string, string> {
	if (kind === 'line') {
		const end = opts.constrain ? snapAngle(from, to) : to;
		return lineEnds(opts.fromCenter ? {x: 2 * from.x - end.x, y: 2 * from.y - end.y} : from, end, opts.decimals);
	}
	return boxedShape(kind, dragBox(from, to, opts.constrain || kind === 'circle', opts.fromCenter), opts.decimals);
}

/** The attributes of a shape placed with a tap: `size` across, an
 * ellipse two thirds as tall, a line level, with its middle where the tap
 * was. */
export function placedShape(kind: DragKind, at: Point, size: number, decimals: number): Record<string, string> {
	const across = Number(size.toPrecision(2)) / 2;
	if (kind === 'line') return lineEnds({x: at.x - across, y: at.y}, {x: at.x + across, y: at.y}, decimals);
	const down = kind === 'ellipse' ? (across * 2) / 3 : across;
	return boxedShape(kind, {left: at.x - across, top: at.y - down, right: at.x + across, bottom: at.y + down}, decimals);
}

/** A polyline's or polygon's points, each pair as x,y. */
export function pointsList(points: Point[], decimals: number): string {
	return points.map(p=>`${fmt(p.x, decimals)},${fmt(p.y, decimals)}`).join(' ');
}

/** A point of a path drawn with the pen, and the handles it was dragged
 * out with: the one the path leaves it toward, and the one it comes in
 * from. A point placed with a tap has neither. */
export interface Anchor {
	x: number;
	y: number;
	in: Point | null;
	out: Point | null;
}

/** An anchor at `at` dragged out to `to`: its out handle there, and its in
 * handle as far the other way, so the path runs through it smoothly. */
export function draggedAnchor(at: Point, to: Point): Anchor {
	return {x: at.x, y: at.y, out: {x: to.x, y: to.y}, in: {x: 2 * at.x - to.x, y: 2 * at.y - to.y}};
}

/** The path data that runs through the anchors: a line between two where
 * neither has a handle toward the other, as the precision writes them, and
 * a cubic curve where either has. A closed path comes back to the first
 * anchor, with a curve when that way back bends, and ends with Z. */
export function penPathData(anchors: Anchor[], closed: boolean, decimals: number): string {
	const n = (v: number): string=>fmt(v, decimals);
	const pair = (p: Point): string=>`${n(p.x)} ${n(p.y)}`;
	const first = anchors.at(0);
	if (!first) return '';
	const parts = [`M${pair(first)}`];
	const join = (a: Anchor, b: Anchor, closing: boolean): void=>{
		const [c1, c2] = [a.out ?? a, b.in ?? b];
		const straight = pair(c1) === pair(a) && pair(c2) === pair(b);
		// the Z draws a straight way back by itself
		if (straight && !closing) parts.push(`L${pair(b)}`);
		if (!straight) parts.push(`C${pair(c1)} ${pair(c2)} ${pair(b)}`);
	};
	anchors.slice(1).forEach((b, i)=>join(anchors[i], b, false));
	const last = anchors.at(-1);
	if (closed && last && anchors.length > 1) {
		join(last, first, true);
		parts.push('Z');
	}
	return parts.join(' ');
}

/** The markup of a new shape: its geometry, then its paint. It closes the
 * way the rest of the source closes empty elements, with a space before
 * the slash or without. */
export function shapeMarkup(kind: ShapeKind, attrs: Record<string, string>, spaced: boolean): string {
	const said = Object.entries(attrs).map(([name, value])=>` ${name}="${value}"`).join('');
	return `<${kind}${said}${spaced ? ' ' : ''}/>`;
}

/** Whether the source mostly closes empty elements with a space before the slash. */
export function spacedClose(source: string): boolean {
	const spaced = source.match(/\s\/>/g)?.length ?? 0;
	return spaced > (source.match(/[^\s]\/>/g)?.length ?? 0);
}
