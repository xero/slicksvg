import {EditorView} from '@codemirror/view';
import {EditorState, Compartment} from '@codemirror/state';
import {keymap} from '@codemirror/view';
import {xml} from '@codemirror/lang-xml';
import {basicSetup} from 'codemirror';
import {tokyoNightDay} from '@fsegurai/codemirror-theme-tokyo-night-day';
import {tokyoNightStorm} from '@fsegurai/codemirror-theme-tokyo-night-storm';
import {linter, lintGutter, forceLinting} from '@codemirror/lint';
import {findElementAtCursor, type ElementRef} from './xray';
import {startTags, readAttribute, attributesOf, planAttributeEdits, applyChanges, stampSource, parseSource, elementExtent, removalRange, duplicateInsertion, SOURCE_ATTR, type StartTag, type TextChange} from './source-map';
import {findSvgTarget, selectionChain, nextInChain, ordinalOf, boxCorners} from './select';
import {planMove, planResize, planRotate, planFlip, parentCenter, invert, applyToVector, applyToPoint, pixelsPerUnit, decimalsFor, roundTo, fmt, placesOf, type Matrix, type Point, type Rect, type Handle, type EditPlan} from './geometry';
import {parsePathData, pathPoints, movePathPoint, insertPathPoint, removePathPoint, nearestPathSegment, polygonPoints, movePolygonPoint, insertPolygonPoint, removePolygonPoint, nearestPolygonEdge} from './path-data';
import {undo, redo, undoDepth, redoDepth, isolateHistory} from '@codemirror/commands';

// --- Constants
const DEFAULT_SVG_SIZE = 200;
const RANDOM_FILENAME_LENGTH = 6;
const ZOOM_MAX = 50;
const ZOOM_MIN = 0.1;
// how far a press may travel and still count as a click
const DRAG_THRESHOLD = 3;
// resize handles are this many screen pixels square; the rotate handle sits
// this far above the top edge
const HANDLE_SIZE = window.matchMedia('(pointer: coarse)').matches ? 14 : 8;
const ROTATE_OFFSET = 24;
const SVG_NS = 'http://www.w3.org/2000/svg';

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
type GestureMode = 'move' | 'resize' | 'rotate' | 'point';

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

/** Point editing on one element: which, and which of its points is selected. */
interface PointMode {
	ordinal: number;
	selected: number | null;
}

/** How far, in screen pixels, a double-click may be from the outline to add a point there. */
const ADD_POINT_REACH = 12;
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
	live: LiveEdit;
	attrs: Record<string, string | null>;
	/** Screen pixels to the units the edit is made in. */
	toUnits: Matrix;
	decimals: number;
	bbox: Rect;
	minSize: number;
	/** The element's centre in its parent's units, and on screen. */
	center: Point;
	screenCenter: Point;
	/** For a point drag: the point, where it started, and the attribute as it was. */
	point: {ref: PointRef; from: Point} | null;
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
}

/**
 * Attribute changes shown on the preview's own copy of an element while a
 * gesture is under way, and taken back if it is cancelled. Each call states
 * the whole change from the start of the gesture, so an attribute no longer
 * in it goes back to what it was.
 */
