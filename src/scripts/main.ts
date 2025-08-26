// main entrypoint
import {EditorView} from '@codemirror/view';
import {EditorState} from '@codemirror/state';
import {xml} from '@codemirror/lang-xml';
import {basicSetup} from 'codemirror';

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
			svgElement.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.zoomLevel})`;
			svgElement.style.transformOrigin = 'center center';
			svgElement.style.transition = 'transform 0.1s ease-out';
		}
	}

	private toggleLayout(): void {
		this.isVerticalLayout = !this.isVerticalLayout;
		document.body.classList.toggle('vertical');
	}

	private toggleMode(): void {
		this.isDarkMode = !this.isDarkMode;
		document.body.classList.toggle('dark');
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

	private rotateSVG(): void {
		const svgCode = this.editor.state.doc.toString();
		try {
			// Extract width and height from SVG
			const widthMatch = svgCode.match(/width="([^"]+)"/);
			const heightMatch = svgCode.match(/height="([^"]+)"/);
			const width = widthMatch ? parseInt(widthMatch[1]) : 100;
			const height = heightMatch ? parseInt(heightMatch[1]) : 100;
			const centerX = width / 2;
			const centerY = height / 2;

			let transformedSVG;
			const rotateTransform = `rotate(90 ${centerX} ${centerY})`;

			// Check if SVG already has a transform attribute
			const transformMatch = svgCode.match(/(<svg[^>]*)\s+transform="([^"]*)"([^>]*>)/);
			if (transformMatch) {
				// Combine with existing transform
				const existingTransform = transformMatch[2];
				const newTransform = `${existingTransform} ${rotateTransform}`;
				transformedSVG = svgCode.replace(
					/(<svg[^>]*)\s+transform="[^"]*"([^>]*>)/,
					`$1 transform="${newTransform}"$2`
				);
			} else {
				// Add transform attribute to SVG element
				transformedSVG = svgCode.replace(
					/(<svg[^>]*)(>)/,
					`$1 transform="${rotateTransform}"$2`
				);
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
			console.error('SVG rotation failed:', error);
		}
	}

	private flipSVGX(): void {
		const svgCode = this.editor.state.doc.toString();
		try {
			let transformedSVG;
			const flipTransform = 'matrix(-1,0,0,1,0,0)';

			// Check if SVG already has a transform attribute
			const transformMatch = svgCode.match(/(<svg[^>]*)\s+transform="([^"]*)"([^>]*>)/);
			if (transformMatch) {
				// Combine with existing transform
				const existingTransform = transformMatch[2];
				const newTransform = `${existingTransform} ${flipTransform}`;
				transformedSVG = svgCode.replace(
					/(<svg[^>]*)\s+transform="[^"]*"([^>]*>)/,
					`$1 transform="${newTransform}"$2`
				);
			} else {
				// Add transform attribute to SVG element
				transformedSVG = svgCode.replace(
					/(<svg[^>]*)(>)/,
					`$1 transform="${flipTransform}"$2`
				);
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
			console.error('SVG horizontal flip failed:', error);
		}
	}

	private flipSVGY(): void {
		const svgCode = this.editor.state.doc.toString();
		try {
			let transformedSVG;
			const flipTransform = 'matrix(1,0,0,-1,0,0)';

			// Check if SVG already has a transform attribute
			const transformMatch = svgCode.match(/(<svg[^>]*)\s+transform="([^"]*)"([^>]*>)/);
			if (transformMatch) {
				// Combine with existing transform
				const existingTransform = transformMatch[2];
				const newTransform = `${existingTransform} ${flipTransform}`;
				transformedSVG = svgCode.replace(
					/(<svg[^>]*)\s+transform="[^"]*"([^>]*>)/,
					`$1 transform="${newTransform}"$2`
				);
			} else {
				// Add transform attribute to SVG element
				transformedSVG = svgCode.replace(
					/(<svg[^>]*)(>)/,
					`$1 transform="${flipTransform}"$2`
				);
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
			console.error('SVG vertical flip failed:', error);
		}
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
