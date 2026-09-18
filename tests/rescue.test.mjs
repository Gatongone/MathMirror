/**
 * Rescue pass tests, built from the exact DOM shapes Obsidian's bundled MathJax
 * 3.2.2 produces for an undefined macro (captured in headless Chromium).
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>");
const { window } = dom;

globalThis.window = window;
globalThis.document = window.document;
globalThis.Node = window.Node;
globalThis.Element = window.Element;
globalThis.HTMLElement = window.HTMLElement;

const { decodeMathJaxGlyphs, findArgumentGroup, mirrorAxisOfErrorNode, rescueMirroredMath } =
	await import("./.build/rescue.mjs");

/** `<mjx-c class="mjx-c5C">` for each character of `text`. */
function glyphs(text) {
	return Array.from(text)
		.map((character) => {
			const hex = character.codePointAt(0).toString(16).toUpperCase();
			return `<mjx-c class="mjx-c${hex}"></mjx-c>`;
		})
		.join("");
}

/** The red error node MathJax emits for an unknown macro. */
function errorNode(name, attributes = "") {
	return `<mjx-mtext class="mjx-n"${attributes} style="color: red;">${glyphs(name)}</mjx-mtext>`;
}

/** A braced argument always renders as its own group element. */
function group(html) {
	return `<mjx-texatom texclass="ORD">${html}</mjx-texatom>`;
}

function container(html) {
	const root = window.document.createElement("div");
	root.innerHTML = `<mjx-container>${html}</mjx-container>`;
	return root;
}

function mirrorClasses(element) {
	return [...element.classList].filter((name) => name.startsWith("mjx-mirror-"));
}

test("decodes a rendered macro name from its glyph classes", () => {
	const node = container(errorNode("\\mirrorh") + group("<mjx-mi></mjx-mi>"));
	const error = node.querySelector("mjx-mtext");
	assert.equal(decodeMathJaxGlyphs(error), "\\mirrorh");
	assert.equal(mirrorAxisOfErrorNode(error), "h");
	assert.equal(mirrorAxisOfErrorNode(container(errorNode("\\foo")).querySelector("mjx-mtext")), null);
});

test("a whole-formula macro has its red text removed and the group mirrored", () => {
	const root = container(errorNode("\\mirrorv") + group("<mjx-mfrac></mjx-mfrac>"));
	assert.equal(rescueMirroredMath(root), 1);

	const containerEl = root.querySelector("mjx-container");
	assert.equal(containerEl.querySelector('[style*="color: red" i]'), null, "red text gone");
	const groupEl = containerEl.querySelector("mjx-texatom");
	assert.deepEqual(mirrorClasses(groupEl), ["mjx-mirror-v"]);
	assert.ok(groupEl.querySelector("mjx-mfrac"), "the argument itself is untouched");
});

test("a partial macro only mirrors its own group and keeps operator spacing", () => {
	const root = container(
		'<mjx-mi class="mjx-i"></mjx-mi><mjx-mo space="3"></mjx-mo>' +
			errorNode("\\mirrorh", ' space="3"') +
			group("<mjx-mfrac></mjx-mfrac>") +
			'<mjx-mo space="3"></mjx-mo><mjx-mi class="mjx-i"></mjx-mi>',
	);
	assert.equal(rescueMirroredMath(root), 1);

	const containerEl = root.querySelector("mjx-container");
	const groupEl = containerEl.querySelector("mjx-texatom");
	assert.deepEqual(mirrorClasses(groupEl), ["mjx-mirror-h"]);
	assert.equal(groupEl.getAttribute("space"), "3", "spacing transferred to the argument");
	assert.equal(containerEl.querySelectorAll("mjx-mo").length, 2, "other siblings untouched");
});

test("nested macros each mirror their own group", () => {
	const root = container(errorNode("\\mirrorh") + group(errorNode("\\mirrorv") + group("<mjx-mi></mjx-mi>")));
	assert.equal(rescueMirroredMath(root), 2);

	const groups = root.querySelectorAll("mjx-texatom");
	assert.deepEqual(mirrorClasses(groups[0]), ["mjx-mirror-h"]);
	assert.deepEqual(mirrorClasses(groups[1]), ["mjx-mirror-v"]);
	assert.equal(root.querySelector('[style*="color: red" i]'), null);
});

test("two macros in one formula are both rescued", () => {
	const root = container(
		errorNode("\\mirrorh") + group("<mjx-mi></mjx-mi>") + errorNode("\\mirrorv") + group("<mjx-mi></mjx-mi>"),
	);
	assert.equal(rescueMirroredMath(root), 2);
	assert.deepEqual(mirrorClasses(root.querySelectorAll("mjx-texatom")[0]), ["mjx-mirror-h"]);
	assert.deepEqual(mirrorClasses(root.querySelectorAll("mjx-texatom")[1]), ["mjx-mirror-v"]);
});

test("other undefined macros are left alone", () => {
	const root = container(errorNode("\\foo") + group("<mjx-mi></mjx-mi>"));
	assert.equal(rescueMirroredMath(root), 0);
	assert.ok(root.querySelector('[style*="color: red" i]'), "the error is still reported");
	assert.equal(root.querySelector("mjx-texatom").className, "");
});

