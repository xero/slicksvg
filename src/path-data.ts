// --- Path data: the points of a path, polygon, or polyline, and how to
// move, add, and remove them by rewriting only the numbers that change.
//
// A path's `d` is kept as the author wrote it: absolute stays absolute,
// relative stays relative, separators stay put, and a number is rewritten
// only when its value moves. An `H` or `V` becomes an `L` only when the
// point it reaches can no longer be said with one number.
import {fmt, placesOf, roundTo, type Point} from './geometry';

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

/** A point of a segment: where it ends, or one of its handles. */
export type Slot = 'end' | 'cp1' | 'cp2';

export interface PathPoint {
	segment: number;
	slot: Slot;
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

/** Half a unit of the last place a path's numbers are written to: two
 * points nearer than that are as one as its numbers can say. */
function reachOf(segments: Segment[]): number {
	let places = 0;
	for (const seg of segments) for (const a of seg.args) places = Math.max(places, placesOf(a.value));
	return 0.5 * 10 ** -places;
}

/**
 * The segments that end a subpath back on its first point just before its
 * Z, each with the M it meets. That is one anchor, the M's, so it is offered
 * once and moves as one.
 */
function closingEnds(segments: Segment[], walked: Walked[]): Map<number, number> {
	const reach = reachOf(segments);
	const ends = new Map<number, number>();
	let m = 0;
	segments.forEach((seg, i)=>{
		const kind = lower(seg.letter);
		if (kind === 'm') m = i;
		if (kind !== 'z' || i - 1 <= m || /^[mz]$/i.test(segments[i - 1].letter)) return;
		const end = walked[i - 1].end;
		const start = walked[m].end;
		if (Math.hypot(end.x - start.x, end.y - start.y) <= reach) ends.set(i - 1, m);
	});
	return ends;
}

/** The points a person can take hold of: every anchor, and the control
 * points a curve writes out, but for one that sits on its anchor, which
 * would only cover the anchor up. */
export function pathPoints(segments: Segment[]): PathPoint[] {
	const walked = walkPath(segments);
	const closing = closingEnds(segments, walked);
	const reach = reachOf(segments);
	const apart = (p: Point, q: Point): boolean=>Math.hypot(p.x - q.x, p.y - q.y) > reach;
	const points: PathPoint[] = [];
	segments.forEach((seg, i)=>{
		const w = walked[i];
		const kind = lower(seg.letter);
		if (kind === 'z') return;
		if (kind === 'c' && w.cp1 && apart(w.cp1, w.start)) points.push({segment: i, slot: 'cp1', x: w.cp1.x, y: w.cp1.y, anchors: [w.start]});
		if ((kind === 'c' || kind === 's') && w.cp2 && apart(w.cp2, w.end)) points.push({segment: i, slot: 'cp2', x: w.cp2.x, y: w.cp2.y, anchors: [w.end]});
		if (kind === 'q' && w.cp1 && apart(w.cp1, w.start) && apart(w.cp1, w.end)) points.push({segment: i, slot: 'cp1', x: w.cp1.x, y: w.cp1.y, anchors: [w.start, w.end]});
		if (!closing.has(i)) points.push({segment: i, slot: 'end', x: w.end.x, y: w.end.y, anchors: []});
	});
	return points;
}

interface Splice {start: number; end: number; text: string}

/** Apply splices, keeping a space between numbers that would otherwise run
 * together into one, as "10" and "3" do where "-5" stood. */
function splice(text: string, splices: Splice[]): string {
	let out = '';
	let at = 0;
	const join = (piece: string): void=>{
		out += runsOn(out, piece) ? ` ${piece}` : piece;
	};
	for (const s of [...splices].sort((a, b)=>a.start - b.start || a.end - b.end)) {
		join(text.slice(at, s.start));
		join(s.text);
		at = s.end;
	}
	join(text.slice(at));
	return out;
}

/** Whether path data would read as one number where two pieces meet: "1"
 * then "2", or "1" then ".5"; "1.5" then ".5" are still two. */
function runsOn(left: string, right: string): boolean {
	if (!/[\d.]$/.test(left)) return false;
	if (/^\d/.test(right)) return true;
	const last = /[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i.exec(left)?.[0] ?? '';
	return right.startsWith('.') && !/[.e]/i.test(last);
}

/** A number for the attribute: as the old one was written when it has not
 * moved, else as finely as the drag, the old number, or the rest of the
 * attribute is written, whichever is finest. A point the drag put down is
 * rounded before it gets here, so it comes out as short as it went in; what
 * is finer is a number the edit carried, like a relative one whose start
 * moved, which must keep every digit of the points it lies between. */
function num(value: number, old: NumberToken | null, decimals: number): string {
	if (old && Math.abs(old.value - value) < 1e-9) return sliceOf(old);
	return fmt(value, Math.max(decimals, old ? placesOf(old.value) : 0, sourcePlaces()));
}

let source = '';
const sliceOf = (t: NumberToken): string=>source.slice(t.start, t.end);

let placesSource: string | null = null;
let placesFound = 0;
/** The finest precision the attribute being edited is written to. */
function sourcePlaces(): number {
	if (placesSource !== source) {
		placesSource = source;
		placesFound = 0;
		for (const n of source.match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) ?? []) placesFound = Math.max(placesFound, placesOf(Number(n)));
	}
	return placesFound;
}

/** The absolute geometry a segment is to be rewritten to. */
interface Target {
	letter: string;
	cp1: Point | null;
	cp2: Point | null;
	end: Point;
}

/** The numbers a segment wrote for one of its points, x and y. An H or V
 * says only one of them; an S or T leaves its first handle unsaid. */
function tokensFor(seg: Segment, slot: Slot): [NumberToken | null, NumberToken | null] {
	const kind = lower(seg.letter);
	const at = (i: number): NumberToken | null=>seg.args.at(i) ?? null;
	if (slot === 'end') {
		if (kind === 'h') return [at(0), null];
		if (kind === 'v') return [null, at(0)];
		return kind === 'z' ? [null, null] : [at(seg.args.length - 2), at(seg.args.length - 1)];
	}
	if (slot === 'cp1') return kind === 'c' || kind === 'q' ? [at(0), at(1)] : [null, null];
	return kind === 'c' ? [at(2), at(3)] : kind === 's' ? [at(0), at(1)] : [null, null];
}

/** The numbers of a whole segment for `target`, relative to `start` when its
 * letter is lowercase, reusing the old tokens where values stand: a point
 * keeps its numbers as written even when the letter around it changes. */
function emitNumbers(seg: Segment, target: Target, start: Point, decimals: number): string[] {
	const rel = isRelative(target.letter);
	const kind = lower(target.letter);
	const coord = (p: Point): Point=>rel ? {x: p.x - start.x, y: p.y - start.y} : p;
	const sameCase = isRelative(seg.letter) === rel;
	const pair = (p: Point, slot: Slot): string[]=>{
		const c = coord(p);
		const [ox, oy] = sameCase ? tokensFor(seg, slot) : [null, null];
		return [num(c.x, ox, decimals), num(c.y, oy, decimals)];
	};
	switch (kind) {
		case 'h': return [pair(target.end, 'end')[0]];
		case 'v': return [pair(target.end, 'end')[1]];
		case 'c': return [...pair(target.cp1 ?? start, 'cp1'), ...pair(target.cp2 ?? target.end, 'cp2'), ...pair(target.end, 'end')];
		case 's': return [...pair(target.cp2 ?? target.end, 'cp2'), ...pair(target.end, 'end')];
		case 'q': return [...pair(target.cp1 ?? start, 'cp1'), ...pair(target.end, 'end')];
		case 'a': return [...seg.args.slice(0, 5).map(sliceOf), ...pair(target.end, 'end')];
		default: return pair(target.end, 'end');
	}
}

/** Take a span out together with the separators before it, or after it
 * when it starts the attribute. */
function deletion(d: string, start: number, end: number): Splice {
	let from = start;
	let to = end;
	while (from > 0 && /[\s,]/.test(d[from - 1])) from -= 1;
	if (from === 0) while (to < d.length && /[\s,]/.test(d[to])) to += 1;
	return {start: from, end: to, text: ''};
}

/** What each segment becomes in an edit: the segments that take its place,
 * in absolute terms. Most stay one segment with their own geometry; a split
 * makes two, and a segment that goes makes none. */
type Plan = Target[][];

interface Edit {segments: Segment[]; walked: Walked[]; plan: Plan}

/** An edit of a path's `d` that, as it stands, changes nothing. */
function begin(d: string): Edit | null {
	const segments = parsePathData(d);
	if (!segments) return null;
	source = d;
	const walked = walkPath(segments);
	const plan = segments.map((s, i)=>[{letter: s.letter, cp1: walked[i].cp1, cp2: walked[i].cp2, end: walked[i].end}]);
	return {segments, walked, plan};
}

const samePoint = (a: Point | null, b: Point | null): boolean=>(a === null && b === null) || (a !== null && b !== null && Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9);

/**
 * Write an edit into the path data, splicing only what it changes. A segment
 * that stays itself has the numbers that moved rewritten in place, or, under
 * a relative command, the numbers its moved start changes. Any other is
 * written out whole. Then what the new path needs to read as the plan says:
 * an H or V whose start left its line becomes an L, an S or T whose handle is
 * no longer the reflection it implies is written out as a C or Q, and a group
 * that borrowed a letter that is no longer before it says its own.
 */
function write(d: string, {segments, walked, plan}: Edit, decimals: number): string {
	const starts: Point[][] = [];
	let cur: Point = {x: 0, y: 0};
	let subpathStart: Point = cur;
	for (const targets of plan) {
		starts.push(targets.map(t=>{
			const start = cur;
			if (lower(t.letter) === 'm') subpathStart = t.end;
			cur = lower(t.letter) === 'z' ? subpathStart : t.end;
			return start;
		}));
	}
	let prev: Target | null = null;
	plan.forEach((targets, i)=>{
		targets.forEach((t, j)=>{
			const kind = lower(t.letter);
			const start = starts[i][j];
			const line = isRelative(t.letter) ? 'l' : 'L';
			if (kind === 'h' && Math.abs(start.y - t.end.y) > 1e-9) t.letter = line;
			if (kind === 'v' && Math.abs(start.x - t.end.x) > 1e-9) t.letter = line;
			if ((kind === 's' || kind === 't') && t.cp1) {
				const before = prev ? lower(prev.letter) : null;
				const from = kind === 's' ? (before === 'c' || before === 's' ? prev?.cp2 : null) : (before === 'q' || before === 't' ? prev?.cp1 : null);
				if (!samePoint(t.cp1, from ? reflect(from, start) : start)) t.letter = kind === 's' ? (isRelative(t.letter) ? 'c' : 'C') : (isRelative(t.letter) ? 'q' : 'Q');
			}
			prev = t;
		});
	});
	const stays = (i: number): boolean=>plan[i].length === 1 && plan[i][0].letter === segments[i].letter;
	const splices: Splice[] = [];
	segments.forEach((seg, i)=>{
		const kind = lower(seg.letter);
		const targets = plan[i];
		if (stays(i)) {
			if (kind === 'z') return;
			const t = targets[0];
			const w = walked[i];
			const start = starts[i][0];
			const cpsMoved = ((kind === 'c' || kind === 'q') && !samePoint(t.cp1, w.cp1)) || ((kind === 'c' || kind === 's') && !samePoint(t.cp2, w.cp2));
			if (samePoint(t.end, w.end) && !cpsMoved && !(isRelative(seg.letter) && !samePoint(start, w.start))) return;
			const numbers = emitNumbers(seg, t, start, decimals);
			splices.push(...seg.args.map((a, k)=>({start: a.start, end: a.end, text: numbers[k]})));
		} else if (targets.length > 0) {
			const text = targets.map((t, j)=>lower(t.letter) === 'z' ? t.letter : `${t.letter}${emitNumbers(seg, t, starts[i][j], decimals).join(' ')}`);
			splices.push({start: seg.start, end: seg.end, text: text.join(' ')});
		} else if (i === 0 || plan[i - 1].length > 0) {
			// segments that go together go as one span
			let last = i;
			while (last + 1 < segments.length && plan[last + 1].length === 0) last += 1;
			splices.push(deletion(d, seg.start, segments[last].end));
		}
	});
	// a group with no letter of its own reads as the letter before it, and
	// keeps the letter that went with the segment it borrowed it from
	let reads: string | null = null;
	let ownerGone = false;
	segments.forEach((seg, i)=>{
		const targets = plan[i];
		if (targets.length === 0) {
			if (seg.letterAt !== null) ownerGone = true;
			return;
		}
		if (stays(i) && seg.letterAt === null && (reads !== seg.letter || ownerGone)) splices.push({start: seg.start, end: seg.start, text: seg.letter});
		ownerGone = false;
		const last = targets[targets.length - 1].letter;
		reads = lower(last) === 'm' ? (last === 'M' ? 'L' : 'l') : lower(last) === 'z' ? null : last;
	});
	return splice(d, splices);
}

/** Where a dragged point goes down: as finely as the drag, or its old
 * numbers, say. */
function dropped(seg: Segment, slot: Slot, at: Point, decimals: number): Point {
	const [ox, oy] = tokensFor(seg, slot);
	return {x: roundTo(at.x, Math.max(decimals, ox ? placesOf(ox.value) : 0)), y: roundTo(at.y, Math.max(decimals, oy ? placesOf(oy.value) : 0))};
}

/**
 * Put one point of a path somewhere else. An anchor takes the handles that
 * belong to it along, so the curve keeps its shape around it; the points
 * after it stay where they are, which for a relative command means its
 * numbers change, and for an H or V that can no longer reach its end means
 * it becomes an L. A subpath's first point brings the end that closes the
 * subpath onto it.
 */
export function movePathPoint(d: string, point: {segment: number; slot: Slot}, at: Point, decimals: number): string | null {
	const e = begin(d);
	const seg = e?.segments.at(point.segment);
	if (!e || !seg || lower(seg.letter) === 'z') return null;
	const {segments, walked, plan} = e;
	const to = dropped(seg, point.slot, at, decimals);
	const target = plan[point.segment][0];
	const kind = lower(seg.letter);
	if (point.slot === 'end') {
		const delta = {x: to.x - walked[point.segment].end.x, y: to.y - walked[point.segment].end.y};
		// the anchor, and the handles at it, come with it
		const arrive = (i: number): void=>{
			const t = plan[i][0];
			const k = lower(segments[i].letter);
			t.end = to;
			if ((k === 'c' || k === 's') && t.cp2) t.cp2 = add(t.cp2, delta);
			if (k === 'q' && t.cp1) t.cp1 = add(t.cp1, delta);
		};
		arrive(point.segment);
		for (const [end, m] of closingEnds(segments, walked)) if (m === point.segment) arrive(end);
		// as does the handle leaving it, written or implied
		const next = segments.at(point.segment + 1);
		const t = plan.at(point.segment + 1)?.[0];
		if (next && t?.cp1 && /^[cst]$/i.test(next.letter)) t.cp1 = add(t.cp1, delta);
	} else if (point.slot === 'cp1' && (kind === 'c' || kind === 'q')) {
		target.cp1 = to;
	} else if (point.slot === 'cp2' && (kind === 'c' || kind === 's')) {
		target.cp2 = to;
	} else {
		return null;
	}
	return write(d, e, decimals);
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

/**
 * Add a point on a segment, `t` of the way along it, as two segments of the
 * same kind that draw the same line. A closing Z gets an L before it. The
 * new point is the end of segment `segment`, where the old one was.
 */
export function insertPathPoint(d: string, segment: number, t: number, decimals: number): string | null {
	const e = begin(d);
	const seg = e?.segments.at(segment);
	const halves = e && seg ? splitAt(seg, e.walked[segment], t) : null;
	if (!e || !halves) return null;
	e.plan[segment] = halves;
	return write(d, e, decimals);
}

/**
 * Take the anchor at the end of `segment` out. The segment after it starts
 * where this one did, which a relative command, an H or V, or an S or T has
 * to be told. Taking out a subpath's first point makes the next point the
 * new M, or, when the subpath closes onto it, joins the points either side
 * of it as any other point's going does; a subpath left with nothing to draw
 * goes entirely.
 */
export function removePathPoint(d: string, segment: number, decimals: number): string | null {
	const e = begin(d);
	const seg = e?.segments.at(segment);
	if (!e || !seg || lower(seg.letter) === 'z') return null;
	const {segments, walked, plan} = e;
	const next = segments.at(segment + 1);
	if (lower(seg.letter) !== 'm') {
		plan[segment] = [];
		return write(d, e, decimals);
	}
	const closing = [...closingEnds(segments, walked)].find(([, m])=>m === segment)?.[0];
	if (closing !== undefined && closing > segment + 1) {
		// the closing segment goes, and the subpath starts where it did
		plan[closing] = [];
		plan[segment][0].end = walked[closing].start;
	} else if (closing !== undefined || !next || /^[mz]$/i.test(next.letter)) {
		// nothing left to draw: the subpath goes, with its Z
		const last = closing ?? segment;
		const close = segments.at(last + 1);
		for (let i = segment; i <= last; i++) plan[i] = [];
		if (close && lower(close.letter) === 'z') plan[last + 1] = [];
	} else {
		// the next point becomes the start; what came after it keeps its start
		plan[segment][0].end = walked[segment + 1].end;
		plan[segment + 1] = [];
	}
	return write(d, e, decimals);
}

const lineTo = (seg: Segment, end: Point): Target=>({letter: isRelative(seg.letter) ? 'l' : 'L', cp1: null, cp2: null, end});

/** Whether a cubic's handles both lie on the line from its start to its end,
 * so that it draws that line. */
function straightCubic(start: Point, cp1: Point, cp2: Point, end: Point, reach: number): boolean {
	const chord = {x: end.x - start.x, y: end.y - start.y};
	const length = Math.hypot(chord.x, chord.y);
	const on = (p: Point): boolean=>{
		const v = {x: p.x - start.x, y: p.y - start.y};
		if (length <= reach) return Math.hypot(v.x, v.y) <= reach;
		const along = (v.x * chord.x + v.y * chord.y) / length;
		return Math.abs(v.x * chord.y - v.y * chord.x) / length <= reach && along >= -reach && along <= length + reach;
	};
	return on(cp1) && on(cp2);
}

/**
 * Put a curve's handle back into its anchor. A quadratic's one handle shapes
 * both its ends, so it becomes the line between them; a cubic left with both
 * handles on its chord draws a line, and is written as one.
 */
export function retractPathHandle(d: string, point: {segment: number; slot: 'cp1' | 'cp2'}, decimals: number): string | null {
	const e = begin(d);
	const seg = e?.segments.at(point.segment);
	if (!e || !seg) return null;
	const w = e.walked[point.segment];
	const t = e.plan[point.segment][0];
	const kind = lower(seg.letter);
	if (kind === 'q' && point.slot === 'cp1') t.cp1 = w.start;
	else if (kind === 'c' && point.slot === 'cp1') t.cp1 = w.start;
	else if ((kind === 'c' || kind === 's') && point.slot === 'cp2') t.cp2 = w.end;
	else return null;
	if (kind === 'q' || (t.cp1 && t.cp2 && straightCubic(w.start, t.cp1, t.cp2, w.end, reachOf(e.segments)))) e.plan[point.segment] = [lineTo(seg, w.end)];
	return write(d, e, decimals);
}

/** The spot `t` of the way along a segment. Arcs are taken along their chord. */
export function pointOnSegment(seg: Segment, w: Walked, t: number): Point {
	const kind = lower(seg.letter);
	if ((kind === 'c' || kind === 's') && w.cp1 && w.cp2) {
		const a = lerp(lerp(w.start, w.cp1, t), lerp(w.cp1, w.cp2, t), t);
		const b = lerp(lerp(w.cp1, w.cp2, t), lerp(w.cp2, w.end, t), t);
		return lerp(a, b, t);
	}
	if ((kind === 'q' || kind === 't') && w.cp1) return lerp(lerp(w.start, w.cp1, t), lerp(w.cp1, w.end, t), t);
	return lerp(w.start, kind === 'z' ? w.subpathStart : w.end, t);
}

/** Where a point lies on a segment, as the parameter `t` of the nearest
 * spot and the distance to it. Arcs are measured along their chord. */
export function nearestOnSegment(seg: Segment, w: Walked, p: Point): {t: number; distance: number} {
	const curve = (t: number): Point=>pointOnSegment(seg, w, t);
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
// Curves: smooth and corner anchors, curved and straight segments, and the
// handle across an anchor that a smooth one keeps in line
// ---------------------------------------------------------------------------

/** How a drag of one handle moves the handle across its anchor: to the same
 * length on the far side, along the same line at its own length, or not. */
export type HandleMode = 'mirrored' | 'aligned' | 'independent';

const sub = (p: Point, q: Point): Point=>({x: p.x - q.x, y: p.y - q.y});
const times = (p: Point, k: number): Point=>({x: p.x * k, y: p.y * k});
const size = (p: Point): number=>Math.hypot(p.x, p.y);
const cross = (p: Point, q: Point): number=>p.x * q.y - p.y * q.x;
const dot = (p: Point, q: Point): number=>p.x * q.x + p.y * q.y;
function unit(p: Point): Point | null {
	const l = size(p);
	return l < 1e-12 ? null : {x: p.x / l, y: p.y / l};
}

/**
 * The segments either side of the anchor at the end of `segment`: the one
 * arriving at it and the one leaving it. A closed subpath goes round, so its
 * first point has the closing line, or the curve that closes onto it,
 * arriving; a closing line with no length is no side of its own.
 */
export function anchorSides(segments: Segment[], walked: Walked[], segment: number): {into: number | null; out: number | null} {
	const seg = segments.at(segment);
	if (!seg || lower(seg.letter) === 'z') return {into: null, out: null};
	// the subpath begins at its M, or after a Z when it has no M of its own
	let m = segment;
	while (m > 0 && !/^[mz]$/i.test(segments[m].letter)) m -= 1;
	let z: number | null = null;
	for (let i = m + 1; i < segments.length && lower(segments[i].letter) !== 'm'; i++) {
		if (lower(segments[i].letter) === 'z') {
			z = i;
			break;
		}
	}
	const closes = z !== null && size(sub(walked[z].start, walked[z].end)) <= reachOf(segments);
	const draws = (i: number): boolean=>i < segments.length && !/^[mz]$/i.test(segments[i].letter);
	if (segment === m && lower(seg.letter) === 'm') {
		const into = z === null ? null : closes ? z - 1 : z;
		return {into: into !== null && into > m ? into : null, out: draws(m + 1) ? m + 1 : null};
	}
	if (z === segment + 1) return {into: segment, out: !closes ? z : draws(m + 1) && m + 1 !== segment ? m + 1 : null};
	return {into: segment, out: draws(segment + 1) ? segment + 1 : null};
}

/** An arc's centre form (SVG 1.1 F.6.5), for the way it runs at its ends. */
function arcCentre(seg: Segment, w: Walked): {rx: number; ry: number; phi: number; theta: number; delta: number} | null {
	const [rx0, ry0, deg, large, sweep] = seg.args.map(a=>a.value);
	if (rx0 === 0 || ry0 === 0 || size(sub(w.start, w.end)) < 1e-12) return null;
	const phi = (deg * Math.PI) / 180;
	const cos = Math.cos(phi);
	const sin = Math.sin(phi);
	const hx = (w.start.x - w.end.x) / 2;
	const hy = (w.start.y - w.end.y) / 2;
	const x1 = cos * hx + sin * hy;
	const y1 = -sin * hx + cos * hy;
	let rx = Math.abs(rx0);
	let ry = Math.abs(ry0);
	const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
	if (lambda > 1) {
		rx *= Math.sqrt(lambda);
		ry *= Math.sqrt(lambda);
	}
	const num2 = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
	const den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
	const k = (large !== sweep ? 1 : -1) * Math.sqrt(Math.max(0, num2 / den));
	const cx = (k * rx * y1) / ry;
	const cy = (-k * ry * x1) / rx;
	const angle = (u: Point, v: Point): number=>Math.atan2(cross(u, v), dot(u, v));
	const u = {x: (x1 - cx) / rx, y: (y1 - cy) / ry};
	const v = {x: (-x1 - cx) / rx, y: (-y1 - cy) / ry};
	let delta = angle(u, v);
	if (!sweep && delta > 0) delta -= 2 * Math.PI;
	if (sweep && delta < 0) delta += 2 * Math.PI;
	return {rx, ry, phi, theta: angle({x: 1, y: 0}, u), delta};
}

/** The way a segment leaves its start, or arrives at its end, as a unit
 * vector along the path, with the length of the handle or line that says
 * so; null for a segment that goes nowhere. An arc says it exactly. */
function heading(seg: Segment, w: Walked, atEnd: boolean): {dir: Point; length: number} | null {
	if (lower(seg.letter) === 'a') {
		const c = arcCentre(seg, w);
		const th = c ? (atEnd ? c.theta + c.delta : c.theta) : 0;
		const s = c ? Math.sign(c.delta) : 0;
		const dir = c
			? unit({x: s * (-c.rx * Math.cos(c.phi) * Math.sin(th) - c.ry * Math.sin(c.phi) * Math.cos(th)), y: s * (-c.rx * Math.sin(c.phi) * Math.sin(th) + c.ry * Math.cos(c.phi) * Math.cos(th))})
			: unit(sub(w.end, w.start));
		return dir && {dir, length: Infinity};
	}
	const pts = [w.start, w.cp1, w.cp2, w.end].filter((p): p is Point=>p !== null);
	if (atEnd) pts.reverse();
	const from = pts[0];
	const to = pts.find(p=>size(sub(p, from)) > 1e-9);
	const dir = to ? unit(atEnd ? sub(from, to) : sub(to, from)) : null;
	return to && dir ? {dir, length: size(sub(to, from))} : null;
}

/** How far two directions may differ and still be one line through an
 * anchor: what rounding the numbers that say them allows, at least two
 * degrees and at most ten, as the sine of the angle. */
function slackFor(reach: number, a: number, b: number): number {
	return Math.min(Math.max(Math.sin(Math.PI / 90), reach / a + reach / b), Math.sin(Math.PI / 18));
}

/** The segment as a cubic in the plan, so both its handles can be set: a
 * line gets handles at its thirds, a quadratic is raised exactly, and a
 * closing Z gets the curve before it. Null for an arc or an M. */
function cubicIn(e: Edit, i: number): Target | null {
	const w = e.walked[i];
	const t = e.plan[i][0];
	const kind = lower(t.letter);
	const letter = isRelative(e.segments[i].letter) ? 'c' : 'C';
	let c: Target;
	if (kind === 'c' || kind === 's') return t;
	if (/^[lhvz]$/.test(kind)) c = {letter, cp1: lerp(w.start, t.end, 1 / 3), cp2: lerp(w.start, t.end, 2 / 3), end: t.end};
	else if ((kind === 'q' || kind === 't') && t.cp1) c = {letter, cp1: lerp(w.start, t.cp1, 2 / 3), cp2: lerp(t.end, t.cp1, 2 / 3), end: t.end};
	else return null;
	e.plan[i] = kind === 'z' ? [c, t] : [c];
	return c;
}

/** Whether the path runs straight on through the anchor at the end of
 * `segment` with a curve on at least one side: a smooth point. A corner is
 * any other anchor with a segment on both sides; null for an open end. */
export function anchorKind(d: string, segment: number): 'smooth' | 'corner' | null {
	const segments = parsePathData(d);
	if (!segments) return null;
	const walked = walkPath(segments);
	const {into, out} = anchorSides(segments, walked, segment);
	if (into === null || out === null) return null;
	const a = heading(segments[into], walked[into], true);
	const b = heading(segments[out], walked[out], false);
	const reach = reachOf(segments);
	if (!a || !b || dot(a.dir, b.dir) <= 0 || Math.abs(cross(a.dir, b.dir)) > slackFor(reach, a.length, b.length)) return 'corner';
	const P = walked[segment].end;
	const off = (p: Point | null): boolean=>p !== null && size(sub(p, P)) > reach;
	const curvedIn = /^[a]$/i.test(segments[into].letter) || (/^[csqt]$/i.test(segments[into].letter) && off(/^[qt]$/i.test(segments[into].letter) ? walked[into].cp1 : walked[into].cp2));
	const curvedOut = /^[a]$/i.test(segments[out].letter) || (/^[csqt]$/i.test(segments[out].letter) && off(walked[out].cp1));
	return curvedIn || curvedOut ? 'smooth' : 'corner';
}

/**
 * Make the anchor at the end of `segment` smooth: both its handles on one
 * line through it, across the angle the path turns there. A line beside it
 * becomes a curve that leaves its far end as straight as before; a
 * quadratic becomes the cubic that draws it. Handles it has keep their
 * lengths, and new ones are a third of their segment. An arc keeps its shape,
 * and the other side lines up with it.
 */
export function smoothPathPoint(d: string, segment: number, decimals: number): string | null {
	const e = begin(d);
	if (!e) return null;
	const {segments, walked} = e;
	const {into, out} = anchorSides(segments, walked, segment);
	if (into === null || out === null) return null;
	const P = walked[segment].end;
	const inArc = lower(segments[into].letter) === 'a';
	const outArc = lower(segments[out].letter) === 'a';
	if (inArc && outArc) return null;
	const dIn = heading(segments[into], walked[into], true)?.dir;
	const dOut = heading(segments[out], walked[out], false)?.dir;
	if (!dIn || !dOut) return null;
	const tangent = inArc ? dIn : outArc ? dOut : unit(add(dIn, dOut)) ?? {x: -dIn.y, y: dIn.x};
	const reach = reachOf(segments);
	const reachFor = (c: Target, i: number, slot: 'cp1' | 'cp2'): number=>{
		const h = c[slot];
		return h && size(sub(h, P)) > reach ? size(sub(h, P)) : size(sub(c.end, walked[i].start)) / 3;
	};
	if (!inArc) {
		const c = cubicIn(e, into);
		if (!c) return null;
		c.cp2 = sub(P, times(tangent, reachFor(c, into, 'cp2')));
	}
	if (!outArc) {
		const c = cubicIn(e, out);
		if (!c) return null;
		c.cp1 = add(P, times(tangent, reachFor(c, out, 'cp1')));
	}
	return write(d, e, decimals);
}

/**
 * Make the anchor at the end of `segment` symmetric: smooth, with its two
 * handles the same length, which is what an S says. They keep the line a
 * smooth point has, or take the one smoothing would give a corner, and share
 * the length they had between them; a side with no handle yet counts a third
 * of its segment. The handle leaving the anchor is rounded as it will be
 * written, and the other mirrors it exactly, so the two read as one length.
 * An arc beside the anchor has no handle to match.
 */
export function symmetricPathPoint(d: string, segment: number, decimals: number): string | null {
	const e = begin(d);
	if (!e) return null;
	const {segments, walked} = e;
	const {into, out} = anchorSides(segments, walked, segment);
	if (into === null || out === null || lower(segments[into].letter) === 'a' || lower(segments[out].letter) === 'a') return null;
	const P = walked[segment].end;
	const dIn = heading(segments[into], walked[into], true)?.dir;
	const dOut = heading(segments[out], walked[out], false)?.dir;
	if (!dIn || !dOut) return null;
	const tangent = unit(add(dIn, dOut)) ?? {x: -dIn.y, y: dIn.x};
	const reach = reachOf(segments);
	const arriving = cubicIn(e, into);
	const leaving = cubicIn(e, out);
	if (!arriving || !leaving) return null;
	const reachOfHandle = (c: Target, i: number, slot: 'cp1' | 'cp2'): number=>{
		const h = c[slot];
		return h && size(sub(h, P)) > reach ? size(sub(h, P)) : size(sub(c.end, walked[i].start)) / 3;
	};
	const length = (reachOfHandle(arriving, into, 'cp2') + reachOfHandle(leaving, out, 'cp1')) / 2;
	const places = Math.max(decimals, sourcePlaces());
	const h = add(P, times(tangent, length));
	const out1 = {x: roundTo(h.x, places), y: roundTo(h.y, places)};
	leaving.cp1 = out1;
	arriving.cp2 = reflect(out1, P);
	return write(d, e, decimals);
}

/**
 * Make the anchor at the end of `segment` a corner: its handles go back into
 * it. A curve beside it left drawing a straight line is written as a line.
 */
export function cornerPathPoint(d: string, segment: number, decimals: number): string | null {
	const e = begin(d);
	if (!e) return null;
	const {segments, walked, plan} = e;
	const {into, out} = anchorSides(segments, walked, segment);
	const P = walked[segment].end;
	const reach = reachOf(segments);
	const retract = (i: number | null, slot: 'cp1' | 'cp2'): boolean=>{
		if (i === null || !/^[csqt]$/i.test(plan[i][0].letter)) return false;
		const was = plan[i];
		const c = cubicIn(e, i);
		const h = c?.[slot];
		if (!c || !h || size(sub(h, P)) <= reach) {
			// a side whose handle is already in stays as it was written
			plan[i] = was;
			return false;
		}
		c[slot] = P;
		if (c.cp1 && c.cp2 && straightCubic(walked[i].start, c.cp1, c.cp2, c.end, reach)) plan[i] = [lineTo(segments[i], c.end)];
		return true;
	};
	// both sides, whatever the first one did
	const changed = [retract(into, 'cp2'), retract(out, 'cp1')];
	return changed.includes(true) ? write(d, e, decimals) : null;
}

/** Whether a segment is written as a curve: a curve's letter or an arc's,
 * even one whose handles lie on its chord, so that it has handles to pull. */
export function segmentCurved(d: string, segment: number): boolean {
	return /^[csqta]$/i.test(parsePathData(d)?.at(segment)?.letter ?? '');
}

/** Make a straight segment a curve that draws the same line, its handles at
 * its thirds, ready to be pulled. A closing Z gets the curve before it. */
export function curvePathSegment(d: string, segment: number, decimals: number): string | null {
	const e = begin(d);
	const seg = e?.segments.at(segment);
	if (!e || !seg || !/^[lhvz]$/i.test(seg.letter)) return null;
	const w = e.walked[segment];
	if (size(sub(w.end, w.start)) <= reachOf(e.segments) || !cubicIn(e, segment)) return null;
	return write(d, e, decimals);
}

/** Make a curve or an arc straight. A curve that closes its subpath onto a Z
 * goes, since the Z draws that line itself. */
export function straightenPathSegment(d: string, segment: number, decimals: number): string | null {
	const e = begin(d);
	const seg = e?.segments.at(segment);
	if (!e || !seg || !/^[csqta]$/i.test(seg.letter)) return null;
	const w = e.walked[segment];
	const next = e.segments.at(segment + 1);
	const closes = next && lower(next.letter) === 'z' && size(sub(w.end, e.walked[segment + 1].end)) <= reachOf(e.segments);
	e.plan[segment] = closes ? [] : [lineTo(seg, w.end)];
	return write(d, e, decimals);
}

/**
 * Pull handles out of the anchor at the end of `segment`, as a pen does: the
 * handle leaving it goes to `at`, and the one arriving at it goes the same
 * length the other way, so the anchor is smooth. An end of an open path has
 * one side, whose handle goes to `at`. A line beside it becomes a curve; an
 * arc keeps its shape.
 */
export function pullHandles(d: string, segment: number, at: Point, decimals: number): string | null {
	const e = begin(d);
	const seg = e?.segments.at(segment);
	if (!e || !seg || lower(seg.letter) === 'z') return null;
	const {into, out} = anchorSides(e.segments, e.walked, segment);
	const curves = (i: number | null): number | null=>i !== null && lower(e.segments[i].letter) !== 'a' ? i : null;
	const inSide = curves(into);
	const outSide = curves(out);
	if (inSide === null && outSide === null) return null;
	const P = e.walked[segment].end;
	const to = {x: roundTo(at.x, decimals), y: roundTo(at.y, decimals)};
	const leaving = outSide === null ? null : cubicIn(e, outSide);
	if (leaving) leaving.cp1 = to;
	const arriving = inSide === null ? null : cubicIn(e, inSide);
	if (arriving) arriving.cp2 = out === null ? to : reflect(to, P);
	return write(d, e, decimals);
}

/**
 * Bend a segment so the spot `t` of the way along it goes to `at`. A cubic's
 * handles share the move by how near each end the spot is, as Inkscape
 * shares it; a quadratic's one handle takes it all; a line becomes a cubic
 * first. Where the segment ran on smoothly into the one beyond an end, the
 * handle across that end follows, so the join stays smooth.
 */
export function bendPathSegment(d: string, segment: number, t: number, at: Point, decimals: number): string | null {
	const e = begin(d);
	const seg = e?.segments.at(segment);
	if (!e || !seg || /^[ma]$/i.test(seg.letter)) return null;
	const {segments, walked, plan} = e;
	const w = walked[segment];
	const reach = reachOf(segments);
	if (size(sub(w.end, w.start)) <= reach && /^[lhvz]$/i.test(seg.letter)) return null;
	const u = Math.min(0.95, Math.max(0.05, t));
	const to = {x: roundTo(at.x, decimals), y: roundTo(at.y, decimals)};
	const kind = lower(seg.letter);
	if ((kind === 'q' || kind === 't') && w.cp1) {
		const delta = sub(to, pointOnSegment(seg, w, u));
		plan[segment] = [{letter: isRelative(seg.letter) ? 'q' : 'Q', cp1: add(w.cp1, times(delta, 1 / (2 * u * (1 - u)))), cp2: null, end: w.end}];
		return write(d, e, decimals);
	}
	// how the segment met the ones beyond its ends, before it moved
	const leaves = heading(seg, w, false);
	const arrives = heading(seg, w, true);
	const c = cubicIn(e, segment);
	if (!c?.cp1 || !c.cp2) return null;
	const before = {cp1: c.cp1, cp2: c.cp2};
	const delta = sub(to, pointOnSegment({...seg, letter: 'C'}, {...w, cp1: c.cp1, cp2: c.cp2}, u));
	const feel = u <= 1 / 6 ? 0 : u <= 0.5 ? ((6 * u - 1) / 2) ** 3 / 2 : u <= 5 / 6 ? (1 - ((6 * (1 - u) - 1) / 2) ** 3) / 2 + 0.5 : 1;
	c.cp1 = add(c.cp1, times(delta, (1 - feel) / (3 * u * (1 - u) ** 2)));
	c.cp2 = add(c.cp2, times(delta, feel / (3 * u * u * (1 - u))));
	// a Z ends on its subpath's first point, the anchor of its M
	let endAnchor = segment;
	if (kind === 'z') while (endAnchor > 0 && lower(segments[endAnchor].letter) !== 'm') endAnchor -= 1;
	const follow = (slot: 'cp1' | 'cp2'): void=>{
		const start = slot === 'cp1';
		const anchor = start ? w.start : w.end;
		const way = start ? leaves : arrives;
		const side = start ? anchorSides(segments, walked, segment - 1).into : anchorSides(segments, walked, endAnchor).out;
		const across = start ? 'cp2' : 'cp1';
		const other = side === null ? null : walked[side][across];
		const h = c[slot];
		if (side === null || side === segment || !other || !h || !way || !/^[cs]$/i.test(segments[side].letter)) return;
		const v = sub(other, anchor);
		const lv = size(v);
		// the handle across ran on from this end in a line, or the join was a corner to leave be
		const expect = start ? times(way.dir, -1) : way.dir;
		if (lv <= reach || dot(v, expect) <= 0 || Math.abs(cross(v, expect)) / lv > slackFor(reach, lv, way.length)) return;
		const away = unit(sub(anchor, h));
		const mirrored = Math.abs(size(sub(before[slot], anchor)) - lv) <= 2 * reach;
		if (away) plan[side][0][across] = add(anchor, times(away, mirrored ? size(sub(h, anchor)) : lv));
	};
	follow('cp1');
	follow('cp2');
	return write(d, e, decimals);
}

/** The handle across the anchor from a handle, which a smooth anchor keeps
 * in line: which segment's, where it is, and whether an S only implies it.
 * A quadratic's handle shapes both its ends and has none. */
function oppositeOf(e: Edit, point: {segment: number; slot: 'cp1' | 'cp2'}): {segment: number; slot: 'cp1' | 'cp2'; anchor: Point; at: Point; implied: boolean} | null {
	const {segments, walked} = e;
	const seg = segments[point.segment];
	if (point.slot === 'cp2') {
		if (!/^[cs]$/i.test(seg.letter)) return null;
		const {out} = anchorSides(segments, walked, point.segment);
		const at = out === null ? null : walked[out].cp1;
		if (out === null || !at || !/^[cs]$/i.test(segments[out].letter)) return null;
		return {segment: out, slot: 'cp1', anchor: walked[point.segment].end, at, implied: lower(segments[out].letter) === 's'};
	}
	if (lower(seg.letter) !== 'c') return null;
	const {into} = anchorSides(segments, walked, point.segment - 1);
	const at = into === null ? null : walked[into].cp2;
	if (into === null || !at || !/^[cs]$/i.test(segments[into].letter)) return null;
	return {segment: into, slot: 'cp2', anchor: walked[point.segment].start, at, implied: false};
}

/**
 * How a drag of this handle should move the one across its anchor, read from
 * where the two are: mirrored when they lie on one line through the anchor
 * at one length, aligned when on one line at different lengths, independent
 * otherwise or when either has no length. The handle an S implies is a
 * mirror by the letter's own meaning.
 */
export function handleMode(d: string, point: {segment: number; slot: 'cp1' | 'cp2'}): HandleMode | null {
	const e = begin(d);
	const seg = e?.segments.at(point.segment);
	const h = e && seg ? e.walked[point.segment][point.slot] : null;
	if (!e || !seg || !h) return null;
	// a T after a quadratic reflects its handle by the letter's own meaning
	const next = e.segments.at(point.segment + 1);
	if (lower(seg.letter) === 'q' && next && lower(next.letter) === 't') return 'mirrored';
	const o = oppositeOf(e, point);
	if (!o) return 'independent';
	if (o.implied) return 'mirrored';
	const reach = reachOf(e.segments);
	const u = sub(h, o.anchor);
	const v = sub(o.at, o.anchor);
	const lu = size(u);
	const lv = size(v);
	if (lu <= reach || lv <= reach) return 'independent';
	const bend = Math.abs(cross(u, v)) / (lu * lv);
	if (dot(u, v) >= 0 || bend > slackFor(reach, lu, lv)) return 'independent';
	return Math.abs(lu - lv) <= 2 * reach ? 'mirrored' : 'aligned';
}

/** Move a handle, taking the one across its anchor along as `mode` says. */
export function moveHandle(d: string, point: {segment: number; slot: 'cp1' | 'cp2'}, at: Point, mode: HandleMode, decimals: number): string | null {
	const e = begin(d);
	const seg = e?.segments.at(point.segment);
	if (!e || !seg || (point.slot === 'cp1' && !/^[cq]$/i.test(seg.letter)) || (point.slot === 'cp2' && !/^[cs]$/i.test(seg.letter))) return null;
	const to = dropped(seg, point.slot, at, decimals);
	e.plan[point.segment][0][point.slot] = to;
	const o = oppositeOf(e, point);
	if (o && mode !== 'independent') {
		const away = unit(sub(o.anchor, to));
		const reach = mode === 'mirrored' ? size(sub(to, o.anchor)) : size(sub(o.at, o.anchor));
		if (away) e.plan[o.segment][0][o.slot] = add(o.anchor, times(away, reach));
	}
	// a quadratic's handle is the one a T after it reflects, unless the two are let go
	const next = e.segments.at(point.segment + 1);
	if (mode !== 'independent' && lower(seg.letter) === 'q' && next && lower(next.letter) === 't') e.plan[point.segment + 1][0].cp1 = reflect(to, e.walked[point.segment].end);
	return write(d, e, decimals);
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

/** A polygon's or polyline's points as path data, every number and
 * separator as written but for any at either end: an M, the rest as the
 * lines it implies, and a Z to close a polygon. Null when the points do not
 * pair up. */
export function pointsAsPathData(points: string, closed: boolean): string | null {
	const tokens = parsePoints(points);
	if (!tokens || tokens.length < 2) return null;
	return `M${points.replace(/^[\s,]+|[\s,]+$/g, '')}${closed ? 'Z' : ''}`;
}
