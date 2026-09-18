/**
 * Live Preview tests: a real CodeMirror 6 editor in jsdom, with a widget that
 * mimics Obsidian's math widget (a replace decoration over the whole `$...$`
 * range whose DOM is `span.math` / `div.math.math-block.cm-embed-block`).
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { EditorState } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
	pretendToBeVisual: true,
});
const { window } = dom;

globalThis.window = window;
globalThis.document = window.document;
globalThis.Node = window.Node;
globalThis.Element = window.Element;
globalThis.HTMLElement = window.HTMLElement;
globalThis.Window = window.Window;
globalThis.MutationObserver = window.MutationObserver;
globalThis.getComputedStyle = window.getComputedStyle.bind(window);
globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window);
globalThis.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);

const { applyLivePreviewMirrors, clearLivePreviewMirrors, createLivePreviewExtension, readMathSource } =
	await import("./.build/live-preview.mjs");

/** Stand-in for Obsidian's math widget. */
class FakeMathWidget extends WidgetType {
	constructor(source, block) {
		super();
		this.source = source;
		this.block = block;
	}
	eq(other) {
		return other.source === this.source && other.block === this.block;
	}
	toDOM() {
		const element = window.document.createElement(this.block ? "div" : "span");
		element.className = this.block ? "math math-block cm-embed-block" : "math";
		if (this.block) element.append(window.document.createElement("br"), window.document.createElement("br"));
		// What MathJax produces when the (undefined) macro reaches it.
		const container = window.document.createElement("mjx-container");
		container.textContent = `ERROR(${this.source})`;
		element.appendChild(container);
		return element;
	}
	ignoreEvent() {
		return false;
	}
}

/** Stand-in for Obsidian's math decoration: replace the whole `$...$` range. */
function fakeObsidianMath() {
	return EditorView.decorations.compute(["doc"], (state) => {
		const ranges = [];
		const text = state.doc.toString();
		const pattern = /\$\$[\s\S]*?\$\$|\$[^$\n]*\$/g;
		let match;
		while ((match = pattern.exec(text)) !== null) {
			const block = match[0].startsWith("$$");
			ranges.push(
				Decoration.replace({
					widget: new FakeMathWidget(match[0], block),
					block: block && match.index === state.doc.lineAt(match.index).from,
				}).range(match.index, match.index + match[0].length),
			);
		}
		return Decoration.set(ranges, true);
	});
}

function makeRenderer() {
	const calls = [];
	/**
	 * Mimics MathJax: `\class{mjx-mirror-x}{…}` ends up as that class on the
	 * argument's wrapper element (which MathJax styles as inline-block).
	 */
	const renderMath = (tex, display) => {
		calls.push([tex, display]);
		const container = window.document.createElement("mjx-container");
		if (display) container.setAttribute("display", "true");
		const classes = [...tex.matchAll(/\\class\{(mjx-mirror-[a-z]+)\}/g)].map((m) => m[1]);
		if (classes.length > 0) {
			const mrow = window.document.createElement("mjx-mrow");
			mrow.className = classes.join(" ");
			mrow.textContent = `RENDERED(${tex})`;
			container.appendChild(mrow);
		} else {
			container.textContent = `RENDERED(${tex})`;
		}
		return container;
	};
	return { calls, renderMath };
}

function makeEditor(doc, host) {
	const parent = window.document.createElement("div");
	window.document.body.appendChild(parent);
	const view = new EditorView({
		state: EditorState.create({
			doc,
			extensions: [fakeObsidianMath(), createLivePreviewExtension(host)],
		}),
		parent,
	});
	return view;
}

function makeHost(overrides = {}) {
	const { calls, renderMath } = makeRenderer();
	return {
		calls,
		host: {
			renderMath,
			finishRenderMath: () => undefined,
			loadMathJax: () => Promise.resolve(),
			enabled: () => true,
			...overrides,
		},
	};
}

