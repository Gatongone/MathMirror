/**
 * Rescue pass: mirror formulas that somebody else rendered.
 *
 * Anything that calls Obsidian's `renderMath` directly bypasses this plugin -
 * LaTeX Suite's math popup preview, other plugins' previews, and Obsidian's own
 * math renderer when it typeset a formula before the markdown post processor saw
 * it. In all of those the mirror macro reaches MathJax, which does not know it,
 * and MathJax's `noundefined` extension renders the name in red:
 *
 *   <mjx-mtext style="color: red"><mjx-c class="mjx-c5C"></mjx-c>…</mjx-mtext>
 *   <mjx-texatom texclass="ORD">…the {argument}…</mjx-texatom>
 *
 * MathJax's CHTML output contains no text (glyphs are CSS drawn), so the macro
 * name is decoded from the `mjx-cXXXX` glyph classes, and the argument is the
 * element right after the error node - a braced TeX argument always renders as
 * its own `mjx-texatom` group.
 *
 * The rescue then removes the bogus red text and puts the mirror class on that
 * group, which is exactly what the `\class{mjx-mirror-…}` route does. Everything
 * else is left alone: other undefined macros, a macro written without braces and
 * a bare macro name all keep their error rendering, because they are not mirror
 * requests this plugin can honour.
 *
 * Verified against the shapes Obsidian's bundled MathJax 3.2.2 produces.
 */

import { MirrorAxis, axisForMacro, texClassForAxis } from "./mirror";

/** The red text MathJax emits for an unknown macro. */
const RED_ERROR_SELECTOR = '[style*="color: red" i]';
/** `<mjx-c class="mjx-c5C">` -> 0x5c -> "\\" */
const GLYPH_CLASS_PATTERN = /(?:^|\s)mjx-c([0-9A-Fa-f]+)(?:\s|$)/;
/** A braced argument always renders as its own group element. */
const ARGUMENT_TAG = "mjx-texatom";
/**
 * Wrappers that a script can attach to the argument. `\mirrorh{x}_i` renders the
 * group as the *base* inside `<mjx-msub>`, so the group has to be looked up one
 * level down. Only these are entered; anything else means "no braced argument".
 */
const SCRIPT_WRAPPERS = new Set([
	"mjx-msub",
	"mjx-msup",
	"mjx-msubsup",
	"mjx-munder",
	"mjx-mover",
	"mjx-munderover",
	"mjx-mmultiscripts",
]);
/** How far down a script chain we are willing to look. */
const MAX_WRAPPER_DEPTH = 4;

/**
 * Rebuild the text of a rendered MathJax element from its glyph classes.
 * The DOM itself carries no text: CHTML draws each character with CSS.
 */
export function decodeMathJaxGlyphs(element: Element): string {
	let text = "";
	for (const glyph of Array.from(element.querySelectorAll("mjx-c"))) {
		const match = GLYPH_CLASS_PATTERN.exec(glyph.getAttribute("class") ?? "");
		if (match !== null) text += String.fromCodePoint(Number.parseInt(match[1], 16));
	}
	return text;
}

/** The axis an undefined-macro error node asks for, or `null` if it is not ours. */
export function mirrorAxisOfErrorNode(node: Element): MirrorAxis | null {
	const name = decodeMathJaxGlyphs(node);
	if (!name.startsWith("\\")) return null;
	return axisForMacro(name.slice(1));
}

/**
 * The rendered group of the macro's braced argument: the element after the error
 * node, or - when a script is attached to it (`\mirrorh{x}_i`) - the base inside
 * the script wrapper. Only the group is reflected, so an attached subscript stays
 * where it belongs.
 */
export function findArgumentGroup(node: Element): HTMLElement | null {
	let candidate: Element | null = node.nextElementSibling;
	for (let depth = 0; candidate !== null && depth < MAX_WRAPPER_DEPTH; depth++) {
		const tag = candidate.tagName.toLowerCase();
		if (tag === ARGUMENT_TAG) return candidate as HTMLElement;
		if (!SCRIPT_WRAPPERS.has(tag)) return null;
		candidate = candidate.firstElementChild;
	}
	return null;
}

/**
 * `true` for math the Live Preview path owns: a math widget inside an editor.
 * Those are handled there (and left alone entirely when the setting is off).
 */
function isEditorMathWidget(node: Element): boolean {
	return node.closest(".cm-editor") !== null && node.closest(".math") !== null;
}

/**
 * Repair wrongly rendered mirror macros inside `root`.
 *
 * @returns how many formulas were rescued.
 */
export function rescueMirroredMath(root: Element): number {
	const candidates = Array.from(root.querySelectorAll<HTMLElement>(RED_ERROR_SELECTOR));
	if (root.matches(RED_ERROR_SELECTOR)) candidates.push(root as HTMLElement);

	let rescued = 0;
	for (const errorNode of candidates) {
		const axis = mirrorAxisOfErrorNode(errorNode);
		if (axis === null) continue;
		if (isEditorMathWidget(errorNode)) continue;

		const wrapper = errorNode.nextElementSibling;
		const group = findArgumentGroup(errorNode);
		// No group means the macro was written without braces: not a mirror request.
		if (wrapper === null || group === null) continue;

		// The error node carried the operator spacing that belongs before the
		// argument; hand it over so the formula still looks right.
		const space = errorNode.getAttribute("space");
		if (space !== null && !wrapper.hasAttribute("space")) {
			wrapper.setAttribute("space", space);
		}

		group.classList.add(texClassForAxis(axis));
		errorNode.remove();
		rescued++;
	}
	return rescued;
}
