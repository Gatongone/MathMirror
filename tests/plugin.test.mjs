/**
 * Smoke test for the built artifact: load `main.js` with a stand-in `obsidian`
 * module, exactly like Obsidian's plugin loader does, then drive the registered
 * markdown post processor over a reading-view DOM.
 *
 * This catches packaging mistakes (externalised modules, missing globals, wrong
 * post processor order) that unit testing the sources would miss.
 */
import assert from "node:assert/strict";
import Module from "node:module";
import { createRequire } from "node:module";
import { test } from "node:test";

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
globalThis.MutationObserver = window.MutationObserver;
globalThis.getComputedStyle = window.getComputedStyle.bind(window);
globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window);
globalThis.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);

// Obsidian's DOM helpers, which the settings tab uses.
window.HTMLElement.prototype.empty = function () {
	while (this.firstChild) this.removeChild(this.firstChild);
	return this;
};
window.HTMLElement.prototype.createDiv = function (options) {
	const element = this.ownerDocument.createElement("div");
	if (options?.cls) element.className = options.cls;
	this.appendChild(element);
	return element;
};
window.HTMLElement.prototype.createEl = function (tag, options) {
	const element = this.ownerDocument.createElement(tag);
	if (typeof options === "string") element.className = options;
	else if (options) {
		if (options.cls) element.className = options.cls;
		if (options.text) element.textContent = options.text;
	}
	this.appendChild(element);
	return element;
};

/* ---------------------------------------------------------------- obsidian mock */

const registrations = { postProcessors: [], editorExtensions: [], settingsTabs: [], cleanups: [] };
/** Returned by the plugin's `loadData`, so tests can seed a data.json. */
let storedSettings = null;

class Plugin {
	constructor(app, manifest) {
		this.app = app;
		this.manifest = manifest;
	}
	registerMarkdownPostProcessor(processor, sortOrder) {
		registrations.postProcessors.push({ processor, sortOrder });
	}
	registerEditorExtension(extension) {
		registrations.editorExtensions.push(extension);
	}
	addSettingTab(tab) {
		registrations.settingsTabs.push(tab);
	}
	register(cleanup) {
		registrations.cleanups.push(cleanup);
	}
	async loadData() {
		return storedSettings;
	}
	async saveData() {
		/* no persistence in tests */
	}
}

class PluginSettingTab {
	constructor(app, plugin) {
		this.app = app;
		this.plugin = plugin;
		this.containerEl = window.document.createElement("div");
	}
}

/** Stand-in for Obsidian's Setting row; it records the rendered name/description. */
class Setting {
	constructor(containerEl) {
		this.settingEl = containerEl.createDiv({ cls: "setting-item" });
		this.nameEl = this.settingEl.createDiv({ cls: "setting-item-name" });
		this.descEl = this.settingEl.createDiv({ cls: "setting-item-description" });
	}
	setName(name) {
		this.nameEl.textContent = name;
		return this;
	}
	setDesc(description) {
		this.descEl.textContent = description;
		return this;
	}
	setLimits() {
		return this;
	}
	setDynamicTooltip() {
		return this;
	}
	setValue() {
		return this;
	}
	addToggle() {
		return this;
	}
	addSlider() {
		return this;
	}
}

const obsidianMock = {
	Plugin,
	PluginSettingTab,
	Setting,
	renderMath: (latex, display) => {
		const container = window.document.createElement("mjx-container");
		if (display) container.setAttribute("display", "true");
		container.textContent = `RENDERED(${latex})`;
		return container;
	},
	loadMathJax: () => Promise.resolve(),
	finishRenderMath: () => Promise.resolve(),
};

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
	if (request === "obsidian") return obsidianMock;
	return originalLoad.call(this, request, parent, isMain);
};

const require = createRequire(import.meta.url);
const PluginClass = require("../main.js").default;
Module._load = originalLoad;

/* ------------------------------------------------------------------------ tests */

test("main.js loads and registers both code paths", async () => {
	assert.equal(typeof PluginClass, "function", "default export is the plugin class");

	const plugin = new PluginClass({ workspace: { onLayoutReady() {} } }, { id: "mirror", version: "0.1.0" });
	await plugin.onload();

	assert.equal(registrations.editorExtensions.length, 1, "Live Preview extension registered");
	assert.equal(registrations.settingsTabs.length, 1, "settings tab registered");
	assert.equal(registrations.postProcessors.length, 1, "one markdown post processor registered");

	// Obsidian's own math processor runs at sortOrder 0 and would typeset the
	// formula before we see it; -1 is what makes the raw TeX available.
	assert.equal(registrations.postProcessors[0].sortOrder, -1);
});

test("the registered post processor mirrors reading view math", async () => {
	const plugin = new PluginClass({ workspace: { onLayoutReady() {} } }, { id: "mirror", version: "0.1.0" });
	await plugin.onload();

	const { processor } = registrations.postProcessors[0];
	const root = window.document.createElement("div");
	root.innerHTML =
		'<span class="math math-inline">\\mirrorh{\\frac{a}{b}}</span>' +
		'<span class="math math-inline">x + y</span>' +
		'<div class="math math-block">\\mirrorv{\\sum_i x_i}</div>' +
		'<span class="math math-inline">\\mirrorh{z} + 1</span>';

	processor(root);

	const [inline, plain, block, partial] = root.querySelectorAll(".math");
	assert.equal(inline.textContent, "\\frac{a}{b}");
	assert.deepEqual(
		[...inline.classList].filter((name) => name.startsWith("math-mirror")).sort(),
		["math-mirror", "math-mirror-h", "math-mirror-inline"],
	);
	assert.equal(plain.className, "math math-inline");
	assert.equal(plain.textContent, "x + y");
	assert.deepEqual(
		[...block.classList].filter((name) => name.startsWith("math-mirror")).sort(),
		["math-mirror", "math-mirror-block", "math-mirror-v"],
	);
	// A partial macro needs no element marking: MathJax's own class does the work.
	assert.equal(partial.className, "math math-inline");
	assert.equal(partial.textContent, "\\class{mjx-mirror-h}{z} + 1");

	// The theme-independent display values the reflection depends on live in
	// styles.css; assert the classes that carry them were applied.
	assert.ok(inline.classList.contains("math-mirror-inline"));
	assert.ok(block.classList.contains("math-mirror-block"));
});

test("the settings tab renders both options and the usage help", async () => {
	const plugin = new PluginClass({ workspace: { onLayoutReady() {} } }, { id: "mirror", version: "0.1.0" });
	await plugin.onload();

	const tab = registrations.settingsTabs.at(-1);
	assert.ok(tab, "a settings tab was registered");
	tab.display();

	const text = tab.containerEl.textContent;
	assert.match(text, /Mirror in Live Preview/);
	assert.match(text, /Debug logging/);
	assert.match(text, /\\mirrorh\{/);
	assert.match(text, /\\mirrorv\{/);
	assert.match(text, /\\mirrorhv\{/);
	// The help must not resurrect the old "whole formula only" restriction.
	assert.doesNotMatch(text, /entire formula/);
	assert.equal(tab.containerEl.querySelectorAll("li").length >= 4, true);
});

test("settings survive a data.json written by an older version", async () => {
	storedSettings = { livePreview: false, animationMs: 100, debug: true, unknown: "x" };
	try {
		const plugin = new PluginClass({ workspace: { onLayoutReady() {} } }, { id: "mirror", version: "0.1.0" });
		await plugin.onload();

		assert.deepEqual({ ...plugin.settings }, { livePreview: false, debug: true });
	} finally {
		storedSettings = null;
	}
});
