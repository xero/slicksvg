import {EditorView} from '@codemirror/view';
import {EditorState, EditorSelection, Compartment} from '@codemirror/state';
import {keymap} from '@codemirror/view';
import {xml} from '@codemirror/lang-xml';
import {basicSetup} from 'codemirror';
import {tokyoNightDay} from '@fsegurai/codemirror-theme-tokyo-night-day';
import {tokyoNightStorm} from '@fsegurai/codemirror-theme-tokyo-night-storm';
import {linter, lintGutter, forceLinting} from '@codemirror/lint';
import {findElementAtCursor, type ElementRef} from './xray';
import {startTags, readAttribute, attributesOf, planAttributeEdits, applyChanges, stampSource, parseSource, elementExtent, removalRange, duplicateInsertion, childInsertion, SOURCE_ATTR, type StartTag, type TextChange} from './source-map';
import {
	SHAPE_KINDS, SHAPE_NAMES, byPoints, pointsNeeded, paintOf, strokeWidthFor, snapAngle, drawnShape, placedShape, pointsList, draggedAnchor, penPathData, shapeMarkup, spacedClose,
	type ShapeKind, type PointKind, type Anchor,
} from './draw';
import {GEOMETRY, SHAPES, plainLength, shapePathData, asPathChanges, conversionBlocked, type Length, type ShapePath} from './shapes';
import {findSvgTarget, selectionChain, nextInChain, ordinalOf, boxCorners, handleCursor} from './select';
import {planMove, planResize, planScaleAbout, planRotate, planMatrix, mirrorAbout, parentCenter, simplestTransform, parseTransform, listMatrix, commaIn, axisMaps, scaleMatrix, multiply, invert, applyToVector, applyToPoint, pixelsPerUnit, decimalsFor, roundTo, fmt, placesOf, IDENTITY, type Matrix, type Point, type Rect, type Handle, type EditPlan} from './geometry';
import {
	parsePathData, walkPath, pathPoints, pointOnSegment, movePathPoint, transformPathPoints, insertPathPoint, removePathPoint, retractPathHandle, nearestPathSegment,
	smoothPathPoint, cornerPathPoint, symmetricPathPoint, anchorKind, curvePathSegment, straightenPathSegment, segmentCurved, handleMode, moveHandle, pullHandles, bendPathSegment, type HandleMode,
	polygonPoints, movePolygonPoint, transformPolygonPoints, insertPolygonPoint, removePolygonPoint, nearestPolygonEdge,
} from './path-data';
import {undo, redo, undoDepth, redoDepth, isolateHistory} from '@codemirror/commands';
import {ZOOM_STEP, zoomAbout, pinchView, wheelZoomFactor, wheelPan, type View, type Pinch} from './view';

// --- Constants
const DEFAULT_SVG_SIZE = 200;
const RANDOM_FILENAME_LENGTH = 6;
// the zoom is announced this long after the last wheel or pinch step
const ZOOM_SETTLE = 400;
// how far a press may travel and still count as a click
const DRAG_THRESHOLD = 3;
/** A finger held this long on an anchor, within this many pixels of where
 * it landed, pulls handles out of it instead of moving it. */
const HOLD_MS = 500;
const HOLD_SLOP = 10;
// resize handles are this many screen pixels square; the rotate handle sits
// this far above the top edge
const HANDLE_SIZE = window.matchMedia('(pointer: coarse)').matches ? 14 : 8;
const ROTATE_OFFSET = 24;
/** The room, in pixels, the preview's message needs beside its tools before it moves above them. */
const STATUS_ROOM = 240;
const SVG_NS = 'http://www.w3.org/2000/svg';

/** Safari's pinch event, which the DOM typings leave out. */
type SafariGesture = Event & {scale?: number; clientX?: number; clientY?: number};

// Global variable to hold status bar update callback
let statusBarUpdateCallback: ((message: string, isError: boolean) => void) | null = null;

