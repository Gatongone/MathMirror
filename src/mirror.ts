/**
 * Pure TeX-level parsing for the mirror macros.
 *
 * This module is free of any Obsidian or DOM API so that it can be unit tested
 * in plain Node (see `npm test`).
 *
 * Supported syntax, in any position of a formula:
 *
 *   $\mirrorh{ \frac{a}{b} }$   -> left/right (horizontal) reflection
 *   $\mirrorv{ \frac{a}{b} }$   -> up/down (vertical) reflection
 *   $\mirrorhv{ ... }$          -> 180° rotation (both axes)
 *
 * Two things are produced from that syntax:
 *
 *   1. A whole-formula wrapper (`$\mirrorh{...}$`) is peeled off and reported as
 *      an *axis*, so the caller can reflect the rendered formula element itself.
 *   2. Any remaining macro inside the formula is rewritten to MathJax's own
 *      `\class{mjx-mirror-…}{…}` (the only CSS hook Obsidian's MathJax lets
 *      through: the Safe extension strips classes that do not match `^mjx-`).
 *      That is what makes partial reflections like `$\mirrorh{x} + y$` work.
 */

export type MirrorAxis = "h" | "v" | "hv";

export interface MirrorMacroMatch {
	/** Macro name without the leading backslash, e.g. `mirrorh`. */
	name: string;
	/** Which reflection(s) the macro asks for. */
	axis: MirrorAxis;
	/** The TeX the macro wraps. */
	inner: string;
	/** Index of the leading backslash inside the scanned string. */
	start: number;
	/** Index just past the closing brace inside the scanned string. */
	end: number;
}

export interface UnwrappedMirror {
	/**
	 * Combined axis of the stripped wrappers, or `null` when they cancel out
	 * (`\mirrorh{\mirrorh{x}}` is the identity).
	 */
	axis: MirrorAxis | null;
	/** The formula with all whole-formula wrappers removed. */
	inner: string;
	/** How many wrappers were removed. */
	depth: number;
}

export interface MirrorPlan {
	/** Reflection to apply to the whole rendered formula, if any. */
	axis: MirrorAxis | null;
	/** TeX to hand to MathJax: delimiters kept, macro wrappers resolved. */
	tex: string;
	/** `true` when the formula needs reflecting at all. */
	mirrored: boolean;
}

const MACRO_AXES: Readonly<Record<string, MirrorAxis>> = {
	mirrorh: "h",
	mirrorv: "v",
	mirrorhv: "hv",
	mirrorvh: "hv",
};

/** Maximum number of nested wrappers we are willing to peel off. */
const MAX_NESTING = 16;