class LiveEdit {
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

/** The attribute a point lives in, and the attribute changes that move it. */
function movePoint(ref: PointRef, source: Element, to: Point, decimals: number): Record<string, string | null> | null {
	if (ref.type === 'path') {
		const d = movePathPoint(source.getAttribute('d') ?? '', ref, to, decimals);
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

function bboxOf(el: Element): Rect | null {
	if (!(el instanceof SVGGraphicsElement)) return null;
	try {
		const bb = el.getBBox();
		return {x: bb.x, y: bb.y, width: bb.width, height: bb.height};
	} catch {
		return null;
	}
}

/** The resize cursor pointing the way a handle actually faces on screen,
 * which for a rotated element is not the way its name says. */
function cursorFor(centre: Point, at: Point): string {
	const deg = ((Math.atan2(at.y - centre.y, at.x - centre.x) * 180) / Math.PI + 180) % 180;
	if (deg < 22.5 || deg >= 157.5) return 'ew-resize';
	if (deg < 67.5) return 'nwse-resize';
	if (deg < 112.5) return 'ns-resize';
	return 'nesw-resize';
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
	private isMultiTouch = false;
	private xray = false;
	private initialPinchDistance = 0;
	private initialZoomLevel = 1;
	private isResizing = false;
	// the selection in the preview, by source ordinal so it survives re-renders;
	// the last one is the primary, whose tag the editor's selection follows
	private selected: number[] = [];
	private moreBoxes: SVGPolygonElement[] = [];
	private pressToggle = false;
	private pointMode: PointMode | null = null;
	private pointsGroup!: SVGGElement;
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
		this.pointsGroup = document.createElementNS(SVG_NS, 'g');
		this.pointsGroup.classList.add('points');
		this.overlay.appendChild(this.pointsGroup);
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
	}

	public announceError(message: string): void {
		announce(message, 'error');
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
			['undo', ()=>this.undoEdit()],
			['redo', ()=>this.redoEdit()],
			['duplicate', ()=>this.duplicateSelected()],
			['points', ()=>this.togglePointMode()]
		]);
		document.addEventListener('keydown', this.handleHistoryKeys);
		this.updateHistoryButtons();
		this.svgPreview.addEventListener('mousedown', (e)=>this.onPress(e));
		this.overlay.addEventListener('mousedown', (e)=>this.onHandlePress(e, e.clientX, e.clientY));
		this.overlay.addEventListener('touchstart', (e)=>{
			const touch = e.touches.item(0);
			if (touch) this.onHandlePress(e, touch.clientX, touch.clientY);
		}, {passive: false});
		document.addEventListener('mousemove', (e)=>{
			if (this.gesture) this.gestureMove(e.clientX, e.clientY, e.shiftKey);
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
			if (this.gesture?.drags.length) {
				this.cancelGesture();
				return;
			}
			const target = e.target;
			if (target instanceof Element && target.closest('.cm-editor, dialog')) return;
			// point editing ends first; a second Escape clears the selection
			if (this.pointMode) this.leavePointMode();
			else this.clearSelection();
		});
		this.svgPreview.addEventListener('touchstart', (e)=>this.handleTouchStart(e), {passive: false});
		// a finger that pressed a handle in the overlay sends its moves to the handle,
		// not the wrapper, so the rest of a touch gesture is read from the page
		document.addEventListener('touchmove', (e)=>this.handleTouchMove(e), {passive: false});
		document.addEventListener('touchend', (e)=>this.handleTouchEnd(e), {passive: false});
		document.addEventListener('touchcancel', (e)=>this.handleTouchEnd(e));
		this.svgPreview.addEventListener('mousemove', (e)=>this.hoverAt(e));
		this.svgPreview.addEventListener('dblclick', (e)=>this.onDoubleClick(e));
		this.svgPreview.addEventListener('mouseleave', ()=>this.drawBox(this.hoverBox, null));
		this.svgPreview.addEventListener('keydown', (e)=>this.onCanvasKey(e));
		this.setupResizeDragbar();
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
			this.applySVGStyles();
		} catch (error) {
			const message = document.createElement('div');
			message.className = 'error';
			message.textContent = `Invalid SVG: ${String(error)}`;
			this.svgPreview.replaceChildren(message);
		}
	}

	private applySVGStyles(): void {
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
				svgContainer.style.transition = 'transform 0.1s ease-out';
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

	private zoomIn(): void {
		this.zoomLevel = Math.min(this.zoomLevel * 1.2, ZOOM_MAX);
		this.applySVGStyles();
		this.announceAction(`Zoomed in to ${Math.round(this.zoomLevel * 100)}%`);
	}
	private zoomOut(): void {
		this.zoomLevel = Math.max(this.zoomLevel / 1.2, ZOOM_MIN);
		this.applySVGStyles();
		this.announceAction(`Zoomed out to ${Math.round(this.zoomLevel * 100)}%`);
	}

	/** A press on the canvas: on the selection it starts a move, anywhere
	 * else a pan, and either way a press that does not travel is a click. */
	private onPress(e: MouseEvent): void {
		if (e.button !== 0) return;
		e.preventDefault();
		this.pressMoved = false;
		this.tapTarget = e.target;
		this.pressToggle = e.ctrlKey || e.metaKey;
		this.pressX = this.lastPanX = e.clientX;
		this.pressY = this.lastPanY = e.clientY;
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
		this.svgPreview.style.cursor = '';
		this.drawBox(this.hoverBox, null);
		const deltaX = e.clientX - this.lastPanX;
		const deltaY = e.clientY - this.lastPanY;
		this.panX += deltaX;
		this.panY += deltaY;
		this.lastPanX = e.clientX;
		this.lastPanY = e.clientY;
		this.applySVGStyles();
		e.preventDefault();
	}
	private endPan(): void {
		if (this.isPanning && !this.pressMoved) this.clickSelect(this.tapTarget, this.pressToggle);
		this.isPanning = false;
	}

	private handleTouchStart(e: TouchEvent): void {
		if (e.touches.length === 2) {
			// a second finger turns a drag into a pinch; the drag keeps its move
			if (this.gesture) this.gestureEnd();
			this.isMultiTouch = true;
			this.initialPinchDistance = this.calculatePinchDistance(e.touches[0], e.touches[1]);
			this.initialZoomLevel = this.zoomLevel;
			this.tapTarget = null;
			e.preventDefault();
		} else if (e.touches.length === 1) {
			this.isMultiTouch = false;
			this.tapTarget = e.target;
			this.pressToggle = false;
			this.pressX = this.lastPanX = e.touches[0].clientX;
			this.pressY = this.lastPanY = e.touches[0].clientY;
			const current = this.onSelection(e.target);
			if (current) {
				this.gesture = {mode: 'move', handle: null, fromHandle: false, toggle: false, startX: this.pressX, startY: this.pressY, targets: this.selectedElements(), drags: [], point: null};
				this.isPanning = false;
			} else {
				this.isPanning = true;
			}
			e.preventDefault();
		} else {
			this.isMultiTouch = false;
		}
	}
	private handleTouchMove(e: TouchEvent): void {
		if (this.gesture && e.touches.length === 1) {
			this.gestureMove(e.touches[0].clientX, e.touches[0].clientY, false);
			e.preventDefault();
			return;
		}
		if (this.isMultiTouch && e.touches.length === 2) {
			const currentDistance = this.calculatePinchDistance(e.touches[0], e.touches[1]);
			const scale = currentDistance / this.initialPinchDistance;
			const newZoomLevel = this.initialZoomLevel * scale;
			this.zoomLevel = Math.max(ZOOM_MIN, Math.min(newZoomLevel, ZOOM_MAX));
			this.applySVGStyles();
			e.preventDefault();
		} else if (!this.isMultiTouch && e.touches.length === 1 && this.isPanning) {
			const touch = e.touches[0];
			if (Math.hypot(touch.clientX - this.pressX, touch.clientY - this.pressY) >= DRAG_THRESHOLD) this.tapTarget = null;
			const deltaX = touch.clientX - this.lastPanX;
			const deltaY = touch.clientY - this.lastPanY;
			this.panX += deltaX;
			this.panY += deltaY;
			this.lastPanX = touch.clientX;
			this.lastPanY = touch.clientY;
			this.applySVGStyles();
			e.preventDefault();
		}
	}
	private handleTouchEnd(e: TouchEvent): void {
		if (e.touches.length === 0 && this.gesture) {
			this.gestureEnd();
			return;
		}
		if (e.touches.length < 2) {
			this.isMultiTouch = false;
		}
		if (e.touches.length === 0) {
			if (this.isPanning && this.tapTarget) this.clickSelect(this.tapTarget);
			this.isPanning = false;
		}
	}
	private calculatePinchDistance(touch1: Touch, touch2: Touch): number {
		const dx = touch1.clientX - touch2.clientX;
		const dy = touch1.clientY - touch2.clientY;
		return Math.sqrt(dx * dx + dy * dy);
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
		// while its points are being edited, a click on the element keeps it rather
		// than walking its group, so a double-click on the outline can add a point
		if (this.pointMode && !toggle && this.onSelection(target)) return;
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
		if (this.isPanning || this.gesture) return;
		const pick = this.pickAt(e.target);
		this.svgPreview.style.cursor = this.onSelection(e.target) ? 'move' : pick ? 'pointer' : '';
		this.drawBox(this.hoverBox, pick && !this.selectedElements().includes(pick) ? pick : null);
	}

	private refreshSelection(): void {
		const els = this.selectedElements();
		const primary = els.at(-1) ?? null;
		const corners = this.drawBox(this.selectBox, primary);
		// a box for each of the others; handles only when the selection is one element
		const others = els.slice(0, -1);
		while (this.moreBoxes.length < others.length) this.moreBoxes.push(this.makeBox('select-more'));
		this.moreBoxes.forEach((box, i)=>this.drawBox(box, others.at(i) ?? null));
		// point editing ends when its element is no longer the one selection
		if (this.pointMode && (els.length !== 1 || this.selected[0] !== this.pointMode.ordinal)) this.pointMode = null;
		const editing = this.pointMode && primary ? primary : null;
		this.placeHandles(els.length === 1 && !editing ? corners : null);
		this.placePoints(editing);
		this.get('duplicate').toggleAttribute('disabled', !primary);
		const pointsButton = this.get('points');
		pointsButton.toggleAttribute('disabled', !(els.length === 1 && primary && POINT_ELEMENTS.test(primary.tagName.toLowerCase())));
		pointsButton.setAttribute('aria-pressed', editing ? 'true' : 'false');
	}

	// --- Point editing
	/** Markers for every point of the element being edited: squares on the
	 * anchors, circles on the handles, with lines to the anchors they shape. */
	private placePoints(el: Element | null): void {
		this.pointsGroup.replaceChildren();
		const points = el ? pointsOf(el) : null;
		const ctm = el instanceof SVGGraphicsElement ? el.getScreenCTM() : null;
		if (!points || !ctm) return;
		const origin = this.overlay.getBoundingClientRect();
		const onScreen = (p: Point): Point=>{
			const q = new DOMPoint(p.x, p.y).matrixTransform(ctm);
			return {x: q.x - origin.left, y: q.y - origin.top};
		};
		const size = HANDLE_SIZE - 1;
		points.forEach((point, i)=>{
			const at = onScreen(point);
			for (const anchor of point.anchors) {
				const a = onScreen(anchor);
				const link = document.createElementNS(SVG_NS, 'line');
				link.setAttribute('x1', `${at.x}`);
				link.setAttribute('y1', `${at.y}`);
				link.setAttribute('x2', `${a.x}`);
				link.setAttribute('y2', `${a.y}`);
				this.pointsGroup.appendChild(link);
			}
			const marker = document.createElementNS(SVG_NS, point.kind === 'anchor' ? 'rect' : 'circle');
			if (point.kind === 'anchor') {
				marker.setAttribute('x', `${at.x - size / 2}`);
				marker.setAttribute('y', `${at.y - size / 2}`);
				marker.setAttribute('width', `${size}`);
				marker.setAttribute('height', `${size}`);
			} else {
				marker.setAttribute('cx', `${at.x}`);
				marker.setAttribute('cy', `${at.y}`);
				marker.setAttribute('r', `${size / 2}`);
			}
			marker.setAttribute('data-point', `${i}`);
			if (this.pointMode?.selected === i) marker.classList.add('selected');
			this.pointsGroup.appendChild(marker);
		});
	}

	/** Edit the points of the one selected path, polygon, polyline, or line. */
	private enterPointMode(): void {
		const current = this.selectedElement();
		const ordinal = this.selected.at(-1);
		if (!current || ordinal === undefined || this.selected.length !== 1 || !POINT_ELEMENTS.test(current.tagName.toLowerCase())) return;
		if (!pointsOf(current)) {
			this.announceError('This element\'s points could not be read, so they cannot be edited here.');
			return;
		}
		this.pointMode = {ordinal, selected: null};
		this.refreshSelection();
		this.svgPreview.focus({preventScroll: true});
		this.announceAction(`Editing the points of ${current.tagName.toLowerCase()}: drag a point, double-click the outline to add one, Delete removes one`);
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
		const current = this.onSelection(e.target);
		if (!current) return;
		e.preventDefault();
		if (!this.pointMode) {
			this.enterPointMode();
			return;
		}
		this.addPointAt(current, e.clientX, e.clientY);
	}

	/** The point of the element being edited that is selected, with its ref. */
	private selectedPoint(): {el: Element; points: EditPoint[]; index: number; point: EditPoint} | null {
		const el = this.selectedElement();
		const index = this.pointMode?.selected ?? null;
		const points = el ? pointsOf(el) : null;
		const point = index === null ? undefined : points?.at(index);
		if (!el || index === null || !points || !point) return null;
		return {el, points, index, point};
	}

	/** Select the numbers of the selected point in the editor. */
	private selectPointInEditor(): void {
		const chosen = this.selectedPoint();
		if (!chosen) return;
		const found = this.sourceFor(chosen.el);
		if (!found) return;
		const attr = attributesOf(found.sourceText, found.tag).find(a=>a.name === pointAttr(chosen.point.ref));
		if (!attr) return;
		const value = attr.value;
		const at = found.tag.start + attr.valueStart;
		const ref = chosen.point.ref;
		let span: [number, number] | null = null;
		if (ref.type === 'path') {
			const seg = parsePathData(value)?.at(ref.segment);
			// an S writes only its second handle, so that is its first pair
			const k = seg ? (ref.slot === 'cp1' ? 0 : ref.slot === 'cp2' ? (/^s$/i.test(seg.letter) ? 0 : 2) : seg.args.length - 2) : -1;
			const x = seg?.args.at(k);
			const y = seg?.args.at(k + 1);
			if (x && y) span = [at + x.start, at + y.end];
		} else if (ref.type === 'poly') {
			const tokens = parsePathData(`M${value}`);
			const x = tokens?.at(ref.index)?.args.at(0);
			const y = tokens?.at(ref.index)?.args.at(1);
			if (x && y) span = [at + x.start - 1, at + y.end - 1];
		} else {
			span = [at, at + value.length];
		}
		if (span) this.editor.dispatch({selection: {anchor: span[0], head: span[1]}, scrollIntoView: true});
	}

	/** Add a point to the element where its outline is nearest the pointer. */
	private addPointAt(el: Element, clientX: number, clientY: number): void {
		const found = this.sourceFor(el);
		const ctm = el instanceof SVGGraphicsElement ? el.getScreenCTM() : null;
		const toLocal = ctm ? invert(toMatrix(ctm)) : null;
		if (!found || !ctm || !toLocal) return;
		const local = applyToPoint(toLocal, clientX, clientY);
		const scale = pixelsPerUnit(toMatrix(ctm));
		const decimals = decimalsFor(scale);
		const tag = el.tagName.toLowerCase();
		let attrs: Record<string, string | null> | null = null;
		let select: ((points: EditPoint[]) => number) | null = null;
		if (tag === 'path') {
			const d = found.source.getAttribute('d') ?? '';
			const near = nearestPathSegment(d, local);
			if (!near || near.distance * scale > ADD_POINT_REACH) return;
			const next = insertPathPoint(d, near.segment, near.t, decimals);
			if (next === null) {
				this.announceError('A point cannot be added on this part of the path.');
				return;
			}
			attrs = {d: next};
			select = points=>points.findIndex(p=>p.ref.type === 'path' && p.ref.segment === near.segment && p.ref.slot === 'end');
		} else if (tag === 'polygon' || tag === 'polyline') {
			const value = found.source.getAttribute('points') ?? '';
			const near = nearestPolygonEdge(value, local, tag === 'polygon');
			if (!near || near.distance * scale > ADD_POINT_REACH) return;
			const pts = polygonPoints(value) ?? [];
			const a = pts[near.index];
			const b = pts[(near.index + 1) % pts.length];
			const p = {x: a.x + (b.x - a.x) * near.t, y: a.y + (b.y - a.y) * near.t};
			const next = insertPolygonPoint(value, near.index, p, decimals);
			if (next === null) return;
			attrs = {points: next};
			select = ()=>near.index + 1;
		}
		if (!attrs || !select) return;
		if (!this.commitChanges(found.sourceText, [{tag: found.tag, attrs}], 'slick.point')) return;
		const made = this.elementForOrdinal(found.tag.ordinal);
		const points = made ? pointsOf(made) : null;
		if (this.pointMode && points) this.pointMode.selected = select(points);
		this.refreshSelection();
		this.selectPointInEditor();
		this.announceAction('Point added');
	}

	/** Move the selected point by whole units of the element, from the keyboard. */
	private nudgePoint(dx: number, dy: number): void {
		const chosen = this.selectedPoint();
		if (!chosen || this.gesture?.drags.length) return;
		const found = this.sourceFor(chosen.el);
		if (!found) return;
		const attrs = movePoint(chosen.point.ref, found.source, {x: chosen.point.x + dx, y: chosen.point.y + dy}, 0);
		if (!attrs) return;
		this.commitChanges(found.sourceText, [{tag: found.tag, attrs}], undefined, false);
		this.selectPointInEditor();
	}

	/** Take the selected point out of the element. */
	private deletePoint(): void {
		const chosen = this.selectedPoint();
		if (!chosen) return;
		const found = this.sourceFor(chosen.el);
		if (!found) return;
		const ref = chosen.point.ref;
		let attrs: Record<string, string | null> | null = null;
		if (ref.type === 'path' && ref.slot === 'end') attrs = ((d)=>d === null ? null : {d})(removePathPoint(found.source.getAttribute('d') ?? '', ref.segment, 0));
		else if (ref.type === 'poly') attrs = ((p)=>p === null ? null : {points: p})(removePolygonPoint(found.source.getAttribute('points') ?? '', ref.index));
		if (!attrs) {
			this.announceError(ref.type === 'line' ? 'A line keeps both its ends.' : ref.type === 'path' && ref.slot !== 'end' ? 'A handle goes with its anchor.' : 'This point could not be removed.');
			return;
		}
		if (this.pointMode) this.pointMode.selected = null;
		if (this.commitChanges(found.sourceText, [{tag: found.tag, attrs}], 'slick.point')) this.announceAction('Point removed');
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
				handle.style.cursor = cursorFor(centre, p);
			}
		}
		this.rotateLink.setAttribute('x1', `${top.x}`);
		this.rotateLink.setAttribute('y1', `${top.y}`);
		this.rotateLink.setAttribute('x2', `${spin.x}`);
		this.rotateLink.setAttribute('y2', `${spin.y}`);
	}

	// --- Gestures: dragging the selection and its handles, and the keyboard
	/** A press on a resize or rotate handle starts that gesture on the selection. */
	private onHandlePress(e: Event, x: number, y: number): void {
		const current = this.selectedElement();
		const marker = e.target instanceof Element ? e.target.closest('[data-point]')?.getAttribute('data-point') : null;
		if (marker !== null && marker !== undefined && current && this.pointMode) {
			e.preventDefault();
			e.stopPropagation();
			this.pointMode.selected = Number(marker);
			this.refreshSelection();
			this.selectPointInEditor();
			this.gesture = {mode: 'point', handle: null, fromHandle: true, toggle: false, startX: x, startY: y, targets: [current], drags: [], point: Number(marker)};
			return;
		}
		const handle = e.target instanceof Element ? e.target.closest('[data-handle]')?.getAttribute('data-handle') : null;
		if (!handle || !current || this.selected.length !== 1) return;
		e.preventDefault();
		e.stopPropagation();
		const rotate = handle === 'rotate';
		this.gesture = {mode: rotate ? 'rotate' : 'resize', handle: rotate ? null : handle as Handle, fromHandle: true, toggle: false, startX: x, startY: y, targets: [current], drags: [], point: null};
	}

	/** Keys on the canvas: arrows nudge the selection by a unit (ten with
	 * Shift), Enter edits its points, Delete removes it. Escape is handled
	 * for the whole page, outside the editor, in setupEventListeners. */
	private onCanvasKey(e: KeyboardEvent): void {
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
	private plansFor(els: Element[], plan: (source: Element, bbox: Rect) => EditPlan): {sourceText: string; plans: Planned[]} | null {
		const parsed = this.parseOnce();
		if (!parsed) return null;
		const sourceText = parsed.sourceText;
		const plans: Planned[] = [];
		for (const el of topLevelOf(els)) {
			const found = this.sourceFor(el, parsed);
			const bbox = bboxOf(el);
			if (!found || !bbox) return null;
			const made = plan(found.source, bbox);
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
		if (g.mode === 'point') {
			const target = g.targets[0];
			const found = this.sourceFor(target);
			const point = g.point === null ? undefined : pointsOf(target)?.at(g.point);
			const ctm = target instanceof SVGGraphicsElement ? target.getScreenCTM() : null;
			const toUnits = ctm ? invert(toMatrix(ctm)) : null;
			if (!found || !point || !ctm || !toUnits) return false;
			const scale = pixelsPerUnit(toMatrix(ctm));
			g.drags = [{
				target, found, live: new LiveEdit(target), attrs: {}, toUnits, decimals: decimalsFor(scale),
				bbox: {x: 0, y: 0, width: 0, height: 0}, minSize: 0, center: {x: 0, y: 0}, screenCenter: {x: 0, y: 0},
				point: {ref: point.ref, from: {x: point.x, y: point.y}},
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
			// move or a turn, the element's own for a resize
			const frame = g.mode === 'resize' ? target : target.parentElement;
			const ctm = frame instanceof SVGGraphicsElement ? frame.getScreenCTM() : null;
			const toUnits = ctm ? invert(toMatrix(ctm)) : null;
			if (!ctm || !toUnits) return false;
			const scale = pixelsPerUnit(toMatrix(ctm));
			const own = target instanceof SVGGraphicsElement ? target.getScreenCTM() : null;
			const onScreen = own ? new DOMPoint(bbox.x + bbox.width / 2, bbox.y + bbox.height / 2).matrixTransform(own) : null;
			drags.push({
				target, found, live: new LiveEdit(target), attrs: {}, toUnits, decimals: decimalsFor(scale), bbox,
				// two screen pixels: small enough to go unnoticed, large enough that
				// the handles never sit on top of each other and become ungrabbable
				minSize: 2 / scale,
				center: parentCenter(found.source, bbox) ?? {x: 0, y: 0},
				screenCenter: onScreen ? {x: onScreen.x, y: onScreen.y} : {x: g.startX, y: g.startY},
				point: null,
			});
		}
		if (drags.length === 0) return false;
		g.drags = drags;
		this.drawBox(this.hoverBox, null);
		this.svgPreview.style.cursor = g.mode === 'move' ? 'move' : '';
		return true;
	}

	private gestureMove(x: number, y: number, shift: boolean): void {
		const g = this.gesture;
		if (!g) return;
		const sx = x - g.startX;
		const sy = y - g.startY;
		if (g.drags.length === 0) {
			if (Math.hypot(sx, sy) < DRAG_THRESHOLD) return;
			if (!this.beginDrag(g)) {
				this.gesture = null;
				this.tapTarget = null;
				return;
			}
		}
		for (const d of g.drags) {
			let plan: EditPlan;
			if (d.point) {
				const v = applyToVector(d.toUnits, sx, sy);
				const to = {x: roundTo(d.point.from.x + v.x, d.decimals), y: roundTo(d.point.from.y + v.y, d.decimals)};
				const attrs = movePoint(d.point.ref, d.found.source, to, d.decimals);
				plan = attrs ? {ok: true, attrs} : {ok: false, reason: 'This point could not be moved.'};
			} else if (g.mode === 'rotate') {
				// the turn from where the handle was pressed to where it is now, measured in the parent's frame
				const from = applyToVector(d.toUnits, g.startX - d.screenCenter.x, g.startY - d.screenCenter.y);
				const to = applyToVector(d.toUnits, x - d.screenCenter.x, y - d.screenCenter.y);
				const degrees = ((Math.atan2(to.y, to.x) - Math.atan2(from.y, from.x)) * 180) / Math.PI;
				// whole degrees, which is finer than a hand on a mouse; fifteen with Shift
				const snap = shift ? 15 : 1;
				plan = planRotate(d.found.source, Math.round(degrees / snap) * snap, d.center);
			} else {
				const v = applyToVector(d.toUnits, sx, sy);
				const dx = roundTo(v.x, d.decimals);
				const dy = roundTo(v.y, d.decimals);
				// a corner keeps the shape's proportions and a side stretches one axis; Shift does the opposite
				const keepAspect = g.handle !== null && g.handle.length === 2 ? !shift : shift;
				plan = g.mode === 'move' || !g.handle
					? planMove(d.found.source, dx, dy)
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
		if (first.point) {
			const v = applyToVector(first.toUnits, sx, sy);
			this.updateStatusBar(`point ${fmt(first.point.from.x + v.x, first.decimals)}, ${fmt(first.point.from.y + v.y, first.decimals)}`, false);
			return;
		}
		const readout = Object.entries(first.attrs).map(([name, value])=>value === null ? `no ${name}` : `${name}="${value}"`).join(' ');
		this.updateStatusBar(g.drags.length > 1 ? `${g.drags.length} elements` : `${first.target.tagName.toLowerCase()} ${readout || 'unchanged'}`, false);
	}

	/** End the gesture: a drag is written to the code; a press that did not
	 * travel was a click, which selects. */
	private gestureEnd(): void {
		const g = this.gesture;
		this.gesture = null;
		this.svgPreview.style.cursor = '';
		if (!g) return;
		if (g.drags.length === 0) {
			if (!g.fromHandle) this.clickSelect(this.tapTarget, g.toggle);
			return;
		}
		const moved = g.drags.filter(d=>Object.keys(d.attrs).length > 0);
		const sourceText = g.drags[0].found.sourceText;
		// the preview re-renders from the new source, which replaces the live copies
		if (moved.length === 0 || !this.commitChanges(sourceText, moved.map(d=>({tag: d.found.tag, attrs: d.attrs})), `slick.${g.mode}`)) {
			for (const d of g.drags) d.live.revert();
			this.refreshSelection();
			forceLinting(this.editor);
			return;
		}
		if (g.mode === 'point') this.selectPointInEditor();
		const verb = g.mode === 'move' ? 'moved' : g.mode === 'resize' ? 'resized' : g.mode === 'rotate' ? 'rotated' : 'point moved';
		this.announceAction(moved.length > 1 ? `${moved.length} elements ${verb}` : `${moved[0].target.tagName.toLowerCase()} ${verb}`);
	}

	private cancelGesture(): void {
		const g = this.gesture;
		this.gesture = null;
		this.svgPreview.style.cursor = '';
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
		const made = this.plansFor(els, source=>planMove(source, dx, dy));
		if (made) this.commitChanges(made.sourceText, made.plans, undefined, false);
	}

	/** Turn each selected element by `degrees` about its own centre. */
	private turnSelection(degrees: number): void {
		const els = this.selectedElements();
		const made = this.plansFor(els, (source, bbox)=>{
			const center = parentCenter(source, bbox);
			return center ? planRotate(source, degrees, center) : {ok: false, reason: 'This element\'s transform could not be read, so it cannot be rotated here.'};
		});
		if (made && this.commitChanges(made.sourceText, made.plans, 'slick.rotate')) {
			this.announceAction(els.length > 1 ? `${els.length} elements rotated ${degrees} degrees` : `${els[0].tagName.toLowerCase()} rotated ${degrees} degrees`);
		}
	}

	/** Mirror each selected element across the line through its own centre. */
	private flipSelection(axis: 'x' | 'y'): void {
		const els = this.selectedElements();
		const made = this.plansFor(els, (source, bbox)=>{
			const center = parentCenter(source, bbox);
			return center ? planFlip(source, axis, center) : {ok: false, reason: 'This element\'s transform could not be read, so it cannot be flipped here.'};
		});
		if (made && this.commitChanges(made.sourceText, made.plans, 'slick.flip')) {
			const way = axis === 'x' ? 'horizontally' : 'vertically';
			this.announceAction(els.length > 1 ? `${els.length} elements flipped ${way}` : `${els[0].tagName.toLowerCase()} flipped ${way}`);
		}
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
		const shift = planMove(found.source, 10, 10);
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
			this.undoEdit(false);
		} else if (key === 'y' || (key === 'z' && e.shiftKey)) {
			e.preventDefault();
			this.redoEdit(false);
		} else if (key === 'd' && !e.shiftKey && this.selected.length > 0) {
			e.preventDefault();
			this.duplicateSelected();
		}
	}

	private updateHistoryButtons(): void {
		this.get('undo').toggleAttribute('disabled', undoDepth(this.editor.state) === 0);
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

	private optimizeSVG(): void {
		const svgCode = this.editor.state.doc.toString();
		try {
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
		this.zoomLevel = this.initialZoomLevel = 1;
		this.panX = this.panY = this.lastPanX = this.lastPanY = this.rotationDegrees = this.initialPinchDistance = 0;
		this.flipX = this.flipY = this.isPanning = this.isMultiTouch = false;
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
