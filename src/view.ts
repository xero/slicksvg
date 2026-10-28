/** The preview's view: the drawing scaled about the middle of the pane and
 * then shifted, as its CSS transform `translate(pan) scale(zoom)` does. */
export interface View {
	zoom: number;
	panX: number;
	panY: number;
}

/** A pinch at one moment: the middle of the fingers, in pixels from the
 * middle of the pane, and how far apart they are. */
export interface Pinch {
	x: number;
	y: number;
	spread: number;
}

export const ZOOM_MAX = 50;
export const ZOOM_MIN = 0.1;
/** The toolbar's step, and the most a single wheel notch zooms. */
export const ZOOM_STEP = 1.2;

export const clampZoom = (zoom: number): number=>Math.max(ZOOM_MIN, Math.min(zoom, ZOOM_MAX));

/** The view zoomed by a factor about a point, in pixels from the middle of
 * the pane, so the spot of the drawing under that point stays under it. */
export function zoomAbout(view: View, factor: number, x: number, y: number): View {
	const zoom = clampZoom(view.zoom * factor);
	const ratio = zoom / view.zoom;
	return {zoom, panX: x - (x - view.panX) * ratio, panY: y - (y - view.panY) * ratio};
}

/** Where a pinch that began at `from`, with the view at `start`, has taken
 * the view by `to`: the fingers' spread sets the zoom, and the spot of the
 * drawing that was between them follows them. */
export function pinchView(start: View, from: Pinch, to: Pinch): View {
	const zoomed = zoomAbout(start, from.spread > 0 ? to.spread / from.spread : 1, from.x, from.y);
	return {zoom: zoomed.zoom, panX: zoomed.panX + to.x - from.x, panY: zoomed.panY + to.y - from.y};
}

/** The zoom factor of a wheel event. A trackpad pinch arrives as many small
 * Ctrl+wheel steps and a mouse notch as one big one; each is kept within a
 * toolbar step, so a notch zooms as the buttons do. */
export function wheelZoomFactor(deltaY: number, deltaMode: number): number {
	const px = deltaY * (deltaMode === 1 ? 33 : deltaMode === 2 ? 800 : 1);
	return Math.min(ZOOM_STEP, Math.max(1 / ZOOM_STEP, Math.exp(-px / 100)));
}

/** How far a wheel event pans, in pixels: the drawing follows the scroll as a
 * page would, and Shift turns a vertical wheel sideways as browsers do. */
export function wheelPan(e: {deltaX: number; deltaY: number; deltaMode: number; shiftKey: boolean}): [number, number] {
	const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 800 : 1;
	let [dx, dy] = [e.deltaX * unit, e.deltaY * unit];
	if (e.shiftKey && dx === 0) [dx, dy] = [dy, 0];
	return [-dx, -dy];
}