const svgLinter = linter(view=>{
	const text = view.state.doc.toString();
	const diagnostics = [];

	try {
		if (!text.trim()) {
			if (statusBarUpdateCallback) {
				statusBarUpdateCallback('Buffer empty', false);
			}
			return [];
		}

		const parser = new DOMParser();
		const doc = parser.parseFromString(text, 'image/svg+xml');
		const parserError = doc.querySelector('parsererror');

		if (parserError) {
			let message = parserError.textContent || 'SVG invalid';
			const lineMatch = message.match(/line\s+(\d+)/i);
			const columnMatch = message.match(/column\s+(\d+)/i);

			// mark the tag around the reported column, back to its "<" and on to its
			// ">", so the error reads as a highlighted tag rather than a one-character blip
			let from = 0;
			let to = text.length;
			if (lineMatch) {
				const lineNumber = parseInt(lineMatch[1], 10);
				if (lineNumber >= 1 && lineNumber <= view.state.doc.lines) {
					const line = view.state.doc.line(lineNumber);
					from = line.from;
					to = line.to;
					if (columnMatch) {
						const column = Math.min(Math.max(0, parseInt(columnMatch[1], 10) - 1), line.length);
						const open = line.text.lastIndexOf('<', column);
						const close = line.text.indexOf('>', column);
						from = line.from + (open === -1 ? 0 : open);
						to = close === -1 ? line.to : line.from + close + 1;
					}
				}
			}
			message = message.match(/: ([^\n]+)\n/)?.[1] || '';
			if (statusBarUpdateCallback) {
				statusBarUpdateCallback(
					message ? `SVG error: ${message}` : 'SVG parsing error',
					true
				);
			}
			diagnostics.push({
				from,
				to,
				severity: 'error' as const,
				message: message
			});
		}
		if (text.trim() && !text.includes('<svg')) {
			const warningMessage = 'invalid contents';
			if (statusBarUpdateCallback) {
				statusBarUpdateCallback(`SVG error: ${warningMessage}`, true);
			}
			diagnostics.push({
				from: 0,
				to: Math.min(50, text.length),
				severity: 'warning' as const,
				message: warningMessage
			});
		}
		if (diagnostics.length === 0 && statusBarUpdateCallback) {
			statusBarUpdateCallback('SVG valid', false);
		}
	} catch (error) {
		const errorMessage = `Parse Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
		if (statusBarUpdateCallback) {
			statusBarUpdateCallback(errorMessage, true);
		}

		diagnostics.push({
			from: 0,
			to: Math.min(100, text.length),
			severity: 'error' as const,
			message: errorMessage
		});
	}
	return diagnostics;
},
	{delay: 750});

// Extend Window interface for testing functions
declare global {
	interface Window {
		announceError?: (message: string) => void;
		svgEditor?: slick;
		updateStatusBar?: (message: string, isError?: boolean) => void;
	}
}

// --- Utility functions
function announce(message: string, type: 'action' | 'error') {
	const id = type === 'action' ? 'test-announcements' : 'error-announcements';
	let announcer = document.getElementById(id);
	if (!announcer) {
		announcer = document.createElement('div');
		announcer.id = id;
		if (type === 'error') {
			announcer.setAttribute('aria-live', 'assertive');
			announcer.setAttribute('aria-atomic', 'true');
			announcer.style.position = 'absolute';
			announcer.style.left = '-10000px';
		}
		document.body.appendChild(announcer);
	}
	announcer.textContent = message;
}

function bindClick(getter: (id: string) => HTMLElement, config: Array<[string, () => void]>) {
	for (const [id, handler] of config) {
		getter(id).addEventListener('click', handler);
	}
}

function replaceEditorContent(editor: EditorView, newContent: string, moveCursorToStart = true) {
	const transaction = editor.state.update({
		changes: {
			from: 0,
			to: editor.state.doc.length,
			insert: newContent
		},
		selection: moveCursorToStart ? {anchor: 0} : undefined
	});
	editor.dispatch(transaction);
}

function resetElementStyles(...elements: HTMLElement[]) {
	for (const el of elements) {
		el.style.width = '';
		el.style.height = '';
		el.classList.remove('resizing');
	}
}

// --- SVGEditor Class
type GestureMode = 'move' | 'resize' | 'rotate' | 'point' | 'bend' | 'marquee' | 'draw';

/** A point of a path, polygon, polyline, or line, as the edit functions address it. */
type PointRef =
	| {type: 'path'; segment: number; slot: 'end' | 'cp1' | 'cp2'}
	| {type: 'poly'; index: number}
	| {type: 'line'; index: 0 | 1};

interface EditPoint {
	x: number;
	y: number;
	kind: 'anchor' | 'control';
	/** For a control point, the anchors its handle lines go to. */
	anchors: Point[];
	ref: PointRef;
}

/** Point editing on one element: which, which of its points are selected,
 * and the spot on its outline that was tapped, if that was what was. */
interface PointMode {
	ordinal: number;
	/** By their places in the element's point list; the last is the one the
	 * code editor shows first. */
	selected: number[];
	spot: Spot | null;
	/** Whether a tap adds a point to the selection or takes it out, and a
	 * drag across the drawing takes in the points it covers. */
	several: boolean;
}

/** A spot on an outline: a path's segment, or a polygon's edge from point
 * `edge` to the next, and how far along it. */
interface Spot {
	edge: number;
	t: number;
}

/** How far, in screen pixels, a double-click may be from the outline to add a point there. */
const ADD_POINT_REACH = 12;
/** How far, in screen pixels, a press may land from a point and still take
 * hold of it: a marker is small, and a fingertip is not. */
const POINT_REACH = window.matchMedia('(pointer: coarse)').matches ? 22 : 10;
const POINT_ELEMENTS = /^(path|polygon|polyline|line)$/;

/** The source behind a preview element: the text, the start tag, and the
 * parsed element the planners read. */
interface Found {sourceText: string; tag: StartTag; source: Element}

/** Attribute changes planned for one element. */
interface Planned {tag: StartTag; attrs: Record<string, string | null>}

/** One parse of the source, shared by every element an operation touches. */
interface Parsed {sourceText: string; elements: Element[]; tags: StartTag[]}

/** The elements of a selection that are not inside another of them: an edit
 * to a group carries its contents, so they are not edited again. */
function topLevelOf(els: Element[]): Element[] {
	return els.filter(el=>!els.some(other=>other !== el && other.contains(el)));
}

interface Drag {
	target: Element;
	found: Found;
	live: Live;
	attrs: Record<string, string | null>;
	/** Screen pixels to the units the edit is made in. */
	toUnits: Matrix;
	decimals: number;
	bbox: Rect;
	minSize: number;
	/** The element's centre in its parent's units, and on screen. */
	center: Point;
	screenCenter: Point;
	/** For a point drag: the point, where it started, and, for a handle, how
	 * the handle across its anchor follows it; for handles pulled out of an
	 * anchor, the path data they are pulled from. */
	point: {ref: PointRef; from: Point; mode: HandleMode; pull: Pull | null; group: Group | null} | null;
	/** For a bend: the path data, the spot held, and where on screen it was. */
	bend?: Pull & {t: number; from: Point};
	/** For one of several elements scaled together: the box round them all,
	 * on screen, and the element's parent's units to the screen. */
	group?: {box: Rect; toScreen: Matrix};
	/** For several points turned or scaled together: which, where they were,
	 * the element's units to the screen, and the transform so far. */
	transform?: {refs: PointRef[]; froms: Wanted[]; toScreen: Matrix; last: Matrix};
}

/** A point to select again after an edit: where it is now, its kind, and
 * its place in the point list before the edit. */
interface Wanted {x: number; y: number; kind: EditPoint['kind']; index?: number}

/** Several points dragged together: each one, and where it started. */
interface Group {
	refs: PointRef[];
	froms: Wanted[];
	/** How far they have gone, as written. */
	by: Point;
}

/** Handles being pulled out of an anchor: the path data, a polygon's or
 * polyline's as the path it becomes, and the segment the anchor ends. */
interface Pull {
	d: string;
	converted: boolean;
	segment: number;
}

interface Gesture {
	mode: GestureMode;
	handle: Handle | null;
	fromHandle: boolean;
	/** Whether the press carried Ctrl or Cmd, which makes a click toggle. */
	toggle: boolean;
	startX: number;
	startY: number;
	/** The elements the gesture acts on: the whole selection for a move,
	 * its one element for a resize or a turn. */
	targets: Element[];
	/** Filled in once the pointer has travelled far enough to be a drag. */
	drags: Drag[];
	/** The point a point gesture holds, by its place in the element's point list. */
	point: number | null;
	/** The spot on the outline a bend holds. */
	spot?: Spot;
	/** Set when a second finger turned the gesture into a pinch: what it did
	 * stays on screen, and is written once every finger has lifted. */
	held?: boolean;
	/** How far the pointer goes before the press is a drag: further for a
	 * finger on an anchor, which may be holding still to pull handles out. */
	slop?: number;
	/** Set when the press on an anchor pulls handles out of it: after a hold
	 * on a touch screen, or with Alt held. */
	pull?: boolean;
	/** The point a press landed on, and whether it was selected already, which
	 * decides what a tap that does not travel does. */
	tapped?: {index: number; had: boolean};
	/** Where a drag across the drawing has got to. */
	to?: Point;
	/** For a turn or a scale of several elements or points: the box round
	 * them as the gesture began, on the overlay, and how far it has turned. */
	box?: Point[];
	turn?: number;
	/** Set when the box is round several selected points, not elements. */
	points?: boolean;
	/** The shape a drag with a shape tool is drawing. */
	draft?: Draft;
}

/** A shape being drawn: the preview's stand-in for it, the screen to the
 * drawing's units and back, the precision the zoom shows, where the press
 * was in those units, the drawing's size in them, and its attributes so far. */
interface Draft {
	kind: ShapeKind;
	el: SVGGraphicsElement;
	toUnits: Matrix;
	toScreen: Matrix;
	decimals: number;
	from: Point;
	size: number;
	attrs: Record<string, string>;
}

/** What a press on a shape drawn a point at a time does, with the point as
 * it stands: places it, closes the shape on its first point, or ends it on
 * its last. */
interface Aim {
	does: 'add' | 'close' | 'end';
	anchor: Anchor;
	/** Whether the press has travelled, which pulls a path's handles out. */
	dragged: boolean;
}

/** A polyline, polygon, or path being drawn a point at a time, in the
 * drawing's units: its stand-in, the points placed so far, the finest
 * precision one was placed at, which they are all written to, and what the
 * press under way, or one where the pointer hovers, would do. */
interface Sketch {
	kind: PointKind;
	draft: Draft;
	anchors: Anchor[];
	decimals: number;
	press: Aim | null;
	hover: Aim | null;
}

/** Whether a press on the first point of a shape under way closes it: once
 * it has points enough to close round something, which for a path is two
 * when either has handles to bend the way between them. */
function closable(s: Sketch): boolean {
	return s.anchors.length >= 3 || (s.kind === 'path' && s.anchors.length === 2 && s.anchors.some(a=>a.in !== null || a.out !== null));
}

/** Paint a stand-in as its shape will be painted, taking off what it no longer has. */
function paintDraft(el: Element, paint: Record<string, string>): void {
	for (const name of ['fill', 'stroke', 'stroke-width']) {
		const value = Object.hasOwn(paint, name) ? paint[name] : null;
		if (value === null) el.removeAttribute(name);
		else el.setAttribute(name, value);
	}
}

/** What each shape tool says it does, when it is taken up. */
function toolHint(kind: ShapeKind): string {
	if (kind === 'polyline') return 'Tap to place each point of the polyline, then tap the last again or press Done to finish it';
	if (kind === 'polygon') return 'Tap to place each corner of the polygon, then tap the first again or press Done to close it';
	if (kind === 'path') return 'Tap to place each point of the path, or drag to pull a curve out of it; tap the first point to close the path, or the last to end it open';
	return `Drag across the drawing to draw a ${SHAPE_NAMES[kind]}, or tap to place one`;
}

/** A value for the status bar: the start of a long one says enough. */
const clipped = (value: string): string=>value.length > 48 ? `${value.slice(0, 48)}…` : value;

/** What a gesture shows on screen until it is written or taken back. */
interface Live {
	show(attrs: Record<string, string | null>): void;
	revert(): void;
}

/**
 * Attribute changes shown on the preview's own copy of an element while a
 * gesture is under way, and taken back if it is cancelled. Each call states
 * the whole change from the start of the gesture, so an attribute no longer
 * in it goes back to what it was.
 */
class LiveEdit implements Live {
	private originals = new Map<string, string | null>();
	constructor(private el: Element) {}

	private put(name: string, value: string | null): void {
		if (value === null) this.el.removeAttribute(name);
		else this.el.setAttribute(name, value);
	}

	show(attrs: Record<string, string | null>): void {
		for (const [name, original] of this.originals) if (!(name in attrs)) this.put(name, original);
		for (const [name, value] of Object.entries(attrs)) {
			if (!this.originals.has(name)) this.originals.set(name, this.el.getAttribute(name));
			this.put(name, value);
		}
	}

	revert(): void {
		for (const [name, original] of this.originals) this.put(name, original);
		this.originals.clear();
	}
}

/**
 * A polygon or polyline shown as the path it is becoming: a path with its
 * attributes stands in front of it, and it is hidden, not taken out, since a
 * touch that began on it must still be heard.
 */
class LivePath implements Live {
	private stand: SVGPathElement | null = null;
	private display = '';
	constructor(private el: SVGElement) {}

	show(attrs: Record<string, string | null>): void {
		if (!this.stand) {
			this.stand = document.createElementNS(SVG_NS, 'path');
			const geometry = GEOMETRY[this.el.tagName.toLowerCase()] ?? [];
			for (const attr of Array.from(this.el.attributes)) if (!geometry.includes(attr.name)) this.stand.setAttribute(attr.name, attr.value);
			this.el.before(this.stand);
			this.display = this.el.style.display;
			this.el.style.display = 'none';
		}
		this.stand.setAttribute('d', attrs.d ?? '');
	}

	revert(): void {
		this.stand?.remove();
		this.stand = null;
		this.el.style.display = this.display;
	}
}

const toMatrix = (m: DOMMatrix): Matrix=>({a: m.a, b: m.b, c: m.c, d: m.d, e: m.e, f: m.f});

/** The points a person can take hold of on an element, in its own units. */
function pointsOf(el: Element): EditPoint[] | null {
	const tag = el.tagName.toLowerCase();
	if (tag === 'path') {
		const segments = parsePathData(el.getAttribute('d') ?? '');
		return segments && pathPoints(segments).map(p=>({
			x: p.x, y: p.y, kind: p.slot === 'end' ? 'anchor' : 'control', anchors: p.anchors,
			ref: {type: 'path', segment: p.segment, slot: p.slot},
		}));
	}
	if (tag === 'polygon' || tag === 'polyline') {
		const pts = polygonPoints(el.getAttribute('points') ?? '');
		return pts && pts.map((p, index)=>({x: p.x, y: p.y, kind: 'anchor', anchors: [], ref: {type: 'poly', index}}));
	}
	if (tag === 'line') {
		const n = (name: string): number=>parseFloat(el.getAttribute(name) ?? '0') || 0;
		return [
			{x: n('x1'), y: n('y1'), kind: 'anchor', anchors: [], ref: {type: 'line', index: 0}},
			{x: n('x2'), y: n('y2'), kind: 'anchor', anchors: [], ref: {type: 'line', index: 1}},
		];
	}
	return null;
}

/** The attribute changes that put several points of an element through one
 * transform, in the element's own units. */
function transformPoints(refs: PointRef[], source: Element, m: Matrix, decimals: number): Record<string, string | null> | null {
	const paths = refs.flatMap(ref=>ref.type === 'path' ? [{segment: ref.segment, slot: ref.slot}] : []);
	if (paths.length > 0) {
		const d = transformPathPoints(source.getAttribute('d') ?? '', paths, m, decimals);
		return d === null ? null : {d};
	}
	const polys = refs.flatMap(ref=>ref.type === 'poly' ? [ref.index] : []);
	if (polys.length > 0) {
		const points = transformPolygonPoints(source.getAttribute('points') ?? '', polys, m, decimals);
		return points === null ? null : {points};
	}
	const at = (name: string): number=>parseFloat(source.getAttribute(name) ?? '0') || 0;
	const attrs: Record<string, string | null> = {};
	for (const ref of refs) {
		if (ref.type !== 'line') continue;
		const [nx, ny] = ref.index === 0 ? ['x1', 'y1'] : ['x2', 'y2'];
		Object.assign(attrs, movePoint(ref, source, applyToPoint(m, at(nx), at(ny)), decimals));
	}
	return attrs;
}

/** A box's corners turned about its middle, as a turn of the things in it shows it. */
function turnedCorners(corners: Point[], degrees: number): Point[] {
	const turn = turnAbout(degrees, {x: corners.reduce((s, p)=>s + p.x, 0) / corners.length, y: corners.reduce((s, p)=>s + p.y, 0) / corners.length});
	return corners.map(p=>applyToPoint(turn, p.x, p.y));
}

/** The smallest upright box holding these points. */
function boundsOf(points: Point[]): Rect {
	const xs = points.map(p=>p.x);
	const ys = points.map(p=>p.y);
	const [l, t] = [Math.min(...xs), Math.min(...ys)];
	return {x: l, y: t, width: Math.max(...xs) - l, height: Math.max(...ys) - t};
}

/** A turn by `degrees` about a point on screen, clockwise as the screen runs. */
function turnAbout(degrees: number, c: Point): Matrix {
	const [cos, sin] = [Math.cos((degrees * Math.PI) / 180), Math.sin((degrees * Math.PI) / 180)];
	return {a: cos, b: sin, c: -sin, d: cos, e: c.x - cos * c.x + sin * c.y, f: c.y - sin * c.x - cos * c.y};
}

/** Whether a transform's slant is a turn alone, with no stretch, slant, or mirror. */
function isTurn(m: Matrix): boolean {
	return Math.abs(m.a - m.d) < 1e-9 && Math.abs(m.b + m.c) < 1e-9 && Math.abs(Math.hypot(m.a, m.b) - 1) < 1e-9;
}

/** A transform's slant, less the float noise that took it off whole
 * numbers, with the shift that keeps `c` where it is. A quarter turn or a
 * flip seen in upright units is then exact. */
function holding(m: Matrix, c: Point): Matrix {
	const whole = (n: number): number=>Math.abs(n - Math.round(n)) < 1e-9 ? Math.round(n) : n;
	const [a, b, cc, d] = [m.a, m.b, m.c, m.d].map(whole);
	return {a, b, c: cc, d, e: c.x - a * c.x - cc * c.y, f: c.y - b * c.x - d * c.y};
}

/** The attribute changes that move several points of an element by one
 * step, which each takes as rounded to what the zoom can show, keeping the
 * precision it was written with. */
function movePoints(refs: PointRef[], source: Element, by: Point, decimals: number): Record<string, string | null> | null {
	return transformPoints(refs, source, {...IDENTITY, e: roundTo(by.x, decimals), f: roundTo(by.y, decimals)}, decimals);
}

/** The attribute a point lives in, and the attribute changes that move it.
 * A handle takes the one across its anchor along as `mode` says, or as the
 * two lie when no mode is given. */
function movePoint(ref: PointRef, source: Element, to: Point, decimals: number, mode?: HandleMode): Record<string, string | null> | null {
	if (ref.type === 'path') {
		const was = source.getAttribute('d') ?? '';
		const d = ref.slot === 'end'
			? movePathPoint(was, ref, to, decimals)
			: moveHandle(was, {segment: ref.segment, slot: ref.slot}, to, mode ?? handleMode(was, {segment: ref.segment, slot: ref.slot}) ?? 'independent', decimals);
		return d === null ? null : {d};
	}
	if (ref.type === 'poly') {
		const points = movePolygonPoint(source.getAttribute('points') ?? '', ref.index, to, decimals);
		return points === null ? null : {points};
	}
	// a line's ends keep the precision they were written with, as a path's points do
	const [nx, ny] = ref.index === 0 ? ['x1', 'y1'] : ['x2', 'y2'];
	const write = (name: string, value: number): string=>fmt(value, Math.max(decimals, placesOf(parseFloat(source.getAttribute(name) ?? '0') || 0)));
	return {[nx]: write(nx, to.x), [ny]: write(ny, to.y)};
}

const pointAttr = (ref: PointRef): string=>ref.type === 'path' ? 'd' : ref.type === 'poly' ? 'points' : ref.index === 0 ? 'x1' : 'x2';

/** A path's `d`, or the path data a polygon, polyline, or line draws, for
 * the tools that need curves: such an element becomes a path when one is
 * used on it. Its point `i` is the anchor of segment `i`, and its edge `i`
 * is segment `i + 1`. A line whose ends are written with units has none. */
function pathDataOf(el: Element): {d: string; converted: boolean} | null {
	const tag = el.tagName.toLowerCase();
	if (tag === 'path') return {d: el.getAttribute('d') ?? '', converted: false};
	if (tag !== 'polygon' && tag !== 'polyline' && tag !== 'line') return null;
	const lengths = writtenLengths(el);
	const made = lengths ? shapePathData(tag, lengths, el.getAttribute('points')) : null;
	return made?.ok ? {d: made.d, converted: true} : null;
}

/** A shape's geometry as written, absent or auto lengths left out; null when
 * one is written with units or as a percentage, which `resolve` can read from
 * the drawing as the browser laid it out. */
function writtenLengths(el: Element, resolve?: (name: string) => number | null): Record<string, Length | undefined> | null {
	const lengths: Record<string, Length | undefined> = {};
	for (const name of GEOMETRY[el.tagName.toLowerCase()] ?? []) {
		const text = el.getAttribute(name)?.trim() ?? '';
		if (name === 'points' || text === '' || text === 'auto') continue;
		const plain = plainLength(text);
		const resolved = plain ? null : resolve?.(name) ?? null;
		if (!plain && resolved === null) return null;
		lengths[name] = plain ?? {value: resolved ?? 0, places: 3};
	}
	return lengths;
}

/** A length attribute of a drawn element, in user units, as the browser resolved it. */
function resolvedLength(el: Element, name: string): number | null {
	const animated: unknown = Reflect.get(el, name);
	return animated instanceof SVGAnimatedLength ? animated.baseVal.value : null;
}

/** The segment an anchor ends, in its element's path data. */
const anchorSegment = (ref: PointRef): number | null=>ref.type === 'path' && ref.slot === 'end' ? ref.segment : ref.type === 'poly' ? ref.index : null;

/** The segments the chosen anchors end; their handles have none. */
const chosenAnchors = (chosen: {point: EditPoint}[]): number[]=>chosen.flatMap(c=>((s)=>c.point.kind === 'anchor' && s !== null ? [s] : [])(anchorSegment(c.point.ref)));

function bboxOf(el: Element): Rect | null {
	if (!(el instanceof SVGGraphicsElement)) return null;
	try {
		const bb = el.getBBox();
		return {x: bb.x, y: bb.y, width: bb.width, height: bb.height};
	} catch {
		return null;
	}
}



class slick {
	public editor!: EditorView;
	private previewContainer!: HTMLElement;
	private svgPreview!: HTMLElement;
	private modal!: HTMLDialogElement;
	private statusBar!: HTMLElement;
	private isVerticalLayout = false;
	private isDarkMode = false;
	private zoomLevel = 1;
	private panX = 0;
	private panY = 0;
	private isPanning = false;
	private lastPanX = 0;
	private lastPanY = 0;
	private rotationDegrees = 0;
	private flipX = false;
	private flipY = false;
	private themeCompartment = new Compartment();
	private xray = false;
	// a two-finger pinch under way: the view and the fingers as it began
	private pinch: {view: View; from: Pinch} | null = null;
	// the scale Safari's last pinch event reported, while one is under way
	private safariScale: number | null = null;
	private zoomTimer: ReturnType<typeof setTimeout> | undefined;
	private holdTimer: ReturnType<typeof setTimeout> | undefined;
	private anchorToolsFor: {key: string; state: {kinds: ('smooth' | 'corner')[]; symmetric: boolean}} | null = null;
	/** The marker a finger is on, which is kept in the page until it lifts. */
	private touchedMarker: Element | null = null;
	private isResizing = false;
	// the selection in the preview, by source ordinal so it survives re-renders;
	// the last one is the primary, whose tag the editor's selection follows
	private selected: number[] = [];
	private moreBoxes: SVGPolygonElement[] = [];
	private pressToggle = false;
	private pointMode: PointMode | null = null;
	/** The shape tool in hand, which the next press on the drawing draws with. */
	private drawTool: ShapeKind | null = null;
	/** The shape under way, drawn a point at a time. */
	private sketch: Sketch | null = null;
	private sketchGroup!: SVGGElement;
	/** What the preview's strip says, and until when a message keeps the standing hint away. */
	private previewStatus!: HTMLElement;
	private heldUntil = 0;
	private hintTimer: ReturnType<typeof setTimeout> | undefined;
	/** Whether the pencil is down on the drawing, while which a touch on a bar is a resting hand. */
	private stylusDown = false;
	/** Set when the last press drew a shape, so a double-click it began does not edit points. */
	private drewOnPress = false;
	private pointsGroup!: SVGGElement;
	private spotGroup!: SVGGElement;
	private marquee!: SVGRectElement;
	/** The box round several selected elements or points, and the corners the
	 * handles were last put on. */
	private groupBox!: SVGPolygonElement;
	private handleCorners: Point[] | null = null;
	private overlay!: SVGSVGElement;
	private selectBox!: SVGPolygonElement;
	private hoverBox!: SVGPolygonElement;
	private pressX = 0;
	private pressY = 0;
	private pressMoved = false;
	private tapTarget: EventTarget | null = null;
	private gesture: Gesture | null = null;
	private handles!: SVGGElement;
	private handleEls = new Map<string, SVGGraphicsElement>();
	private rotateLink!: SVGLineElement;
	private skipSync = false;

	constructor() {
		this.modal = this.getTyped('dialog');
		this.statusBar = this.get('svg-status-bar');
		this.previewStatus = this.get('preview-status');
		statusBarUpdateCallback = this.updateStatusBar.bind(this);
		this.initializeEditor();
		this.initializePreview();
		this.setupEventListeners();
		this.setupDragAndDrop();
		this.setupReducedMotion();
		this.updateSVGPreview();
	}

	private get(i: string) {
		const e = document.getElementById(i);
		if (!e) throw new Error(`Element #${i} not found`);
		return e;
	}

	// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
	private getTyped = <T extends Element = HTMLElement>(q: string): T=>{
		const e = document.querySelector(q);
		if (!e) throw new Error(`Element ${q} was not found`);
		return e as T;
	}

	private getAllTyped = <T extends Element = HTMLHtmlElement>(
		selector: string,
		root: ParentNode = document
	): NodeListOf<T>=>root.querySelectorAll(selector);

	private initializeEditor(): void {
		const editorContainer = this.get('editor');
		const startDoc = `<svg xmlns="http://www.w3.org/2000/svg" width="${DEFAULT_SVG_SIZE}" height="${DEFAULT_SVG_SIZE}" viewBox="0 0 ${DEFAULT_SVG_SIZE} ${DEFAULT_SVG_SIZE}">
	<circle cx="100" cy="100" r="80" fill="#6291e0" stroke="#295da9" stroke-width="2"/>
	<text x="100" y="110" text-anchor="middle" fill="white" font-family="Arial" font-size="16">
		Hello SVG
	</text>
</svg>`;

		this.editor = new EditorView({
			state: EditorState.create({
				doc: startDoc,
				extensions: [
					basicSetup,
					keymap.of([]),
					xml(),
					EditorView.lineWrapping,
					lintGutter(),
					svgLinter,
					this.themeCompartment.of([tokyoNightDay]),
					EditorView.updateListener.of((update)=>{
						if (update.docChanged) {
							this.updateSVGPreview();
							this.updateHistoryButtons();
						}
						// only a cursor that moved: a change alone must not bring back an
						// element the cursor still sits in after it was let go
						if (update.selectionSet) {
							this.syncSelectionFromCursor();
						}
						if (this.xray && (update.selectionSet || update.docChanged)) {
							this.updateElementHighlight();
						}
					})
				]
			}),
			parent: editorContainer
		});
	}

	private initializePreview(): void {
		this.previewContainer = this.get('preview');
		this.svgPreview = document.createElement('div');
		this.svgPreview.className = 'svg-preview-wrapper';
		this.svgPreview.tabIndex = 0;
		this.svgPreview.setAttribute('aria-label', 'SVG preview canvas');
		this.previewContainer.appendChild(this.svgPreview);
		// the selection box lives beside the drawing, never inside it, so it is
		// not part of the document and keeps its size at any zoom
		this.overlay = document.createElementNS(SVG_NS, 'svg');
		this.overlay.classList.add('select-overlay');
		this.overlay.setAttribute('aria-hidden', 'true');
		this.hoverBox = this.makeBox('hover-box');
		this.selectBox = this.makeBox('select-box');
		this.groupBox = this.makeBox('group-box');
		this.handles = document.createElementNS(SVG_NS, 'g');
		this.handles.classList.add('handles', 'hide');
		this.rotateLink = document.createElementNS(SVG_NS, 'line');
		this.handles.appendChild(this.rotateLink);
		for (const name of ['nw', 'ne', 'se', 'sw', 'n', 'e', 's', 'w']) {
			const handle = document.createElementNS(SVG_NS, 'rect');
			handle.setAttribute('data-handle', name);
			handle.setAttribute('width', `${HANDLE_SIZE}`);
			handle.setAttribute('height', `${HANDLE_SIZE}`);
			this.handles.appendChild(handle);
			this.handleEls.set(name, handle);
		}
		const rotate = document.createElementNS(SVG_NS, 'circle');
		rotate.setAttribute('data-handle', 'rotate');
		rotate.setAttribute('r', `${HANDLE_SIZE / 2 + 1}`);
		this.handles.appendChild(rotate);
		this.handleEls.set('rotate', rotate);
		this.overlay.appendChild(this.handles);
		this.spotGroup = document.createElementNS(SVG_NS, 'g');
		this.spotGroup.classList.add('spot');
		this.overlay.appendChild(this.spotGroup);
		this.pointsGroup = document.createElementNS(SVG_NS, 'g');
		this.pointsGroup.classList.add('points');
		this.overlay.appendChild(this.pointsGroup);
		this.marquee = document.createElementNS(SVG_NS, 'rect');
		this.marquee.classList.add('marquee', 'hide');
		this.overlay.appendChild(this.marquee);
		this.sketchGroup = document.createElementNS(SVG_NS, 'g');
		this.sketchGroup.classList.add('sketch');
		this.overlay.appendChild(this.sketchGroup);
		this.previewContainer.appendChild(this.overlay);
		new ResizeObserver(()=>this.refreshSelection()).observe(this.svgPreview);
	}

	private makeBox(className: string): SVGPolygonElement {
		const box = document.createElementNS(SVG_NS, 'polygon');
		box.classList.add(className, 'hide');
		this.overlay.appendChild(box);
		return box;
	}

	private get eyes() {
		return [this.get('awake'), this.get('asleep')];
	}
	private toggleXray = (): void=>{
		this.xray = !this.xray;
		this.eyes.forEach(s=>s.classList.toggle('hide'));
		this.get('xray').setAttribute('aria-pressed', this.xray ? 'true' : 'false');
		this.editor.focus();
		if (this.xray) {
			this.updateElementHighlight();
		} else {
			this.clearHighlights();
		}
	}

	private modalIsOpen = (): boolean=>this.modal.open;

	private modalShow(): void {
		this.modal.classList.remove('closing');
		if (!this.modalIsOpen()) this.modal.showModal();
		const firstInput = this.modal.querySelector('#width') as HTMLInputElement;
		firstInput.focus();
		this.modal.addEventListener('keydown', this.handleModalKeydown);
	}

	private modalClose(): void {
		this.modal.classList.add('closing');
		this.modal.removeEventListener('keydown', this.handleModalKeydown);
		setTimeout(()=>{
			this.modal.classList.remove('closing');
			this.modal.close();
		}, 700);
	}

	private handleModalKeydown = (e: KeyboardEvent): void=>{
		if (e.key !== 'Tab') return;

		const focusableElements = this.getAllTyped(
			'input, button, select, textarea, [tabindex]:not([tabindex="-1"])',
			this.modal
		);
		const firstElement = focusableElements[0];
		const lastElement = focusableElements[focusableElements.length - 1];

		if (e.shiftKey) {
			if (document.activeElement === firstElement) {
				e.preventDefault();
				lastElement.focus();
			}
		} else {
			if (document.activeElement === lastElement) {
				e.preventDefault();
				firstElement.focus();
			}
		}
	};

	private announceAction(message: string): void {
		announce(message, 'action');
		this.sayInPreview(message);
	}

	public announceError(message: string): void {
		announce(message, 'error');
		this.sayInPreview(message, 'error');
	}

	/** Say in the preview's strip, where the eye is while drawing, what just
	 * happened or went wrong, for a while; then the standing hint comes back.
	 * Screen readers have heard it already, from the live regions. */
	private sayInPreview(message: string, kind: 'note' | 'error' = 'note'): void {
		const ms = kind === 'error' ? 6000 : 2500;
		this.previewStatus.textContent = message;
		this.previewStatus.classList.toggle('error', kind === 'error');
		this.heldUntil = Date.now() + ms;
		clearTimeout(this.hintTimer);
		// a timer can fire a moment before the clock says it is due, and the
		// message it ends is the last one said, as each clears the one before
		this.hintTimer = setTimeout(()=>this.restoreHint(true), ms);
	}

	/** Read out an edit in the preview's strip as a drag makes it, until the drag ends. */
	private readOut(message: string): void {
		this.previewStatus.textContent = message;
		this.previewStatus.classList.remove('error');
		this.heldUntil = Infinity;
		clearTimeout(this.hintTimer);
	}

	/** Put back what the preview's strip says between messages: how to use the
	 * tool in hand, or the points being edited, or nothing. A message still
	 * being shown is left be, unless `force` says the moment for it is over. */
	private restoreHint(force = false): void {
		if (!force && Date.now() < this.heldUntil) return;
		this.heldUntil = 0;
		clearTimeout(this.hintTimer);
		const hint = this.standingHint();
		// a pointer hovering over a shape under way asks for this at every move
		if (this.previewStatus.textContent !== hint) this.previewStatus.textContent = hint;
		this.previewStatus.classList.remove('error');
	}

	/** What the preview's strip says while nothing else is to be said. */
	private standingHint(): string {
		const s = this.sketch;
		if (s && s.anchors.length < pointsNeeded(s.kind)) return s.kind === 'polygon' ? 'Tap to place each corner' : s.kind === 'path' ? 'Tap to place the next point, or drag to pull a curve' : 'Tap to place the next point';
		if (s?.kind === 'polygon') return 'Tap the first corner to close the polygon, or press Done';
		if (s?.kind === 'polyline') return 'Tap the last point again, or press Done, to finish the polyline';
		if (s?.kind === 'path') return 'Tap the first point to close the path, or the last to end it open; drag to pull a curve';
		if (this.drawTool) return toolHint(this.drawTool);
		if (this.pointMode) return 'Drag a point; tap the outline to pick a segment, or double-click it to add a point';
		return '';
	}

	public updateStatusBar(message: string, isError: boolean = false): void {
		this.statusBar.textContent = message;
		this.statusBar.classList.toggle('error', isError);
	}

	private setupReducedMotion(): void {
		if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
			document.body.classList.add('reduced-motion');
		}
	}

	private setupEventListeners(): void {
		if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
			this.toggleMode();
		}
		bindClick(this.get.bind(this), [
			['dark', ()=>this.toggleMode()],
			['cancel', ()=>this.modalClose()],
			['resolution', ()=>this.showResolutionModal()],
			['resize', ()=>this.resizeSVG()],
			['flip', ()=>this.toggleLayout()],
			['zoomin', ()=>this.zoomIn()],
			['zoomout', ()=>this.zoomOut()],
			['rotate', ()=>this.rotateSVG()],
			['flipx', ()=>this.flipSVGX()],
			['flipy', ()=>this.flipSVGY()],
			['optimize', ()=>this.optimizeSVG()],
			['download', ()=>this.downloadSVG()],
			['upload', ()=>this.triggerFileUpload()],
			['xray', ()=>this.toggleXray()],
			['undo', ()=>{
				// while a shape is drawn a point at a time, its last point is the last thing done
				if (this.sketch) this.backSketch();
				else this.undoEdit();
			}],
			['redo', ()=>this.redoEdit()],
			['duplicate', ()=>this.duplicateSelected()],
			['points', ()=>this.togglePointMode()],
			['topath', ()=>this.pointTool(()=>this.convertToPaths())],
			['point-several', ()=>this.pointTool(()=>this.toggleSeveral())],
			['point-add', ()=>this.pointTool(()=>this.addPointAtSpot())],
			['point-smooth', ()=>this.pointTool(()=>this.toggleSmooth())],
			['point-symmetric', ()=>this.pointTool(()=>this.makeSymmetric())],
			['point-curve', ()=>this.pointTool(()=>this.toggleCurve())],
			['point-delete', ()=>this.pointTool(()=>this.deletePoint())],
			['point-done', ()=>this.togglePointMode()],
			...SHAPE_KINDS.map((kind): [string, () => void]=>[`draw-${kind}`, ()=>this.armShape(kind)]),
			['draw-back', ()=>this.backSketch()],
			['draw-done', ()=>this.endSketch()]
		]);
		document.addEventListener('keydown', this.handleHistoryKeys);
		this.updateHistoryButtons();
		this.svgPreview.addEventListener('mousedown', (e)=>this.onPress(e));
		this.overlay.addEventListener('mousedown', (e)=>this.onHandlePress(e, e.clientX, e.clientY));
		this.overlay.addEventListener('touchstart', (e)=>{
			// a second finger on a handle joins a pinch instead
			const touch = e.touches.item(0);
			if (touch && e.touches.length === 1) this.onHandlePress(e, touch.clientX, touch.clientY);
		}, {passive: false});
		document.addEventListener('mousemove', (e)=>{
			if (this.gesture) this.gestureMove(e.clientX, e.clientY, e.shiftKey, e.altKey);
			else this.doPan(e);
		});
		document.addEventListener('mouseup', ()=>{
			if (this.gesture) this.gestureEnd();
			else this.endPan();
		});
		// Escape reaches the selection from the toolbar too; in the editor and
		// the dialog it keeps its own meaning
		document.addEventListener('keydown', (e)=>{
			if (e.key !== 'Escape') return;
			if (this.gesture?.drags.length || this.gesture?.mode === 'marquee' || this.gesture?.mode === 'draw') {
				this.cancelGesture();
				return;
			}
			const target = e.target;
			if (target instanceof Element && target.closest('.cm-editor, dialog')) return;
			// a shape under way is let go first, then its tool put down, then point
			// editing ends; the next Escape clears the selection
			if (this.sketch) {
				this.dropSketch();
				this.announceAction('Shape let go');
			} else if (this.drawTool) this.armShape(null);
			else if (this.pointMode) this.leavePointMode();
			else this.clearSelection();
		});
		this.svgPreview.addEventListener('touchstart', (e)=>this.handleTouchStart(e), {passive: false});
		// a second finger may land anywhere, so a pinch is caught from the page;
		// a finger that pressed a handle in the overlay sends its moves to the
		// handle, not the wrapper, so the rest of a touch gesture is read there too
		document.addEventListener('touchstart', (e)=>this.handlePinchStart(e), {passive: false});
		document.addEventListener('touchmove', (e)=>this.handleTouchMove(e), {passive: false});
		document.addEventListener('touchend', (e)=>this.handleTouchEnd(e), {passive: false});
		document.addEventListener('touchcancel', (e)=>this.handleTouchEnd(e));
		this.svgPreview.addEventListener('mousemove', (e)=>this.hoverAt(e));
		this.svgPreview.addEventListener('dblclick', (e)=>this.onDoubleClick(e));
		this.svgPreview.addEventListener('mouseleave', ()=>{
			this.drawBox(this.hoverBox, null);
			if (this.sketch && !this.gesture) {
				this.sketch.hover = null;
				this.showSketch();
			}
		});
		this.svgPreview.addEventListener('keydown', (e)=>this.onCanvasKey(e));
		// the wheel and a trackpad pinch zoom the drawing, not the page: every
		// browser but Safari reports the pinch as Ctrl+wheel, and Safari sends
		// its own gesture events, which an iPhone sends beside the touches too
		this.previewContainer.addEventListener('wheel', (e)=>this.onWheel(e), {passive: false});
		this.previewContainer.addEventListener('gesturestart', (e)=>this.onGestureStart(e), {passive: false});
		this.previewContainer.addEventListener('gesturechange', (e)=>this.onGestureChange(e), {passive: false});
		this.previewContainer.addEventListener('gestureend', (e)=>this.onGestureEnd(e), {passive: false});
		this.setupResizeDragbar();
		for (const nav of document.querySelectorAll('nav')) this.fitBar(nav);
		this.guardBarsFromPalm();
		// the preview's message sits beside its tools while there is room there,
		// and above the strip, across the foot of the drawing, while there is not
		const strip = this.get('context-bar');
		const tools = strip.querySelector('nav');
		const placeStatus = (): void=>{
			this.previewStatus.classList.toggle('above', strip.clientWidth - (tools?.offsetWidth ?? 0) < STATUS_ROOM);
		};
		const sizes = new ResizeObserver(placeStatus);
		sizes.observe(strip);
		if (tools) sizes.observe(tools);
	}

	/** A hand drawing with a pencil rests on the screen, and iPadOS lets the
	 * drawing ignore it but not a toolbar under it. While the pencil is down
	 * on the drawing, a finger's touch on a bar is taken for that hand and
	 * goes no further, so it presses nothing. */
	private guardBarsFromPalm(): void {
		const stylus = (t: Touch): boolean=>(t as Touch & {touchType?: string}).touchType === 'stylus';
		const track = (e: TouchEvent): void=>{
			// a touch's target is where it began, which may since have been redrawn
			// out of the document, as the marks of a shape under way are at each move
			this.stylusDown = Array.from(e.touches).some(t=>stylus(t) && t.target instanceof Node && (!t.target.isConnected || this.previewContainer.contains(t.target)) && !this.inBar(t.target));
		};
		for (const type of ['touchstart', 'touchend', 'touchcancel'] as const) document.addEventListener(type, track, {capture: true, passive: true});
		for (const bar of [this.get('appbar'), this.get('context-bar')]) {
			bar.addEventListener('touchstart', (e)=>{
				if (!this.stylusDown || Array.from(e.changedTouches).some(stylus)) return;
				e.preventDefault();
				e.stopPropagation();
			}, {capture: true, passive: false});
		}
	}

	/** Whether a node is in one of the toolbars. */
	private inBar(node: Node): boolean {
		return node instanceof Element && node.closest('#appbar, .strip') !== null;
	}

	/** Keep a toolbar's buttons named while their names fit, and fall back to
	 * their icons alone when the bar is too narrow for them: when the bar is
	 * resized, and when buttons in it come and go. */
	private fitBar(nav: HTMLElement): void {
		// an edge with buttons scrolled past it fades, to say there are more that way
		const edges = (): void=>{
			nav.classList.toggle('more-start', nav.scrollLeft > 1);
			nav.classList.toggle('more-end', nav.scrollLeft + nav.clientWidth < nav.scrollWidth - 1);
		};
		const fit = (): void=>{
			nav.classList.remove('compact');
			if (nav.scrollWidth > nav.clientWidth) nav.classList.add('compact');
			edges();
		};
		nav.addEventListener('scroll', edges, {passive: true});
		new ResizeObserver(fit).observe(nav);
		// the bar's own class is what fitting changes, so only its buttons' changes count
		new MutationObserver((records)=>{
			if (records.some(r=>r.target !== nav)) fit();
		}).observe(nav, {subtree: true, attributes: true, attributeFilter: ['class']});
	}

	private updateSVGPreview(): void {
		const svgCode = this.editor.state.doc.toString();
		try {
			const svgContainer = document.createElement('div');
			svgContainer.className = 'svg-container';
			// stamped with source ordinals when the source parses, so preview
			// elements can be traced back to their tags
			svgContainer.innerHTML = stampSource(svgCode) ?? svgCode;
			svgContainer.addEventListener('transitionend', ()=>this.refreshSelection());
			this.svgPreview.replaceChildren(svgContainer);
			// a shape under way stays in the drawing the code draws now
			const root = svgContainer.querySelector('svg');
			if (this.sketch && root) root.appendChild(this.sketch.draft.el);
			this.applySVGStyles();
		} catch (error) {
			const message = document.createElement('div');
			message.className = 'error';
			message.textContent = `Invalid SVG: ${String(error)}`;
			this.svgPreview.replaceChildren(message);
		}
	}

	/** The pan and zoom: eased for a toolbar step, immediate under the hand. */
	private applySVGStyles(animate = true): void {
		const svgElement = this.svgPreview.querySelector('svg');
		if (svgElement) {
			const hasWidth = svgElement.hasAttribute('width');
			const hasHeight = svgElement.hasAttribute('height');
			if (!hasWidth) svgElement.style.width = `${DEFAULT_SVG_SIZE}px`;
			if (!hasHeight) svgElement.style.height = `${DEFAULT_SVG_SIZE}px`;
			const svgContainer = svgElement.parentElement;
			if (svgContainer && svgContainer.classList.contains('svg-container')) {
				svgContainer.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.zoomLevel})`;
				svgContainer.style.transformOrigin = 'center center';
				svgContainer.style.transition = animate ? 'transform 0.1s ease-out' : 'none';
			}
		}
		this.refreshSelection();
	}

	private updateElementHighlight(): void {
		try {
			const cursorPos = this.editor.state.selection.main.head;
			const svgCode = this.editor.state.doc.toString();
			const elementInfo = findElementAtCursor(svgCode, cursorPos);
			this.clearHighlights();
			if (elementInfo) {
				this.highlightElement(elementInfo);
			}
		} catch (error) {
			console.debug('Element highlighting failed:', error);
		}
	}

	private highlightElement(ref: ElementRef): void {
		try {
			const svgContainer = this.svgPreview.querySelector('.svg-container');
			if (!svgContainer) return;
			const svgElement = svgContainer.querySelector('svg');
			if (!svgElement) return;
			const cssHlColor = getComputedStyle(document.body).getPropertyValue('--color-hl').trim() || '#0f0';
			this.ensureHighlightFilter(svgElement, cssHlColor);

			const target = this.elementForOrdinal(ref.ordinal);
			if (!target) return;
			// keep the element's own filter so clearHighlights can restore it
			const ownFilter = target.getAttribute('filter');
			if (ownFilter !== null) target.setAttribute('data-xray-filter', ownFilter);
			target.setAttribute('filter', 'url(#highlight-glow)');
		} catch (error) {
			console.debug('Failed to highlight element:', error);
		}
	}

	private clearHighlights(): void {
		try {
			const svgContainer = this.svgPreview.querySelector('.svg-container');
			if (!svgContainer) return;
			const filteredElements = svgContainer.querySelectorAll('[filter="url(#highlight-glow)"]');
			filteredElements.forEach(element=>{
				const ownFilter = element.getAttribute('data-xray-filter');
				if (ownFilter !== null) {
					element.setAttribute('filter', ownFilter);
					element.removeAttribute('data-xray-filter');
				} else {
					element.removeAttribute('filter');
				}
			});
		} catch (error) {
			console.debug('Failed to clear highlights:', error);
		}
	}

	private ensureHighlightFilter(svgElement: SVGSVGElement, color: string): void {
		const SVG_NS = 'http://www.w3.org/2000/svg';
		let defs = svgElement.querySelector('defs');
		if (!defs) {
			defs = document.createElementNS(SVG_NS, 'defs');
			svgElement.insertBefore(defs, svgElement.firstChild);
		}
		const filter = defs.querySelector('#highlight-glow');
		if (!filter) {
			const filterMarkup = `
<filter id="highlight-glow" x="-10%" y="-10%" width="120%" height="120%" filterUnits="objectBoundingBox" primitiveUnits="userSpaceOnUse" color-interpolation-filters="sRGB">
	<feColorMatrix type="matrix" values="1 0 0 0 0
	1 0 0 0 0
	1 0 0 0 0
	0 0 0 1 0" in="SourceGraphic" result="colormatrix"/>
	<feComponentTransfer in="colormatrix" result="componentTransfer">
		<feFuncR type="table" tableValues="0.75 0.53"/>
		<feFuncG type="table" tableValues="0.25 0.97"/>
		<feFuncB type="table" tableValues="0.64 0.77"/>
		<feFuncA type="table" tableValues="0 1"/>
	</feComponentTransfer>
	<feBlend mode="normal" in="componentTransfer" in2="SourceGraphic" result="blend"/>
</filter>
`;
			defs.insertAdjacentHTML('beforeend', filterMarkup);
		} else {
			const fe = filter.querySelector('feDropShadow');
			if (fe) fe.setAttribute('flood-color', color);
		}
	}

	private toggleLayout(): void {
		this.isVerticalLayout = !this.isVerticalLayout;
		document.body.classList.toggle('vertical');
		resetElementStyles(this.get('editor'), this.get('preview'));
		const dragbar = this.get('dragbar');
		dragbar.setAttribute('aria-orientation', this.isVerticalLayout ? 'horizontal' : 'vertical');
	}

	private toggleMode(): void {
		this.isDarkMode = !this.isDarkMode;
		document.body.classList.toggle('dark');
		this.editor.dispatch({
			effects: this.themeCompartment.reconfigure(
				this.isDarkMode ? [tokyoNightStorm] : [tokyoNightDay]
			)
		});
	}

	// --- Pan and zoom
	/** The toolbar zooms about the middle of the drawing, wherever it was panned to. */
	private zoomIn(): void {
		const v = this.view();
		this.setView(zoomAbout(v, ZOOM_STEP, v.panX, v.panY), true);
		this.announceAction(`Zoomed in to ${Math.round(this.zoomLevel * 100)}%`);
	}
	private zoomOut(): void {
		const v = this.view();
		this.setView(zoomAbout(v, 1 / ZOOM_STEP, v.panX, v.panY), true);
		this.announceAction(`Zoomed out to ${Math.round(this.zoomLevel * 100)}%`);
	}
	private view(): View {
		return {zoom: this.zoomLevel, panX: this.panX, panY: this.panY};
	}
	private setView(view: View, animate = false): void {
		this.zoomLevel = view.zoom;
		this.panX = view.panX;
		this.panY = view.panY;
		this.drawBox(this.hoverBox, null);
		this.applySVGStyles(animate);
	}
	/** A point on the screen as an offset from the middle of the pane, which
	 * the drawing is centred on and scaled about. */
	private fromPaneCenter(clientX: number, clientY: number): [number, number] {
		const r = this.svgPreview.getBoundingClientRect();
		return [clientX - (r.left + r.width / 2), clientY - (r.top + r.height / 2)];
	}
	/** The zoom in the status bar as it changes, and announced once it has
	 * settled: a pinch changes it dozens of times a second. */
	private showZoom(): void {
		const pct = `${Math.round(this.zoomLevel * 100)}%`;
		this.sayInPreview(`Zoom ${pct}`);
		clearTimeout(this.zoomTimer);
		this.zoomTimer = setTimeout(()=>this.announceAction(`Zoomed to ${pct}`), ZOOM_SETTLE);
	}
	/** The wheel over the preview: with Ctrl or Cmd, which is how a trackpad
	 * pinch arrives, it zooms about the pointer; on its own it pans. Either
	 * way the page itself keeps still. */
	private onWheel(e: WheelEvent): void {
		e.preventDefault();
		if (this.gesture || this.pinch) return;
		if (e.ctrlKey || e.metaKey) {
			const [x, y] = this.fromPaneCenter(e.clientX, e.clientY);
			this.setView(zoomAbout(this.view(), wheelZoomFactor(e.deltaY, e.deltaMode), x, y));
			this.showZoom();
		} else {
			const [dx, dy] = wheelPan(e);
			const v = this.view();
			this.setView({zoom: v.zoom, panX: v.panX + dx, panY: v.panY + dy});
		}
	}
	/** Safari's own pinch events: a Mac trackpad pinch arrives only as these
	 * there, never as Ctrl+wheel. An iPhone sends them beside the touches,
	 * which already zoom, so they are left alone while a touch pinch is on. */
	private onGestureStart(e: Event): void {
		e.preventDefault();
		if (this.pinch || this.gesture) return;
		this.safariScale = (e as SafariGesture).scale ?? 1;
	}
	private onGestureChange(e: Event): void {
		e.preventDefault();
		const g = e as SafariGesture;
		const scale = g.scale ?? 0;
		if (this.safariScale === null || this.pinch || !(scale > 0)) return;
		const [x, y] = g.clientX === undefined || g.clientY === undefined ? [0, 0] : this.fromPaneCenter(g.clientX, g.clientY);
		this.setView(zoomAbout(this.view(), scale / this.safariScale, x, y));
		this.safariScale = scale;
		this.showZoom();
	}
	private onGestureEnd(e: Event): void {
		e.preventDefault();
		this.safariScale = null;
	}

	/** A press on the canvas: on the selection it starts a move, anywhere
	 * else a pan, and either way a press that does not travel is a click. */
	private onPress(e: MouseEvent): void {
		if (e.button !== 0) return;
		e.preventDefault();
		if (this.drawTool) {
			this.drewOnPress = true;
			this.pressDraw(e.clientX, e.clientY, e.shiftKey);
			return;
		}
		// a second click keeps the mark of a first that drew, for the double-click to see
		if (e.detail <= 1) this.drewOnPress = false;
		if (this.pressPoint(e, e.clientX, e.clientY)) return;
		this.pressMoved = false;
		this.tapTarget = e.target;
		this.pressToggle = e.ctrlKey || e.metaKey;
		this.pressX = this.lastPanX = e.clientX;
		this.pressY = this.lastPanY = e.clientY;
		// the open hand closes on the press, for the selection and the canvas alike
		this.svgPreview.style.cursor = 'grabbing';
		if (this.pressMarquee(e.clientX, e.clientY)) return;
		if (!this.pressToggle && this.pressOutline(e.clientX, e.clientY)) return;
		if (this.onSelection(e.target) && !this.pressToggle) {
			this.gesture = {mode: 'move', handle: null, fromHandle: false, toggle: false, startX: e.clientX, startY: e.clientY, targets: this.selectedElements(), drags: [], point: null};
			return;
		}
		this.isPanning = true;
	}

	/** The selected element a press on this target lands on or inside, if any. */
	private onSelection(target: EventTarget | null): Element | null {
		if (!(target instanceof Node)) return null;
		return this.selectedElements().find(el=>el.contains(target)) ?? null;
	}
	private doPan(e: MouseEvent): void {
		if (!this.isPanning) return;
		// a press that has not travelled is a click in the making, not a pan
		if (!this.pressMoved && Math.hypot(e.clientX - this.pressX, e.clientY - this.pressY) < DRAG_THRESHOLD) return;
		this.pressMoved = true;
		this.drawBox(this.hoverBox, null);
		const deltaX = e.clientX - this.lastPanX;
		const deltaY = e.clientY - this.lastPanY;
		this.panX += deltaX;
		this.panY += deltaY;
		this.lastPanX = e.clientX;
		this.lastPanY = e.clientY;
		this.applySVGStyles(false);
		e.preventDefault();
	}
	private endPan(): void {
		if (this.isPanning && !this.pressMoved) this.clickSelect(this.tapTarget, this.pressToggle);
		this.isPanning = false;
		this.svgPreview.style.cursor = this.drawTool ? 'crosshair' : '';
	}

	/** One finger on the canvas: on the selection it starts a move, anywhere
	 * else a pan, and a finger that does not travel is a tap. */
	private handleTouchStart(e: TouchEvent): void {
		if (e.touches.length !== 1) return;
		if (this.drawTool) {
			this.pressDraw(e.touches[0].clientX, e.touches[0].clientY);
			e.preventDefault();
			return;
		}
		if (this.pressPoint(e, e.touches[0].clientX, e.touches[0].clientY)) return;
		this.tapTarget = e.target;
		this.pressToggle = false;
		this.pressX = this.lastPanX = e.touches[0].clientX;
		this.pressY = this.lastPanY = e.touches[0].clientY;
		const current = this.onSelection(e.target);
		if (this.pressMarquee(this.pressX, this.pressY) || this.pressOutline(this.pressX, this.pressY)) {
			this.isPanning = false;
		} else if (current) {
			this.gesture = {mode: 'move', handle: null, fromHandle: false, toggle: false, startX: this.pressX, startY: this.pressY, targets: this.selectedElements(), drags: [], point: null};
			this.isPanning = false;
		} else {
			this.isPanning = true;
		}
		e.preventDefault();
	}
	/** A second finger starts a pinch when the first is on the preview, wherever
	 * the second lands. Left to the browser, the pinch would zoom the whole page.
	 * A drag the first finger had going keeps what it did, but is written only
	 * once every finger has lifted: writing it now would redraw the preview
	 * under the fingers, and a touch reports to the element it began on even
	 * after that element has been replaced, so the pinch would go unheard. */
	private handlePinchStart(e: TouchEvent): void {
		if (e.touches.length !== 2) return;
		const changed = Array.from(e.changedTouches);
		const first = Array.from(e.touches).find(t=>!changed.some(c=>c.identifier === t.identifier)) ?? e.touches[0];
		if (!(first.target instanceof Node) || !this.previewContainer.contains(first.target)) return;
		e.preventDefault();
		if (this.gesture?.drags.length) this.gesture.held = true;
		else if (this.gesture) this.cancelGesture();
		this.isPanning = false;
		this.tapTarget = null;
		this.pinch = {view: this.view(), from: this.pinchOf(e.touches)};
	}
	private pinchOf(touches: TouchList): Pinch {
		const [a, b] = [touches[0], touches[1]];
		const [x, y] = this.fromPaneCenter((a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2);
		return {x, y, spread: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)};
	}
	private handleTouchMove(e: TouchEvent): void {
		if (this.pinch) {
			if (e.touches.length !== 2) return;
			e.preventDefault();
			this.setView(pinchView(this.pinch.view, this.pinch.from, this.pinchOf(e.touches)));
			this.showZoom();
			return;
		}
		if (this.gesture && !this.gesture.held && e.touches.length === 1) {
			this.gestureMove(e.touches[0].clientX, e.touches[0].clientY, false);
			e.preventDefault();
			return;
		}
		if (e.touches.length === 1 && this.isPanning) {
			const touch = e.touches[0];
			if (Math.hypot(touch.clientX - this.pressX, touch.clientY - this.pressY) >= DRAG_THRESHOLD) this.tapTarget = null;
			this.panX += touch.clientX - this.lastPanX;
			this.panY += touch.clientY - this.lastPanY;
			this.lastPanX = touch.clientX;
			this.lastPanY = touch.clientY;
			this.applySVGStyles(false);
			e.preventDefault();
		}
	}
	private handleTouchEnd(e: TouchEvent): void {
		if (this.pinch && e.touches.length < 2) {
			this.pinch = null;
			// the finger left behind goes on as a pan, from where it is now,
			// unless it is holding a drag, which waits for it to lift
			const rest = e.touches.item(0);
			this.isPanning = rest !== null && !this.gesture;
			if (rest) {
				this.pressX = this.lastPanX = rest.clientX;
				this.pressY = this.lastPanY = rest.clientY;
			}
		}
		if (this.pinch) return;
		if (e.touches.length === 0) this.touchedMarker = null;
		if (e.touches.length === 0 && this.gesture) {
			this.gestureEnd();
			return;
		}
		if (e.touches.length === 0) {
			if (this.isPanning && this.tapTarget) this.clickSelect(this.tapTarget);
			this.isPanning = false;
		}
	}

	// --- Selection
	/** The preview element with this source ordinal: by its stamp when the
	 * source parsed, else by counting same-named tags, as the tag scanner does. */
	private elementForOrdinal(ordinal: number): Element | null {
		const container = this.svgPreview.querySelector('.svg-container');
		if (!container) return null;
		try {
			const stamped = container.querySelector(`[${SOURCE_ATTR}="${ordinal}"]`);
			if (stamped) return stamped;
			const tags = startTags(this.editor.state.doc.toString());
			const tag = tags.at(ordinal);
			if (!tag) return null;
			const index = tags.slice(0, ordinal).filter(t=>t.name === tag.name).length;
			return Array.from(container.querySelectorAll(tag.name)).at(index) ?? null;
		} catch {
			return null;
		}
	}

	/** The primary selection: the element the editor's selection follows. */
	private selectedElement(): Element | null {
		const ordinal = this.selected.at(-1);
		return ordinal === undefined ? null : this.elementForOrdinal(ordinal);
	}

	/** Every selected element, in the order they were picked. */
	private selectedElements(): Element[] {
		return this.selected.map(ordinal=>this.elementForOrdinal(ordinal)).filter((el): el is Element=>el !== null);
	}

	/** What a click on this target would select. */
	private pickAt(target: EventTarget | null): Element | null {
		const root = this.svgPreview.querySelector('.svg-container svg');
		if (!(root instanceof SVGSVGElement)) return null;
		const leaf = findSvgTarget(target, root);
		return leaf ? nextInChain(selectionChain(leaf, root), this.selectedElement()) : null;
	}

	/** A click selects what it lands on; with Ctrl or Cmd held it adds to the
	 * selection, or takes an element back out of it. */
	private clickSelect(target: EventTarget | null, toggle = false): void {
		this.svgPreview.focus({preventScroll: true});
		// while its points are being edited, a click near its outline picks that
		// spot, and one on the element keeps it rather than walking its group;
		// while several are being picked, one anywhere else only lets them go
		if (this.pointMode && !toggle && this.pickSpot(this.pressX, this.pressY)) return;
		if (this.pointMode && !toggle && (this.pointMode.several || this.onSelection(target))) {
			this.pointMode.selected = [];
			this.pointMode.spot = null;
			this.refreshSelection();
			return;
		}
		const pick = this.pickAt(target);
		if (!pick) {
			if (!toggle) this.clearSelection();
			return;
		}
		const ordinal = this.ordinalFor(pick);
		if (ordinal === null) return;
		if (toggle && this.selected.includes(ordinal)) {
			this.selected = this.selected.filter(o=>o !== ordinal);
			this.refreshSelection();
			// the editor follows the new primary, so the cursor does not stay in the element just let go
			const primary = this.selectedElement();
			const primaryOrdinal = this.selected.at(-1);
			if (primary && primaryOrdinal !== undefined) this.selectInEditor(primary, primaryOrdinal);
			return;
		}
		this.selected = toggle ? [...this.selected, ordinal] : [ordinal];
		this.refreshSelection();
		this.drawBox(this.hoverBox, null);
		this.selectInEditor(pick, ordinal);
		this.announceAction(`Selected ${pick.tagName.toLowerCase()}`);
	}

	private ordinalFor(el: Element, source = this.editor.state.doc.toString()): number | null {
		const container = this.svgPreview.querySelector('.svg-container');
		return container ? ordinalOf(el, container, source) : null;
	}

	/** Select the element's start tag in the editor. */
	private selectInEditor(el: Element, ordinal: number): void {
		const tag = startTags(this.editor.state.doc.toString()).at(ordinal);
		if (tag && tag.name === el.tagName.toLowerCase()) {
			this.editor.dispatch({selection: {anchor: tag.start, head: tag.end}, scrollIntoView: true});
		}
	}

	/** Select one preview element, alone, and its start tag in the editor. */
	private selectElement(el: Element): void {
		const ordinal = this.ordinalFor(el);
		if (ordinal === null) return;
		this.selected = [ordinal];
		this.refreshSelection();
		this.drawBox(this.hoverBox, null);
		this.selectInEditor(el, ordinal);
		this.announceAction(`Selected ${el.tagName.toLowerCase()}`);
	}

	private clearSelection(): void {
		if (this.selected.length === 0) return;
		this.selected = [];
		this.refreshSelection();
	}

	/** The selection follows the editor cursor, as the x-ray glow does. The
	 * root <svg> is never selected: it is the canvas, not a thing on it. A
	 * cursor still in the primary selection leaves a wider selection be. */
	private syncSelectionFromCursor(): void {
		if (this.skipSync) {
			this.skipSync = false;
			return;
		}
		const source = this.editor.state.doc.toString();
		const ref = findElementAtCursor(source, this.editor.state.selection.main.head);
		const next = ref && ref.ordinal !== this.rootTag(source)?.ordinal ? ref.ordinal : null;
		if (next === (this.selected.at(-1) ?? null)) return;
		this.selected = next === null ? [] : [next];
		this.refreshSelection();
	}

	private hoverAt(e: MouseEvent): void {
		// a shape under way shows what a press where the pointer is would add
		if (this.sketch && !this.gesture) {
			this.sketch.hover = this.aimAt(this.sketch, e.clientX, e.clientY, e.shiftKey);
			this.showSketch();
			return;
		}
		// with a shape tool in hand, nothing is picked out to select
		if (this.isPanning || this.gesture || this.drawTool) return;
		const pick = this.pickAt(e.target);
		// a hand over the selection says it can be dragged, as over the canvas
		this.svgPreview.style.cursor = this.onSelection(e.target) ? 'grab' : pick ? 'pointer' : '';
		this.drawBox(this.hoverBox, pick && !this.selectedElements().includes(pick) ? pick : null);
	}

	private refreshSelection(): void {
		const els = this.selectedElements();
		const primary = els.at(-1) ?? null;
		const corners = this.drawBox(this.selectBox, primary);
		// a box for each of the others
		const others = els.slice(0, -1);
		while (this.moreBoxes.length < others.length) this.moreBoxes.push(this.makeBox('select-more'));
		const drawn = this.moreBoxes.map((box, i)=>this.drawBox(box, others.at(i) ?? null));
		// point editing ends when its element is no longer the one selection
		if (this.pointMode && (els.length !== 1 || this.selected[0] !== this.pointMode.ordinal)) this.pointMode = null;
		const editing = this.pointMode && primary ? primary : null;
		// several elements, or several points, have one box with handles round them all;
		// while it turns, it turns with them rather than growing to hold them upright
		const several = editing ? this.pointBox()?.corners ?? null : els.length > 1 ? this.groupBoxOf([...drawn, corners].flatMap(c=>c ?? [])) : null;
		const turning = this.gesture?.box && this.gesture.drags.length > 0 && this.gesture.mode === 'rotate' ? this.gesture : null;
		const shown = several && turning?.box ? turnedCorners(turning.box, turning.turn ?? 0) : several;
		this.drawCorners(this.groupBox, shown);
		this.placeHandles(els.length === 1 && !editing ? corners : shown);
		this.placePoints(editing);
		this.get('duplicate').toggleAttribute('disabled', !primary);
		const pointsButton = this.get('points');
		pointsButton.toggleAttribute('disabled', !(els.length === 1 && primary && POINT_ELEMENTS.test(primary.tagName.toLowerCase())));
		pointsButton.setAttribute('aria-pressed', editing ? 'true' : 'false');
		const shape = SHAPES.join(',');
		this.get('topath').toggleAttribute('disabled', !els.some(el=>el.matches(shape) || el.querySelector(shape)));
		this.refreshPointTools(editing !== null);
		this.placeSketch();
	}

	/** While points are being edited, their tools take the place of the
	 * preview's own buttons, but for the zoom, which editing needs too. Each
	 * is there to be found, and can be pressed when what is selected is
	 * something it works on. */
	private refreshPointTools(editing: boolean): void {
		this.get('point-tools').classList.toggle('hide', !editing);
		this.get('shape-tools').classList.toggle('hide', editing);
		this.refreshSketchTools();
		this.get('point-several').setAttribute('aria-pressed', this.pointMode?.several ? 'true' : 'false');
		// the tools wait for a drag to end before they look again
		if (this.gesture?.drags.length) return;
		const chosen = editing ? this.selectedPoints()?.chosen ?? [] : [];
		const remove = this.get('point-delete');
		remove.toggleAttribute('disabled', chosen.length === 0 || chosen.every(c=>c.point.ref.type === 'line'));
		remove.setAttribute('aria-label', chosen.length > 1 ? 'Delete points' : chosen.at(0)?.point.kind === 'control' ? 'Delete handle' : 'Delete point');
		const el = editing ? this.selectedElement() : null;
		const data = el ? pathDataOf(el) : null;
		const anchors = chosenAnchors(chosen);
		const decimals = el ? this.decimalsAt(el) : 0;
		const {kinds, symmetric} = this.anchorTools(data?.d ?? null, anchors, decimals);
		const smooth = this.get('point-smooth');
		smooth.toggleAttribute('disabled', kinds.length === 0);
		smooth.setAttribute('aria-pressed', kinds.length > 0 && kinds.every(k=>k === 'smooth') ? 'true' : 'false');
		// there to be pressed only when it would change something
		this.get('point-symmetric').toggleAttribute('disabled', !symmetric);
		const segment = data ? this.spotSegment(data) : null;
		const segments = data && segment !== null ? parsePathData(data.d) : null;
		const curved = data && segment !== null ? segmentCurved(data.d, segment) : false;
		const curve = this.get('point-curve');
		// an arc cannot be curved, but it can be made straight
		curve.toggleAttribute('disabled', !segments || segment === null || /^m$/i.test(segments[segment].letter));
		curve.setAttribute('aria-pressed', curved ? 'true' : 'false');
		this.get('point-add').toggleAttribute('disabled', !segments || segment === null || /^[ma]$/i.test(segments[segment].letter));
	}

	/** What the selected anchors are, smooth or corners, and whether one of
	 * them would change if made symmetric. Worked out again only when the
	 * path or the selection changes, not on every redraw of the selection. */
	private anchorTools(d: string | null, anchors: number[], decimals: number): {kinds: ('smooth' | 'corner')[]; symmetric: boolean} {
		const key = `${d ?? ''}\u0000${anchors.join(',')}\u0000${decimals}`;
		if (this.anchorToolsFor?.key === key) return this.anchorToolsFor.state;
		const kinds = d === null ? [] : anchors.map(s=>anchorKind(d, s)).filter(k=>k !== null);
		const symmetric = d !== null && anchors.some(s=>((next)=>next !== null && next !== d)(symmetricPathPoint(d, s, decimals)));
		this.anchorToolsFor = {key, state: {kinds, symmetric}};
		return this.anchorToolsFor.state;
	}

	/** The segment of the path data the picked spot is on, if one is picked
	 * and still there. */
	private spotSegment(data: {d: string; converted: boolean}): number | null {
		const spot = this.pointMode?.spot;
		if (!spot) return null;
		const segment = data.converted ? spot.edge + 1 : spot.edge;
		return parsePathData(data.d)?.at(segment) ? segment : null;
	}

	/** Run a tool from its button, then give the keys back to the canvas. */
	private pointTool(run: () => void): void {
		run();
		this.svgPreview.focus({preventScroll: true});
	}

	// --- Point editing
	/** Markers for every point of the element being edited: squares on the
	 * anchors, circles on the handles, with lines to the anchors they shape.
	 * Their elements are kept from one drawing to the next where they can be:
	 * a touch reports to the element it began on, and a marker under a finger
	 * that was replaced mid-drag would take the rest of the touch with it. */
	private placePoints(el: Element | null): void {
		this.spotGroup.replaceChildren();
		const points = el ? pointsOf(el) : null;
		const ctm = el instanceof SVGGraphicsElement ? el.getScreenCTM() : null;
		const shapes: {tag: 'line' | 'rect' | 'circle'; attrs: Record<string, string>; selected: boolean; pulling: boolean}[] = [];
		if (el && points && ctm) {
			const origin = this.overlay.getBoundingClientRect();
			this.placeSpot(el, ctm, origin);
			const onScreen = (p: Point): Point=>{
				const q = new DOMPoint(p.x, p.y).matrixTransform(ctm);
				return {x: q.x - origin.left, y: q.y - origin.top};
			};
			const size = HANDLE_SIZE - 1;
			// handles pulled out of an anchor come before it in the list, so once
			// the drag is under way the anchor is found by where it is
			const pull = this.gesture?.pull ? this.gesture : null;
			const from = pull?.drags[0]?.point?.from ?? null;
			const picked = new Set(this.pointMode?.selected);
			const held = (point: EditPoint, i: number): boolean=>from
				? point.kind === 'anchor' && Math.hypot(point.x - from.x, point.y - from.y) < 1e-6
				: pull?.point === i;
			points.forEach((point, i)=>{
				const at = onScreen(point);
				for (const anchor of point.anchors) {
					const a = onScreen(anchor);
					shapes.push({tag: 'line', attrs: {x1: `${at.x}`, y1: `${at.y}`, x2: `${a.x}`, y2: `${a.y}`}, selected: false, pulling: false});
				}
				const selected = from ? held(point, i) : picked.has(i);
				// an anchor a finger is holding shows that handles will come out of it
				const pulling = pull !== null && held(point, i);
				shapes.push(point.kind === 'anchor'
					? {tag: 'rect', attrs: {x: `${at.x - size / 2}`, y: `${at.y - size / 2}`, width: `${size}`, height: `${size}`, 'data-point': `${i}`}, selected, pulling}
					: {tag: 'circle', attrs: {cx: `${at.x}`, cy: `${at.y}`, r: `${size / 2}`, 'data-point': `${i}`}, selected, pulling});
			});
		}
		// the marker under a finger is hidden rather than taken out, even when
		// the points change around it, as handles pulled out of it do
		const drop = (node: Element): void=>{
			if (node === this.touchedMarker) node.classList.add('hide');
			else node.remove();
		};
		const kids = Array.from(this.pointsGroup.children);
		shapes.forEach((shape, k)=>{
			let node = kids.at(k);
			if (node?.tagName !== shape.tag) {
				const made = document.createElementNS(SVG_NS, shape.tag);
				if (node) {
					node.before(made);
					drop(node);
				} else {
					this.pointsGroup.appendChild(made);
				}
				node = made;
			}
			for (const [name, value] of Object.entries(shape.attrs)) node.setAttribute(name, value);
			node.classList.toggle('selected', shape.selected);
			node.classList.toggle('pulling', shape.pulling);
			node.classList.remove('hide');
		});
		for (const extra of kids.slice(shapes.length)) drop(extra);
	}

	/** The picked segment, drawn over the outline in the element's own units
	 * with a stroke that keeps its width on screen, and a dot on the spot. */
	private placeSpot(el: Element, ctm: DOMMatrix, origin: DOMRect): void {
		const spot = this.pointMode?.spot;
		const data = spot ? pathDataOf(el) : null;
		const segments = data ? parsePathData(data.d) : null;
		const index = data ? this.spotSegment(data) : null;
		if (!spot || !segments || index === null) return;
		const seg = segments[index];
		const w = walkPath(segments)[index];
		const p = (q: Point): string=>`${q.x} ${q.y}`;
		const kind = seg.letter.toLowerCase();
		const shape = (kind === 'c' || kind === 's') && w.cp1 && w.cp2 ? `C${p(w.cp1)} ${p(w.cp2)} ${p(w.end)}`
			: (kind === 'q' || kind === 't') && w.cp1 ? `Q${p(w.cp1)} ${p(w.end)}`
			: kind === 'a' ? `A${seg.args.slice(0, 5).map(a=>a.value).join(' ')} ${p(w.end)}`
			: `L${p(w.end)}`;
		const line = document.createElementNS(SVG_NS, 'path');
		line.setAttribute('d', `M${p(w.start)} ${shape}`);
		line.setAttribute('transform', `matrix(${ctm.a} ${ctm.b} ${ctm.c} ${ctm.d} ${ctm.e - origin.left} ${ctm.f - origin.top})`);
		const on = pointOnSegment(seg, w, spot.t);
		const at = new DOMPoint(on.x, on.y).matrixTransform(ctm);
		const dot = document.createElementNS(SVG_NS, 'circle');
		dot.setAttribute('cx', `${at.x - origin.left}`);
		dot.setAttribute('cy', `${at.y - origin.top}`);
		dot.setAttribute('r', `${HANDLE_SIZE / 2 - 1}`);
		this.spotGroup.append(line, dot);
	}

	/** Edit the points of the one selected path, polygon, polyline, or line. */
	private enterPointMode(): void {
		const current = this.selectedElement();
		const ordinal = this.selected.at(-1);
		if (!current || ordinal === undefined || this.selected.length !== 1) return;
		const tag = current.tagName.toLowerCase();
		if (!POINT_ELEMENTS.test(tag)) {
			if (SHAPES.includes(tag)) this.announceError(`${/^[aeiou]/.test(tag) ? 'An' : 'A'} ${tag} has no points to edit until it is a path: use the to-path button first.`);
			return;
		}
		if (!pointsOf(current)) {
			this.announceError('This element\'s points could not be read, so they cannot be edited here.');
			return;
		}
		if (this.drawTool) {
			this.armShape(null);
			// a shape under way the code cannot take yet keeps the tool in hand
			if (this.sketch) return;
			// a shape under way was written and selected in its place: its points are the ones edited
			if (this.selected.at(-1) !== ordinal) {
				this.enterPointMode();
				return;
			}
		}
		this.pointMode = {ordinal, selected: [], spot: null, several: false};
		this.refreshSelection();
		this.svgPreview.focus({preventScroll: true});
		this.announceAction(`Editing the points of ${current.tagName.toLowerCase()}: drag a point, tap the outline to pick a segment, double-click it to add a point, Delete removes one`);
	}

	private leavePointMode(): void {
		if (!this.pointMode) return;
		this.pointMode = null;
		this.refreshSelection();
		this.announceAction('Point editing ended');
	}

	private togglePointMode(): void {
		if (this.pointMode) this.leavePointMode();
		else this.enterPointMode();
		this.svgPreview.focus({preventScroll: true});
	}

	/** A double-click on the selection edits its points; in point editing it
	 * adds a point where the outline is nearest. */
	private onDoubleClick(e: MouseEvent): void {
		// the first click of this double-click drew a shape, which the second only selects
		if (this.drewOnPress) {
			this.drewOnPress = false;
			return;
		}
		const current = this.onSelection(e.target);
		if (!current) return;
		e.preventDefault();
		if (!this.pointMode) {
			this.enterPointMode();
			return;
		}
		const spot = this.outlineNear(current, e.clientX, e.clientY);
		if (spot) this.addPointOn(current, spot);
	}

	/** The spot on an element's outline nearest a press, if it is within
	 * reach of it. */
	private outlineNear(el: Element, clientX: number, clientY: number): Spot | null {
		const ctm = el instanceof SVGGraphicsElement ? el.getScreenCTM() : null;
		const toLocal = ctm ? invert(toMatrix(ctm)) : null;
		if (!ctm || !toLocal) return null;
		const local = applyToPoint(toLocal, clientX, clientY);
		const reach = Math.max(ADD_POINT_REACH, POINT_REACH) / pixelsPerUnit(toMatrix(ctm));
		const tag = el.tagName.toLowerCase();
		if (tag === 'path') {
			const near = nearestPathSegment(el.getAttribute('d') ?? '', local);
			return near && near.distance <= reach ? {edge: near.segment, t: near.t} : null;
		}
		if (tag === 'polygon' || tag === 'polyline' || tag === 'line') {
			const ends = tag === 'line' ? pointsOf(el)?.map(p=>`${p.x},${p.y}`).join(' ') ?? '' : el.getAttribute('points') ?? '';
			const near = nearestPolygonEdge(ends, local, tag === 'polygon');
			return near && near.distance <= reach ? {edge: near.index, t: near.t} : null;
		}
		return null;
	}

	/** A tap near the outline of the element being edited picks that spot,
	 * for the tools that work on a segment. */
	private pickSpot(clientX: number, clientY: number): boolean {
		const el = this.selectedElement();
		const spot = el && this.pointMode ? this.outlineNear(el, clientX, clientY) : null;
		if (!this.pointMode || !spot) return false;
		this.pointMode.spot = spot;
		this.pointMode.selected = [];
		this.refreshSelection();
		this.announceAction('Segment picked: add a point to it, or curve or straighten it');
		return true;
	}

	/** The precision an edit made at the current zoom is written to. */
	private decimalsAt(el: Element): number {
		const ctm = el instanceof SVGGraphicsElement ? el.getScreenCTM() : null;
		return ctm ? decimalsFor(pixelsPerUnit(toMatrix(ctm))) : 0;
	}

	/** Write new path data for the element being edited. A polygon or
	 * polyline the tools gave curves becomes a path, its points attribute the
	 * path's `d` where it stood. */
	private commitPathData(found: Found, d: string, converted: boolean): boolean {
		if (!converted) return this.commitChanges(found.sourceText, [{tag: found.tag, attrs: {d}}], 'slick.point');
		if (this.editor.state.doc.toString() !== found.sourceText) return false;
		return this.applyEdits(asPathChanges(found.sourceText, found.tag, d), 'slick.point');
	}

	/** The shapes a conversion to paths takes: each selected shape, and each
	 * shape inside a selected group, once. */
	private shapesIn(els: Element[]): Element[] {
		const selector = SHAPES.join(',');
		const found = new Set<Element>();
		for (const el of els) {
			if (el.matches(selector)) found.add(el);
			else for (const inner of Array.from(el.querySelectorAll(selector))) found.add(inner);
		}
		return [...found];
	}

	/** Make every selected shape a path that draws the same, in one step.
	 * There is no way back but undo. */
	private convertToPaths(): void {
		const parsed = this.parseOnce();
		const selected = this.selectedElements();
		const shapes = this.shapesIn(selected);
		if (!parsed || shapes.length === 0) return;
		// Enter edits points only when the shape itself is what is selected
		const one = selected.length === 1 && selected[0] === shapes[0] ? shapes[0].tagName.toLowerCase() : null;
		const changes: TextChange[] = [];
		let count = 0;
		let refusal: string | null = null;
		for (const el of shapes) {
			const found = this.sourceFor(el, parsed);
			if (!found) continue;
			const blocked = conversionBlocked(found.source);
			const lengths = blocked ? null : writtenLengths(found.source, (name)=>resolvedLength(el, name));
			const made: ShapePath = blocked ? {ok: false, reason: blocked}
				: lengths ? shapePathData(found.tag.name, lengths, found.source.getAttribute('points'))
				: {ok: false, reason: `This ${found.tag.name}'s sizes could not be read, so it cannot be made a path here.`};
			if (made.ok) {
				changes.push(...asPathChanges(parsed.sourceText, found.tag, made.d));
				count += 1;
			} else {
				refusal = made.reason;
			}
		}
		if (changes.length === 0) {
			this.announceError(refusal ?? 'Nothing selected can be made a path.');
			return;
		}
		// a spot or point picked on a polygon is numbered apart from the path it becomes
		if (this.pointMode) {
			this.pointMode.selected = [];
			this.pointMode.spot = null;
		}
		if (!this.applyEdits(changes.sort((a, b)=>a.from - b.from), 'slick.topath')) return;
		this.announceAction(one && count === 1 ? `${one} made a path: press Enter to edit its points` : `${count} ${count === 1 ? 'shape' : 'shapes'} made ${count === 1 ? 'a path' : 'paths'}${refusal ? `; ${refusal}` : ''}`);
	}

	/** Select the anchor at a place, after an edit that may have moved the
	 * point list around it. */
	private selectAnchorAt(ordinal: number, at: Point): void {
		this.selectPointsAt(ordinal, [{x: at.x, y: at.y, kind: 'anchor'}]);
	}

	/** Select the points of these kinds at these places, after an edit that
	 * may have moved the point list around them; any not found go. One still
	 * at the place it had in the list keeps it, so a point moved onto another
	 * does not hand its selection over. `reach` allows for the rounding of
	 * where a point was written, as a turn's or a scale's are. */
	private selectPointsAt(ordinal: number, wanted: Wanted[], reach = 1e-6): void {
		const made = this.elementForOrdinal(ordinal);
		const points = made ? pointsOf(made) ?? [] : [];
		const found = wanted.map(w=>{
			const there = (p: EditPoint): boolean=>p.kind === w.kind && Math.hypot(p.x - w.x, p.y - w.y) <= reach;
			const kept = w.index === undefined ? undefined : points.at(w.index);
			return kept && w.index !== undefined && there(kept) ? w.index : points.findIndex(there);
		}).filter(i=>i >= 0);
		if (this.pointMode) this.pointMode.selected = [...new Set(found)];
		this.refreshSelection();
		this.selectPointInEditor();
	}

	/** Pick several points one tap at a time, or one at a time again. */
	private toggleSeveral(): void {
		if (!this.pointMode) return;
		this.pointMode.several = !this.pointMode.several;
		this.refreshSelection();
		this.announceAction(this.pointMode.several
			? 'Selecting several points: tap points to add them or take them out, or drag across the drawing to take in the points inside'
			: 'Selecting one point at a time');
	}

	/** Say how many points are selected, when more than one is. */
	private announceSelected(): void {
		const count = this.pointMode?.selected.length ?? 0;
		this.announceAction(count === 1 ? '1 point selected' : `${count} points selected`);
	}

	/** Add a point on the picked spot. */
	private addPointAtSpot(): void {
		const el = this.selectedElement();
		const spot = this.pointMode?.spot;
		if (el && spot) this.addPointOn(el, spot);
	}

	/**
	 * Rewrite the path data at each selected anchor, last segment first, so an
	 * edit that puts a curve before a Z does not move the anchors still to
	 * come, and write it all as one step. The anchors stay selected.
	 */
	private editAnchors(edit: (d: string, segment: number, decimals: number) => string | null): {changed: number; tried: number; refused: number} | null {
		const sel = this.selectedPoints();
		const found = sel ? this.sourceFor(sel.el) : null;
		const data = found ? pathDataOf(found.source) : null;
		if (!sel || !found || !data) return null;
		const decimals = this.decimalsAt(sel.el);
		const anchors = chosenAnchors(sel.chosen).sort((a, b)=>b - a);
		let d = data.d;
		let changed = 0;
		let refused = 0;
		for (const segment of anchors) {
			const next = edit(d, segment, decimals);
			if (next === null) refused += 1;
			if (next === null || next === d) continue;
			d = next;
			changed += 1;
		}
		if (changed === 0) return {changed, tried: anchors.length, refused};
		if (!this.commitPathData(found, d, data.converted)) return null;
		this.selectPointsAt(found.tag.ordinal, sel.chosen.filter(c=>c.point.kind === 'anchor').map(c=>({x: c.point.x, y: c.point.y, kind: 'anchor', index: c.index})));
		return {changed, tried: anchors.length, refused};
	}

	/** Make the selected anchors smooth, or, when every one is, corners. */
	private toggleSmooth(): void {
		const sel = this.selectedPoints();
		const data = sel ? pathDataOf(sel.el) : null;
		if (!sel || !data) return;
		const kinds = chosenAnchors(sel.chosen).map(s=>anchorKind(data.d, s)).filter(k=>k !== null);
		const corner = kinds.length > 0 && kinds.every(k=>k === 'smooth');
		const done = this.editAnchors((d, segment, decimals)=>{
			const kind = anchorKind(d, segment);
			if (corner) return kind === 'smooth' ? cornerPathPoint(d, segment, decimals) : null;
			return kind === 'corner' ? smoothPathPoint(d, segment, decimals) : null;
		});
		if (!done) return;
		if (done.changed === 0) {
			const one = done.tried === 1;
			this.announceError(corner ? `${one ? 'This point has' : 'These points have'} no handles to take in.` : `${one ? 'This point' : 'These points'} cannot be made smooth.`);
			return;
		}
		const what = done.changed === 1 ? 'Point' : `${done.changed} points`;
		this.announceAction(corner ? `${what} made ${done.changed === 1 ? 'a corner' : 'corners'}` : `${what} made smooth`);
	}

	/** Make the selected anchors symmetric: smooth, their handles one length. */
	private makeSymmetric(): void {
		const done = this.editAnchors(symmetricPathPoint);
		if (!done) return;
		if (done.changed === 0) {
			this.announceError(done.tried !== 1 ? 'These points are symmetric already, or cannot be: each needs a curve or line on both sides, and no arc.'
				: done.refused > 0 ? 'This point cannot be made symmetric: it needs a curve or line on both sides, and no arc.' : 'This point is already symmetric.');
			return;
		}
		this.announceAction(done.changed === 1 ? 'Point made symmetric' : `${done.changed} points made symmetric`);
	}

	/** Make the picked segment a curve, or a curved one straight. */
	private toggleCurve(): void {
		const el = this.selectedElement();
		const found = el ? this.sourceFor(el) : null;
		const data = found ? pathDataOf(found.source) : null;
		const segment = data ? this.spotSegment(data) : null;
		if (!el || !found || !data || segment === null || !this.pointMode?.spot) return;
		const curved = segmentCurved(data.d, segment);
		const next = curved ? straightenPathSegment(data.d, segment, this.decimalsAt(el)) : curvePathSegment(data.d, segment, this.decimalsAt(el));
		if (next === null) {
			this.announceError(curved ? 'This segment cannot be made straight.' : 'This segment cannot be made a curve.');
			return;
		}
		if (!this.commitPathData(found, next, data.converted)) return;
		// the segment keeps its place, unless a closing curve went for its Z
		const kept = (parsePathData(next)?.length ?? 0) >= (parsePathData(data.d)?.length ?? 0);
		this.pointMode.spot = kept ? {edge: segment, t: this.pointMode.spot.t} : null;
		this.refreshSelection();
		this.announceAction(curved ? 'Segment made straight' : 'Segment made a curve: drag its handles to shape it');
	}

	/** The selected points of the element being edited, the last the one the
	 * code editor shows first. */
	private selectedPoints(): {el: Element; points: EditPoint[]; chosen: {index: number; point: EditPoint}[]} | null {
		const el = this.pointMode ? this.selectedElement() : null;
		const points = el ? pointsOf(el) : null;
		if (!el || !points || !this.pointMode) return null;
		const chosen = this.pointMode.selected.flatMap(index=>((point)=>point ? [{index, point}] : [])(points.at(index)));
		return {el, points, chosen};
	}

	/** Select the numbers of the selected points in the editor, a range for
	 * each, the last selected the main one. */
	private selectPointInEditor(): void {
		const sel = this.selectedPoints();
		const found = sel && sel.chosen.length > 0 ? this.sourceFor(sel.el) : null;
		if (!sel || !found) return;
		const attrs = attributesOf(found.sourceText, found.tag);
		// each attribute is read once, however many of its points are selected
		const parsed = new Map<string, ReturnType<typeof parsePathData>>();
		const parse = (text: string): ReturnType<typeof parsePathData>=>{
			if (!parsed.has(text)) parsed.set(text, parsePathData(text));
			return parsed.get(text) ?? null;
		};
		const spanOf = (ref: PointRef): [number, number] | null=>{
			const attr = attrs.find(a=>a.name === pointAttr(ref));
			if (!attr) return null;
			const value = attr.value;
			const at = found.tag.start + attr.valueStart;
			if (ref.type === 'path') {
				const seg = parse(value)?.at(ref.segment);
				// an S writes only its second handle, so that is its first pair
				const k = seg ? (ref.slot === 'cp1' ? 0 : ref.slot === 'cp2' ? (/^s$/i.test(seg.letter) ? 0 : 2) : seg.args.length - 2) : -1;
				const x = seg?.args.at(k);
				const y = seg?.args.at(k + 1);
				return x && y ? [at + x.start, at + y.end] : null;
			}
			if (ref.type === 'poly') {
				const tokens = parse(`M${value}`);
				const x = tokens?.at(ref.index)?.args.at(0);
				const y = tokens?.at(ref.index)?.args.at(1);
				return x && y ? [at + x.start - 1, at + y.end - 1] : null;
			}
			return [at, at + value.length];
		};
		const spans = sel.chosen.map(c=>spanOf(c.point.ref)).filter((s): s is [number, number]=>s !== null);
		if (spans.length === 0) return;
		const ranges = spans.map(([from, to])=>EditorSelection.range(from, to));
		this.editor.dispatch({selection: EditorSelection.create(ranges, ranges.length - 1), scrollIntoView: true});
	}

	/** Add a point to the element at a spot on its outline. */
	private addPointOn(el: Element, spot: Spot): void {
		const found = this.sourceFor(el);
		if (!found) return;
		const decimals = this.decimalsAt(el);
		const tag = el.tagName.toLowerCase();
		let attrs: Record<string, string | null> | null = null;
		let select: ((points: EditPoint[]) => number) | null = null;
		if (tag === 'path') {
			const next = insertPathPoint(found.source.getAttribute('d') ?? '', spot.edge, spot.t, decimals);
			if (next === null) {
				this.announceError('A point cannot be added on this part of the path.');
				return;
			}
			attrs = {d: next};
			select = points=>points.findIndex(p=>p.ref.type === 'path' && p.ref.segment === spot.edge && p.ref.slot === 'end');
		} else if (tag === 'polygon' || tag === 'polyline') {
			const value = found.source.getAttribute('points') ?? '';
			const pts = polygonPoints(value) ?? [];
			const a = pts.at(spot.edge);
			const b = pts.at((spot.edge + 1) % pts.length);
			const next = a && b ? insertPolygonPoint(value, spot.edge, {x: a.x + (b.x - a.x) * spot.t, y: a.y + (b.y - a.y) * spot.t}, decimals) : null;
			if (next === null) return;
			attrs = {points: next};
			select = ()=>spot.edge + 1;
		} else if (tag === 'line') {
			// a line has two points: a third makes it a path
			const data = pathDataOf(found.source);
			const next = data ? insertPathPoint(data.d, spot.edge + 1, spot.t, decimals) : null;
			if (next === null) {
				this.announceError('A point cannot be added to this line: its ends are written with units. Make it a path first.');
				return;
			}
			attrs = {d: next};
			select = points=>points.findIndex(p=>p.ref.type === 'path' && p.ref.segment === spot.edge + 1 && p.ref.slot === 'end');
		}
		if (!attrs || !select) return;
		const written = tag === 'line' && attrs.d ? this.commitPathData(found, attrs.d, true) : this.commitChanges(found.sourceText, [{tag: found.tag, attrs}], 'slick.point');
		if (!written) return;
		const made = this.elementForOrdinal(found.tag.ordinal);
		const points = made ? pointsOf(made) : null;
		if (this.pointMode && points) {
			const index = select(points);
			this.pointMode.selected = index < 0 ? [] : [index];
			this.pointMode.spot = null;
		}
		this.refreshSelection();
		this.selectPointInEditor();
		this.announceAction('Point added');
	}

	/** Move the selected points by whole units of the element, from the
	 * keyboard. One handle alone takes the one across its anchor along, as a
	 * drag of it does; several points move as one shape. */
	private nudgePoint(dx: number, dy: number): void {
		const sel = this.selectedPoints();
		const found = sel && sel.chosen.length > 0 && !this.gesture?.drags.length && this.gesture?.mode !== 'marquee' ? this.sourceFor(sel.el) : null;
		if (!sel || !found) return;
		const [only] = sel.chosen;
		const attrs = sel.chosen.length === 1
			? movePoint(only.point.ref, found.source, {x: only.point.x + dx, y: only.point.y + dy}, 0)
			: movePoints(sel.chosen.map(c=>c.point.ref), found.source, {x: dx, y: dy}, 0);
		if (!attrs) return;
		this.commitChanges(found.sourceText, [{tag: found.tag, attrs}], undefined, false);
		if (sel.chosen.length > 1) this.selectPointsAt(found.tag.ordinal, sel.chosen.map(c=>({x: c.point.x + dx, y: c.point.y + dy, kind: c.point.kind, index: c.index})));
		else this.selectPointInEditor();
	}

	/** Take the selected points out of the element. A handle goes back into
	 * its anchor; one handle alone has its anchor selected in its place. Each
	 * goes from the end of the path back, so the places of those still to go
	 * hold, and all of it is one step. */
	private deletePoint(): void {
		const sel = this.selectedPoints();
		const found = sel && sel.chosen.length > 0 ? this.sourceFor(sel.el) : null;
		if (!sel || !found) return;
		const refs = sel.chosen.map(c=>c.point.ref);
		const last = (a: number, b: number): number=>b - a;
		let attrs: Record<string, string | null> | null = null;
		if (refs.every(ref=>ref.type === 'path')) {
			let d: string | null = found.source.getAttribute('d') ?? '';
			const handles = refs.flatMap(ref=>ref.slot !== 'end' ? [{segment: ref.segment, slot: ref.slot}] : []).sort((a, b)=>last(a.segment, b.segment));
			const anchors = refs.flatMap(ref=>ref.slot === 'end' ? [ref.segment] : []).sort(last);
			for (const h of handles) {
				// a cubic straightened by taking in its other handle has none left here
				if (d !== null && /^[lhv]$/i.test(parsePathData(d)?.at(h.segment)?.letter ?? '')) continue;
				d = d === null ? null : retractPathHandle(d, h, 0);
			}
			for (const segment of anchors) d = d === null ? null : removePathPoint(d, segment, 0);
			attrs = d === null ? null : {d};
		} else if (refs.every(ref=>ref.type === 'poly')) {
			let points: string | null = found.source.getAttribute('points') ?? '';
			for (const index of refs.map(ref=>ref.index).sort(last)) points = points === null ? null : removePolygonPoint(points, index);
			attrs = points === null ? null : {points};
		}
		const [only] = sel.chosen;
		const handle = sel.chosen.length === 1 && only.point.kind === 'control';
		if (!attrs) {
			this.announceError(refs.some(ref=>ref.type === 'line') ? 'A line keeps both its ends.' : handle ? 'This handle could not be removed.' : sel.chosen.length === 1 ? 'This point could not be removed.' : 'These points could not be removed.');
			return;
		}
		if (this.pointMode) this.pointMode.selected = [];
		if (!this.commitChanges(found.sourceText, [{tag: found.tag, attrs}], 'slick.point')) return;
		const anchor = only.point.anchors.at(0);
		if (handle && anchor) this.selectAnchorAt(found.tag.ordinal, anchor);
		this.announceAction(handle ? 'Handle removed' : sel.chosen.length === 1 ? 'Point removed' : `${sel.chosen.length} points removed`);
	}

	/** The smallest upright box on the overlay holding all these corners. */
	private groupBoxOf(all: Point[]): Point[] | null {
		if (all.length === 0) return null;
		const {x: l, y: t, width, height} = boundsOf(all);
		const [r, b] = [l + width, t + height];
		return [{x: l, y: t}, {x: r, y: t}, {x: r, y: b}, {x: l, y: b}];
	}

	/** The box round two or more selected points: upright in the element's own
	 * units, and on the overlay set out a little from them along its sides, so
	 * its handles do not cover the points at its corners. */
	private pointBox(): {local: Rect; corners: Point[]} | null {
		const sel = this.selectedPoints();
		const ctm = sel?.el instanceof SVGGraphicsElement ? sel.el.getScreenCTM() : null;
		if (!sel || sel.chosen.length < 2 || !ctm) return null;
		const local = boundsOf(sel.chosen.map(c=>c.point));
		const origin = this.overlay.getBoundingClientRect();
		const on = (x: number, y: number): Point=>{
			const q = new DOMPoint(x, y).matrixTransform(ctm);
			return {x: q.x - origin.left, y: q.y - origin.top};
		};
		const [nw, ne, sw] = [on(local.x, local.y), on(local.x + local.width, local.y), on(local.x, local.y + local.height)];
		const unit = (p: Point): Point | null=>((l)=>l > 1e-9 ? {x: p.x / l, y: p.y / l} : null)(Math.hypot(p.x, p.y));
		const along = unit({x: ne.x - nw.x, y: ne.y - nw.y});
		const downward = unit({x: sw.x - nw.x, y: sw.y - nw.y});
		// a box with no width or height still has sides to set out along
		const across = along ?? (downward ? {x: downward.y, y: -downward.x} : {x: 1, y: 0});
		const down = downward ?? {x: -across.y, y: across.x};
		const pad = HANDLE_SIZE * 1.5;
		const at = (p: Point, a: number, d: number): Point=>({x: p.x + pad * (a * across.x + d * down.x), y: p.y + pad * (a * across.y + d * down.y)});
		const se = {x: ne.x + sw.x - nw.x, y: ne.y + sw.y - nw.y};
		return {local, corners: [at(nw, -1, -1), at(ne, 1, -1), at(se, 1, 1), at(sw, -1, 1)]};
	}

	/** Draw a box on these corners, or take it away. */
	private drawCorners(box: SVGPolygonElement, corners: Point[] | null): void {
		box.classList.toggle('hide', !corners);
		if (corners) box.setAttribute('points', corners.map(p=>`${p.x},${p.y}`).join(' '));
	}

	/** Put a box over an element, or take it away. */
	private drawBox(box: SVGPolygonElement, el: Element | null): Point[] | null {
		const corners = el ? boxCorners(el, this.overlay) : null;
		box.classList.toggle('hide', !corners);
		if (corners) box.setAttribute('points', corners.map(p=>`${p.x},${p.y}`).join(' '));
		return corners;
	}

	/** Eight resize handles on the box and a rotate handle above its top edge;
	 * side handles only when there is room for them, so none sit on a corner. */
	private placeHandles(corners: Point[] | null): void {
		this.handleCorners = corners;
		this.handles.classList.toggle('hide', !corners);
		if (!corners) return;
		const [nw, ne, se, sw] = corners;
		const mid = (p: Point, q: Point): Point=>({x: (p.x + q.x) / 2, y: (p.y + q.y) / 2});
		const centre = mid(nw, se);
		const width = Math.hypot(ne.x - nw.x, ne.y - nw.y);
		const height = Math.hypot(sw.x - nw.x, sw.y - nw.y);
		const sides = width > HANDLE_SIZE * 3 && height > HANDLE_SIZE * 3;
		const top = mid(nw, ne);
		const up = height > 0 ? {x: (top.x - centre.x) / (height / 2), y: (top.y - centre.y) / (height / 2)} : {x: 0, y: -1};
		const spin = {x: top.x + up.x * ROTATE_OFFSET, y: top.y + up.y * ROTATE_OFFSET};
		const at: Record<string, Point | null> = {
			nw, ne, se, sw, rotate: spin,
			n: sides ? top : null, e: sides ? mid(ne, se) : null, s: sides ? mid(se, sw) : null, w: sides ? mid(sw, nw) : null,
		};
		for (const [name, handle] of this.handleEls) {
			const p = at[name];
			handle.classList.toggle('hide', !p);
			if (!p) continue;
			if (name === 'rotate') {
				handle.setAttribute('cx', `${p.x}`);
				handle.setAttribute('cy', `${p.y}`);
			} else {
				handle.setAttribute('x', `${p.x - HANDLE_SIZE / 2}`);
				handle.setAttribute('y', `${p.y - HANDLE_SIZE / 2}`);
				handle.style.cursor = handleCursor(name, corners);
			}
		}
		this.rotateLink.setAttribute('x1', `${top.x}`);
		this.rotateLink.setAttribute('y1', `${top.y}`);
		this.rotateLink.setAttribute('x2', `${spin.x}`);
		this.rotateLink.setAttribute('y2', `${spin.y}`);
	}

	// --- Gestures: dragging the selection and its handles, and the keyboard
	/** The point of the element being edited nearest a press, if one is
	 * within reach of it. */
	private pointNear(clientX: number, clientY: number): number | null {
		const el = this.pointMode ? this.selectedElement() : null;
		const points = el ? pointsOf(el) : null;
		const ctm = el instanceof SVGGraphicsElement ? el.getScreenCTM() : null;
		if (!points || !ctm) return null;
		let best: number | null = null;
		let bestDistance = POINT_REACH;
		points.forEach((p, i)=>{
			const q = new DOMPoint(p.x, p.y).matrixTransform(ctm);
			const distance = Math.hypot(q.x - clientX, q.y - clientY);
			// the later of two at one spot is the one drawn on top
			if (distance <= bestDistance) {
				best = i;
				bestDistance = distance;
			}
		});
		return best;
	}

	/** A press within reach of a point, while points are being edited,
	 * selects it and takes hold of it, wherever on the preview it lands. One
	 * already among several selected keeps them, so a drag moves them all;
	 * while several are being picked, or with Ctrl or Cmd, one that was not
	 * selected joins them. */
	private pressPoint(e: Event, x: number, y: number): boolean {
		const current = this.selectedElement();
		const index = this.pointNear(x, y);
		if (!this.pointMode || !current || index === null) return false;
		e.preventDefault();
		e.stopPropagation();
		const adding = this.pointMode.several || (e instanceof MouseEvent && (e.ctrlKey || e.metaKey));
		const had = this.pointMode.selected.includes(index);
		if (!had) this.pointMode.selected = adding ? [...this.pointMode.selected, index] : [index];
		this.pointMode.spot = null;
		this.refreshSelection();
		this.selectPointInEditor();
		if (adding && !had) this.announceSelected();
		const g: Gesture = {mode: 'point', handle: null, fromHandle: true, toggle: adding, startX: x, startY: y, targets: [current], drags: [], point: index, tapped: {index, had}};
		this.gesture = g;
		if ('touches' in e && e.target instanceof Element && this.pointsGroup.contains(e.target)) this.touchedMarker = e.target;
		// an anchor gives out handles: at once with Alt, or to a finger held still
		const point = pointsOf(current)?.at(index);
		if (!point || point.kind !== 'anchor' || anchorSegment(point.ref) === null) return true;
		if ('touches' in e) {
			g.slop = HOLD_SLOP;
			this.holdTimer = setTimeout(()=>{
				this.holdTimer = undefined;
				if (this.gesture === g && g.drags.length === 0) this.startPull(g);
			}, HOLD_MS);
		} else if (e instanceof MouseEvent && e.altKey) {
			this.startPull(g);
		}
		return true;
	}

	/** While several points are being picked, a press anywhere but on a point
	 * starts a drag across the drawing that takes in the points it covers;
	 * one that does not travel is a tap. */
	private pressMarquee(x: number, y: number): boolean {
		const el = this.pointMode?.several ? this.selectedElement() : null;
		if (!el) return false;
		this.gesture = {mode: 'marquee', handle: null, fromHandle: false, toggle: false, startX: x, startY: y, targets: [el], drags: [], point: null};
		return true;
	}

	/** Draw the box a drag across the drawing covers, or take it away. */
	private placeMarquee(g: Gesture | null): void {
		const origin = this.overlay.getBoundingClientRect();
		this.marquee.classList.toggle('hide', !g?.to);
		if (!g?.to) return;
		this.marquee.setAttribute('x', `${Math.min(g.startX, g.to.x) - origin.left}`);
		this.marquee.setAttribute('y', `${Math.min(g.startY, g.to.y) - origin.top}`);
		this.marquee.setAttribute('width', `${Math.abs(g.to.x - g.startX)}`);
		this.marquee.setAttribute('height', `${Math.abs(g.to.y - g.startY)}`);
	}

	/** The anchors a drag across the drawing covered join the selection. Their
	 * handles come along with them anyway, and a handle of an anchor outside
	 * the box is left out, so a Delete does not take it in unasked. */
	private takeInMarquee(g: Gesture): void {
		const el = g.targets[0];
		const points = pointsOf(el);
		const ctm = el instanceof SVGGraphicsElement ? el.getScreenCTM() : null;
		if (!this.pointMode || !points || !ctm || !g.to) return;
		const [left, right] = [Math.min(g.startX, g.to.x), Math.max(g.startX, g.to.x)];
		const [top, bottom] = [Math.min(g.startY, g.to.y), Math.max(g.startY, g.to.y)];
		const inside = points.flatMap((p, i)=>{
			const q = new DOMPoint(p.x, p.y).matrixTransform(ctm);
			return p.kind === 'anchor' && q.x >= left && q.x <= right && q.y >= top && q.y <= bottom ? [i] : [];
		});
		this.pointMode.selected = [...new Set([...this.pointMode.selected, ...inside])];
		this.pointMode.spot = null;
		this.refreshSelection();
		this.selectPointInEditor();
		this.announceSelected();
	}

	/** A press on the outline of the element being edited, away from its
	 * points, holds that spot: a drag bends the segment there, and a tap
	 * picks it for the point tools. */
	private pressOutline(x: number, y: number): boolean {
		const el = this.pointMode ? this.selectedElement() : null;
		const spot = el ? this.outlineNear(el, x, y) : null;
		if (!el || !spot) return false;
		this.gesture = {mode: 'bend', handle: null, fromHandle: false, toggle: false, startX: x, startY: y, targets: [el], drags: [], point: null, spot};
		return true;
	}

	/** The press on an anchor pulls handles out of it from here on. */
	private startPull(g: Gesture): void {
		g.pull = true;
		g.slop = DRAG_THRESHOLD;
		if ('vibrate' in navigator) navigator.vibrate(10);
		this.refreshSelection();
		this.announceAction('Drag to pull handles out of the point');
	}

	private clearHold(): void {
		clearTimeout(this.holdTimer);
		this.holdTimer = undefined;
	}

	/** A press on a point, or a resize or rotate handle, starts that gesture
	 * on the selection. */
	private onHandlePress(e: Event, x: number, y: number): void {
		// a shape tool draws wherever it is pressed, on a handle too
		if (this.drawTool) {
			if (e instanceof MouseEvent && e.button !== 0) return;
			e.preventDefault();
			e.stopPropagation();
			if (e instanceof MouseEvent) this.drewOnPress = true;
			this.pressDraw(x, y, e instanceof MouseEvent && e.shiftKey);
			return;
		}
		const current = this.selectedElement();
		const handle = e.target instanceof Element ? e.target.closest('[data-handle]')?.getAttribute('data-handle') : null;
		// the box round several selected points takes a press on its handles before a point near one
		const points = handle !== null && handle !== undefined && this.pointMode !== null && this.pointMode.selected.length > 1;
		if (!points && this.pressPoint(e, x, y)) return;
		if (!handle || !current || (this.pointMode && !points)) return;
		e.preventDefault();
		e.stopPropagation();
		const rotate = handle === 'rotate';
		const group = points || this.selected.length > 1;
		this.gesture = {
			mode: rotate ? 'rotate' : 'resize', handle: rotate ? null : handle as Handle, fromHandle: true, toggle: false, startX: x, startY: y,
			targets: points ? [current] : this.selectedElements(), drags: [], point: null,
			box: group ? this.handleCorners ?? undefined : undefined, points: points || undefined,
		};
	}

	/** Keys on the canvas: arrows nudge the selection by a unit (ten with
	 * Shift), Enter edits its points, Delete removes it. Escape is handled
	 * for the whole page, outside the editor, in setupEventListeners. */
	private onCanvasKey(e: KeyboardEvent): void {
		// a shape under way takes Enter to finish it and Delete to take a point
		// back, and leaves the selection be
		if (this.sketch) {
			if (e.key === 'Enter') this.endSketch();
			else if (e.key === 'Delete' || e.key === 'Backspace') this.backSketch();
			else return;
			e.preventDefault();
			return;
		}
		const arrows: Record<string, [number, number] | undefined> = {ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1]};
		const arrow = arrows[e.key];
		if (arrow && this.selected.length > 0 && !e.ctrlKey && !e.metaKey && !e.altKey) {
			e.preventDefault();
			const step = e.shiftKey ? 10 : 1;
			if (this.pointMode) this.nudgePoint(arrow[0] * step, arrow[1] * step);
			else this.nudge(arrow[0] * step, arrow[1] * step);
		} else if (e.key === 'Enter' && !this.pointMode) {
			e.preventDefault();
			this.enterPointMode();
		} else if (e.key === 'Delete' || e.key === 'Backspace') {
			e.preventDefault();
			if (this.pointMode) this.deletePoint();
			else this.deleteSelected();
		}
	}

	/** The source behind a preview element, or null with a message when the
	 * code does not parse or the element cannot be found in it. */
	private sourceFor(el: Element, parsed = this.parseOnce()): Found | null {
		if (!parsed) return null;
		const ordinal = this.ordinalFor(el, parsed.sourceText);
		const tag = ordinal === null ? undefined : parsed.tags.at(ordinal);
		const source = ordinal === null ? undefined : parsed.elements.at(ordinal);
		if (!tag || !source || source.tagName.toLowerCase() !== el.tagName.toLowerCase()) {
			this.announceError('This element could not be found in the code, so it cannot be edited here.');
			return null;
		}
		return {sourceText: parsed.sourceText, tag, source};
	}

	/** The source parsed once, for every element an operation touches; null,
	 * with a message, when the code does not parse. */
	private parseOnce(): Parsed | null {
		const sourceText = this.editor.state.doc.toString();
		const parsed = parseSource(sourceText);
		if (!parsed) {
			this.announceError('The code has an error, so this element cannot be edited here. Fix the code first.');
			return null;
		}
		return {sourceText, elements: parsed.elements, tags: startTags(sourceText)};
	}

	/** A plan for each element, all made against one text of the source;
	 * null, with a message, when any element cannot be edited. */
	private plansFor(els: Element[], plan: (source: Element, bbox: Rect, el: Element) => EditPlan): {sourceText: string; plans: Planned[]} | null {
		const parsed = this.parseOnce();
		if (!parsed) return null;
		const sourceText = parsed.sourceText;
		const plans: Planned[] = [];
		for (const el of topLevelOf(els)) {
			const found = this.sourceFor(el, parsed);
			const bbox = bboxOf(el);
			if (!found || !bbox) return null;
			const made = plan(found.source, bbox, el);
			if (!made.ok) {
				this.announceError(made.reason);
				return null;
			}
			plans.push({tag: found.tag, attrs: made.attrs});
		}
		return {sourceText, plans};
	}

	/** Write the planned attribute changes to the source as one history step. */
	private commitChanges(sourceText: string, plans: Planned[], userEvent: string | undefined, isolate = true): boolean {
		if (this.editor.state.doc.toString() !== sourceText) {
			this.announceError('The code changed meanwhile, so the edit was not applied.');
			return false;
		}
		const changes = plans.flatMap(({tag, attrs})=>planAttributeEdits(sourceText, tag, Object.entries(attrs).map(([name, value])=>({name, value}))));
		return this.applyEdits(changes.sort((a, b)=>a.from - b.from), userEvent, isolate);
	}

	/** The drag begins: find each element in the source and measure its frame. */
	private beginDrag(g: Gesture): boolean {
		const drags: Drag[] = [];
		if (g.mode === 'bend') return this.beginBend(g);
		if (g.points) return this.beginPointTransform(g);
		// several elements turn about the middle of the box round them all,
		// and scale from its far side, in each one's parent's units
		const origin = this.overlay.getBoundingClientRect();
		const box = g.box ? ((b)=>({...b, x: b.x + origin.left, y: b.y + origin.top}))(boundsOf(g.box)) : null;
		const middle = box ? {x: box.x + box.width / 2, y: box.y + box.height / 2} : null;
		if (g.mode === 'point') {
			const target = g.targets[0];
			const found = this.sourceFor(target);
			const point = g.point === null ? undefined : pointsOf(target)?.at(g.point);
			const ctm = target instanceof SVGGraphicsElement ? target.getScreenCTM() : null;
			const toUnits = ctm ? invert(toMatrix(ctm)) : null;
			if (!found || !point || !ctm || !toUnits) return false;
			const scale = pixelsPerUnit(toMatrix(ctm));
			// a handle of a smooth point keeps the one across it in line, as the two lay when the drag began
			const ref = point.ref;
			const mode = ref.type === 'path' && ref.slot !== 'end' ? handleMode(found.source.getAttribute('d') ?? '', {segment: ref.segment, slot: ref.slot}) ?? 'independent' : 'independent';
			const data = g.pull ? pathDataOf(found.source) : null;
			const segment = anchorSegment(ref);
			const pull = data && segment !== null ? {...data, segment} : null;
			if (g.pull && !pull) return false;
			// a point among several selected takes them all along
			const sel = g.pull ? null : this.selectedPoints();
			const chosen = sel && sel.chosen.length > 1 && sel.chosen.some(c=>c.index === g.point) ? sel.chosen : null;
			const group = chosen ? {refs: chosen.map(c=>c.point.ref), froms: chosen.map(c=>({x: c.point.x, y: c.point.y, kind: c.point.kind, index: c.index})), by: {x: 0, y: 0}} : null;
			g.drags = [{
				target, found, live: pull?.converted && target instanceof SVGElement ? new LivePath(target) : new LiveEdit(target), attrs: {}, toUnits, decimals: decimalsFor(scale),
				bbox: {x: 0, y: 0, width: 0, height: 0}, minSize: 0, center: {x: 0, y: 0}, screenCenter: {x: 0, y: 0},
				point: {ref, from: {x: point.x, y: point.y}, mode, pull, group},
			}];
			this.drawBox(this.hoverBox, null);
			return true;
		}
		const parsed = this.parseOnce();
		if (!parsed) return false;
		for (const target of topLevelOf(g.targets)) {
			const found = this.sourceFor(target, parsed);
			const bbox = bboxOf(target);
			if (!found || !bbox) return false;
			// a blocked element is refused before anything moves on screen
			const probe: EditPlan = g.mode === 'move' ? planMove(found.source, 0, 0)
				: g.mode === 'resize' && g.handle ? planResize(found.source, {handle: g.handle, dx: 0, dy: 0, keepAspect: false, bbox, minSize: 0, decimals: 0})
				: planRotate(found.source, 0, {x: 0, y: 0});
			if (!probe.ok) {
				this.announceError(probe.reason);
				return false;
			}
			// screen pixels to the units the edit is made in: the parent's for a
			// move or a turn, or a scale of several, the element's own for a resize
			const frame = g.mode === 'resize' && !box ? target : target.parentElement;
			const ctm = frame instanceof SVGGraphicsElement ? frame.getScreenCTM() : null;
			const toUnits = ctm ? invert(toMatrix(ctm)) : null;
			if (!ctm || !toUnits) return false;
			const scale = pixelsPerUnit(toMatrix(ctm));
			const own = target instanceof SVGGraphicsElement ? target.getScreenCTM() : null;
			const onScreen = middle ?? (own ? new DOMPoint(bbox.x + bbox.width / 2, bbox.y + bbox.height / 2).matrixTransform(own) : null);
			drags.push({
				target, found, live: new LiveEdit(target), attrs: {}, toUnits, decimals: decimalsFor(scale), bbox,
				// two screen pixels: small enough to go unnoticed, large enough that
				// the handles never sit on top of each other and become ungrabbable
				minSize: 2 / scale,
				center: middle ? applyToPoint(toUnits, middle.x, middle.y) : parentCenter(found.source, bbox) ?? {x: 0, y: 0},
				screenCenter: onScreen ? {x: onScreen.x, y: onScreen.y} : {x: g.startX, y: g.startY},
				point: null,
				group: box ? {box, toScreen: toMatrix(ctm)} : undefined,
			});
		}
		if (drags.length === 0) return false;
		g.drags = drags;
		this.drawBox(this.hoverBox, null);
		// the cursor keeps the shape of the drag wherever the pointer strays:
		// a closed hand for a move, and a handle's own arrow for its resize
		const shapes: Record<GestureMode, string> = {move: 'grabbing', rotate: 'move', point: 'move', bend: 'grabbing', marquee: 'crosshair', draw: 'crosshair', resize: this.handleEls.get(g.handle ?? '')?.style.cursor ?? ''};
		this.svgPreview.style.cursor = shapes[g.mode];
		return true;
	}

	/** A turn or a scale of several selected points begins, about the box
	 * round them. */
	private beginPointTransform(g: Gesture): boolean {
		const target = g.targets[0];
		const found = this.sourceFor(target);
		const sel = this.selectedPoints();
		const box = this.pointBox();
		const ctm = target instanceof SVGGraphicsElement ? target.getScreenCTM() : null;
		const toUnits = ctm ? invert(toMatrix(ctm)) : null;
		if (!found || !sel || !box || !ctm || !toUnits) return false;
		const scale = pixelsPerUnit(toMatrix(ctm));
		const middle = new DOMPoint(box.local.x + box.local.width / 2, box.local.y + box.local.height / 2).matrixTransform(ctm);
		g.drags = [{
			target, found, live: new LiveEdit(target), attrs: {}, toUnits, decimals: decimalsFor(scale), bbox: box.local, minSize: 2 / scale,
			center: {x: 0, y: 0}, screenCenter: {x: middle.x, y: middle.y}, point: null,
			transform: {refs: sel.chosen.map(c=>c.point.ref), froms: sel.chosen.map(c=>({x: c.point.x, y: c.point.y, kind: c.point.kind, index: c.index})), toScreen: toMatrix(ctm), last: IDENTITY},
		}];
		this.drawBox(this.hoverBox, null);
		this.svgPreview.style.cursor = g.mode === 'rotate' ? 'move' : this.handleEls.get(g.handle ?? '')?.style.cursor ?? '';
		return true;
	}

	/** A bend begins: the segment under the spot, in the path it is or will be. */
	private beginBend(g: Gesture): boolean {
		const target = g.targets[0];
		const found = this.sourceFor(target);
		const data = found ? pathDataOf(found.source) : null;
		const ctm = target instanceof SVGGraphicsElement ? target.getScreenCTM() : null;
		const toUnits = ctm ? invert(toMatrix(ctm)) : null;
		if (!found || !data || !g.spot || !ctm || !toUnits) return false;
		const segment = data.converted ? g.spot.edge + 1 : g.spot.edge;
		const segments = parsePathData(data.d);
		const seg = segments?.at(segment);
		if (!segments || !seg || /^[ma]$/i.test(seg.letter)) {
			this.announceError('An arc keeps its shape: make it straight first, then curve it.');
			return false;
		}
		g.drags = [{
			target, found, live: data.converted && target instanceof SVGElement ? new LivePath(target) : new LiveEdit(target), attrs: {}, toUnits,
			decimals: decimalsFor(pixelsPerUnit(toMatrix(ctm))), bbox: {x: 0, y: 0, width: 0, height: 0}, minSize: 0,
			center: {x: 0, y: 0}, screenCenter: {x: 0, y: 0}, point: null,
			bend: {...data, segment, t: g.spot.t, from: pointOnSegment(seg, walkPath(segments)[segment], g.spot.t)},
		}];
		// a spot picked before is not the one bent, and a polygon's edges are
		// numbered apart from the path it shows as, so it is let go
		if (this.pointMode) this.pointMode.spot = null;
		this.drawBox(this.hoverBox, null);
		this.svgPreview.style.cursor = 'grabbing';
		return true;
	}

	/** The gesture follows the pointer. Shift snaps a turn and swaps how a
	 * handle resizes; Alt lets a curve handle go of the one across its anchor. */
	private gestureMove(x: number, y: number, shift: boolean, alt = false): void {
		const g = this.gesture;
		if (!g) return;
		const sx = x - g.startX;
		const sy = y - g.startY;
		if (g.mode === 'draw' && this.sketch) {
			this.sketchMove(g, this.sketch, x, y, shift);
			return;
		}
		if (g.mode === 'marquee' || g.mode === 'draw') {
			if (!g.to && Math.hypot(sx, sy) < DRAG_THRESHOLD) return;
			g.to = {x, y};
			if (g.mode === 'draw') this.drawDraft(g, shift, alt);
			else this.placeMarquee(g);
			return;
		}
		if (g.drags.length === 0) {
			if (Math.hypot(sx, sy) < (g.slop ?? DRAG_THRESHOLD)) return;
			this.clearHold();
			if (!this.beginDrag(g)) {
				this.gesture = null;
				this.tapTarget = null;
				return;
			}
		}
		for (const d of g.drags) {
			let plan: EditPlan;
			// a corner keeps the shape's proportions and a side stretches one axis; Shift does the opposite
			const keepAspect = g.handle !== null && g.handle.length === 2 ? !shift : shift;
			// whole degrees, which is finer than a hand on a mouse; fifteen with Shift
			const snap = shift ? 15 : 1;
			const turned = (): number=>{
				const degrees = ((Math.atan2(y - d.screenCenter.y, x - d.screenCenter.x) - Math.atan2(g.startY - d.screenCenter.y, g.startX - d.screenCenter.x)) * 180) / Math.PI;
				return Math.round(degrees / snap) * snap;
			};
			if (g.box && g.mode === 'rotate') g.turn = turned();
			if (d.transform) {
				// several points turn about the middle of their box as the screen shows it, or scale from its far side
				const m = g.mode === 'rotate'
					? multiply(d.toUnits, multiply(turnAbout(turned(), d.screenCenter), d.transform.toScreen))
					: scaleMatrix(axisMaps(d.bbox, {handle: g.handle ?? 'se', ...((v)=>({dx: v.x, dy: v.y}))(applyToVector(d.toUnits, sx, sy)), keepAspect, minSize: d.minSize}));
				d.transform.last = m;
				const attrs = transformPoints(d.transform.refs, d.found.source, m, d.decimals);
				plan = attrs ? {ok: true, attrs} : {ok: false, reason: 'These points could not be moved.'};
			} else if (d.group && g.mode === 'resize' && g.handle) {
				// the scale on screen, seen in the element's parent's units
				const onScreen = scaleMatrix(axisMaps(d.group.box, {handle: g.handle, dx: sx, dy: sy, keepAspect, minSize: 2}));
				plan = planScaleAbout(d.found.source, multiply(d.toUnits, multiply(onScreen, d.group.toScreen)), d.decimals, d.bbox);
			} else if (d.bend) {
				const v = applyToVector(d.toUnits, sx, sy);
				const bent = bendPathSegment(d.bend.d, d.bend.segment, d.bend.t, {x: d.bend.from.x + v.x, y: d.bend.from.y + v.y}, d.decimals);
				plan = bent === null ? {ok: false, reason: 'This segment could not be bent.'} : {ok: true, attrs: {d: bent}};
			} else if (d.point) {
				const v = applyToVector(d.toUnits, sx, sy);
				const to = {x: roundTo(d.point.from.x + v.x, d.decimals), y: roundTo(d.point.from.y + v.y, d.decimals)};
				const pull = d.point.pull;
				const pulled = pull ? pullHandles(pull.d, pull.segment, to, d.decimals) : null;
				if (d.point.group) d.point.group.by = {x: roundTo(v.x, d.decimals), y: roundTo(v.y, d.decimals)};
				const attrs = pull ? (pulled === null ? null : {d: pulled})
					: d.point.group ? movePoints(d.point.group.refs, d.found.source, v, d.decimals)
					: movePoint(d.point.ref, d.found.source, to, d.decimals, alt ? 'independent' : d.point.mode);
				plan = attrs ? {ok: true, attrs} : {ok: false, reason: 'This point could not be moved.'};
			} else if (g.mode === 'rotate') {
				// the turn from where the handle was pressed to where it is now, measured in the parent's frame
				const from = applyToVector(d.toUnits, g.startX - d.screenCenter.x, g.startY - d.screenCenter.y);
				const to = applyToVector(d.toUnits, x - d.screenCenter.x, y - d.screenCenter.y);
				const degrees = ((Math.atan2(to.y, to.x) - Math.atan2(from.y, from.x)) * 180) / Math.PI;
				plan = planRotate(d.found.source, Math.round(degrees / snap) * snap, d.center, d.decimals, d.bbox);
			} else {
				const v = applyToVector(d.toUnits, sx, sy);
				const dx = roundTo(v.x, d.decimals);
				const dy = roundTo(v.y, d.decimals);
				plan = g.mode === 'move' || !g.handle
					? planMove(d.found.source, dx, dy, d.bbox)
					: planResize(d.found.source, {handle: g.handle, dx, dy, keepAspect, bbox: d.bbox, minSize: d.minSize, decimals: d.decimals});
			}
			if (!plan.ok) {
				this.announceError(plan.reason);
				this.cancelGesture();
				return;
			}
			d.attrs = plan.attrs;
			d.live.show(plan.attrs);
		}
		this.refreshSelection();
		// the status bar reads out the edit as it will be written
		const first = g.drags[0];
		if (first.transform || (g.box && g.drags.length > 1)) {
			const m = first.transform?.last;
			const scaled = m ? `${Math.round(Math.hypot(m.a, m.b) * 100)}% × ${Math.round(Math.hypot(m.c, m.d) * 100)}%` : 'scaled';
			const what = first.transform ? `${first.transform.refs.length} points` : `${g.drags.length} elements`;
			this.readOut(`${what} ${g.mode === 'rotate' ? `turned ${g.turn ?? 0}°` : scaled}`);
			return;
		}
		if (first.point) {
			const v = applyToVector(first.toUnits, sx, sy);
			const count = first.point.group?.refs.length ?? 1;
			this.readOut(count > 1
				? `${count} points moved ${fmt(v.x, first.decimals)}, ${fmt(v.y, first.decimals)}`
				: `point ${fmt(first.point.from.x + v.x, first.decimals)}, ${fmt(first.point.from.y + v.y, first.decimals)}`);
			return;
		}
		// a path's whole d can be long, and the start of it says enough of how it is moving
		const readout = Object.entries(first.attrs).map(([name, value])=>value === null ? `no ${name}` : `${name}="${clipped(value)}"`).join(' ');
		this.readOut(g.drags.length > 1 ? `${g.drags.length} elements` : `${first.target.tagName.toLowerCase()} ${readout || 'unchanged'}`);
	}

	/** End the gesture: a drag is written to the code; a press that did not
	 * travel was a click, which selects. */
	private gestureEnd(): void {
		const g = this.gesture;
		this.gesture = null;
		this.clearHold();
		// a shape drawn a point at a time keeps its tool, and its crosshair, between points
		this.svgPreview.style.cursor = this.drawTool ? 'crosshair' : '';
		// the drag's readout is over; what it did is announced in its place
		if (this.heldUntil === Infinity) this.restoreHint(true);
		if (!g) return;
		if (g.pull && g.drags.length === 0) this.refreshSelection();
		if (g.mode === 'marquee') {
			this.placeMarquee(null);
			if (g.to) this.takeInMarquee(g);
			else this.clickSelect(this.tapTarget);
			return;
		}
		if (g.mode === 'draw') {
			if (this.sketch) this.releaseSketch(this.sketch);
			else this.finishDraw(g);
			return;
		}
		if (g.drags.length === 0) {
			if (!g.fromHandle) this.clickSelect(this.tapTarget, g.toggle);
			else if (g.tapped && !g.pull) this.tapPoint(g.tapped, g.toggle);
			return;
		}
		const moved = g.drags.filter(d=>Object.keys(d.attrs).length > 0);
		const sourceText = g.drags[0].found.sourceText;
		const first = g.drags[0];
		const pull = first.point?.pull ?? first.bend ?? null;
		// the preview re-renders from the new source, which replaces the live copies
		const written = moved.length > 0 && (pull && first.attrs.d
			? this.commitPathData(first.found, first.attrs.d, pull.converted)
			: this.commitChanges(sourceText, moved.map(d=>({tag: d.found.tag, attrs: d.attrs})), `slick.${g.mode}`));
		if (!written) {
			for (const d of g.drags) d.live.revert();
			this.refreshSelection();
			forceLinting(this.editor);
			return;
		}
		if (pull && first.point) {
			// handles came in before the anchor, so it is found again by where it is
			this.selectAnchorAt(first.found.tag.ordinal, first.point.from);
			this.announceAction('Handles pulled out');
			return;
		}
		const turned = first.transform;
		if (turned) {
			// the points are found again where the transform took them
			this.selectPointsAt(first.found.tag.ordinal, turned.froms.map(f=>({...f, ...applyToPoint(turned.last, f.x, f.y)})), 10 ** -first.decimals);
			this.announceAction(`${turned.refs.length} points ${g.mode === 'rotate' ? `turned ${g.turn ?? 0} degrees` : 'scaled'}`);
			return;
		}
		const group = first.point?.group;
		if (group) {
			// the points are found again where they went
			this.selectPointsAt(first.found.tag.ordinal, group.froms.map(f=>({...f, x: f.x + group.by.x, y: f.y + group.by.y})));
			this.announceAction(`${group.refs.length} points moved`);
			return;
		}
		if (first.bend && this.pointMode) {
			// the bent segment stays picked, for the tools that work on it
			this.pointMode.selected = [];
			this.pointMode.spot = {edge: first.bend.segment, t: first.bend.t};
			this.refreshSelection();
			this.announceAction('Segment bent');
			return;
		}
		if (g.mode === 'point') this.selectPointInEditor();
		const verb = g.mode === 'move' ? 'moved' : g.mode === 'resize' ? 'resized' : g.mode === 'rotate' ? 'rotated' : 'point moved';
		this.announceAction(moved.length > 1 ? `${moved.length} elements ${verb}` : `${moved[0].target.tagName.toLowerCase()} ${verb}`);
	}

	/** A tap on a point that was selected already: while several are being
	 * picked it takes the point out, and otherwise it leaves that one alone
	 * selected. */
	private tapPoint(tapped: {index: number; had: boolean}, adding: boolean): void {
		if (!this.pointMode || !tapped.had) return;
		const rest = this.pointMode.selected.filter(i=>i !== tapped.index);
		this.pointMode.selected = adding ? rest : [tapped.index];
		this.refreshSelection();
		this.selectPointInEditor();
		if (adding) this.announceSelected();
	}

	private cancelGesture(): void {
		const g = this.gesture;
		this.gesture = null;
		this.clearHold();
		this.placeMarquee(null);
		this.svgPreview.style.cursor = this.drawTool ? 'crosshair' : '';
		if (this.heldUntil === Infinity) this.restoreHint(true);
		if (g?.draft) {
			g.draft.el.remove();
			forceLinting(this.editor);
		}
		// a press on a shape under way is taken back, and the shape stays
		if (g?.mode === 'draw' && this.sketch) {
			this.sketch.press = null;
			this.showSketch();
		}
		if (!g || g.drags.length === 0) return;
		for (const d of g.drags) d.live.revert();
		this.tapTarget = null;
		this.refreshSelection();
		// the lint status takes the status bar back
		forceLinting(this.editor);
	}

	/** Move the selection by whole units of its parent, from the keyboard.
	 * Rapid presses join into one history step, as typing does: the history
	 * only joins unlabelled or typing events, so these carry no label. */
	private nudge(dx: number, dy: number): void {
		const els = this.selectedElements();
		if (els.length === 0 || this.gesture?.drags.length) return;
		const made = this.plansFor(els, (source, bbox)=>planMove(source, dx, dy, bbox));
		if (made) this.commitChanges(made.sourceText, made.plans, undefined, false);
	}

	/** Turn the selection clockwise by `degrees`, as the screen shows it,
	 * about the middle of the box round it: several selected points about
	 * theirs, and several elements about the one round them all, so they
	 * turn as one. */
	private turnSelection(degrees: number): void {
		const turn = (middle: Point): Matrix=>turnAbout(degrees, middle);
		if (this.transformSelectedPoints(turn, `turned ${degrees} degrees`)) return;
		const els = this.selectedElements();
		// the turn as it runs in each one's parent, which a flip there runs the
		// other way round; a parent stretched or slanted against the screen sees
		// it as no turn at all, so it goes in front as the matrix it is there
		const made = this.plansAbout(els, turn, (source, m, center, bbox)=>isTurn(m)
			? planRotate(source, (Math.atan2(m.b, m.a) * 180) / Math.PI, center, 2, bbox)
			: planMatrix(source, m, 2, bbox));
		if (made && this.commitChanges(made.sourceText, made.plans, 'slick.rotate')) {
			this.announceAction(els.length > 1 ? `${els.length} elements rotated ${degrees} degrees` : `${els[0].tagName.toLowerCase()} rotated ${degrees} degrees`);
		}
	}

	/** Mirror the selection across the upright (axis "x") or level (axis
	 * "y") line, as the screen shows it, through the middle of the box round
	 * it, as a turn goes about it. */
	private flipSelection(axis: 'x' | 'y'): void {
		const way = axis === 'x' ? 'horizontally' : 'vertically';
		const mirror = (middle: Point): Matrix=>mirrorAbout(axis, middle);
		if (this.transformSelectedPoints(mirror, `flipped ${way}`)) return;
		const els = this.selectedElements();
		const made = this.plansAbout(els, mirror, (source, m, _center, bbox)=>planMatrix(source, m, 2, bbox));
		if (made && this.commitChanges(made.sourceText, made.plans, 'slick.flip')) {
			this.announceAction(els.length > 1 ? `${els.length} elements flipped ${way}` : `${els[0].tagName.toLowerCase()} flipped ${way}`);
		}
	}

	/**
	 * A plan for each element from one transform on screen about the middle
	 * of the box round them all. `plan` is given it as it runs in that
	 * element's parent's units, about the point it holds there: for one
	 * element its own centre, which its box gives exactly.
	 */
	private plansAbout(els: Element[], onScreen: (middle: Point) => Matrix, plan: (source: Element, m: Matrix, center: Point, bbox: Rect) => EditPlan): {sourceText: string; plans: Planned[]} | null {
		const corners = els.flatMap(el=>boxCorners(el, this.overlay) ?? []);
		if (corners.length === 0) {
			this.announceError('The selection has no box to turn or flip it about.');
			return null;
		}
		const origin = this.overlay.getBoundingClientRect();
		const box = boundsOf(corners);
		const middle = {x: origin.left + box.x + box.width / 2, y: origin.top + box.y + box.height / 2};
		const one = topLevelOf(els).length === 1;
		return this.plansFor(els, (source, bbox, el)=>{
			const ctm = el.parentElement instanceof SVGGraphicsElement ? el.parentElement.getScreenCTM() : null;
			const toUnits = ctm ? invert(toMatrix(ctm)) : null;
			const center = one ? parentCenter(source, bbox) : toUnits && applyToPoint(toUnits, middle.x, middle.y);
			if (!center || (!one && !toUnits)) return {ok: false, reason: 'This element\'s transform could not be read, so it cannot be turned or flipped here.'};
			// a parent with no place on screen is taken as upright, as it was before there was a screen to go by
			const m = ctm && toUnits ? multiply(toUnits, multiply(onScreen(middle), toMatrix(ctm))) : onScreen(center);
			return plan(source, holding(m, center), center, bbox);
		});
	}

	/** Put two or more selected points through a transform on screen about
	 * the middle of the box round them, as one step, and keep them selected.
	 * False when there are not several to transform. */
	private transformSelectedPoints(onScreen: (middle: Point) => Matrix, done: string): boolean {
		const sel = this.selectedPoints();
		if (!sel || sel.chosen.length < 2) return false;
		const box = this.pointBox();
		const ctm = sel.el instanceof SVGGraphicsElement ? sel.el.getScreenCTM() : null;
		const toUnits = ctm ? invert(toMatrix(ctm)) : null;
		// the picked points, not the whole shape, are what was asked for
		if (!box || !ctm || !toUnits) {
			this.announceError('These points could not be moved.');
			return true;
		}
		const found = this.sourceFor(sel.el);
		if (!found) return true;
		const center = {x: box.local.x + box.local.width / 2, y: box.local.y + box.local.height / 2};
		const toScreen = toMatrix(ctm);
		const m = holding(multiply(toUnits, multiply(onScreen(applyToPoint(toScreen, center.x, center.y)), toScreen)), center);
		// a quarter turn or a flip in upright units lands on the places of the
		// middle, which are then kept, so that four turns come back to the start
		const exact = [m.a, m.b, m.c, m.d].every(Number.isInteger);
		const decimals = Math.max(this.decimalsAt(sel.el), exact ? Math.max(placesOf(roundTo(center.x, 6)), placesOf(roundTo(center.y, 6))) : 0);
		const attrs = transformPoints(sel.chosen.map(c=>c.point.ref), found.source, m, decimals);
		if (!attrs) {
			this.announceError('These points could not be moved.');
			return true;
		}
		if (!this.commitChanges(found.sourceText, [{tag: found.tag, attrs}], 'slick.point')) return true;
		this.selectPointsAt(found.tag.ordinal, sel.chosen.map(c=>({...applyToPoint(m, c.point.x, c.point.y), kind: c.point.kind, index: c.index})), 10 ** -decimals);
		this.announceAction(`${sel.chosen.length} points ${done}`);
		return true;
	}

	/** Put a copy of the primary selection right after it in the code,
	 * shifted a little so both can be seen, with an id of its own, and select
	 * the copy. */
	private duplicateSelected(): void {
		const current = this.selectedElement();
		if (!current) return;
		const found = this.sourceFor(current);
		if (!found) return;
		const extent = elementExtent(found.sourceText, found.tag.ordinal);
		if (!extent) {
			this.announceError('This element\'s closing tag could not be found, so it was not duplicated.');
			return;
		}
		const original = found.sourceText.slice(extent.start, extent.end);
		const changes = [];
		const shift = planMove(found.source, 10, 10, bboxOf(current));
		if (shift.ok) changes.push(...Object.entries(shift.attrs).map(([name, value])=>({name, value})));
		const id = found.source.getAttribute('id');
		if (id !== null) {
			const doc = found.source.ownerDocument;
			let next = `${id}-copy`;
			for (let n = 2; doc.getElementById(next); n++) next = `${id}-copy${n}`;
			changes.push({name: 'id', value: next});
		}
		const copyTag = startTags(original).at(0);
		const copy = copyTag ? applyChanges(original, planAttributeEdits(original, copyTag, changes)) : original;
		const insertion = duplicateInsertion(found.sourceText, found.tag.ordinal, copy);
		if (!insertion) return;
		// the copy's ordinal follows the original and everything inside it
		const ordinal = found.tag.ordinal + startTags(original).length;
		const name = current.tagName.toLowerCase();
		this.skipSync = true;
		this.applyEdits([insertion], 'slick.duplicate');
		const made = this.elementForOrdinal(ordinal);
		if (made) this.selectElement(made);
		this.announceAction(`${name} duplicated`);
	}

	// --- Drawing
	/** Take up a shape tool, or put it down when it is in hand already, or
	 * with null. The next press on the drawing draws that shape, whatever it
	 * lands on: with a drag or a tap for a shape drawn at one go, and a point
	 * at a press for the others. Once drawn, the tool is put down and the new
	 * shape selected, for its handles to size and turn it. A drag under way
	 * is let go, and a shape under way, drawn a point at a time, is written
	 * as it stands when it has points enough. */
	private armShape(kind: ShapeKind | null): void {
		const next = kind === this.drawTool ? null : kind;
		if (this.gesture?.mode === 'draw') this.cancelGesture();
		const sketch = this.sketch;
		if (sketch) {
			// the points are kept, and the tool, until the code can take the shape
			if (sketch.anchors.length >= pointsNeeded(sketch.kind) && !this.sketchWritable()) return;
			this.dropSketch();
			if (sketch.anchors.length >= pointsNeeded(sketch.kind)) this.addShape(sketch.kind, this.sketchAttrs(sketch, false));
		}
		this.drawTool = next;
		if (this.drawTool) this.leavePointMode();
		for (const each of SHAPE_KINDS) this.get(`draw-${each}`).setAttribute('aria-pressed', each === this.drawTool ? 'true' : 'false');
		this.svgPreview.style.cursor = this.drawTool ? 'crosshair' : '';
		this.drawBox(this.hoverBox, null);
		if (this.drawTool) this.announceAction(toolHint(this.drawTool));
		// a tool put down takes its hint with it
		else this.restoreHint();
	}

	/** A press with a shape tool in hand starts drawing, unless the code does
	 * not parse. The canvas takes the keys, for those that finish a shape
	 * drawn a point at a time or take a point of it back. */
	private pressDraw(x: number, y: number, shift = false): void {
		this.isPanning = false;
		this.svgPreview.focus({preventScroll: true});
		if (!parseSource(this.editor.state.doc.toString())) {
			this.announceError('The code has an error, so a shape cannot be added here. Fix the code first.');
			return;
		}
		this.gesture = {mode: 'draw', handle: null, fromHandle: false, toggle: false, startX: x, startY: y, targets: [], drags: [], point: null};
		if (this.drawTool && byPoints(this.drawTool)) this.pressSketch(this.gesture, this.drawTool, shift);
	}

	/** The preview's stand-in for a shape being drawn from a press at (x, y),
	 * last in the drawing as the shape will be and painted as it will be,
	 * and the frame it is drawn in: the drawing's own units. */
	private startDraft(kind: ShapeKind, x: number, y: number): Draft | null {
		const root = this.svgPreview.querySelector('.svg-container svg');
		if (!(root instanceof SVGSVGElement)) return null;
		const el = document.createElementNS(SVG_NS, kind);
		root.appendChild(el);
		const draft: Draft = {kind, el, toUnits: IDENTITY, toScreen: IDENTITY, decimals: 0, from: {x, y}, size: 0, attrs: {}};
		if (!this.measureDraft(draft)) {
			el.remove();
			return null;
		}
		draft.from = applyToPoint(draft.toUnits, x, y);
		// the drawing's size, which a shape placed with a tap and the width of a stroke go by
		const box = root.getBoundingClientRect();
		draft.size = Math.min(box.width, box.height) * pixelsPerUnit(draft.toUnits);
		paintDraft(el, paintOf(kind, false, strokeWidthFor(draft.size)));
		return draft;
	}

	/** Read the frame a shape is drawn in afresh, for a zoom or a pan since the last look. */
	private measureDraft(draft: Draft): boolean {
		const ctm = draft.el.getScreenCTM();
		const toUnits = ctm ? invert(toMatrix(ctm)) : null;
		if (!ctm || !toUnits) return false;
		draft.toUnits = toUnits;
		draft.toScreen = toMatrix(ctm);
		draft.decimals = decimalsFor(pixelsPerUnit(draft.toScreen));
		return true;
	}

	/** Show the shape a drag draws, and read it out in the status bar. The
	 * press stays where it was in the drawing, however the view has moved
	 * since, and the pointer is read in the view as it is now. */
	private drawDraft(g: Gesture, constrain: boolean, fromCenter: boolean): void {
		if (!this.drawTool || !g.to) return;
		if (!g.draft) g.draft = this.startDraft(this.drawTool, g.startX, g.startY) ?? undefined;
		const draft = g.draft;
		const kind = draft?.kind;
		if (!draft || !kind || byPoints(kind)) return;
		this.measureDraft(draft);
		const to = applyToPoint(draft.toUnits, g.to.x, g.to.y);
		draft.attrs = drawnShape(kind, draft.from, to, {constrain, fromCenter, decimals: draft.decimals});
		for (const [name, value] of Object.entries(draft.attrs)) draft.el.setAttribute(name, value);
		this.readOut(`${kind} ${Object.entries(draft.attrs).map(([name, value])=>`${name}="${value}"`).join(' ')}`);
	}

	/** Write the shape a drag drew, or for a tap one a quarter the size of
	 * the drawing with its middle where the tap was. The tool is put down. */
	private finishDraw(g: Gesture): void {
		const kind = this.drawTool;
		const draft = g.draft ?? (kind && !g.to ? this.startDraft(kind, g.startX, g.startY) : null);
		draft?.el.remove();
		this.armShape(null);
		// a tool put down mid-drag has let the drag go already
		if (!kind || byPoints(kind)) return;
		if (!draft) {
			this.announceError('There is no <svg> element to draw in.');
			return;
		}
		const geometry = g.to ? draft.attrs : placedShape(kind, draft.from, draft.size / 4, draft.decimals);
		this.addShape(kind, {...geometry, ...paintOf(kind, false, strokeWidthFor(draft.size))});
	}

	/** Write a new shape as the drawing's last child, select it, and give the canvas the keys. */
	private addShape(kind: ShapeKind, attrs: Record<string, string>): void {
		const parsed = this.parseOnce();
		if (!parsed) return;
		const rootTag = this.rootTag(parsed.sourceText);
		const insertion = rootTag ? childInsertion(parsed.sourceText, rootTag.ordinal, shapeMarkup(kind, attrs, spacedClose(parsed.sourceText))) : null;
		if (!insertion) {
			this.announceError('The drawing\'s closing tag could not be found, so the shape was not added.');
			return;
		}
		// the new shape comes after every tag before where it goes
		const ordinal = parsed.tags.filter(tag=>tag.start < insertion.from).length;
		this.skipSync = true;
		this.applyEdits([insertion], 'slick.draw');
		const made = this.elementForOrdinal(ordinal);
		if (made) this.selectElement(made);
		this.svgPreview.focus({preventScroll: true});
		this.announceAction(`${kind} drawn`);
	}

	/** A press with a tool that draws a point at a time; the first starts the
	 * shape. On a polyline or polygon, the press places a point that follows
	 * the pointer until it lets go. On a path, it places an anchor, and a drag
	 * pulls handles out of it. A press on the first point closes the shape,
	 * and one on the last ends it, or with a drag bends a path's way out of
	 * it alone. */
	private pressSketch(g: Gesture, kind: PointKind, shift: boolean): void {
		if (!this.sketch) {
			const draft = this.startDraft(kind, g.startX, g.startY);
			if (!draft) {
				this.gesture = null;
				this.announceError('There is no <svg> element to draw in.');
				return;
			}
			this.sketch = {kind, draft, anchors: [], decimals: draft.decimals, press: null, hover: null};
			this.refreshSketchTools();
		}
		const s = this.sketch;
		this.measureDraft(s.draft);
		s.decimals = Math.max(s.decimals, s.draft.decimals);
		s.hover = null;
		s.press = this.aimAt(s, g.startX, g.startY, shift);
		this.showSketch();
	}

	/** Whether a point of the shape under way is within a press's reach of (x, y) on screen. */
	private reaches(s: Sketch, a: Anchor, x: number, y: number): boolean {
		const p = applyToPoint(s.draft.toScreen, a.x, a.y);
		return Math.hypot(p.x - x, p.y - y) <= POINT_REACH;
	}

	/** What a press at (x, y) does to the shape under way: closes it on its
	 * first point, once it has points enough to close round something; ends
	 * it on its last, or on its first before then, rather than put a point
	 * on top of one; or places a point there, which Shift keeps at a
	 * multiple of 45 degrees from the last. */
	private aimAt(s: Sketch, x: number, y: number, shift: boolean): Aim {
		const first = s.anchors.at(0);
		const last = s.anchors.at(-1);
		const onFirst = first !== undefined && this.reaches(s, first, x, y);
		if (first && onFirst && closable(s)) return {does: 'close', anchor: {...first}, dragged: false};
		if (last && (onFirst || this.reaches(s, last, x, y))) return {does: 'end', anchor: {...last}, dragged: false};
		const at = applyToPoint(s.draft.toUnits, x, y);
		const to = shift && last ? snapAngle(last, at) : at;
		return {does: 'add', anchor: {x: to.x, y: to.y, in: null, out: null}, dragged: false};
	}

	/** The pointer moves while pressed on a shape under way: a polyline's or
	 * polygon's new point follows it, and a path's handles are pulled toward
	 * it, at a multiple of 45 degrees with Shift. */
	private sketchMove(g: Gesture, s: Sketch, x: number, y: number, shift: boolean): void {
		const press = s.press;
		if (!press) return;
		this.measureDraft(s.draft);
		if (s.kind !== 'path') {
			s.press = this.aimAt(s, x, y, shift);
			this.showSketch();
			return;
		}
		if (!press.dragged && Math.hypot(x - g.startX, y - g.startY) < DRAG_THRESHOLD) return;
		const base = press.does === 'close' ? s.anchors.at(0) : press.does === 'end' ? s.anchors.at(-1) : press.anchor;
		if (!base) return;
		const raw = applyToPoint(s.draft.toUnits, x, y);
		const to = shift ? snapAngle(base, raw) : raw;
		press.dragged = true;
		// from the last anchor only the way out bends, which leaves a corner there
		press.anchor = press.does === 'end' ? {...base, out: to} : draggedAnchor(base, to);
		this.showSketch();
	}

	/** A press on a shape under way lets go: the point it placed joins the
	 * shape, or the shape is closed or ended and written. */
	private releaseSketch(s: Sketch): void {
		const press = s.press;
		s.press = null;
		const first = s.anchors.at(0);
		if (!press) return;
		if (press.does === 'add') {
			s.anchors.push(press.anchor);
		} else if (press.does === 'close' && first) {
			if (s.kind === 'path') s.anchors[0] = press.anchor;
			// a polyline stays open, so it comes back by a point of its own on the first
			if (s.kind === 'polyline') s.anchors.push({...first});
			this.endSketch(s.kind === 'path');
			if (this.sketch !== s) return;
			// not written, for the code does not parse: the shape stays as it was
			if (s.kind === 'polyline') s.anchors.pop();
		} else if (press.dragged) {
			s.anchors[s.anchors.length - 1] = press.anchor;
		} else if (s.anchors.length >= 2) {
			this.endSketch();
			if (this.sketch !== s) return;
		}
		this.refreshSketchTools();
		this.showSketch();
	}

	/** The attributes of the shape drawn a point at a time, to the finest
	 * precision a point of it was placed at. */
	private sketchAttrs(s: Sketch, closed: boolean): Record<string, string> {
		const geometry: Record<string, string> = s.kind === 'path' ? {d: penPathData(s.anchors, closed, s.decimals)} : {points: pointsList(s.anchors, s.decimals)};
		return {...geometry, ...paintOf(s.kind, closed, strokeWidthFor(s.draft.size))};
	}

	/** Write the shape drawn a point at a time, when it has points enough,
	 * and put the tool down. */
	private endSketch(closed = false): void {
		const s = this.sketch;
		if (!s || s.press) return;
		const need = pointsNeeded(s.kind);
		if (s.anchors.length < need) {
			this.announceError(`A ${s.kind} needs ${need === 3 ? 'three' : 'two'} points or more.`);
			return;
		}
		if (!this.sketchWritable()) return;
		this.dropSketch();
		this.armShape(null);
		this.addShape(s.kind, this.sketchAttrs(s, closed));
	}

	/** Whether the code parses, so the shape under way can be written into
	 * it; when it does not, the shape is kept, to be finished once it does. */
	private sketchWritable(): boolean {
		if (parseSource(this.editor.state.doc.toString())) return true;
		this.announceError('The code has an error, so the shape cannot be written yet. Fix the code first, then finish it.');
		return false;
	}

	/** Take back the last point of the shape under way; with none left, let it go. */
	private backSketch(): void {
		const s = this.sketch;
		if (!s || s.press) return;
		s.anchors.pop();
		if (s.anchors.length === 0) {
			this.dropSketch();
			this.announceAction('Shape let go');
			return;
		}
		s.hover = null;
		this.refreshSketchTools();
		this.showSketch();
		this.announceAction(`Point taken back, ${s.anchors.length} left`);
	}

	/** Let the shape under way go, without writing it. The tool stays in hand. */
	private dropSketch(): void {
		const s = this.sketch;
		if (!s) return;
		this.sketch = null;
		s.draft.el.remove();
		this.placeSketch();
		this.refreshSketchTools();
		forceLinting(this.editor);
	}

	/** Show the shape under way as it would be written, with what the press
	 * under way, or one where the pointer hovers, would do to it. */
	private showSketch(): void {
		const s = this.sketch;
		if (!s) return;
		const aim = s.press ?? s.hover;
		const first = s.anchors.at(0);
		let anchors = s.anchors;
		let closed = false;
		if (aim?.does === 'add') {
			anchors = [...anchors, aim.anchor];
		} else if (aim?.does === 'end' && aim.dragged) {
			anchors = [...anchors.slice(0, -1), aim.anchor];
		} else if (aim?.does === 'close' && first) {
			closed = s.kind !== 'polyline';
			anchors = s.kind === 'path' ? [aim.anchor, ...anchors.slice(1)] : s.kind === 'polyline' ? [...anchors, first] : anchors;
		}
		const [name, value] = s.kind === 'path' ? ['d', penPathData(anchors, closed, s.decimals)] : ['points', pointsList(anchors, s.decimals)];
		s.draft.el.setAttribute(name, value);
		paintDraft(s.draft.el, paintOf(s.kind, closed, strokeWidthFor(s.draft.size)));
		// a press reads out what it does; between presses, the hint says what to do next
		if (s.press) this.readOut(`${s.kind} ${name}="${clipped(value)}"`);
		else this.restoreHint();
		this.placeSketch();
	}

	/** Mark the points of the shape under way on the overlay: the first
	 * ringed once a press on it would close the shape, the one a press would
	 * close or end it on filled, the point a press is placing, and a path's
	 * handles on its last anchor and on the one a press is pulling. */
	private placeSketch(): void {
		this.sketchGroup.replaceChildren();
		const s = this.sketch;
		if (!s || !this.measureDraft(s.draft)) return;
		const origin = this.overlay.getBoundingClientRect();
		const toScreen = s.draft.toScreen;
		const onScreen = (p: Point): Point=>{
			const q = applyToPoint(toScreen, p.x, p.y);
			return {x: q.x - origin.left, y: q.y - origin.top};
		};
		const mark = (tag: 'rect' | 'circle' | 'line', attrs: Record<string, number>, classes: string[] = []): void=>{
			const node = document.createElementNS(SVG_NS, tag);
			for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, `${value}`);
			node.classList.add(...classes);
			this.sketchGroup.appendChild(node);
		};
		const aim = s.press ?? s.hover;
		const last = s.anchors.length - 1;
		const handled = [s.anchors.at(-1), aim?.dragged ? aim.anchor : undefined];
		for (const anchor of handled) {
			if (!anchor) continue;
			const at = onScreen(anchor);
			for (const handle of [anchor.in, anchor.out]) {
				if (!handle) continue;
				const h = onScreen(handle);
				mark('line', {x1: at.x, y1: at.y, x2: h.x, y2: h.y});
				mark('circle', {cx: h.x, cy: h.y, r: (HANDLE_SIZE - 1) / 2});
			}
		}
		const square = (p: Point, size: number, classes: string[]): void=>{
			const at = onScreen(p);
			mark('rect', {x: at.x - size / 2, y: at.y - size / 2, width: size, height: size}, classes);
		};
		const canClose = closable(s);
		s.anchors.forEach((anchor, i)=>{
			const first = i === 0 && canClose;
			const aimed = (aim?.does === 'close' && i === 0) || (aim?.does === 'end' && i === last);
			square(anchor, first ? HANDLE_SIZE + 3 : HANDLE_SIZE - 1, [...(first ? ['first'] : []), ...(aimed ? ['aimed'] : [])]);
		});
		if (s.press?.does === 'add') square(s.press.anchor, HANDLE_SIZE - 1, ['aimed']);
	}

	/** While a shape is drawn a point at a time, the drawing's tools are its
	 * own tool and the buttons that take a point back and finish it, in place
	 * of the other tools, so they are in reach on a narrow screen. */
	private refreshSketchTools(): void {
		const s = this.sketch;
		this.get('sketch-tools').classList.toggle('hide', !s);
		for (const kind of SHAPE_KINDS) this.get(`draw-${kind}`).classList.toggle('hide', s !== null && kind !== s.kind);
		this.get('draw-done').toggleAttribute('disabled', !s || s.anchors.length < pointsNeeded(s.kind));
		this.updateHistoryButtons();
		// the hint follows the tools: a shape under way, or points edited, coming or going
		this.restoreHint();
	}

	/** Remove the selection from the code, each element with the line it sat
	 * on when it had the line to itself. An element inside another that is
	 * also selected goes with it. */
	private deleteSelected(): void {
		const els = this.selectedElements();
		const tops = topLevelOf(els);
		if (tops.length === 0) return;
		const parsed = this.parseOnce();
		if (!parsed) return;
		const sourceText = parsed.sourceText;
		const changes: TextChange[] = [];
		for (const el of tops) {
			const found = this.sourceFor(el, parsed);
			if (!found) return;
			const range = removalRange(sourceText, found.tag.ordinal);
			if (!range) {
				this.announceError('This element\'s closing tag could not be found, so it was not removed.');
				return;
			}
			changes.push(range);
		}
		this.selected = [];
		this.skipSync = true;
		this.applyEdits(changes.sort((a, b)=>a.from - b.from), 'slick.delete');
		this.announceAction(tops.length > 1 ? `${tops.length} elements removed` : `${tops[0].tagName.toLowerCase()} removed`);
	}

	// --- Transforms
	private parseCurrentTransforms(transformValue: string): void {
		this.rotationDegrees = 0;
		const rotateMatch = /rotate\((\d+)[^)]*\)/.exec(transformValue);
		if (rotateMatch) {
			this.rotationDegrees = parseInt(rotateMatch[1]) % 360;
		}
		this.flipX = transformValue.includes('matrix(-1,0,0,1,0,0)');
		this.flipY = transformValue.includes('matrix(1,0,0,-1,0,0)');
	}

	private buildTransformAttribute(): string {
		const transforms = [];
		if (this.rotationDegrees > 0) {
			transforms.push(`rotate(${this.rotationDegrees})`);
		}
		if (this.flipX) {
			transforms.push('matrix(-1,0,0,1,0,0)');
		}
		if (this.flipY) {
			transforms.push('matrix(1,0,0,-1,0,0)');
		}
		return transforms.join(' ');
	}

	/** The start tag of the document's root <svg>, where whole-image edits land. */
	private rootTag(source: string): StartTag | null {
		return startTags(source).find(tag=>tag.name === 'svg') ?? null;
	}

	/** Splice changes into the source as one undo step of its own. */
	private applyEdits(changes: TextChange[], userEvent: string | undefined, isolate = true): boolean {
		if (changes.length === 0) return false;
		this.editor.dispatch({changes, annotations: isolate ? isolateHistory.of('full') : [], userEvent});
		return true;
	}

	/** Change the rotation or flip flags, then rewrite the root transform to match. */
	private transformRoot(change: () => void, message: string): void {
		const source = this.editor.state.doc.toString();
		const root = this.rootTag(source);
		if (!root) {
			this.announceError('No <svg> element to transform');
			return;
		}
		this.parseCurrentTransforms(readAttribute(source, root, 'transform') ?? '');
		change();
		const value = this.buildTransformAttribute();
		this.applyEdits(planAttributeEdits(source, root, [{name: 'transform', value: value || null}]), 'slick.transform');
		this.announceAction(message);
	}

	private rotateSVG(): void {
		if (this.selected.length > 0) {
			this.turnSelection(90);
			return;
		}
		this.transformRoot(()=>{this.rotationDegrees = (this.rotationDegrees + 90) % 360;}, 'SVG rotated 90 degrees');
	}
	private flipSVGX(): void {
		if (this.selected.length > 0) {
			this.flipSelection('x');
			return;
		}
		this.transformRoot(()=>{this.flipX = !this.flipX;}, 'SVG flipped horizontally');
	}
	private flipSVGY(): void {
		if (this.selected.length > 0) {
			this.flipSelection('y');
			return;
		}
		this.transformRoot(()=>{this.flipY = !this.flipY;}, 'SVG flipped vertically');
	}

	private undoEdit(focusEditor = true): void {
		if (undo(this.editor)) this.announceAction('Undid last change');
		if (focusEditor) this.editor.focus();
	}
	private redoEdit(focusEditor = true): void {
		if (redo(this.editor)) this.announceAction('Redid last change');
		if (focusEditor) this.editor.focus();
	}

	/** Mod+Z and Mod+Shift+Z (or Mod+Y) reach the editor's history from the
	 * preview and the toolbar, and Mod+D duplicates the selection; inside the
	 * editor and the dialog they are left to the editor and the browser. */
	private handleHistoryKeys = (e: KeyboardEvent): void=>{
		if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
		const target = e.target;
		if (target instanceof Element && (target.closest('.cm-editor, dialog') || target.matches('input, textarea, select'))) return;
		const key = e.key.toLowerCase();
		if (key === 'z' && !e.shiftKey) {
			e.preventDefault();
			// while a shape is drawn a point at a time, its last point is the last thing done
			if (this.sketch) this.backSketch();
			else this.undoEdit(false);
		} else if (key === 'y' || (key === 'z' && e.shiftKey)) {
			e.preventDefault();
			this.redoEdit(false);
		} else if (key === 'd' && !e.shiftKey && this.selected.length > 0) {
			e.preventDefault();
			this.duplicateSelected();
		}
	}

	private updateHistoryButtons(): void {
		// a shape under way has a point to take back, whatever the code's history
		this.get('undo').toggleAttribute('disabled', undoDepth(this.editor.state) === 0 && !this.sketch);
		this.get('redo').toggleAttribute('disabled', redoDepth(this.editor.state) === 0);
	}

	private showResolutionModal(): void {
		const svgCode = this.editor.state.doc.toString();
		const widthMatch = svgCode.match(/width="([^"]+)"/);
		const heightMatch = svgCode.match(/height="([^"]+)"/);
		let currentWidth = widthMatch ? parseInt(widthMatch[1]) : null;
		let currentHeight = heightMatch ? parseInt(heightMatch[1]) : null;
		if (currentWidth === null || currentHeight === null) {
			const viewBoxMatch = svgCode.match(/viewBox="([^"]+)"/);
			if (viewBoxMatch) {
				const viewBoxValues = viewBoxMatch[1].split(/\s+/);
				if (viewBoxValues.length >= 4) {
					if (currentWidth === null) currentWidth = parseInt(viewBoxValues[2]);
					if (currentHeight === null) currentHeight = parseInt(viewBoxValues[3]);
				}
			}
		}
		currentWidth = currentWidth || DEFAULT_SVG_SIZE;
		currentHeight = currentHeight || DEFAULT_SVG_SIZE;
		(this.get('width') as HTMLInputElement).value = currentWidth.toString();
		(this.get('height') as HTMLInputElement).value = currentHeight.toString();
		this.modalShow();
	}

	private resizeSVG(): void {
		const widthInput = this.get('width') as HTMLInputElement;
		const heightInput = this.get('height') as HTMLInputElement;
		const newWidth = parseInt(widthInput.value);
		const newHeight = parseInt(heightInput.value);
		if (!newWidth || newWidth <= 0 || !newHeight || newHeight <= 0) {
			alert('Please enter valid positive numbers for width and height');
			return;
		}
		const source = this.editor.state.doc.toString();
		const root = this.rootTag(source);
		if (root) {
			this.applyEdits(planAttributeEdits(source, root, [
				{name: 'width', value: `${newWidth}`},
				{name: 'height', value: `${newHeight}`},
				{name: 'viewBox', value: `0 0 ${newWidth} ${newHeight}`}
			]), 'slick.resize');
		} else {
			alert('Failed to resize SVG. Please check the SVG format.');
		}
		this.modalClose();
	}

	/** The source with every element's transform in its simplest form, each
	 * turning about the middle of the element as the preview draws it. The
	 * root's is the whole drawing's, which its own buttons write. */
	private simplestTransforms(source: string): string {
		const changes = startTags(source).flatMap(tag=>{
			const value = tag.name === 'svg' ? null : readAttribute(source, tag, 'transform');
			const list = value === null ? null : parseTransform(value);
			if (value === null || !list || list.length === 0) return [];
			const shown = this.elementForOrdinal(tag.ordinal);
			const text = simplestTransform(listMatrix(list), {box: shown ? bboxOf(shown) : null, was: list, decimals: 3, comma: commaIn(value)});
			return text === null || text === value.trim() ? [] : planAttributeEdits(source, tag, [{name: 'transform', value: text || null}]);
		});
		return applyChanges(source, changes);
	}

	private optimizeSVG(): void {
		try {
			const svgCode = this.simplestTransforms(this.editor.state.doc.toString());
			const optimized = svgCode
			// Remove XML processing instructions
			.replace(/<\?xml[^>]*\?>/g, '')
			// Remove DOCTYPE declarations
			.replace(/<!DOCTYPE[^>]*>/g, '')
			// Remove comments
			.replace(/<!--[\s\S]*?-->/g, '')
			// Remove extra whitespace between tags
			.replace(/>\s+</g, '><')
			// Remove whitespace around attribute values
			.replace(/\s*=\s*"/g, '="')
			// Remove unnecessary precision in numbers (limit to 3 decimal places)
			.replace(/(\d+\.\d{3})\d+/g, '$1')
			// Remove trailing zeros after decimal point
			.replace(/(\d+)\.0+\b/g, '$1')
			.replace(/(\d+\.\d*?)0+\b/g, '$1')
			// Remove redundant default attribute values
			.replace(/\s+fill="none"/g, '')
			.replace(/\s+stroke="none"/g, '')
			.replace(/\s+stroke-width="1"/g, '')
			.replace(/\s+opacity="1"/g, '')
			.replace(/\s+fill-opacity="1"/g, '')
			.replace(/\s+stroke-opacity="1"/g, '')
			// Remove empty attributes
			.replace(/\s+[a-zA-Z-]+=""/g, '')
			// Remove redundant transform attributes
			.replace(/\s+transform="matrix\(1,0,0,1,0,0\)"/g, '')
			.replace(/\s+transform="translate\(0,0\)"/g, '')
			.replace(/\s+transform="scale\(1\)"/g, '')
			.replace(/\s+transform="rotate\(0\)"/g, '')
			// Remove unnecessary namespace declarations if not used
			.replace(/\s+xmlns:[a-z]+="[^"]*"/g, (match)=>{
				const prefix = match.match(/xmlns:([a-z]+)=/)?.[1];
				if (prefix && !svgCode.includes(`${prefix}:`)) {
					return '';
				}
				return match;
			})
			// Remove metadata, desc, and title elements
			.replace(/<metadata[^>]*>[\s\S]*?<\/metadata>/g, '')
			.replace(/<desc[^>]*>[\s\S]*?<\/desc>/g, '')
			.replace(/<title[^>]*>[\s\S]*?<\/title>/g, '')
			// Remove empty groups
			.replace(/<g[^>]*>\s*<\/g>/g, '')
			// Consolidate whitespace
			.replace(/\s+/g, ' ')
			// Trim whitespace
			.trim();
			replaceEditorContent(this.editor, optimized, false);
		} catch (error) {
			console.error('SVG optimization failed:', error);
		}
	}

	private loadSVGContent(content: string): void {
		try {
			this.resetViewState();
			replaceEditorContent(this.editor, content, true);
		} catch (error) {
			console.error('Failed to load SVG content:', error);
			alert('Failed to load SVG content. Please check the file format.');
		}
	}

	private resetViewState(): void {
		this.zoomLevel = 1;
		this.panX = this.panY = this.lastPanX = this.lastPanY = this.rotationDegrees = 0;
		this.flipX = this.flipY = this.isPanning = false;
		this.pinch = null;
	}

	private handleFileUpload(file: File): void {
		if (!file.type.includes('svg') && !file.name.toLowerCase().endsWith('.svg')) {
			alert('Please select a valid SVG file.');
			return;
		}
		const reader = new FileReader();
		reader.onload = (e)=>{
			const content = e.target?.result as string;
			if (content) {
				if (content.includes('<svg') && content.includes('</svg>')) {
					this.loadSVGContent(content);
				} else {
					alert('The selected file does not contain valid SVG content.');
				}
			}
		};
		reader.onerror = ()=>{
			alert('Error reading the file. Please try again.');
		};
		reader.readAsText(file);
	}

	private triggerFileUpload(): void {
		const fileInput = document.createElement('input');
		fileInput.type = 'file';
		fileInput.accept = '.svg,image/svg+xml';
		fileInput.style.display = 'none';
		fileInput.addEventListener('change', (e)=>{
			const target = e.target as HTMLInputElement;
			const file = target.files?.[0];
			if (file) {
				this.handleFileUpload(file);
			}
		});
		document.body.appendChild(fileInput);
		fileInput.click();
		document.body.removeChild(fileInput);
	}

	private setupDragAndDrop(): void {
		let dragCounter = 0;
		document.addEventListener('dragenter', (e)=>{
			e.preventDefault();
			dragCounter++;
			document.body.classList.add('drag-over');
		});
		document.addEventListener('dragover', (e)=>{
			e.preventDefault();
		});
		document.addEventListener('dragleave', (e)=>{
			e.preventDefault();
			dragCounter--;
			if (dragCounter === 0) {
				document.body.classList.remove('drag-over');
			}
		});
		document.addEventListener('drop', (e)=>{
			e.preventDefault();
			dragCounter = 0;
			document.body.classList.remove('drag-over');
			const files = e.dataTransfer?.files;
			if (files && files.length > 0) {
				const file = files[0];
				this.handleFileUpload(file);
			}
		});
	}

	private setupResizeDragbar(): void {
		try {
			const dragbar = this.get('dragbar');
			const boundStartResize = this.startResize.bind(this);
			dragbar.addEventListener('mousedown', boundStartResize);
			dragbar.addEventListener('touchstart', boundStartResize, {passive: false});
		} catch (error) {
			console.error('Failed to setup dragbar:', error);
		}
	}

	private startResize = (e: MouseEvent | TouchEvent): void=>{
		e.preventDefault();
		this.isResizing = true;
		window.addEventListener('mousemove', this.doResize);
		window.addEventListener('mouseup', this.endResize);
		window.addEventListener('touchmove', this.doResize, {passive: false});
		window.addEventListener('touchend', this.endResize);
	};

	private doResize = (e: MouseEvent | TouchEvent): void=>{
		if (!this.isResizing) return;
		const vertical = document.body.classList.contains('vertical');
		const editor = this.get('editor');
		const preview = this.get('preview');
		const parent = editor.parentNode as HTMLElement;
		const parentRect = parent.getBoundingClientRect();
		const total = vertical ? parentRect.height : parentRect.width;
		let pagePos: number;
		if (e instanceof MouseEvent) {
			pagePos = vertical ? e.clientY : e.clientX;
		} else {
			pagePos = vertical ? e.touches[0].clientY : e.touches[0].clientX;
			e.preventDefault();
		}
		const offset = pagePos - (vertical ? parentRect.top : parentRect.left);
		const percent = Math.max(10, Math.min(90, (offset / total) * 100));
		if (vertical) {
			editor.style.height = `${percent - 1}%`;
			preview.style.height = `${100 - percent - 1}%`;
		} else {
			editor.style.width = `${percent}%`;
			preview.style.width = `${100 - percent}%`;
		}
		editor.classList.add('resizing');
		preview.classList.add('resizing');
	};

	private endResize = (): void=>{
		this.isResizing = false;
		window.removeEventListener('mousemove', this.doResize);
		window.removeEventListener('mouseup', this.endResize);
		window.removeEventListener('touchmove', this.doResize);
		window.removeEventListener('touchend', this.endResize);
	};

	private generateRandomFilename(): string {
		const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
		let randomStr = '';
		for (let i = 0; i < RANDOM_FILENAME_LENGTH; i++) {
			randomStr += chars.charAt(Math.floor(Math.random() * chars.length));
		}
		return `slicksvg-${randomStr}.svg`;
	}

	private downloadSVG(): void {
		try {
			const svgContent = this.editor.state.doc.toString();
			if (!svgContent.trim()) {
				alert('No SVG content to download. Please create some SVG content first.');
				return;
			}
			const filename = this.generateRandomFilename();
			const blob = new Blob([svgContent], {type: 'image/svg+xml'});
			const url = URL.createObjectURL(blob);
			const downloadLink = document.createElement('a');
			downloadLink.href = url;
			downloadLink.download = filename;
			downloadLink.style.display = 'none';
			document.body.appendChild(downloadLink);
			downloadLink.click();
			document.body.removeChild(downloadLink);
			URL.revokeObjectURL(url);
			this.announceAction(`SVG downloaded as ${filename}`);
		} catch (error) {
			console.error('Download failed:', error);
			alert('Failed to download SVG. Please try again.');
		}
	}
}

// --- Initialization
function initializeEditor(): void {
	const editor = new slick();
	window.announceError = editor.announceError.bind(editor);
	window.updateStatusBar = editor.updateStatusBar.bind(editor);
	window.svgEditor = editor;
}

if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', initializeEditor);
} else {
	initializeEditor();
}
