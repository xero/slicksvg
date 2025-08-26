// main entrypoint
import {EditorView} from '@codemirror/view';
import {EditorState, Compartment} from '@codemirror/state';
import {xml} from '@codemirror/lang-xml';
import {basicSetup} from 'codemirror';
import {oneDark} from '@codemirror/theme-one-dark';

// SVG Editor Application
class SVGEditor {
	private editor: EditorView;
	private previewContainer: HTMLElement;
	private svgPreview: HTMLElement;
	private isVerticalLayout = false;
	private isDarkMode = false;
	private zoomLevel = 1;
	private panX = 0;
	private panY = 0;
	private isPanning = false;
	private lastPanX = 0;
	private lastPanY = 0;
	private rotationDegrees = 0; // Track current rotation: 0, 90, 180, 270
	private flipX = false; // Track horizontal flip state
	private flipY = false; // Track vertical flip state
	private themeCompartment = new Compartment();
	// Touch/pinch zoom properties
	private isMultiTouch = false;
	private initialPinchDistance = 0;
	private initialZoomLevel = 1;


	constructor() {
		this.initializeEditor();
		this.initializePreview();
		this.setupEventListeners();
		this.updateSVGPreview();
	}

	private get(i: string) {
		const e = document.getElementById(i);
		if (!e) throw new Error(`Element #${i} not found`);
		return e
	}

  private getTyped = <T extends Element = HTMLElement>(q: string): T=>{
		const e = document.querySelector(q);
		if (!e) throw new Error(`Element ${q} was not found`);
		return e as T;
	}

	private initializeEditor(): void {
		const editorContainer = this.get('editor');
		if (!editorContainer) throw new Error('Editor container not found');

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
					this.themeCompartment.of([]), // Start with light theme (no theme extension)
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

		// Create SVG preview wrapper
		this.svgPreview = document.createElement('div');
		this.svgPreview.className = 'svg-preview-wrapper';
		this.previewContainer.appendChild(this.svgPreview);
	}

	private setupEventListeners(): void {
		if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
			this.toggleMode();
		}
		this.get('dark').addEventListener('click', ()=>this.toggleMode());

		// Flip button
		this.get('flip').addEventListener('click', ()=>this.toggleLayout());

		// Zoom controls
		const zoomInButton = this.get('zoomin');
		const zoomOutButton = this.get('zoomout');

		zoomInButton?.addEventListener('click', ()=>this.zoomIn());
		zoomOutButton?.addEventListener('click', ()=>this.zoomOut());

		// Transform controls
		const rotateButton = this.get('rotate');
		const flipXButton = this.get('flipx');
		const flipYButton = this.get('flipy');

		rotateButton?.addEventListener('click', ()=>this.rotateSVG());
		flipXButton?.addEventListener('click', ()=>this.flipSVGX());
		flipYButton?.addEventListener('click', ()=>this.flipSVGY());

		// Tools
		const optimizeButton = this.get('optimize');
		optimizeButton?.addEventListener('click', ()=>this.optimizeSVG());

		// Pan controls
		this.svgPreview.addEventListener('mousedown', (e)=>this.startPan(e));
		document.addEventListener('mousemove', (e)=>this.doPan(e));
		document.addEventListener('mouseup', ()=>this.endPan());

