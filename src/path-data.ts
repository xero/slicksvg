// --- Path data: the points of a path, polygon, or polyline, and how to
// move, add, and remove them by rewriting only the numbers that change.
//
// A path's `d` is kept as the author wrote it: absolute stays absolute,
// relative stays relative, separators stay put, and a number is rewritten
// only when its value moves. An `H` or `V` becomes an `L` only when the
// point it reaches can no longer be said with one number.
import {fmt, placesOf, type Point} from './geometry';

export interface NumberToken {
	start: number;
	end: number;
	value: number;
}

/** One drawing command of a path, with its numbers' places in the attribute.
 * A letter followed by several groups of numbers is several segments sharing
 * the letter, so a segment may have no letter of its own. */
export interface Segment {
	/** The command as it applies to this segment: an implicit group after an
	 * M is an L (or l). */
	letter: string;
	/** Offset of the letter when this segment has one of its own. */
	letterAt: number | null;
	args: NumberToken[];
	/** From the letter (or the first number) through the last number. */
	start: number;
	end: number;
}

/** A segment's geometry in absolute user units. */
export interface Walked {
	start: Point;
	end: Point;
	/** Explicit or implied control points, as the curve uses them. */
	cp1: Point | null;
	cp2: Point | null;
	/** Where the subpath began, which is where a Z returns to. */
	subpathStart: Point;
}

export interface PathPoint {
	segment: number;
	slot: 'end' | 'cp1' | 'cp2';
	x: number;
	y: number;
	/** For a control point, the anchors its handle lines go to. */
	anchors: Point[];
}

