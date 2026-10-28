// --- New shapes: the attributes of a rect, circle, or ellipse drawn with a
// drag across the drawing, or placed with a tap, and the markup it is
// written as. Each says its geometry as the SVG spec names it, in the
// units of the drawing it lands in, to the precision the zoom shows.
import {fmt, roundTo, type Point} from './geometry';

export type ShapeKind = 'rect' | 'circle' | 'ellipse';

export const SHAPE_KINDS: ShapeKind[] = ['rect', 'circle', 'ellipse'];

/** Each shape's name, as its tool says it. */
export const SHAPE_NAMES: Record<ShapeKind, string> = {rect: 'rectangle', circle: 'circle', ellipse: 'ellipse'};

/** What a new shape is filled with: a grey that shows on a light preview and a dark one alike, and on the colours of the drawing. */
export const NEW_SHAPE_FILL = '#999';

/** How a drag draws: with its box made square, and from the press as its middle rather than a corner. */
export interface DrawOptions {
	square: boolean;
	fromCenter: boolean;
	decimals: number;
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
export function boxedShape(kind: ShapeKind, box: {left: number; top: number; right: number; bottom: number}, decimals: number): Record<string, string> {
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

/** The attributes of a shape drawn with a drag from `from` to `to`. A
 * circle is always round, as big as the longer side of the drag. */
export function drawnShape(kind: ShapeKind, from: Point, to: Point, opts: DrawOptions): Record<string, string> {
	return boxedShape(kind, dragBox(from, to, opts.square || kind === 'circle', opts.fromCenter), opts.decimals);
}

/** The attributes of a shape placed with a tap: `size` across, an
 * ellipse two thirds as tall, with its middle where the tap was. */
export function placedShape(kind: ShapeKind, at: Point, size: number, decimals: number): Record<string, string> {
	const across = Number(size.toPrecision(2)) / 2;
	const down = kind === 'ellipse' ? (across * 2) / 3 : across;
	return boxedShape(kind, {left: at.x - across, top: at.y - down, right: at.x + across, bottom: at.y + down}, decimals);
}

/** The markup of a new shape: its geometry, then its fill. It closes the
 * way the rest of the source closes empty elements, with a space before
 * the slash or without. */
export function shapeMarkup(kind: ShapeKind, attrs: Record<string, string>, spaced: boolean): string {
	const said = Object.entries({...attrs, fill: NEW_SHAPE_FILL}).map(([name, value])=>` ${name}="${value}"`).join('');
	return `<${kind}${said}${spaced ? ' ' : ''}/>`;
}

/** Whether the source mostly closes empty elements with a space before the slash. */
export function spacedClose(source: string): boolean {
	const spaced = source.match(/\s\/>/g)?.length ?? 0;
	return spaced > (source.match(/[^\s]\/>/g)?.length ?? 0);
}
