/**
 * Reading view tests: run the real pipeline against the exact DOM shape
 * Obsidian's markdown renderer produces, in jsdom.
 *
 * Obsidian's tokenizer already strips the `$` delimiters, so the element text is
 * the bare TeX - but the parser accepts both forms, and both are covered here.
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

const {
	MIRROR_AXIS_ATTR,
	findMathHolders,
	isMirrored,
	isTypeset,
	markMirror,
	mirrorMathIn,
} = await import("./.build/math-dom.mjs");

function container(html) {
	const element = window.document.createElement("div");
	element.innerHTML = html;
	return element;
}

function classesOf(element) {
	return [...element.classList].filter((name) => name.startsWith("math-mirror")).sort();
}

test("inline math loses the macro and is marked inline", () => {
	// Obsidian's DOM: the text content is the TeX without `$`.
	const root = container('<span class="math math-inline">\\mirrorh{x}</span>');
	assert.equal(mirrorMathIn(root), 1);

	const span = root.querySelector("span.math");
	assert.equal(span.textContent, "x", "bare formula handed to MathJax");
	assert.equal(span.getAttribute(MIRROR_AXIS_ATTR), "h");
	assert.deepEqual(classesOf(span), ["math-mirror", "math-mirror-h", "math-mirror-inline"]);
	assert.equal(isMirrored(span), true);
});

test("display math is marked block, even when written inline", () => {
	const fenced = container('<div class="math math-block">\\mirrorv{\\frac{a}{b}}</div>');
	mirrorMathIn(fenced);
	const div = fenced.querySelector("div.math");
	assert.equal(div.textContent, "\\frac{a}{b}");
	assert.deepEqual(classesOf(div), ["math-mirror", "math-mirror-block", "math-mirror-v"]);

	// `$$...$$` written inside a paragraph also yields a `span.math.math-block`.
	const inline = container('<span class="math math-block">\\mirrorh{\\sum_i x_i}</span>');
	mirrorMathIn(inline);
	const span = inline.querySelector("span.math");
	assert.deepEqual(classesOf(span), ["math-mirror", "math-mirror-block", "math-mirror-h"]);
	assert.equal(span.textContent, "\\sum_i x_i");
});

test("nested macros compose into both axes", () => {
	const root = container('<span class="math math-inline">\\mirrorh{\\mirrorv{x}}</span>');
	mirrorMathIn(root);
	const span = root.querySelector("span.math");
	assert.equal(span.getAttribute(MIRROR_AXIS_ATTR), "hv");
	assert.deepEqual(classesOf(span), [
		"math-mirror",
		"math-mirror-h",
		"math-mirror-inline",
		"math-mirror-v",
	]);
});

test("delimiters are accepted and preserved when present", () => {
	const root = container(
		'<span class="math math-inline">$\\mirrorh{x}$</span>' +
			'<div class="math math-block">$$\\mirrorv{\\sqrt{y}}$$</div>',
	);
	assert.equal(mirrorMathIn(root), 2);
	assert.equal(root.querySelector("span.math").textContent, "$x$");
	assert.equal(root.querySelector("div.math").textContent, "$$\\sqrt{y}$$");
});

test("TeX characters survive the rewrite", () => {
	const root = container('<span class="math math-inline">\\mirrorh{a &amp; b &lt; c}</span>');
	mirrorMathIn(root);
	const span = root.querySelector("span.math");
	// textContent is decoded, and re-serialising escapes it again.
	assert.equal(span.textContent, "a & b < c");
	assert.equal(span.innerHTML, "a &amp; b &lt; c");
});

test("plain math is left alone", () => {
	const root = container('<span class="math math-inline">x + y</span>');
	assert.equal(mirrorMathIn(root), 0);
	const span = root.querySelector("span.math");
	assert.equal(span.textContent, "x + y");
	assert.equal(span.className, "math math-inline");
	assert.equal(isMirrored(span), false);
});

test("a macro inside a larger formula is rewritten for MathJax", () => {
	const root = container('<span class="math math-inline">\\mirrorh{x} + y</span>');
	assert.equal(mirrorMathIn(root), 1);

	const span = root.querySelector("span.math");
	// MathJax's Safe extension lets `mjx-` classes through, and \class puts the
	// class on the argument's own wrapper element, so a partial mirror needs no
	// element level reflection at all.
	assert.equal(span.textContent, "\\class{mjx-mirror-h}{x} + y");
	assert.equal(isMirrored(span), false);
});

test("partial rewriting keeps the delimiters it was given", () => {
	const root = container('<span class="math math-inline">$\\mirrorv{x} + y$</span>');
	mirrorMathIn(root);
	assert.equal(root.querySelector("span.math").textContent, "$\\class{mjx-mirror-v}{x} + y$");
});

test("an outer wrapper reflects the element, inner macros become classes", () => {
	const root = container('<span class="math math-inline">\\mirrorh{a + \\mirrorv{b}}</span>');
	mirrorMathIn(root);

	const span = root.querySelector("span.math");
	assert.equal(span.textContent, "a + \\class{mjx-mirror-v}{b}");
	assert.equal(span.getAttribute(MIRROR_AXIS_ATTR), "h");
	assert.deepEqual(classesOf(span), ["math-mirror", "math-mirror-h", "math-mirror-inline"]);
});

test("a cancelling wrapper is removed without reflecting anything", () => {
	const root = container('<span class="math math-inline">\\mirrorh{\\mirrorh{x}}</span>');
	mirrorMathIn(root);

	const span = root.querySelector("span.math");
	assert.equal(span.textContent, "x");
	assert.equal(isMirrored(span), false);
});

test("a macro without a valid argument is reported and left alone", () => {
	const problems = [];
	const root = container('<span class="math math-inline">\\mirrorh{x</span>');
	assert.equal(mirrorMathIn(root, { onProblem: (message) => problems.push(message) }), 0);

	const span = root.querySelector("span.math");
	assert.equal(span.textContent, "\\mirrorh{x", "source untouched");
	assert.equal(isMirrored(span), false);
	assert.equal(problems.length, 1);
	assert.match(problems[0], /without a valid \{argument\}/);
});

test("already typeset math is skipped instead of guessed", () => {
	// Nothing about the original TeX is left in MathJax's output.
	const root = container(
		'<span class="math math-inline is-loaded"><mjx-container><mjx-math>x</mjx-math></mjx-container></span>',
	);
	assert.equal(isTypeset(root.querySelector("span.math")), true);
	assert.equal(mirrorMathIn(root), 0);
	assert.equal(root.querySelector("span.math").className, "math math-inline is-loaded");
});

test("mirroring is idempotent", () => {
	const root = container('<span class="math math-inline">\\mirrorh{x}</span>');
	mirrorMathIn(root);
	const span = root.querySelector("span.math");
	const afterFirstPass = span.outerHTML;

	// The second pass no longer sees a macro (it was stripped), and it must not
	// undo the mirror that is already applied.
	assert.equal(mirrorMathIn(root), 0);
	assert.equal(span.outerHTML, afterFirstPass, "nothing changed on the second pass");
	assert.equal(isMirrored(span), true);
});

test("findMathHolders only returns outermost elements", () => {
	const root = container(
		'<div class="markdown-rendered"><span class="math math-inline">x</span>' +
			'<span class="math math-inline">y</span></div>',
	);
	const holders = findMathHolders(root);
	assert.equal(holders.length, 2);
	for (const holder of holders) assert.equal(holder.tagName, "SPAN");
});

test("an element can be marked directly, which is what Live Preview uses", () => {
	const span = window.document.createElement("span");
	span.className = "math";
	markMirror(span, "v", false);
	assert.deepEqual(classesOf(span), ["math-mirror", "math-mirror-inline", "math-mirror-v"]);
	markMirror(span, "hv", true);
	assert.deepEqual(classesOf(span), [
		"math-mirror",
		"math-mirror-block",
		"math-mirror-h",
		"math-mirror-v",
	]);
});
