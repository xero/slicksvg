import {EditorView} from '@codemirror/view';
import {EditorState, Compartment} from '@codemirror/state';
import {xml} from '@codemirror/lang-xml';
import {basicSetup} from 'codemirror';
import {tokyoNightDay} from '@fsegurai/codemirror-theme-tokyo-night-day';
import {tokyoNightStorm} from '@fsegurai/codemirror-theme-tokyo-night-storm';
import {linter, lintGutter} from '@codemirror/lint';

// Global variable to hold status bar update callback
let statusBarUpdateCallback: ((message: string, isError: boolean) => void) | null = null;

const svgLinter = linter(view=>{
	const text = view.state.doc.toString().trim();
	const diagnostics = [];

	try {
		if (!text) {
			if (statusBarUpdateCallback) {
				statusBarUpdateCallback('svg valid', false);
			}
			return [];
		}

		const parser = new DOMParser();
		const doc = parser.parseFromString(text, 'image/svg+xml');
		const parserError = doc.querySelector('parsererror');

		if (parserError) {
			let message = parserError.textContent || 'Invalid SVG/XML';
			const lineMatch = message.match(/line\s+(\d+)/i);
			const columnMatch = message.match(/column\s+(\d+)/i);

			let from = 0;
			let to = text.length;

			if (lineMatch) {
				const lineNumber = parseInt(lineMatch[1], 10) - 1;
				const lines = text.split('\n');
				if (lineNumber >= 0 && lineNumber < lines.length) {
					let lineStart = 0;
					for (let i = 0; i < lineNumber; i++) {
						lineStart += lines[i].length + 1;
					}
					from = lineStart;
					to = lineStart + (lines[lineNumber]?.length || 0);
					if (columnMatch) {
						const columnNumber = parseInt(columnMatch[1], 10) - 1;
						from = lineStart + Math.min(columnNumber, lines[lineNumber]?.length || 0);
						to = Math.min(from + 1, lineStart + (lines[lineNumber]?.length || 0));
					}
				}
			}
			message = message.match(/: ([^\n]+)\n/)?.[1] || '';
			if (statusBarUpdateCallback) {
				statusBarUpdateCallback(message || 'SVG parsing error', true);
			}
			diagnostics.push({
				from,
				to,
				severity: 'error' as const,
				message: message
			});
		}
		if (text.trim() && !text.includes('<svg')) {
			const warningMessage = 'Document should contain an SVG element';
			if (statusBarUpdateCallback) {
				statusBarUpdateCallback(warningMessage, true);
			}
			diagnostics.push({
				from: 0,
				to: Math.min(50, text.length),
				severity: 'warning' as const,
				message: warningMessage
			});
		}
		if (diagnostics.length === 0 && statusBarUpdateCallback) {
			statusBarUpdateCallback('svg valid', false);
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
		svgEditor?: SVGEditor;
		updateStatusBar?: (message: string, isError?: boolean) => void;
	}
}

class SVGEditor {
	public editor: EditorView;
	private previewContainer: HTMLElement;
	private svgPreview: HTMLElement;
	private modal: HTMLDialogElement;
	private statusBar: HTMLElement;
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
	private initialPinchDistance = 0;
	private initialZoomLevel = 1;

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
		return e
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
		// Create CodeMirror editor
		const startDoc = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
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
					xml(),
					EditorView.lineWrapping,
					lintGutter(),
					svgLinter,
					this.themeCompartment.of([tokyoNightDay]),
					EditorView.updateListener.of((update)=>{
						if (update.docChanged) {
							this.updateSVGPreview();
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
		this.previewContainer.appendChild(this.svgPreview);
	}

	private modalIsOpen = (): boolean=>this.modal.open;

	private modalShow(): void {
		this.modal.classList.remove('closing');
		void (!this.modalIsOpen() && this.modal.showModal());
		// Focus the first input when modal opens
		const firstInput = this.modal.querySelector('#width') as HTMLInputElement;
		firstInput.focus();
		// Add focus trapping
		this.modal.addEventListener('keydown', this.handleModalKeydown);
	};

	private modalClose():void {
		this.modal.classList.add('closing');
		// Remove focus trapping
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
			// Shift+Tab - going backwards
			if (document.activeElement === firstElement) {
				e.preventDefault();
				lastElement.focus();
			}
		} else {
			// Tab - going forwards
			if (document.activeElement === lastElement) {
				e.preventDefault();
				firstElement.focus();
			}
		}
	};

	private announceAction(message: string): void {
		const announcer = document.getElementById('test-announcements');
		if (announcer) {
			announcer.textContent = message;
		}
	}

	public announceError(message: string): void {
		let liveRegion = document.getElementById('error-announcements');
		if (!liveRegion) {
			liveRegion = document.createElement('div');
			liveRegion.id = 'error-announcements';
			liveRegion.setAttribute('aria-live', 'assertive');
			liveRegion.setAttribute('aria-atomic', 'true');
			liveRegion.style.position = 'absolute';
			liveRegion.style.left = '-10000px';
			document.body.appendChild(liveRegion);
		}
		liveRegion.textContent = message;
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
		this.get('dark').addEventListener('click', ()=>this.toggleMode());
		this.get('cancel').addEventListener('click', ()=>this.modalClose());
		this.get('resolution').addEventListener('click', ()=>this.showResolutionModal());
		this.get('resize').addEventListener('click', ()=>this.resizeSVG());
		this.get('flip').addEventListener('click', ()=>this.toggleLayout());
		this.get('zoomin').addEventListener('click', ()=>this.zoomIn());
		this.get('zoomout').addEventListener('click', ()=>this.zoomOut());
		this.get('rotate').addEventListener('click', ()=>this.rotateSVG());
		this.get('flipx').addEventListener('click', ()=>this.flipSVGX());
		this.get('flipy').addEventListener('click', ()=>this.flipSVGY());
		this.get('optimize').addEventListener('click', ()=>this.optimizeSVG());
		this.get('download').addEventListener('click', ()=>this.downloadSVG());
		this.get('upload').addEventListener('click', ()=>this.triggerFileUpload());
		this.svgPreview.addEventListener('mousedown', (e)=>this.startPan(e));
		document.addEventListener('mousemove', (e)=>this.doPan(e));
		document.addEventListener('mouseup', ()=>this.endPan());
		this.svgPreview.addEventListener('touchstart', (e)=>this.handleTouchStart(e), {passive: false});
		this.svgPreview.addEventListener('touchmove', (e)=>this.handleTouchMove(e), {passive: false});
		this.svgPreview.addEventListener('touchend', (e)=>this.handleTouchEnd(e), {passive: false});
	}

	private updateSVGPreview(): void {
		const svgCode = this.editor.state.doc.toString();
		try {
			this.svgPreview.innerHTML = '';

			const svgContainer = document.createElement('div');
			svgContainer.className = 'svg-container';
			svgContainer.innerHTML = svgCode;

			this.svgPreview.appendChild(svgContainer);
			this.applySVGStyles();
		} catch (error) {
			this.svgPreview.innerHTML = `<div class="error">Invalid SVG: ${String(error)}</div>`;
		}
	}

	private applySVGStyles(): void {
		const svgElement = this.svgPreview.querySelector('svg');
		if (svgElement) {
			const hasWidth = svgElement.hasAttribute('width');
			const hasHeight = svgElement.hasAttribute('height');

			if (!hasWidth || !hasHeight) {
				if (!hasWidth) {
					svgElement.style.width = '200px';
				}
				if (!hasHeight) {
					svgElement.style.height = '200px';
				}
			}

			// apply CSS transforms for zoom/pan only, preserving SVG transform attributes
			// uses CSS transforms on a wrapper div instead of directly on the SVG element
			const svgContainer = svgElement.parentElement;
			if (svgContainer && svgContainer.classList.contains('svg-container')) {
				svgContainer.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.zoomLevel})`;
				svgContainer.style.transformOrigin = 'center center';
				svgContainer.style.transition = 'transform 0.1s ease-out';
			}
		}
	}

	private toggleLayout(): void {
		this.isVerticalLayout = !this.isVerticalLayout;
		document.body.classList.toggle('vertical');
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
		this.zoomLevel = Math.min(this.zoomLevel * 1.2, 50);
		this.applySVGStyles();
		this.announceAction(`Zoomed in to ${Math.round(this.zoomLevel * 100)}%`);
	}

	private zoomOut(): void {
		this.zoomLevel = Math.max(this.zoomLevel / 1.2, 0.1);
		this.applySVGStyles();
		this.announceAction(`Zoomed out to ${Math.round(this.zoomLevel * 100)}%`);
	}

	private startPan(e: MouseEvent): void {
		this.isPanning = true;
		this.lastPanX = e.clientX;
		this.lastPanY = e.clientY;
		e.preventDefault();
	}

	private doPan(e: MouseEvent): void {
		if (!this.isPanning) return;

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
		this.isPanning = false;
	}

	private handleTouchStart(e: TouchEvent): void {
		if (e.touches.length === 2) {
			this.isMultiTouch = true;
			this.initialPinchDistance = this.calculatePinchDistance(e.touches[0], e.touches[1]);
			this.initialZoomLevel = this.zoomLevel;
			e.preventDefault();
		} else if (e.touches.length === 1) {
			this.isMultiTouch = false;
			this.isPanning = true;
			this.lastPanX = e.touches[0].clientX;
			this.lastPanY = e.touches[0].clientY;
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
			this.zoomLevel = Math.max(0.1, Math.min(newZoomLevel, 50));
			this.applySVGStyles();
			e.preventDefault();
		} else if (!this.isMultiTouch && e.touches.length === 1 && this.isPanning) {
			const touch = e.touches[0];
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
			// End panning when all touches are removed
			this.isPanning = false;
		}
	}

	private calculatePinchDistance(touch1: Touch, touch2: Touch): number {
		const dx = touch1.clientX - touch2.clientX;
		const dy = touch1.clientY - touch2.clientY;
		return Math.sqrt(dx * dx + dy * dy);
	}

	private parseCurrentTransforms(svgCode: string): void {
		this.rotationDegrees = 0;
		this.flipX = false;
		this.flipY = false;

		const transformMatch = svgCode.match(/transform="([^"]*)"/);
		if (!transformMatch) return;

		const transformValue = transformMatch[1];
		const rotateMatch = transformValue.match(/rotate\((\d+)[^)]*\)/);

		if (rotateMatch) {
			const angle = parseInt(rotateMatch[1]);
			this.rotationDegrees = angle % 360;
		}
		if (transformValue.includes('matrix(-1,0,0,1,0,0)')) {
			this.flipX = true;
		}
		if (transformValue.includes('matrix(1,0,0,-1,0,0)')) {
			this.flipY = true;
		}
	}

	private buildTransformAttribute(width: number, height: number): string {
		const transforms = [];
		if (this.rotationDegrees > 0) {
			const centerX = width / 2;
			const centerY = height / 2;
			transforms.push(`rotate(${this.rotationDegrees} ${centerX} ${centerY})`);
		}
		if (this.flipX) {
			transforms.push('matrix(-1,0,0,1,0,0)');
		}
		if (this.flipY) {
			transforms.push('matrix(1,0,0,-1,0,0)');
		}
		return transforms.join(' ');
	}

	private applyTransformToSVG(): void {
		const svgCode = this.editor.state.doc.toString();
		try {
			const widthMatch = svgCode.match(/width="([^"]+)"/);
			const heightMatch = svgCode.match(/height="([^"]+)"/);
			const width = widthMatch ? parseInt(widthMatch[1]) : 100;
			const height = heightMatch ? parseInt(heightMatch[1]) : 100;
			const transformValue = this.buildTransformAttribute(width, height);

			let transformedSVG;
			if (transformValue.trim()) {
				const transformMatch = svgCode.match(/(<svg[^>]*)\s+transform="[^"]*"([^>]*>)/);
				if (transformMatch) {
					transformedSVG = svgCode.replace(
						/(<svg[^>]*)\s+transform="[^"]*"([^>]*>)/,
						`$1 transform="${transformValue}"$2`
					);
				} else {
					transformedSVG = svgCode.replace(
						/(<svg[^>]*)(>)/,
						`$1 transform="${transformValue}"$2`
					);
				}
			} else {
				transformedSVG = svgCode.replace(/\s+transform="[^"]*"/, '');
			}

			const transaction = this.editor.state.update({
				changes: {
					from: 0,
					to: this.editor.state.doc.length,
					insert: transformedSVG
				}
			});
			this.editor.dispatch(transaction);
		} catch (error) {
			console.error('SVG transformation failed:', error);
		}
	}

	private rotateSVG(): void {
		const svgCode = this.editor.state.doc.toString();
		this.parseCurrentTransforms(svgCode);
		this.rotationDegrees = (this.rotationDegrees + 90) % 360;
		this.applyTransformToSVG();
		this.announceAction(`SVG rotated 90 degrees`);
	}

	private flipSVGX(): void {
		const svgCode = this.editor.state.doc.toString();
		this.parseCurrentTransforms(svgCode);
		this.flipX = !this.flipX;
		this.applyTransformToSVG();
		this.announceAction('SVG flipped horizontally');
	}

	private flipSVGY(): void {
		const svgCode = this.editor.state.doc.toString();
		this.parseCurrentTransforms(svgCode);
		this.flipY = !this.flipY;
		this.applyTransformToSVG();
		this.announceAction('SVG flipped vertically');
	}

	private showResolutionModal(): void {
		const svgCode = this.editor.state.doc.toString();
		const widthMatch = svgCode.match(/width="([^"]+)"/);
		const heightMatch = svgCode.match(/height="([^"]+)"/);

		let currentWidth = widthMatch ? parseInt(widthMatch[1]) : null;
		let currentHeight = heightMatch ? parseInt(heightMatch[1]) : null;

		// if width or height are missing, fall back to viewbox
		if (currentWidth === null || currentHeight === null) {
			const viewBoxMatch = svgCode.match(/viewBox="([^"]+)"/);
			if (viewBoxMatch) {
				const viewBoxValues = viewBoxMatch[1].split(/\s+/);
				if (viewBoxValues.length >= 4) {
					if (currentWidth === null) {
						currentWidth = parseInt(viewBoxValues[2]);
					}
					if (currentHeight === null) {
						currentHeight = parseInt(viewBoxValues[3]);
					}
				}
			}
		}
		// final fallback to defaults if still null
		currentWidth = currentWidth || 200;
		currentHeight = currentHeight || 200;

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

		const svgCode = this.editor.state.doc.toString();

		try {
			let updatedSVG = svgCode;

			if (updatedSVG.includes('width="')) {
				updatedSVG = updatedSVG.replace(/width="[^"]*"/, `width="${newWidth}"`);
			} else {
				updatedSVG = updatedSVG.replace(/(<svg[^>]*)(>)/, `$1 width="${newWidth}"$2`);
			}

			if (updatedSVG.includes('height="')) {
				updatedSVG = updatedSVG.replace(/height="[^"]*"/, `height="${newHeight}"`);
			} else {
				updatedSVG = updatedSVG.replace(/(<svg[^>]*)(>)/, `$1 height="${newHeight}"$2`);
			}

			const viewBoxValue = `0 0 ${newWidth} ${newHeight}`;
			if (updatedSVG.includes('viewBox="')) {
				updatedSVG = updatedSVG.replace(/viewBox="[^"]*"/, `viewBox="${viewBoxValue}"`);
			} else {
				updatedSVG = updatedSVG.replace(/(<svg[^>]*)(>)/, `$1 viewBox="${viewBoxValue}"$2`);
			}

			const transaction = this.editor.state.update({
				changes: {
					from: 0,
					to: this.editor.state.doc.length,
					insert: updatedSVG
				}
			});
			this.editor.dispatch(transaction);

		} catch (error) {
			console.error('SVG resize failed:', error);
			alert('Failed to resize SVG. Please check the SVG format.');
		}

		this.modalClose();
	}

	private optimizeSVG(): void {
		const svgCode = this.editor.state.doc.toString();
		try {
			// Comprehensive SVG optimization
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
				// Remove metadata, desc, and title elements (optional optimization)
				.replace(/<metadata[^>]*>[\s\S]*?<\/metadata>/g, '')
				.replace(/<desc[^>]*>[\s\S]*?<\/desc>/g, '')
				// Remove empty groups
				.replace(/<g[^>]*>\s*<\/g>/g, '')
				// Consolidate whitespace
				.replace(/\s+/g, ' ')
				// Trim whitespace
				.trim();

			const transaction = this.editor.state.update({
				changes: {
					from: 0,
					to: this.editor.state.doc.length,
					insert: optimized
				}
			});
			this.editor.dispatch(transaction);
		} catch (error) {
			console.error('SVG optimization failed:', error);
		}
	}

	private loadSVGContent(content: string): void {
		try {
			// Reset all view states before loading new content
			this.resetViewState();

			// Update editor with new SVG content
			const transaction = this.editor.state.update({
				changes: {
					from: 0,
					to: this.editor.state.doc.length,
					insert: content
				},
				selection: {anchor: 0} // Reset cursor to start of document
			});
			this.editor.dispatch(transaction);
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

	private generateRandomFilename(): string {
		const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
		let randomStr = '';
		for (let i = 0; i < 6; i++) {
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

function initializeEditor(): void {
	const editor = new SVGEditor();
	// Expose function globally for testing
	window.announceError = editor.announceError.bind(editor);
	window.updateStatusBar = editor.updateStatusBar.bind(editor);
	window.svgEditor = editor;
}

if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', initializeEditor);
} else {
	initializeEditor();
}
