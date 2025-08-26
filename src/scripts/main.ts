// main entrypoint
import { EditorView } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { xml } from '@codemirror/lang-xml';
import { basicSetup } from 'codemirror';

// SVG Editor Application
class SVGEditor {
	private editor: EditorView;
	private previewContainer: HTMLElement;
	private svgPreview: HTMLElement;
	private isVerticalLayout = false;
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

	private initializeEditor(): void {
		const editorContainer = document.getElementById('editor');
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
					EditorView.updateListener.of((update) => {
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
		this.previewContainer = document.getElementById('preview');
		if (!this.previewContainer) throw new Error('Preview container not found');

		// Create SVG preview wrapper
		this.svgPreview = document.createElement('div');
		this.svgPreview.className = 'svg-preview-wrapper';
		this.previewContainer.appendChild(this.svgPreview);
	}

	private setupEventListeners(): void {
		// Flip button
		const flipButton = document.getElementById('flip');
		flipButton?.addEventListener('click', () => this.toggleLayout());

		// Zoom controls
		const zoomInButton = document.getElementById('zoomin');
		const zoomOutButton = document.getElementById('zoomout');
		
		zoomInButton?.addEventListener('click', () => this.zoomIn());
		zoomOutButton?.addEventListener('click', () => this.zoomOut());

		// Pan controls
		this.svgPreview.addEventListener('mousedown', (e) => this.startPan(e));
		document.addEventListener('mousemove', (e) => this.doPan(e));
		document.addEventListener('mouseup', () => this.endPan());
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
			this.svgPreview.innerHTML = `<div class="error">Invalid SVG: ${error}</div>`;
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
		if (this.isVerticalLayout) {
			document.body.classList.add('vertical');
		} else {
			document.body.classList.remove('vertical');
		}
	}

	private zoomIn(): void {
		this.zoomLevel = Math.min(this.zoomLevel * 1.2, 5);
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
}

// Initialize the application when DOM is loaded
if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', () => new SVGEditor());
} else {
	new SVGEditor();
}
