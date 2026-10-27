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
	// the point goes down as finely as the drag, or its old numbers, say
	const [ox, oy] = tokensFor(seg, point.slot);
	const to = {x: roundTo(at.x, Math.max(decimals, ox ? placesOf(ox.value) : 0)), y: roundTo(at.y, Math.max(decimals, oy ? placesOf(oy.value) : 0))};
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
	const line = {letter: isRelative(seg.letter) ? 'l' : 'L', cp1: null, cp2: null, end: w.end};
	if (kind === 'q' && point.slot === 'cp1') t.cp1 = w.start;
	else if (kind === 'c' && point.slot === 'cp1') t.cp1 = w.start;
	else if ((kind === 'c' || kind === 's') && point.slot === 'cp2') t.cp2 = w.end;
	else return null;
	if (kind === 'q' || (t.cp1 && t.cp2 && straightCubic(w.start, t.cp1, t.cp2, w.end, reachOf(e.segments)))) e.plan[point.segment] = [line];
	return write(d, e, decimals);
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