test("a macro without braces keeps its error rendering", () => {
	// `\mirrorh x` renders the next symbol instead of a group.
	const root = container(errorNode("\\mirrorh") + '<mjx-mi class="mjx-i"></mjx-mi>');
	assert.equal(rescueMirroredMath(root), 0);
	assert.equal(root.querySelector('[style*="color: red" i]').textContent, "");
	assert.equal(root.querySelector("mjx-mi").className, "mjx-i");
});

test("a script attached to the argument mirrors the group, not the script", () => {
	// `\mirrorh{\mathcal{f}}_x` renders as <mjx-msub><mjx-texatom>…</mjx-texatom><mjx-script>…
	const root = container(
		errorNode("\\mirrorh", ' space="3"') +
			'<mjx-msub><mjx-texatom texclass="ORD"><mjx-mi class="mjx-cal mjx-i"></mjx-mi></mjx-texatom>' +
			'<mjx-script style="vertical-align: -0.357em;"><mjx-mi class="mjx-i"></mjx-mi></mjx-script></mjx-msub>',
	);
	assert.equal(rescueMirroredMath(root), 1);

	const subscript = root.querySelector("mjx-msub");
	assert.deepEqual(mirrorClasses(root.querySelector("mjx-texatom")), ["mjx-mirror-h"]);
	assert.deepEqual(mirrorClasses(subscript), [], "the script wrapper itself is not mirrored");
	assert.equal(subscript.getAttribute("space"), "3", "spacing moved to the whole construct");
	assert.equal(root.querySelector('[style*="color: red" i]'), null);
});

test("superscripts, primes and double scripts are handled the same way", () => {
	for (const [wrapper, source] of [
		["mjx-msup", "\\mirrorh{x}^2"],
		["mjx-msup", "\\mirrorh{x}'"],
		["mjx-msubsup", "\\mirrorh{x}_i^j"],
		["mjx-munder", "\\mirrorh{\\sum}_i"],
	]) {
		const root = container(
			errorNode("\\mirrorv") +
				`<${wrapper}><mjx-texatom texclass="ORD"><mjx-mi></mjx-mi></mjx-texatom>` +
				`<mjx-script></mjx-script></${wrapper}>`,
		);
		assert.equal(rescueMirroredMath(root), 1, source);
		assert.deepEqual(mirrorClasses(root.querySelector("mjx-texatom")), ["mjx-mirror-v"], source);
	}
});

test("a script wrapper without an argument group is left alone", () => {
	// e.g. `\mirrorh x^2`: the base is a plain symbol, not a braced group.
	const root = container(
		errorNode("\\mirrorh") + '<mjx-msup><mjx-mi class="mjx-i"></mjx-mi><mjx-script></mjx-script></mjx-msup>',
	);
	assert.equal(rescueMirroredMath(root), 0);
	assert.ok(root.querySelector('[style*="color: red" i]'));
	assert.equal(findArgumentGroup(root.querySelector("mjx-mtext")), null);
});

test("a bare macro name keeps its error rendering", () => {
	const root = container(errorNode("\\mirrorh"));
	assert.equal(rescueMirroredMath(root), 0);
	assert.ok(root.querySelector('[style*="color: red" i]'));
});

test("Live Preview math widgets are left to the editor path", () => {
	const root = window.document.createElement("div");
	root.innerHTML =
		'<div class="cm-editor"><div class="cm-content">' +
		`<span class="math">${errorNode("\\mirrorh")}${group("<mjx-mi></mjx-mi>")}</span>` +
		"</div></div>";
	assert.equal(rescueMirroredMath(root), 0, "editor widgets belong to live-preview.ts");
	assert.ok(root.querySelector('[style*="color: red" i]'));
});

test("a rendered popup inside an editor is rescued", () => {
	// Like LaTeX Suite's math preview: inside the editor, but not a math widget.
	const root = window.document.createElement("div");
	root.innerHTML =
		'<div class="cm-editor"><div class="cm-tooltip">' +
		`<mjx-container>${errorNode("\\mirrorh")}${group("<mjx-mfrac></mjx-mfrac>")}</mjx-container>` +
		"</div></div>";
	assert.equal(rescueMirroredMath(root), 1);
	assert.deepEqual(mirrorClasses(root.querySelector("mjx-texatom")), ["mjx-mirror-h"]);
});

test("rescuing is idempotent and ignores clean math", () => {
	const root = container(errorNode("\\mirrorh") + group("<mjx-mi></mjx-mi>"));
	assert.equal(rescueMirroredMath(root), 1);
	assert.equal(rescueMirroredMath(root), 0);
	assert.equal(rescueMirroredMath(container("<mjx-mi></mjx-mi>")), 0);
});

test("the error node itself can be the scanned root", () => {
	const error = container(errorNode("\\mirrorh") + group("<mjx-mi></mjx-mi>")).querySelector(
		'mjx-mtext[style*="color: red" i]',
	);
	assert.equal(rescueMirroredMath(error), 1);
});