const ARG_COUNT: Record<string, number> = {m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0};
const NUMBER = /[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/iy;
const FLAG = /[01]/y;

const isRelative = (letter: string): boolean=>letter === letter.toLowerCase();
const lower = (letter: string): string=>letter.toLowerCase();

/** The segments of a path's `d`, or null when it does not parse. */
export function parsePathData(d: string): Segment[] | null {
	const segments: Segment[] = [];
	let i = 0;
	let letter: string | null = null;
	let letterAt = 0;
	let ownsLetter = false;
	while (i < d.length) {
		const c = d[i];
		if (/[\s,]/.test(c)) {
			i += 1;
			continue;
		}
		if (/[a-z]/i.test(c)) {
			if (!(lower(c) in ARG_COUNT)) return null;
			letter = c;
			letterAt = i;
			ownsLetter = true;
			i += 1;
			if (lower(c) === 'z') {
				segments.push({letter: c, letterAt, args: [], start: letterAt, end: i});
				letter = null;
				ownsLetter = false;
			}
			continue;
		}
		if (letter === null) return null;
		const count = ARG_COUNT[lower(letter)];
		if (count === 0) return null;
		const args: NumberToken[] = [];
		for (let k = 0; k < count; k++) {
			while (i < d.length && /[\s,]/.test(d[i])) i += 1;
			// an arc's flags may be written without separators, as in "a1 1 0 00 1 1"
			const re = lower(letter) === 'a' && (k === 3 || k === 4) ? FLAG : NUMBER;
			re.lastIndex = i;
			const m = re.exec(d);
			if (!m) return null;
			args.push({start: m.index, end: re.lastIndex, value: Number(m[0])});
			i = re.lastIndex;
		}
		const implicitLine = !ownsLetter && lower(letter) === 'm';
		const first = args[0];
		const last = args[args.length - 1];
		segments.push({
			letter: implicitLine ? (letter === 'M' ? 'L' : 'l') : letter,
			letterAt: ownsLetter ? letterAt : null,
			args,
			start: ownsLetter ? letterAt : first.start,
			end: last.end,
		});
		ownsLetter = false;
	}
	return segments;
}

const reflect = (p: Point, about: Point): Point=>({x: 2 * about.x - p.x, y: 2 * about.y - p.y});
const add = (p: Point, q: Point): Point=>({x: p.x + q.x, y: p.y + q.y});

/** Every segment's geometry in absolute units, walking the path as the
 * renderer does. */
export function walkPath(segments: Segment[]): Walked[] {
	const out: Walked[] = [];
	let cur: Point = {x: 0, y: 0};
	let subpathStart: Point = {x: 0, y: 0};
	let prevCp: Point | null = null;
	let prevKind: 'c' | 'q' | null = null;
	for (const seg of segments) {
		const v = seg.args.map(a=>a.value);
		const rel = isRelative(seg.letter);
		const at = (x: number, y: number): Point=>rel ? add(cur, {x, y}) : {x, y};
		let end: Point;
		let cp1: Point | null = null;
		let cp2: Point | null = null;
		let kind: 'c' | 'q' | null = null;
		switch (lower(seg.letter)) {
			case 'm':
				end = at(v[0], v[1]);
				subpathStart = end;
				break;
			case 'l':
			case 't':
				end = at(v[0], v[1]);
				if (lower(seg.letter) === 't') {
					cp1 = prevKind === 'q' && prevCp ? reflect(prevCp, cur) : cur;
					kind = 'q';
				}
				break;
			case 'h':
				end = {x: rel ? cur.x + v[0] : v[0], y: cur.y};
				break;
			case 'v':
				end = {x: cur.x, y: rel ? cur.y + v[0] : v[0]};
				break;
			case 'c':
				cp1 = at(v[0], v[1]);
				cp2 = at(v[2], v[3]);
				end = at(v[4], v[5]);
				kind = 'c';
				break;
			case 's':
				cp1 = prevKind === 'c' && prevCp ? reflect(prevCp, cur) : cur;
				cp2 = at(v[0], v[1]);
				end = at(v[2], v[3]);
				kind = 'c';
				break;
			case 'q':
				cp1 = at(v[0], v[1]);
				end = at(v[2], v[3]);
				kind = 'q';
				break;
			case 'a':
				end = at(v[5], v[6]);
				break;
			default:
				end = subpathStart;
		}
		out.push({start: cur, end, cp1, cp2, subpathStart});
		prevCp = kind === 'c' ? cp2 : kind === 'q' ? cp1 : null;
		prevKind = kind;
		cur = end;
	}
	return out;
}

/** The points a person can take hold of: every anchor, and the control
 * points a curve writes out. */
export function pathPoints(segments: Segment[]): PathPoint[] {
	const walked = walkPath(segments);
	const points: PathPoint[] = [];
	segments.forEach((seg, i)=>{
		const w = walked[i];
		const kind = lower(seg.letter);
		if (kind === 'z') return;
		if (kind === 'c' && w.cp1) points.push({segment: i, slot: 'cp1', x: w.cp1.x, y: w.cp1.y, anchors: [w.start]});
		if ((kind === 'c' || kind === 's') && w.cp2) points.push({segment: i, slot: 'cp2', x: w.cp2.x, y: w.cp2.y, anchors: [w.end]});
		if (kind === 'q' && w.cp1) points.push({segment: i, slot: 'cp1', x: w.cp1.x, y: w.cp1.y, anchors: [w.start, w.end]});
		points.push({segment: i, slot: 'end', x: w.end.x, y: w.end.y, anchors: []});
	});
	return points;
}

interface Splice {start: number; end: number; text: string}

function splice(text: string, splices: Splice[]): string {
	let out = text;
	for (const s of [...splices].sort((a, b)=>b.start - a.start)) out = out.slice(0, s.start) + s.text + out.slice(s.end);
	return out;
}

/** A number for the attribute: as the old one was written when it has not
 * moved, else to the drag's precision or the old one's, whichever is finer. */
function num(value: number, old: NumberToken | null, decimals: number): string {
	if (old && Math.abs(old.value - value) < 1e-9) return sliceOf(old);
	return fmt(value, Math.max(decimals, old ? placesOf(old.value) : 0));
}

let source = '';
const sliceOf = (t: NumberToken): string=>source.slice(t.start, t.end);

/** The absolute geometry a segment is to be rewritten to. */
interface Target {
	letter: string;
	cp1: Point | null;
	cp2: Point | null;
	end: Point;
}

/** The numbers of a whole segment for `target`, relative to `start` when its
 * letter is lowercase, reusing the old tokens where values stand. */
function emitNumbers(seg: Segment, target: Target, start: Point, decimals: number): string[] {
	const rel = isRelative(target.letter);
	const kind = lower(target.letter);
	const coord = (p: Point): Point=>rel ? {x: p.x - start.x, y: p.y - start.y} : p;
	const old = (k: number): NumberToken | null=>seg.args.at(k) ?? null;
	const sameLetter = lower(seg.letter) === kind;
	const pair = (p: Point, k: number): string[]=>{
		const c = coord(p);
		return [num(c.x, sameLetter ? old(k) : null, decimals), num(c.y, sameLetter ? old(k + 1) : null, decimals)];
	};
	switch (kind) {
		case 'h': return [num(coord(target.end).x, sameLetter ? old(0) : null, decimals)];
		case 'v': return [num(coord(target.end).y, sameLetter ? old(0) : null, decimals)];
		case 'c': return [...pair(target.cp1 ?? start, 0), ...pair(target.cp2 ?? target.end, 2), ...pair(target.end, 4)];
		case 's': return [...pair(target.cp2 ?? target.end, 0), ...pair(target.end, 2)];
		case 'q': return [...pair(target.cp1 ?? start, 0), ...pair(target.end, 2)];
		case 'a': return [...seg.args.slice(0, 5).map(sliceOf), ...pair(target.end, 5)];
		default: return pair(target.end, 0);
	}
}

const emit = (seg: Segment, target: Target, start: Point, decimals: number): string=>emitNumbers(seg, target, start, decimals).join(' ');

/** Rewrite a segment in place: number by number, keeping the separators,
 * when the letter stands; the letter and numbers together when it changes. */
function rewrite(seg: Segment, target: Target, start: Point, decimals: number): Splice[] {
	const numbers = emitNumbers(seg, target, start, decimals);
	if (target.letter === seg.letter && numbers.length === seg.args.length) {
		return seg.args.map((a, k)=>({start: a.start, end: a.end, text: numbers[k]}));
	}
	return [{start: seg.start, end: seg.end, text: `${target.letter}${numbers.join(' ')}`}];
}

/** Take a span out together with the separators before it. */
function deletion(d: string, start: number, end: number): Splice {
	let from = start;
	while (from > 0 && /[\s,]/.test(d[from - 1])) from -= 1;
	return {start: from, end, text: ''};
}

/** The start point each segment would have if the ends in `ends` applied. */
function startsFrom(segments: Segment[], ends: Point[]): Point[] {
	const starts: Point[] = [];
	let cur: Point = {x: 0, y: 0};
	let subpathStart: Point = {x: 0, y: 0};
	segments.forEach((seg, i)=>{
		starts.push(cur);
		const kind = lower(seg.letter);
		cur = kind === 'z' ? subpathStart : ends[i];
		if (kind === 'm') subpathStart = ends[i];
	});
	return starts;
}

/**
 * Put one point of a path somewhere else. An anchor takes the handles that
 * belong to it along, so the curve keeps its shape around it; the points
 * after it stay where they are, which for a relative command means its
 * numbers change, and for an H or V that can no longer reach its end means
 * it becomes an L.
 */
export function movePathPoint(d: string, point: {segment: number; slot: 'end' | 'cp1' | 'cp2'}, to: Point, decimals: number): string | null {
	const segments = parsePathData(d);
	if (!segments) return null;
	const seg = segments.at(point.segment);
	if (!seg || lower(seg.letter) === 'z') return null;
	source = d;
	const walked = walkPath(segments);
	const targets: Target[] = segments.map((s, i)=>({letter: s.letter, cp1: walked[i].cp1, cp2: walked[i].cp2, end: walked[i].end}));
	const w = walked[point.segment];
	const target = targets[point.segment];
	const kind = lower(seg.letter);
	if (point.slot === 'end') {
		const delta = {x: to.x - w.end.x, y: to.y - w.end.y};
		target.end = to;
		// the handles at this anchor come with it
		if ((kind === 'c' || kind === 's') && target.cp2) target.cp2 = add(target.cp2, delta);
		if (kind === 'q' && target.cp1) target.cp1 = add(target.cp1, delta);
		const next = segments.at(point.segment + 1);
		if (next && lower(next.letter) === 'c') {
			const t = targets[point.segment + 1];
			if (t.cp1) t.cp1 = add(t.cp1, delta);
		}
		if (kind === 'h' && Math.abs(to.y - w.start.y) > 1e-9) target.letter = isRelative(seg.letter) ? 'l' : 'L';
		if (kind === 'v' && Math.abs(to.x - w.start.x) > 1e-9) target.letter = isRelative(seg.letter) ? 'l' : 'L';
	} else if (point.slot === 'cp1' && (kind === 'c' || kind === 'q')) {
		target.cp1 = to;
	} else if (point.slot === 'cp2' && (kind === 'c' || kind === 's')) {
		target.cp2 = to;
	} else {
		return null;
	}
	return rewriteChanged(d, segments, walked, targets, decimals);
}

/** Splice every segment whose geometry, or whose start under a relative
 * command, has moved. */
function rewriteChanged(d: string, segments: Segment[], walked: Walked[], targets: Target[], decimals: number): string {
	const starts = startsFrom(segments, targets.map(t=>t.end));
	const samePoint = (a: Point | null, b: Point | null): boolean=>(a === null && b === null) || (a !== null && b !== null && Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9);
	const splices: Splice[] = [];
	segments.forEach((seg, i)=>{
		const kind = lower(seg.letter);
		if (kind === 'z') return;
		const w = walked[i];
		const t = targets[i];
		const start = starts[i];
		const startMoved = !samePoint(start, w.start);
		// an H or V reaches its end from its start, so a start that moved sideways
		// would drag the end along: say the end in full instead
		if (kind === 'h' && t.letter === seg.letter && Math.abs(start.y - t.end.y) > 1e-9) t.letter = isRelative(seg.letter) ? 'l' : 'L';
		if (kind === 'v' && t.letter === seg.letter && Math.abs(start.x - t.end.x) > 1e-9) t.letter = isRelative(seg.letter) ? 'l' : 'L';
		const explicitCps = kind === 'c' || kind === 'q' || kind === 's';
		const cpsMoved = explicitCps && ((kind !== 's' && !samePoint(t.cp1, w.cp1)) || !samePoint(t.cp2, w.cp2));
		// an S or T whose implied handle moved with the segment before it has nothing to write
		if (t.letter !== seg.letter || !samePoint(t.end, w.end) || cpsMoved || (startMoved && isRelative(seg.letter))) {
			splices.push(...rewrite(seg, t, start, decimals));
		}
	});
	return splice(d, splices);
}

const lerp = (a: Point, b: Point, t: number): Point=>({x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t});

/** The segments a split at `t` turns one segment into, in absolute terms, or
 * null for an arc, whose split needs more than its end points say. */
function splitAt(seg: Segment, w: Walked, t: number): Target[] | null {
	const kind = lower(seg.letter);
	const rel = isRelative(seg.letter);
	const line = rel ? 'l' : 'L';
	if (kind === 'm' || kind === 'a') return null;
	if (kind === 'z') {
		const p = lerp(w.start, w.subpathStart, t);
		return [{letter: line, cp1: null, cp2: null, end: p}, {letter: seg.letter, cp1: null, cp2: null, end: w.subpathStart}];
	}
	if (kind === 'l' || kind === 'h' || kind === 'v') {
		const p = lerp(w.start, w.end, t);
		return [{letter: seg.letter, cp1: null, cp2: null, end: p}, {letter: seg.letter, cp1: null, cp2: null, end: w.end}];
	}
	if ((kind === 'c' || kind === 's') && w.cp1 && w.cp2) {
		const q0 = lerp(w.start, w.cp1, t);
		const q1 = lerp(w.cp1, w.cp2, t);
		const q2 = lerp(w.cp2, w.end, t);
		const r0 = lerp(q0, q1, t);
		const r1 = lerp(q1, q2, t);
		const p = lerp(r0, r1, t);
		const cubic = rel ? 'c' : 'C';
		return [{letter: cubic, cp1: q0, cp2: r0, end: p}, {letter: cubic, cp1: r1, cp2: q2, end: w.end}];
	}
	if ((kind === 'q' || kind === 't') && w.cp1) {
		const q0 = lerp(w.start, w.cp1, t);
		const q1 = lerp(w.cp1, w.end, t);
		const p = lerp(q0, q1, t);
		const quad = rel ? 'q' : 'Q';
		return [{letter: quad, cp1: q0, cp2: null, end: p}, {letter: quad, cp1: q1, cp2: null, end: w.end}];
	}
	return null;
}

/** A segment after one that changed shape: an S or T borrowed its first
 * handle from that segment, so it is written out in full to keep its shape. */
function explicitTarget(seg: Segment, w: Walked): Target {
	const kind = lower(seg.letter);
	const rel = isRelative(seg.letter);
	if (kind === 's') return {letter: rel ? 'c' : 'C', cp1: w.cp1, cp2: w.cp2, end: w.end};
	if (kind === 't') return {letter: rel ? 'q' : 'Q', cp1: w.cp1, cp2: null, end: w.end};
	return {letter: seg.letter, cp1: w.cp1, cp2: w.cp2, end: w.end};
}

/**
 * Add a point on a segment, `t` of the way along it, as two segments of the
 * same kind that draw the same line. A closing Z gets an L before it. The
 * new point is the end of segment `segment`, where the old one was.
 */
export function insertPathPoint(d: string, segment: number, t: number, decimals: number): string | null {
	const segments = parsePathData(d);
	if (!segments) return null;
	const seg = segments.at(segment);
	if (!seg) return null;
	source = d;
	const walked = walkPath(segments);
	const w = walked[segment];
	const halves = splitAt(seg, w, t);
	if (!halves) return null;
	const [first, second] = halves;
	const splices: Splice[] = [];
	const firstText = `${first.letter}${emit(seg, first, w.start, decimals)}`;
	const secondText = lower(second.letter) === 'z' ? second.letter : `${second.letter}${emit({...seg, args: []}, second, first.end, decimals)}`;
	splices.push({start: seg.start, end: seg.end, text: `${firstText} ${secondText}`});
	const next = segments.at(segment + 1);
	if (next && /^[st]$/i.test(next.letter) && /^[csqt]$/i.test(seg.letter)) {
		splices.push(...rewrite(next, explicitTarget(next, walked[segment + 1]), w.end, decimals));
	}
	return splice(d, splices);
}

/**
 * Take the anchor at the end of `segment` out. The segment after it starts
 * where this one did, which a relative command, an H or V, or an S or T has
 * to be told. Taking out a subpath's first point makes the next point the
 * new M; a subpath left with nothing to draw goes entirely.
 */
export function removePathPoint(d: string, segment: number, decimals: number): string | null {
	const segments = parsePathData(d);
	if (!segments) return null;
	const seg = segments.at(segment);
	if (!seg || lower(seg.letter) === 'z') return null;
	source = d;
	const walked = walkPath(segments);
	const w = walked[segment];
	const next = segments.at(segment + 1);
	const nextW = walked.at(segment + 1);
	const splices: Splice[] = [];
	if (lower(seg.letter) === 'm') {
		if (!next || !nextW || lower(next.letter) === 'z' || lower(next.letter) === 'm') {
			// nothing left to draw: the subpath goes, with its Z
			const close = next && lower(next.letter) === 'z' ? next : null;
			splices.push(deletion(d, seg.start, close ? close.end : seg.end));
		} else {
			// the next point becomes the start; what came after it keeps its start
			const target: Target = {letter: seg.letter, cp1: null, cp2: null, end: nextW.end};
			splices.push({start: seg.start, end: next.end, text: `${seg.letter}${emit(seg, target, w.start, decimals)}`});
			const after = segments.at(segment + 2);
			const afterW = walked.at(segment + 2);
			if (after && afterW && /^[st]$/i.test(after.letter)) {
				splices.push(...rewrite(after, explicitTarget(after, afterW), afterW.start, decimals));
			} else if (after && after.letterAt === null && next.letter !== (seg.letter === 'M' ? 'L' : 'l')) {
				// it borrowed its letter from the segment that just went, and the M
				// reads a bare group as L or l by its own case
				splices.push({start: after.start, end: after.start, text: next.letter});
			}
		}
		return splice(d, splices);
	}
	// drop the segment; when its letter also serves the group after it, keep the letter
	const sharesLetter = next !== undefined && next.letterAt === null && seg.letterAt !== null;
	splices.push(deletion(d, sharesLetter ? seg.args[0].start : seg.start, seg.end));
	if (next && nextW && lower(next.letter) !== 'z') {
		const kind = lower(next.letter);
		let target = explicitTarget(next, nextW);
		if (kind === 'h' && Math.abs(w.start.y - nextW.end.y) > 1e-9) target = {...target, letter: isRelative(next.letter) ? 'l' : 'L'};
		if (kind === 'v' && Math.abs(w.start.x - nextW.end.x) > 1e-9) target = {...target, letter: isRelative(next.letter) ? 'l' : 'L'};
		if (target.letter !== next.letter || isRelative(next.letter)) splices.push(...rewrite(next, target, w.start, decimals));
	}
	return splice(d, splices);
}

/** Where a point lies on a segment, as the parameter `t` of the nearest
 * spot and the distance to it. Arcs are measured along their chord. */
export function nearestOnSegment(seg: Segment, w: Walked, p: Point): {t: number; distance: number} {
	const kind = lower(seg.letter);
	const curve = (t: number): Point=>{
		if ((kind === 'c' || kind === 's') && w.cp1 && w.cp2) {
			const a = lerp(lerp(w.start, w.cp1, t), lerp(w.cp1, w.cp2, t), t);
			const b = lerp(lerp(w.cp1, w.cp2, t), lerp(w.cp2, w.end, t), t);
			return lerp(a, b, t);
		}
		if ((kind === 'q' || kind === 't') && w.cp1) return lerp(lerp(w.start, w.cp1, t), lerp(w.cp1, w.end, t), t);
		return lerp(w.start, kind === 'z' ? w.subpathStart : w.end, t);
	};
	const dist = (t: number): number=>Math.hypot(curve(t).x - p.x, curve(t).y - p.y);
	let best = 0;
	let bestDist = dist(0);
	for (let i = 1; i <= 32; i++) {
		const t = i / 32;
		const dd = dist(t);
		if (dd < bestDist) {
			best = t;
			bestDist = dd;
		}
	}
	// then narrow in
	let step = 1 / 64;
	for (let i = 0; i < 20; i++) {
		for (const t of [best - step, best + step]) {
			if (t < 0 || t > 1) continue;
			const dd = dist(t);
			if (dd < bestDist) {
				best = t;
				bestDist = dd;
			}
		}
		step /= 2;
	}
	return {t: best, distance: bestDist};
}

/** The segment closest to a point and where on it, or null for a path with
 * nothing to add to. M segments draw nothing and are not offered. */
export function nearestPathSegment(d: string, p: Point): {segment: number; t: number; distance: number} | null {
	const segments = parsePathData(d);
	if (!segments) return null;
	const walked = walkPath(segments);
	let best: {segment: number; t: number; distance: number} | null = null;
	segments.forEach((seg, i)=>{
		if (lower(seg.letter) === 'm') return;
		const near = nearestOnSegment(seg, walked[i], p);
		if (!best || near.distance < best.distance) best = {segment: i, ...near};
	});
	return best;
}

// ---------------------------------------------------------------------------
// Polygons and polylines
// ---------------------------------------------------------------------------

/** The numbers of a `points` attribute, in pairs, or null when they do not
 * pair up or do not parse. */
export function parsePoints(value: string): NumberToken[] | null {
	const tokens: NumberToken[] = [];
	let i = 0;
	while (i < value.length) {
		if (/[\s,]/.test(value[i])) {
			i += 1;
			continue;
		}
		NUMBER.lastIndex = i;
		const m = NUMBER.exec(value);
		if (!m) return null;
		tokens.push({start: m.index, end: NUMBER.lastIndex, value: Number(m[0])});
		i = NUMBER.lastIndex;
	}
	return tokens.length % 2 === 0 ? tokens : null;
}

/** The separators a `points` attribute uses within a pair and between pairs. */
function pointSeparators(value: string, tokens: NumberToken[]): {pair: string; point: string} {
	const between = (a: NumberToken | undefined, b: NumberToken | undefined, fallback: string): string=>a && b ? value.slice(a.end, b.start) : fallback;
	return {pair: between(tokens.at(0), tokens.at(1), ','), point: between(tokens.at(1), tokens.at(2), ' ')};
}

export function movePolygonPoint(value: string, index: number, to: Point, decimals: number): string | null {
	const tokens = parsePoints(value);
	const x = tokens?.at(2 * index);
	const y = tokens?.at(2 * index + 1);
	if (!tokens || !x || !y) return null;
	source = value;
	return splice(value, [
		{start: x.start, end: x.end, text: num(to.x, x, decimals)},
		{start: y.start, end: y.end, text: num(to.y, y, decimals)},
	]);
}

/** Add a point after point `index`, written the way the others are. */
export function insertPolygonPoint(value: string, index: number, p: Point, decimals: number): string | null {
	const tokens = parsePoints(value);
	const y = tokens?.at(2 * index + 1);
	if (!tokens || !y) return null;
	const sep = pointSeparators(value, tokens);
	return splice(value, [{start: y.end, end: y.end, text: `${sep.point}${fmt(p.x, decimals)}${sep.pair}${fmt(p.y, decimals)}`}]);
}

export function removePolygonPoint(value: string, index: number): string | null {
	const tokens = parsePoints(value);
	const x = tokens?.at(2 * index);
	const y = tokens?.at(2 * index + 1);
	if (!tokens || !x || !y) return null;
	// take the separator before it too, or the one after for the first point
	const prev = tokens.at(2 * index - 1);
	const next = tokens.at(2 * index + 2);
	const start = index > 0 && prev ? prev.end : x.start;
	const end = index > 0 || !next ? y.end : next.start;
	return splice(value, [{start, end, text: ''}]);
}

/** The edge of a polygon or polyline closest to a point, and where on it. */
export function nearestPolygonEdge(value: string, p: Point, closed: boolean): {index: number; t: number; distance: number} | null {
	const tokens = parsePoints(value);
	if (!tokens || tokens.length < 4) return null;
	const pts: Point[] = [];
	for (let i = 0; i < tokens.length; i += 2) pts.push({x: tokens[i].value, y: tokens[i + 1].value});
	let best: {index: number; t: number; distance: number} | null = null;
	const edges = closed ? pts.length : pts.length - 1;
	for (let i = 0; i < edges; i++) {
		const a = pts[i];
		const b = pts[(i + 1) % pts.length];
		const len2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
		const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / len2));
		const q = lerp(a, b, t);
		const distance = Math.hypot(q.x - p.x, q.y - p.y);
		if (!best || distance < best.distance) best = {index: i, t, distance};
	}
	return best;
}

/** The points of a `points` attribute as absolute positions. */
export function polygonPoints(value: string): Point[] | null {
	const tokens = parsePoints(value);
	if (!tokens) return null;
	const pts: Point[] = [];
	for (let i = 0; i < tokens.length; i += 2) pts.push({x: tokens[i].value, y: tokens[i + 1].value});
	return pts;
}