		// Touch/pinch zoom controls (always add listeners, check support in handlers)
		this.svgPreview.addEventListener('touchstart', (e)=>this.handleTouchStart(e), {passive: false});
		this.svgPreview.addEventListener('touchmove', (e)=>this.handleTouchMove(e), {passive: false});
		this.svgPreview.addEventListener('touchend', (e)=>this.handleTouchEnd(e), {passive: false});
	}

	private updateSVGPreview(): void {
		const svgCode = this.editor.state.doc.toString();
		try {
			// Clear previous content
			this.svgPreview.innerHTML = '';

			// Create container for the SVG
			const svgContainer = document.createElement('div');
			svgContainer.className = 'svg-container';
			svgContainer.innerHTML = svgCode;

			this.svgPreview.appendChild(svgContainer);
			this.applySVGStyles();
		} catch (error) {
			// Display error message if SVG is invalid
			this.svgPreview.innerHTML = `<div class="error">Invalid SVG: ${String(error)}</div>`;
		}
	}

	private applySVGStyles(): void {
		const svgElement = this.svgPreview.querySelector('svg');
		if (svgElement) {
			svgElement.style.border = '2px dashed rgba(0,0,0,0.3)';

			// Apply CSS transforms for zoom/pan only, preserving SVG transform attributes
			// We use CSS transforms on a wrapper div instead of directly on the SVG element
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

		// Update CodeMirror theme
		this.editor.dispatch({
			effects: this.themeCompartment.reconfigure(
				this.isDarkMode ? [oneDark] : []
			)
		});
	}

	private zoomIn(): void {
		this.zoomLevel = Math.min(this.zoomLevel * 1.2, 50);
		this.applySVGStyles();
	}

	private zoomOut(): void {
		this.zoomLevel = Math.max(this.zoomLevel / 1.2, 0.1);
		this.applySVGStyles();
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
			// Start pinch zoom
			this.isMultiTouch = true;
			this.initialPinchDistance = this.calculatePinchDistance(e.touches[0], e.touches[1]);
			this.initialZoomLevel = this.zoomLevel;
			e.preventDefault();
		} else {
			this.isMultiTouch = false;
		}
	}

	private handleTouchMove(e: TouchEvent): void {
		if (this.isMultiTouch && e.touches.length === 2) {
			const currentDistance = this.calculatePinchDistance(e.touches[0], e.touches[1]);
			const scale = currentDistance / this.initialPinchDistance;

			// Apply zoom based on pinch scale
			const newZoomLevel = this.initialZoomLevel * scale;
			this.zoomLevel = Math.max(0.1, Math.min(newZoomLevel, 50));

			this.applySVGStyles();
			e.preventDefault();
		}
	}

	private handleTouchEnd(e: TouchEvent): void {
		if (e.touches.length < 2) {
			this.isMultiTouch = false;
		}
	}

	private calculatePinchDistance(touch1: Touch, touch2: Touch): number {
		const dx = touch1.clientX - touch2.clientX;
		const dy = touch1.clientY - touch2.clientY;
		return Math.sqrt(dx * dx + dy * dy);
	}

	private parseCurrentTransforms(svgCode: string): void {
		// Reset states
		this.rotationDegrees = 0;
		this.flipX = false;
		this.flipY = false;

		// Extract existing transform attribute
		const transformMatch = svgCode.match(/transform="([^"]*)"/);
		if (!transformMatch) return;

		const transformValue = transformMatch[1];

		// Parse rotation - look for rotate(angle ...)
		const rotateMatch = transformValue.match(/rotate\((\d+)[^)]*\)/);
		if (rotateMatch) {
			const angle = parseInt(rotateMatch[1]);
			this.rotationDegrees = angle % 360;
		}

		// Parse horizontal flip - look for matrix(-1,0,0,1,0,0)
		if (transformValue.includes('matrix(-1,0,0,1,0,0)')) {
			this.flipX = true;
		}

		// Parse vertical flip - look for matrix(1,0,0,-1,0,0)
		if (transformValue.includes('matrix(1,0,0,-1,0,0)')) {
			this.flipY = true;
		}
	}

	private buildTransformAttribute(width: number, height: number): string {
		const transforms = [];

		// Add rotation if needed
		if (this.rotationDegrees > 0) {
			const centerX = width / 2;
			const centerY = height / 2;
			transforms.push(`rotate(${this.rotationDegrees} ${centerX} ${centerY})`);
		}

		// Add horizontal flip if needed
		if (this.flipX) {
			transforms.push('matrix(-1,0,0,1,0,0)');
		}

		// Add vertical flip if needed
		if (this.flipY) {
			transforms.push('matrix(1,0,0,-1,0,0)');
		}

		return transforms.join(' ');
	}

	private applyTransformToSVG(): void {
		const svgCode = this.editor.state.doc.toString();
		try {
			// Extract width and height from SVG
			const widthMatch = svgCode.match(/width="([^"]+)"/);
			const heightMatch = svgCode.match(/height="([^"]+)"/);
			const width = widthMatch ? parseInt(widthMatch[1]) : 100;
			const height = heightMatch ? parseInt(heightMatch[1]) : 100;

			// Build the new transform attribute
			const transformValue = this.buildTransformAttribute(width, height);

			let transformedSVG;
			if (transformValue.trim()) {
				// Check if SVG already has a transform attribute
				const transformMatch = svgCode.match(/(<svg[^>]*)\s+transform="[^"]*"([^>]*>)/);
				if (transformMatch) {
					// Replace existing transform
					transformedSVG = svgCode.replace(
						/(<svg[^>]*)\s+transform="[^"]*"([^>]*>)/,
						`$1 transform="${transformValue}"$2`
					);
				} else {
					// Add new transform attribute
					transformedSVG = svgCode.replace(
						/(<svg[^>]*)(>)/,
						`$1 transform="${transformValue}"$2`
					);
				}
			} else {
				// Remove transform attribute if no transforms are needed
				transformedSVG = svgCode.replace(/\s+transform="[^"]*"/, '');
			}

			// Update editor with transformed SVG
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

		// Parse current transforms to get current state
		this.parseCurrentTransforms(svgCode);

		// Increment rotation by 90 degrees (cycle through 0, 90, 180, 270, then back to 0)
		this.rotationDegrees = (this.rotationDegrees + 90) % 360;

		// Apply the consolidated transform
		this.applyTransformToSVG();
	}

	private flipSVGX(): void {
		const svgCode = this.editor.state.doc.toString();

		// Parse current transforms to get current state
		this.parseCurrentTransforms(svgCode);

		// Toggle horizontal flip
		this.flipX = !this.flipX;

		// Apply the consolidated transform
		this.applyTransformToSVG();
	}

	private flipSVGY(): void {
		const svgCode = this.editor.state.doc.toString();

		// Parse current transforms to get current state
		this.parseCurrentTransforms(svgCode);

		// Toggle vertical flip
		this.flipY = !this.flipY;

		// Apply the consolidated transform
		this.applyTransformToSVG();
	}

	private optimizeSVG(): void {
		const svgCode = this.editor.state.doc.toString();
		try {
			// Basic SVG optimization - remove comments, extra whitespace, and redundant attributes
			const optimized = svgCode
				// Remove comments
				.replace(/<!--[\s\S]*?-->/g, '')
				// Remove extra whitespace between tags
				.replace(/>\s+</g, '><')
				// Remove unnecessary precision in numbers
				.replace(/(\d+\.\d{3})\d+/g, '$1')
				// Trim whitespace
				.trim();

			// Update the editor with optimized SVG
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
}

// Initialize the application when DOM is loaded
if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', ()=>new SVGEditor());
} else {
	new SVGEditor();
}