const MACRO_PATTERN = /\\([A-Za-z]+)[ \t]*\{/g;

/**
 * Any use of a macro name, whether or not it is followed by a valid argument.
 * Used only for diagnostics.
 */
const MACRO_NAME_PATTERN = /\\(mirrorhv|mirrorvh|mirrorh|mirrorv)(?![A-Za-z])/g;

/**
 * Prefix of the class names used inside TeX. MathJax's Safe extension only lets
 * classes matching `^mjx-[-a-zA-Z0-9_.]+$` through, hence this prefix.
 */
export const TEX_CLASS_PREFIX = "mjx-mirror-";

/** `mirrorh` -> `"h"`, anything unknown -> `null`. */
export function axisForMacro(name: string): MirrorAxis | null {
	return Object.prototype.hasOwnProperty.call(MACRO_AXES, name) ? MACRO_AXES[name] : null;
}

function axisBits(axis: MirrorAxis | null): number {
	switch (axis) {
		case null:
			return 0;
		case "h":
			return 1;
		case "v":
			return 2;
		case "hv":
			return 3;
	}
}

function bitsAxis(bits: number): MirrorAxis | null {
	switch (bits) {
		case 0:
			return null;
		case 1:
			return "h";
		case 2:
			return "v";
		default:
			return "hv";
	}
}

/**
 * Compose two reflections. They are elements of the Klein four-group, so this is
 * an XOR: reflecting twice on the same axis is the identity, `h` then `v` is a
 * 180° rotation.
 */
export function combineAxes(a: MirrorAxis | null, b: MirrorAxis | null): MirrorAxis | null {
	return bitsAxis(axisBits(a) ^ axisBits(b));
}

/** Class name handed to MathJax for an axis. */
export function texClassForAxis(axis: MirrorAxis): string {
	return `${TEX_CLASS_PREFIX}${axis}`;
}

/** CSS transform for an axis; kept here so parsing and styling cannot drift apart. */
export function transformForAxis(axis: MirrorAxis): string {
	switch (axis) {
		case "h":
			return "scaleX(-1)";
		case "v":
			return "scaleY(-1)";
		case "hv":
			return "scale(-1, -1)";
	}
}

/** CSS classes that carry one axis, without the common `math-mirror` class. */
export function axisClasses(axis: MirrorAxis): string[] {
	const classes: string[] = [];
	if (axis === "h" || axis === "hv") classes.push("math-mirror-h");
	if (axis === "v" || axis === "hv") classes.push("math-mirror-v");
	return classes;
}

/**
 * Index of the `}` matching the `{` at `openIndex`, or `-1` when unbalanced.
 * Escaped characters (`\{`, `\}`, `\\`) are skipped, so `\frac{\{}{2}` behaves.
 */
export function findClosingBrace(tex: string, openIndex: number): number {
	if (tex[openIndex] !== "{") return -1;
	let depth = 0;
	for (let i = openIndex; i < tex.length; i++) {
		const character = tex[i];
		if (character === "\\") {
			// Skip the escaped character: \{ \} \\ all stop being structural.
			i++;
			continue;
		}
		if (character === "{") {
			depth++;
		} else if (character === "}") {
			depth--;
			if (depth === 0) return i;
		}
	}
	return -1;
}

/**
 * First `\mirrorh{...}` / `\mirrorv{...}` / `\mirrorhv{...}` occurrence in `tex`
 * (at or after `from`), with its balanced argument already extracted.
 */
export function findMirrorMacro(tex: string, from = 0): MirrorMacroMatch | null {
	MACRO_PATTERN.lastIndex = from;
	let match: RegExpExecArray | null;
	while ((match = MACRO_PATTERN.exec(tex)) !== null) {
		// `\\mirrorh{...}` is an escaped backslash followed by plain text, not a macro.
		if (match.index > 0 && tex[match.index - 1] === "\\") continue;
		const axis = axisForMacro(match[1]);
		if (axis === null) continue;
		const open = match.index + match[0].length - 1;
		const close = findClosingBrace(tex, open);
		if (close === -1) continue;
		return {
			name: match[1],
			axis,
			inner: tex.slice(open + 1, close),
			start: match.index,
			end: close + 1,
		};
	}
	return null;
}

/** `true` when `tex` uses one of the mirror macros with a valid argument. */
export function containsMirrorMacro(tex: string): boolean {
	return findMirrorMacro(tex) !== null;
}

/** `true` when a macro *name* appears at all, even with a broken argument. */
export function containsMirrorMacroName(tex: string): boolean {
	MACRO_NAME_PATTERN.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = MACRO_NAME_PATTERN.exec(tex)) !== null) {
		if (match.index > 0 && tex[match.index - 1] === "\\") continue;
		return true;
	}
	return false;
}

/**
 * Match only when a single mirror macro wraps the whole formula (surrounding
 * whitespace allowed).
 */
export function parseWholeMirror(tex: string): MirrorMacroMatch | null {
	const match = findMirrorMacro(tex);
	if (match === null) return null;
	if (tex.slice(0, match.start).trim() !== "") return null;
	if (tex.slice(match.end).trim() !== "") return null;
	return match;
}