test("reads the formula source back from the document", () => {
	const { host } = makeHost();
	const view = makeEditor("a $\\mirrorh{x^2}$ b", host);
	const widget = view.contentDOM.querySelector(".math");
	const source = readMathSource(view, widget);
	assert.deepEqual(source, { text: "$\\mirrorh{x^2}$", display: false });
	view.destroy();
});

test("inline Live Preview math is re-rendered from the inner TeX and marked", () => {
	const { calls, host } = makeHost();
	const view = makeEditor("a $\\mirrorh{x^2}$ b", host);
	const widget = view.contentDOM.querySelector(".math");

	applyLivePreviewMirrors(view, host);

	assert.deepEqual(calls, [["x^2", false]], "MathJax gets the bare formula");
	assert.equal(widget.getAttribute("data-mirror-axis"), "h");
	assert.deepEqual(
		[...widget.classList].filter((c) => c.startsWith("math-mirror")).sort(),
		["math-mirror", "math-mirror-h", "math-mirror-inline"],
	);
	assert.equal(widget.querySelector("mjx-container").textContent, "RENDERED(x^2)");
	assert.ok(!widget.textContent.includes("ERROR"), "the error output is gone");
	view.destroy();
});

test("display math keeps block layout and the widget's other children", () => {
	const { calls, host } = makeHost();
	const view = makeEditor("$$\n\\mirrorv{\\frac{a}{b}}\n$$", host);
	const widget = view.contentDOM.querySelector(".math");

	applyLivePreviewMirrors(view, host);

	assert.deepEqual(calls, [["\n\\frac{a}{b}\n", true]]);
	assert.deepEqual(
		[...widget.classList].filter((c) => c.startsWith("math-mirror")).sort(),
		["math-mirror", "math-mirror-block", "math-mirror-v"],
	);
	assert.equal(widget.querySelectorAll("br").length, 2, "Obsidian's block children survive");
	assert.equal(widget.querySelector("mjx-container").getAttribute("display"), "true");
	view.destroy();
});

test("nested macros mirror on both axes", () => {
	const { calls, host } = makeHost();
	const view = makeEditor("$\\mirrorh{\\mirrorv{x}}$", host);
	applyLivePreviewMirrors(view, host);

	assert.deepEqual(calls, [["x", false]]);
	const widget = view.contentDOM.querySelector(".math");
	assert.equal(widget.getAttribute("data-mirror-axis"), "hv");
	assert.deepEqual(
		[...widget.classList].filter((c) => c.startsWith("math-mirror")).sort(),
		["math-mirror", "math-mirror-h", "math-mirror-inline", "math-mirror-v"],
	);
	view.destroy();
});

test("plain formulas are untouched", () => {
	const { calls, host } = makeHost();
	const view = makeEditor("a $x^2 + y$ b", host);
	applyLivePreviewMirrors(view, host);

	assert.deepEqual(calls, []);
	const widget = view.contentDOM.querySelector(".math");
	assert.equal(widget.className, "math");
	assert.match(widget.textContent, /^ERROR/);
	view.destroy();
});

test("a macro inside a larger formula is rewritten and rendered", () => {
	const { calls, host } = makeHost();
	const view = makeEditor("$\\mirrorh{x} + y$", host);
	const widget = view.contentDOM.querySelector(".math");

	applyLivePreviewMirrors(view, host);

	assert.deepEqual(calls, [["\\class{mjx-mirror-h}{x} + y", false]]);
	assert.equal(widget.hasAttribute("data-mirror-axis"), false, "no element level reflection");
	assert.ok(widget.querySelector(".mjx-mirror-h"), "MathJax carries the reflection");
	assert.ok(!widget.textContent.includes("ERROR"));

	// The rendered class is what proves the mirror is in place, so the pass is
	// still idempotent for partial macros.
	applyLivePreviewMirrors(view, host);
	assert.equal(calls.length, 1);
	view.destroy();
});

