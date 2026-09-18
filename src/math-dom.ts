/**
 * Shared DOM vocabulary for mirrored math, plus the Reading view pipeline.
 *
 * Obsidian renders `$...$` into a `.math` element whose *text content* is the
 * bare TeX (Obsidian's own tokenizer strips the `$` delimiters) and typesets it
 * later, in the same synchronous post-processor loop, by reading that text,
 * emptying the element and appending the MathJax output.
 *
 * Everything here therefore happens on the *raw* element, before MathJax runs:
 *
 *   - a macro wrapping the whole formula is peeled off and turns into the mirror
 *     classes on the element, so the CSS reflection applies to the rendered math;
 *   - a macro used inside a larger formula is rewritten to
 *     `\class{mjx-mirror-…}{…}`, which MathJax turns into a class on that part's
 *     wrapper element (see mirror.ts).
 *
 * This module imports nothing from Obsidian so it can be unit tested in jsdom.
 */

import {
	MirrorAxis,
	MirrorPlan,
	axisClasses,
	containsMirrorMacroName,
	planFormula,
} from "./mirror";

export const MIRROR_CLASS = "math-mirror";
export const MIRROR_INLINE_CLASS = "math-mirror-inline";
export const MIRROR_BLOCK_CLASS = "math-mirror-block";
export const MIRROR_AXIS_ATTR = "data-mirror-axis";

export interface MirrorRunOptions {
	/** Called when a formula mentions a mirror macro it cannot resolve. */
	onProblem?: (message: string, element: Element) => void;
}

interface MathHolderInfo {
	/** The element MathJax typesets, i.e. the one carrying `.math`. */
	holder: HTMLElement;
	/** TeX as written in the note, without the `$` delimiters. */
	source: string;
	/** `true` for display (block) math. */
	display: boolean;
}

const MATH_SELECTOR = ".math";

/** Class list that turns an element into a mirror target. */
export function mirrorClassesFor(axis: MirrorAxis, display: boolean): string[] {
	return [
		MIRROR_CLASS,
		...(display ? [MIRROR_BLOCK_CLASS] : [MIRROR_INLINE_CLASS]),
		...axisClasses(axis),
	];
}

/**
 * Mark an element as mirrored.
 *
 * The reflection itself is CSS, and `transform` does not apply to a plain inline
 * box - which is exactly what an inline `.math` span is - so the marked element
 * also gets an explicit transformable `display` (see styles.css). Display math
 * gets `display: block`, because `$$...$$` written inline produces a `span` too.
 */
export function markMirror(holder: HTMLElement, axis: MirrorAxis, display: boolean): void {
	holder.classList.remove(
		MIRROR_CLASS,
		MIRROR_INLINE_CLASS,
		MIRROR_BLOCK_CLASS,
		"math-mirror-h",
		"math-mirror-v",
	);
	holder.classList.add(...mirrorClassesFor(axis, display));
	holder.setAttribute(MIRROR_AXIS_ATTR, axis);
}

/** `true` when this plugin has already mirrored the element. */
export function isMirrored(holder: HTMLElement): boolean {
	return holder.classList.contains(MIRROR_CLASS) && holder.hasAttribute(MIRROR_AXIS_ATTR);
}

/** Every outermost `.math` element inside `root`. */
export function findMathHolders(root: Element): HTMLElement[] {
	const found: HTMLElement[] = [];
	if (root.matches(MATH_SELECTOR)) found.push(root as HTMLElement);
	for (const element of Array.from(root.querySelectorAll<HTMLElement>(MATH_SELECTOR))) {
		if (element.parentElement?.closest(MATH_SELECTOR) === null) found.push(element);
	}
	return found;
}

/** `true` once MathJax has produced output inside the element. */
export function isTypeset(holder: HTMLElement): boolean {
	return holder.querySelector("mjx-container") !== null;
}

function readHolder(holder: HTMLElement): MathHolderInfo | null {
	if (isTypeset(holder)) return null;
	const source = holder.textContent ?? "";
	if (source.trim() === "") return null;
	return {
		holder,
		source,
		// Both delimiters produce a `span`; only the class distinguishes them.
		display: holder.classList.contains("math-block"),
	};
}

/**
 * Mirror one still-unrendered math element if its TeX asks for it. Idempotent:
 * the second pass sees rewritten TeX and does nothing.
 *
 * @returns the plan that was applied, or `null` when nothing was mirrored.
 */
export function mirrorMathHolder(
	holder: HTMLElement,
	options: MirrorRunOptions = {},
): MirrorPlan | null {
	const info = readHolder(holder);
	if (info === null) return null;

	const plan = planFormula(info.source);
	if (plan === null) {
		if (containsMirrorMacroName(info.source)) {
			options.onProblem?.(
				`Mirror macro without a valid {argument}: ${info.source}`,
				holder,
			);
		}
		return null;
	}
	if (!plan.mirrored) return null;

	// Give MathJax the rewritten formula; it renders into this very element.
	if (info.source !== plan.tex) holder.textContent = plan.tex;
	if (plan.axis !== null) markMirror(holder, plan.axis, info.display);
	return plan;
}

/** Mirror every math element inside `root`. @returns how many were mirrored. */
export function mirrorMathIn(root: Element, options: MirrorRunOptions = {}): number {
	let mirrored = 0;
	for (const holder of findMathHolders(root)) {
		if (mirrorMathHolder(holder, options) !== null) mirrored++;
	}
	return mirrored;
}