/** Peel off every whole-formula mirror wrapper, composing their axes. */
export function unwrapMirror(tex: string): UnwrappedMirror | null {
	let axis: MirrorAxis | null = null;
	let inner = tex;
	let depth = 0;
	for (let i = 0; i < MAX_NESTING; i++) {
		const match = parseWholeMirror(inner);
		if (match === null) break;
		axis = combineAxes(axis, match.axis);
		inner = match.inner;
		depth++;
	}
	if (depth === 0) return null;
	return { axis, inner, depth };
}

/**
 * Rewrite every mirror macro in `tex` to `\class{mjx-mirror-…}{…}`.
 *
 * A macro whose argument is itself one macro chain is folded into a single class
 * (`\mirrorh{\mirrorv{x}}` -> one `mjx-mirror-hv`), because MathJax attaches
 * `\class` to the argument's own wrapper element: two nested classes on the same
 * element would not compose. Reflections on *different* elements (the usual
 * partial case) compose through CSS.
 */
export function rewriteMirrorMacros(tex: string): string {
	let output = "";
	let index = 0;
	for (let guard = 0; guard < MAX_NESTING; guard++) {
		const match = findMirrorMacro(tex, index);
		if (match === null) break;
		output += tex.slice(index, match.start);

		let axis: MirrorAxis | null = match.axis;
		let inner = match.inner;
		// Fold wrappers that make up the entire argument.
		for (let i = 0; i < MAX_NESTING; i++) {
			const nested = parseWholeMirror(inner);
			if (nested === null) break;
			axis = combineAxes(axis, nested.axis);
			inner = nested.inner;
		}

		const rewritten = rewriteMirrorMacros(inner);
		output += axis === null ? rewritten : `\\class{${texClassForAxis(axis)}}{${rewritten}}`;
		index = match.end;
	}
	return output + tex.slice(index);
}

export interface SplitSource {
	/** Leading whitespace plus the opening delimiter, e.g. `"  \\("`. */
	open: string;
	/** The bare TeX between the delimiters. */
	body: string;
	/** The closing delimiter plus trailing whitespace, e.g. `"\\)  "`. */
	close: string;
}

const DELIMITER_PAIRS: ReadonlyArray<readonly [string, string]> = [
	["$$", "$$"],
	["$", "$"],
	["\\[", "\\]"],
	["\\(", "\\)"],
];

/** Split `$...$`, `$$...$$`, `\(...\)` or `\[...\]` into open / body / close. */
export function splitMathDelimiters(raw: string): SplitSource {
	const leadMatch = /^\s*/.exec(raw);
	const trailMatch = /\s*$/.exec(raw);
	const lead = leadMatch ? leadMatch[0] : "";
	const trail = trailMatch ? trailMatch[0] : "";
	const core = raw.slice(lead.length, raw.length - trail.length);
	for (const [open, close] of DELIMITER_PAIRS) {
		if (
			core.length >= open.length + close.length &&
			core.startsWith(open) &&
			core.endsWith(close)
		) {
			return {
				open: lead + open,
				body: core.slice(open.length, core.length - close.length),
				close: close + trail,
			};
		}
	}
	return { open: lead, body: core, close: trail };
}

/** Strip `$`, `$$`, `\(...\)` and `\[...\]` wrappers from a math snippet. */
export function stripMathDelimiters(raw: string): string {
	return splitMathDelimiters(raw).body;
}

/**
 * Decide what to do with a math snippet: which reflection applies to the whole
 * formula, and which TeX to hand to MathJax.
 *
 * @returns `null` when the snippet uses no mirror macro.
 */
export function planFormula(raw: string): MirrorPlan | null {
	const { open, body, close } = splitMathDelimiters(raw);
	if (!containsMirrorMacro(body)) return null;

	const whole = unwrapMirror(body);
	if (whole !== null) {
		// The wrapper is applied to the rendered formula element, so it is removed
		// from the TeX; anything nested deeper still goes through \class.
		return {
			axis: whole.axis,
			tex: open + rewriteMirrorMacros(whole.inner) + close,
			mirrored: true,
		};
	}

	const rewritten = rewriteMirrorMacros(body);
	return {
		axis: null,
		tex: open + rewritten + close,
		mirrored: rewritten !== body,
	};
}