test("display math with a partial macro stays a block", () => {
	const { calls, host } = makeHost();
	const view = makeEditor("$$\n\\sum_i \\mirrorv{x_i}\n$$", host);
	const widget = view.contentDOM.querySelector(".math");

	applyLivePreviewMirrors(view, host);

	assert.deepEqual(calls, [["\n\\sum_i \\class{mjx-mirror-v}{x_i}\n", true]]);
	assert.equal(widget.querySelector("mjx-container").getAttribute("display"), "true");
	assert.equal(widget.querySelectorAll("br").length, 2);
	view.destroy();
});

test("a macro without a valid argument is reported and left alone", () => {
	const problems = [];
	const { calls, host } = makeHost({ onProblem: (message) => problems.push(message) });
	const view = makeEditor("$\\mirrorh{x$", host);
	applyLivePreviewMirrors(view, host);

	assert.deepEqual(calls, []);
	assert.equal(problems.length, 1);
	assert.match(problems[0], /without a valid \{argument\}/);
	view.destroy();
});

test("re-running the pass does not re-render", () => {
	const { calls, host } = makeHost();
	const view = makeEditor("$\\mirrorh{x}$", host);

	applyLivePreviewMirrors(view, host);
	applyLivePreviewMirrors(view, host);

	assert.equal(calls.length, 1);
	view.destroy();
});

test("math inside markdown sub-renders is left to the post processor", () => {
	const { calls, host } = makeHost();
	const view = makeEditor("a $\\mirrorh{x}$ b", host);

	// Callouts and table cells render markdown inside the editor; those `.math`
	// elements carry `.markdown-rendered` and were already handled elsewhere.
	const subRender = window.document.createElement("div");
	subRender.className = "markdown-rendered";
	subRender.innerHTML = '<span class="math math-inline">\\mirrorh{y}</span>';
	view.contentDOM.appendChild(subRender);

	applyLivePreviewMirrors(view, host);

	assert.deepEqual(calls, [["x", false]], "only the editor's own widget was re-rendered");
	assert.equal(subRender.querySelector(".math").className, "math math-inline");
	view.destroy();
});

test("while MathJax is loading the widget is marked and re-rendered later", async () => {
	let resolveLoader;
	const loader = new Promise((resolve) => {
		resolveLoader = resolve;
	});
	let ready = false;
	const calls = [];
	const host = {
		renderMath: (tex, display) => {
			if (!ready) throw new TypeError("MathJax is not loaded");
			calls.push([tex, display]);
			const container = window.document.createElement("mjx-container");
			container.textContent = `RENDERED(${tex})`;
			return container;
		},
		finishRenderMath: () => undefined,
		loadMathJax: () => loader,
		enabled: () => true,
	};

	const view = makeEditor("$\\mirrorv{y}$", host);
	applyLivePreviewMirrors(view, host);

	const widget = view.contentDOM.querySelector(".math");
	assert.equal(widget.getAttribute("data-mirror-axis"), "v", "marked even though it could not render");
	assert.deepEqual(calls, []);

	ready = true;
	resolveLoader();
	await loader;
	await Promise.resolve();

	assert.deepEqual(calls, [["y", false]]);
	assert.equal(widget.querySelector("mjx-container").textContent, "RENDERED(y)");
	view.destroy();
});

test("disabling Live Preview mirroring clears the marks", () => {
	const { host } = makeHost();
	const view = makeEditor("$\\mirrorh{x}$", host);
	applyLivePreviewMirrors(view, host);

	const widget = view.contentDOM.querySelector(".math");
	assert.ok(widget.classList.contains("math-mirror"));

	clearLivePreviewMirrors(view);

	assert.deepEqual([...widget.classList], ["math"]);
	assert.equal(widget.hasAttribute("data-mirror-axis"), false);
	view.destroy();
});

test("with the setting off no widget is touched", () => {
	const { calls, host } = makeHost({ enabled: () => false });
	const view = makeEditor("$\\mirrorh{x}$", host);
	const widget = view.contentDOM.querySelector(".math");

	applyLivePreviewMirrors(view, host);

	assert.deepEqual(calls, []);
	assert.equal(widget.className, "math");
	assert.match(widget.textContent, /^ERROR/);
	view.destroy();
});
