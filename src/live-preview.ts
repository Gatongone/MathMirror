/**
 * Live Preview support.
 *
 * In Live Preview, Obsidian renders math with a CodeMirror widget: the widget
 * element is `span.math` (or `div.math.math-block.cm-embed-block`), it holds the
 * TeX only in a JavaScript property, and its DOM contains nothing but MathJax
 * output. Markdown post processors never run for editor content, so the reading
 * view approach cannot be reused here.
 *
 * This module therefore post-processes Obsidian's own widget:
 *
 *   1. locate the widget element (`span.math` / `div.math` inside the editor),
 *   2. map it back to the document with `view.posAtDOM` and read the `$...$`
 *      source from the document - the only place the TeX still exists,
 *   3. if that source uses a mirror macro, re-render the MathJax output from the
 *      rewritten TeX (`planFormula`) and, for whole-formula macros, mark the
 *      widget for the CSS reflection.
 *
 * Nothing is replaced through CodeMirror decorations: Obsidian's widget stays in
 * charge of layout, the edit button and click handling, only its math output is
 * swapped. The module takes Obsidian's `renderMath`/`loadMathJax` by injection so
 * it stays testable without the Obsidian runtime.
 */

import { EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";

import {
	MIRROR_AXIS_ATTR,
	MIRROR_BLOCK_CLASS,
	MIRROR_CLASS,
	MIRROR_INLINE_CLASS,
	markMirror,
} from "./math-dom";
import {
	MirrorPlan,
	containsMirrorMacroName,
	planFormula,
	stripMathDelimiters,
} from "./mirror";

/** Selector for the classes MathJax emits for `\class{mjx-mirror-…}{…}`. */
const TEX_MIRROR_SELECTOR = '[class*="mjx-mirror-"]';

export interface LivePreviewHost {
	/** Obsidian's `renderMath`. */
	renderMath: (latex: string, display: boolean) => HTMLElement;
	/** Obsidian's `finishRenderMath`, called after inserting fresh output. */
	finishRenderMath?: () => unknown;
	/** Obsidian's `loadMathJax`, used when MathJax is not loaded yet. */
	loadMathJax: () => Promise<unknown>;
	/** Whether Live Preview mirroring is currently enabled in the settings. */
	enabled: () => boolean;
	/** Diagnostic hook. */
	onProblem?: (message: string, element: Element) => void;
}

/** Longest formula we are willing to scan for, in characters. */
const MAX_MATH_LENGTH = 20000;

/**
 * The maths source at a widget's document position, when that position really
 * starts a `$...$` or `$$...$$` formula.
 */
export function readMathSource(
	view: EditorView,
	widget: HTMLElement,
): { text: string; display: boolean } | null {
	let pos: number;
	try {
		pos = view.posAtDOM(widget);
	} catch {
		return null;
	}
	const doc = view.state.doc;
	if (!Number.isFinite(pos) || pos < 0 || pos > doc.length) return null;

	const delimiter = doc.sliceString(pos, Math.min(doc.length, pos + 2)).startsWith("$$")
		? "$$"
		: doc.sliceString(pos, Math.min(doc.length, pos + 1)) === "$"
			? "$"
			: null;
	if (delimiter === null) return null;

	const end = findClosingDelimiter(view, pos, delimiter);
	if (end === null) return null;
	return { text: doc.sliceString(pos, end), display: delimiter === "$$" };
}

/** Index just past the `$`/`$$` that closes the formula opened at `start`. */
function findClosingDelimiter(view: EditorView, start: number, delimiter: string): number | null {
	const doc = view.state.doc;
	const text = doc.sliceString(start, Math.min(doc.length, start + MAX_MATH_LENGTH));
	let index = delimiter.length;
	while (index < text.length) {
		const character = text[index];
		if (character === "\\") {
			// Skip the escaped character (`\$` is not a closing delimiter).
			index += 2;
			continue;
		}
		if (character === "$" && (delimiter === "$" || text[index + 1] === "$")) {
			return start + index + delimiter.length;
		}
		index++;
	}
	return null;
}

/** Put fresh MathJax output where the old container was, keeping layout children. */
function replaceMathOutput(widget: HTMLElement, rendered: HTMLElement): void {
	let inserted = false;
	for (const child of Array.from(widget.childNodes)) {
		const isContainer =
			child.nodeType === Node.ELEMENT_NODE &&
			(child as Element).tagName.toLowerCase() === "mjx-container";
		if (isContainer) {
			if (inserted) child.remove();
			else {
				child.replaceWith(rendered);
				inserted = true;
			}
			continue;
		}
		// Obsidian falls back to plain text when MathJax throws; drop that.
		if (child.nodeType === Node.TEXT_NODE && (child.textContent ?? "").trim() !== "") {
			child.remove();
		}
	}
	if (!inserted) widget.appendChild(rendered);
}

function tryRender(host: LivePreviewHost, tex: string, display: boolean): HTMLElement | null {
	try {
		return host.renderMath(tex, display);
	} catch {
		return null;
	}
}

/** `true` when the widget already shows our mirrored output. */
function isMirrorRendered(widget: HTMLElement, plan: MirrorPlan): boolean {
	if (widget.querySelector("mjx-container") === null) return false;
	if (plan.axis !== null) return widget.getAttribute(MIRROR_AXIS_ATTR) === plan.axis;
	// Partial reflection: the proof is in the rendered MathJax classes.
	return widget.querySelector(TEX_MIRROR_SELECTOR) !== null;
}

function mirrorWidget(
	widget: HTMLElement,
	display: boolean,
	plan: MirrorPlan,
	host: LivePreviewHost,
): void {
	if (plan.axis !== null) markMirror(widget, plan.axis, display);

	const rendered = tryRender(host, plan.tex, display);
	if (rendered !== null) {
		replaceMathOutput(widget, rendered);
		host.finishRenderMath?.();
		return;
	}

	// MathJax is still loading. Its own continuation for this widget was queued
	// before ours, so re-rendering once the loader resolves is the correct order.
	void host
		.loadMathJax()
		.then(() => {
			if (!widget.isConnected) return;
			const later = tryRender(host, plan.tex, display);
			if (later === null) return;
			replaceMathOutput(widget, later);
			host.finishRenderMath?.();
		})
		.catch(() => undefined);
}

/** Mirror every math widget in the editor that asks for it. */
export function applyLivePreviewMirrors(view: EditorView, host: LivePreviewHost): void {
	if (!host.enabled()) return;

	for (const widget of Array.from(view.contentDOM.querySelectorAll<HTMLElement>(".math"))) {
		// Markdown sub-renders inside the editor (callouts, table cells) carry
		// `.markdown-rendered` and are handled by the markdown post processor.
		if (widget.closest(".markdown-rendered") !== null) continue;

		const source = readMathSource(view, widget);
		if (source === null) continue;

		// The document source includes the delimiters; `renderMath` wants bare TeX.
		const body = stripMathDelimiters(source.text);
		const plan = planFormula(body);
		if (plan === null) {
			if (containsMirrorMacroName(body)) {
				host.onProblem?.(`Mirror macro without a valid {argument}: ${source.text}`, widget);
			}
			continue;
		}
		if (!plan.mirrored) continue;
		if (isMirrorRendered(widget, plan)) continue;

		mirrorWidget(widget, source.display, plan, host);
	}
}

/** Drop the reflection from every Live Preview formula in the editor. */
export function clearLivePreviewMirrors(view: EditorView): void {
	for (const widget of Array.from(
		view.contentDOM.querySelectorAll<HTMLElement>(`.${MIRROR_CLASS}`),
	)) {
		widget.classList.remove(
			MIRROR_CLASS,
			MIRROR_INLINE_CLASS,
			MIRROR_BLOCK_CLASS,
			"math-mirror-h",
			"math-mirror-v",
		);
		widget.removeAttribute(MIRROR_AXIS_ATTR);
	}
}

/** Re-run the mirror pass for one editor (used when settings change). */
export function refreshLivePreview(view: EditorView, host: LivePreviewHost): void {
	view.requestMeasure({
		read: () => undefined,
		write: () => {
			if (view.dom.isConnected) applyLivePreviewMirrors(view, host);
		},
	});
}

/** CodeMirror extension that keeps Live Preview math mirrored. */
export function createLivePreviewExtension(host: LivePreviewHost) {
	return ViewPlugin.fromClass(
		class {
			private readonly view: EditorView;
			private destroyed = false;

			constructor(view: EditorView) {
				this.view = view;
				this.schedule();
			}

			update(update: ViewUpdate): void {
				if (
					update.docChanged ||
					update.viewportChanged ||
					update.geometryChanged ||
					update.selectionSet
				) {
					this.schedule();
				}
			}

			destroy(): void {
				this.destroyed = true;
			}

			private schedule(): void {
				if (this.destroyed) return;
				refreshLivePreview(this.view, host);
			}
		},
	);
}
