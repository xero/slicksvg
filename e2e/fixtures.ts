import { expect, type Page } from '@playwright/test';

/** The drawing the editor opened with before the light bulb, a circle and a
 * line of text, which the specs written against it still use. */
export const HELLO = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
	<circle cx="100" cy="100" r="80" fill="#6291e0" stroke="#295da9" stroke-width="2"/>
	<text x="100" y="110" text-anchor="middle" fill="white" font-family="Arial" font-size="16">
		Hello SVG
	</text>
</svg>`;

/** Put the circle and text in the editor, the cursor at the start, as the
 * drawing it opens with is, out of the history; and wait for the preview to draw it. */
export async function useHello(page: Page) {
  await page.evaluate((doc) => {
    const view = (window as any).svgEditor.editor;
    // the Transaction class, which the page has no import of, for its history annotation
    const Transaction = view.state.update({}).constructor;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: doc }, selection: { anchor: 0 }, annotations: Transaction.addToHistory.of(false) });
  }, HELLO);
  await expect(page.locator('.svg-container circle')).toBeVisible();
}
