import {EditorView} from '@codemirror/view';
import {EditorState, Compartment} from '@codemirror/state';
import {keymap} from '@codemirror/view';
import {xml} from '@codemirror/lang-xml';
import {basicSetup} from 'codemirror';
import {tokyoNightDay} from '@fsegurai/codemirror-theme-tokyo-night-day';
import {tokyoNightStorm} from '@fsegurai/codemirror-theme-tokyo-night-storm';
import {linter, lintGutter} from '@codemirror/lint';
import {findElementAtCursor, type ElementRef} from './xray';
import {startTags, readAttribute, planAttributeEdits, stampSource, SOURCE_ATTR, type StartTag, type TextChange} from './source-map';
import {findSvgTarget, selectionChain, nextInChain, ordinalOf, boxCorners} from './select';
import {undo, redo, undoDepth, redoDepth, isolateHistory} from '@codemirror/commands';

// --- Constants
const DEFAULT_SVG_SIZE = 200;
const RANDOM_FILENAME_LENGTH = 6;
const ZOOM_MAX = 50;
const ZOOM_MIN = 0.1;
// how far a press may travel and still count as a click
const DRAG_THRESHOLD = 3;
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
	// selection in the preview, by source ordinal so it survives re-renders
	private selectedOrdinal: number | null = null;
	private overlay!: SVGSVGElement;
	private selectBox!: SVGPolygonElement;
	private hoverBox!: SVGPolygonElement;
	private pressX = 0;
	private pressY = 0;
	private pressMoved = false;
	private tapTarget: EventTarget | null = null;

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
						if (update.selectionSet || update.docChanged) {
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
			['redo', ()=>this.redoEdit()]
		]);
		document.addEventListener('keydown', this.handleHistoryKeys);
		this.updateHistoryButtons();
		this.svgPreview.addEventListener('mousedown', (e)=>this.startPan(e));
		document.addEventListener('mousemove', (e)=>this.doPan(e));
		document.addEventListener('mouseup', ()=>this.endPan());
		this.svgPreview.addEventListener('touchstart', (e)=>this.handleTouchStart(e), {passive: false});
		this.svgPreview.addEventListener('touchmove', (e)=>this.handleTouchMove(e), {passive: false});
		this.svgPreview.addEventListener('touchend', (e)=>this.handleTouchEnd(e), {passive: false});
		this.svgPreview.addEventListener('mousemove', (e)=>this.hoverAt(e));
		this.svgPreview.addEventListener('mouseleave', ()=>this.drawBox(this.hoverBox, null));
		this.svgPreview.addEventListener('keydown', (e)=>{
			if (e.key === 'Escape') this.clearSelection();
		});
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

	private startPan(e: MouseEvent): void {
		this.isPanning = true;
		this.pressMoved = false;
		this.tapTarget = e.target;
		this.pressX = this.lastPanX = e.clientX;
		this.pressY = this.lastPanY = e.clientY;
		e.preventDefault();
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
		if (this.isPanning && !this.pressMoved) this.clickSelect(this.tapTarget);
		this.isPanning = false;
	}

	private handleTouchStart(e: TouchEvent): void {
		if (e.touches.length === 2) {
			this.isMultiTouch = true;
			this.initialPinchDistance = this.calculatePinchDistance(e.touches[0], e.touches[1]);
			this.initialZoomLevel = this.zoomLevel;
			this.tapTarget = null;
			e.preventDefault();
		} else if (e.touches.length === 1) {
			this.isMultiTouch = false;
			this.isPanning = true;
			this.tapTarget = e.target;
			this.pressX = this.lastPanX = e.touches[0].clientX;
			this.pressY = this.lastPanY = e.touches[0].clientY;
			e.preventDefault();
		} else {
			this.isMultiTouch = false;
		}
	}
	private handleTouchMove(e: TouchEvent): void {
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

	private selectedElement(): Element | null {
		return this.selectedOrdinal === null ? null : this.elementForOrdinal(this.selectedOrdinal);
	}

	/** What a click on this target would select. */
	private pickAt(target: EventTarget | null): Element | null {
		const root = this.svgPreview.querySelector('.svg-container svg');
		if (!(root instanceof SVGSVGElement)) return null;
		const leaf = findSvgTarget(target, root);
		return leaf ? nextInChain(selectionChain(leaf, root), this.selectedElement()) : null;
	}

	private clickSelect(target: EventTarget | null): void {
		this.svgPreview.focus({preventScroll: true});
		const pick = this.pickAt(target);
		if (pick) {
			this.selectElement(pick);
		} else {
			this.clearSelection();
		}
	}

	/** Select a preview element and select its start tag in the editor. */
	private selectElement(el: Element): void {
		const source = this.editor.state.doc.toString();
		const container = this.svgPreview.querySelector('.svg-container');
		const ordinal = container ? ordinalOf(el, container, source) : null;
		if (ordinal === null) return;
		this.selectedOrdinal = ordinal;
		this.refreshSelection();
		this.drawBox(this.hoverBox, null);
		const tag = startTags(source).at(ordinal);
		if (tag && tag.name === el.tagName.toLowerCase()) {
			this.editor.dispatch({selection: {anchor: tag.start, head: tag.end}, scrollIntoView: true});
		}
		this.announceAction(`Selected ${el.tagName.toLowerCase()}`);
	}

	private clearSelection(): void {
		if (this.selectedOrdinal === null) return;
		this.selectedOrdinal = null;
		this.refreshSelection();
	}

	/** The selection follows the editor cursor, as the x-ray glow does. The
	 * root <svg> is never selected: it is the canvas, not a thing on it. */
	private syncSelectionFromCursor(): void {
		const source = this.editor.state.doc.toString();
		const ref = findElementAtCursor(source, this.editor.state.selection.main.head);
		const next = ref && ref.ordinal !== this.rootTag(source)?.ordinal ? ref.ordinal : null;
		if (next === this.selectedOrdinal) return;
		this.selectedOrdinal = next;
		this.refreshSelection();
	}

	private hoverAt(e: MouseEvent): void {
		if (this.isPanning) return;
		const pick = this.pickAt(e.target);
		this.svgPreview.style.cursor = pick ? 'pointer' : '';
		this.drawBox(this.hoverBox, pick && pick !== this.selectedElement() ? pick : null);
	}

	private refreshSelection(): void {
		this.drawBox(this.selectBox, this.selectedElement());
	}

	/** Put a box over an element, or take it away. */
	private drawBox(box: SVGPolygonElement, el: Element | null): void {
		const corners = el ? boxCorners(el, this.overlay) : null;
		box.classList.toggle('hide', !corners);
		if (corners) box.setAttribute('points', corners.map(p=>`${p.x},${p.y}`).join(' '));
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
	private applyEdits(changes: TextChange[], userEvent: string): boolean {
		if (changes.length === 0) return false;
		this.editor.dispatch({changes, annotations: isolateHistory.of('full'), userEvent});
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
		this.transformRoot(()=>{this.rotationDegrees = (this.rotationDegrees + 90) % 360;}, 'SVG rotated 90 degrees');
	}
	private flipSVGX(): void {
		this.transformRoot(()=>{this.flipX = !this.flipX;}, 'SVG flipped horizontally');
	}
	private flipSVGY(): void {
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
	 * preview and the toolbar; inside the editor and the dialog they are left
	 * to the editor and the browser. */
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
