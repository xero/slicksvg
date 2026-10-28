// --- Paint: the fill and stroke an element is painted with, as the
// drawing's tools read and write them. A browser reports a colour as it
// computed it, rgb() mostly, and the native colour picker takes and gives
// a #rrggbb; a paint that is no colour (none, or a gradient by its url)
// says so instead. A paint is written where it shows: an element's own
// style beats its attributes, so a property its style sets is set there.
import {fmt} from './geometry';

/** A paint as a swatch shows it: a colour, no paint at all, or something
 * else, such as a gradient, that a colour picker cannot show. */
export type Paint = {kind: 'color'; hex: string} | {kind: 'none'} | {kind: 'other'};

const hex2 = (n: number): string=>Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0');

/** A CSS colour as #rrggbb, from the forms a browser computes one to (rgb()
 * and rgba(), with commas or without) and the hex ones written by hand;
 * null for any other, or one with no colour to it at all. Alpha is let go:
 * the picker has none. */
export function toHex(css: string): string | null {
	const value = css.trim().toLowerCase();
	const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])([0-9a-f])?$/.exec(value);
	if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
	const long = /^#([0-9a-f]{6})([0-9a-f]{2})?$/.exec(value);
	if (long) return `#${long[1]}`;
	const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/.exec(value);
	if (!rgb) return null;
	const alpha = rgb.at(4);
	if (alpha !== undefined && parseFloat(alpha) === 0) return null;
	return `#${hex2(Number(rgb[1]))}${hex2(Number(rgb[2]))}${hex2(Number(rgb[3]))}`;
}

/** The paint a computed fill or stroke is. */
export function paintFrom(computed: string): Paint {
	const value = computed.trim();
	if (value === 'none') return {kind: 'none'};
	const hex = toHex(value);
	return hex ? {kind: 'color', hex} : {kind: 'other'};
}

/** The declarations of an inline style, by name, in their order. */
function declarations(style: string): [string, string][] {
	return style.split(';').map(d=>d.trim()).filter(Boolean).map((d): [string, string]=>{
		const colon = d.indexOf(':');
		return colon === -1 ? [d.toLowerCase(), ''] : [d.slice(0, colon).trim().toLowerCase(), d.slice(colon + 1).trim()];
	});
}

/** Whether an inline style sets a property. */
export function styleSets(style: string | null, name: string): boolean {
	return style !== null && declarations(style).some(([n])=>n === name);
}

/** An inline style with a property set to a value: in place of where it was
 * set, or added at the end, the rest as they were written. */
export function setStyleProperty(style: string, name: string, value: string): string {
	const out: string[] = [];
	let found = false;
	for (const part of style.split(';')) {
		const colon = part.indexOf(':');
		if (colon === -1 || part.slice(0, colon).trim().toLowerCase() !== name) out.push(part);
		// set twice, the property is written once, where it was first
		else if (!found) {
			found = true;
			out.push(`${part.slice(0, part.length - part.trimStart().length)}${name}: ${value}`);
		}
	}
	if (found) return out.join(';');
	const kept = style.trim().replace(/;\s*$/, '');
	return kept ? `${kept}; ${name}: ${value}` : `${name}: ${value}`;
}

/** The stroke widths the width slider runs over for a drawing `size`
 * across: from nothing to twenty times the width a new line is drawn with
 * there, or twice the width now when that is more, in steps a tenth of it. */
export function widthRange(size: number, now: number): {min: number; max: number; step: number; decimals: number} {
	const base = size > 0 && Number.isFinite(size) ? Number((size / 100).toPrecision(1)) : 1;
	const step = Number((base / 10).toPrecision(1));
	const decimals = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
	const reach = Math.max(base * 20, Number.isFinite(now) ? now * 2 : 0);
	const max = Number((Math.ceil(reach / step) * step).toFixed(decimals));
	return {min: 0, max, step, decimals};
}

/** A stroke width to write: not below nothing, to the slider's precision. */
export function writtenWidth(value: number, decimals: number): string | null {
	if (!Number.isFinite(value) || value < 0) return null;
	return fmt(value, decimals);
}
