import assert from "node:assert/strict";
import { test } from "node:test";

import {
	axisClasses,
	axisForMacro,
	combineAxes,
	containsMirrorMacro,
	containsMirrorMacroName,
	findClosingBrace,
	findMirrorMacro,
	planFormula,
	rewriteMirrorMacros,
	splitMathDelimiters,
	stripMathDelimiters,
	texClassForAxis,
	transformForAxis,
	unwrapMirror,
} from "./.build/mirror.mjs";

test("axisForMacro only knows the documented macro names", () => {
	assert.equal(axisForMacro("mirrorh"), "h");
	assert.equal(axisForMacro("mirrorv"), "v");
	assert.equal(axisForMacro("mirrorhv"), "hv");
	assert.equal(axisForMacro("mirrorvh"), "hv");
	assert.equal(axisForMacro("MirrorH"), null);
	assert.equal(axisForMacro("mirror"), null);
	assert.equal(axisForMacro("frac"), null);
	assert.equal(axisForMacro("constructor"), null);
});

test("combineAxes composes reflections, so the same axis twice cancels out", () => {
	assert.equal(combineAxes(null, "h"), "h");
	assert.equal(combineAxes("h", null), "h");
	assert.equal(combineAxes("h", "v"), "hv");
	assert.equal(combineAxes("hv", "v"), "h");
	assert.equal(combineAxes("hv", "h"), "v");
	assert.equal(combineAxes("h", "h"), null);
	assert.equal(combineAxes("v", "v"), null);
	assert.equal(combineAxes("hv", "hv"), null);
});

test("class and transform names are derived from the axis", () => {
	assert.equal(texClassForAxis("h"), "mjx-mirror-h");
	assert.equal(texClassForAxis("v"), "mjx-mirror-v");
	assert.equal(texClassForAxis("hv"), "mjx-mirror-hv");
	assert.equal(transformForAxis("h"), "scaleX(-1)");
	assert.equal(transformForAxis("v"), "scaleY(-1)");
	assert.equal(transformForAxis("hv"), "scale(-1, -1)");
	assert.deepEqual(axisClasses("h"), ["math-mirror-h"]);
	assert.deepEqual(axisClasses("v"), ["math-mirror-v"]);
	assert.deepEqual(axisClasses("hv"), ["math-mirror-h", "math-mirror-v"]);
});

test("findClosingBrace handles nesting and escapes", () => {
	assert.equal(findClosingBrace("{x}", 0), 2);
	assert.equal(findClosingBrace("{\\frac{a}{b}}", 0), 12);
	assert.equal(findClosingBrace("{\\{x\\}}", 0), 6);
	assert.equal(findClosingBrace("\\begin{cases} a & b \\\\ c & d \\end{cases}", 6), 12);
	assert.equal(findClosingBrace("{x", 0), -1);
	assert.equal(findClosingBrace("x", 0), -1);
});

test("findMirrorMacro finds the first macro and its argument", () => {
	const source = "a + \\mirrorh{\\frac{1}{2}} + b";
	const match = findMirrorMacro(source);
	assert.ok(match);
	assert.equal(match.name, "mirrorh");
	assert.equal(match.axis, "h");
	assert.equal(match.inner, "\\frac{1}{2}");
	assert.equal(source.slice(match.start, match.end), "\\mirrorh{\\frac{1}{2}}");

	assert.equal(findMirrorMacro("\\frac{1}{2}"), null);
	assert.equal(findMirrorMacro("\\mirrorh{x"), null);
});

test("escaped macro names are not macros", () => {
	assert.equal(findMirrorMacro("\\\\mirrorh{x}"), null);
	assert.equal(containsMirrorMacro("\\\\mirrorh{x}"), false);
	assert.equal(containsMirrorMacro("\\mirrorh{x}"), true);
	// ... but a bare name is still worth reporting.
	assert.equal(containsMirrorMacroName("\\mirrorh{x"), true);
	assert.equal(containsMirrorMacroName("\\\\mirrorh{x}"), false);
	assert.equal(containsMirrorMacroName("\\mirrorhx{y}"), false);
});

test("unwrapMirror requires the macro to wrap the whole formula", () => {
	assert.equal(unwrapMirror("\\mirrorh{x} + y"), null);
	assert.equal(unwrapMirror("y + \\mirrorh{x}"), null);
	assert.equal(unwrapMirror("\\frac{1}{2}"), null);
	assert.deepEqual(unwrapMirror("  \\mirrorh{ x }  "), { axis: "h", inner: " x ", depth: 1 });
});

test("unwrapMirror composes nested wrappers, including cancellation", () => {
	assert.deepEqual(unwrapMirror("\\mirrorh{\\mirrorv{x}}"), { axis: "hv", inner: "x", depth: 2 });
	assert.deepEqual(unwrapMirror("\\mirrorv{\\mirrorv{x}}"), { axis: null, inner: "x", depth: 2 });
	assert.deepEqual(unwrapMirror("\\mirrorh{\\mirrorv{\\mirrorh{x}}}"), {
		axis: "v",
		inner: "x",
		depth: 3,
	});
});

test("unwrapMirror keeps nested braces intact", () => {
	assert.deepEqual(unwrapMirror("\\mirrorh{\\frac{a}{\\sqrt{b}}}"), {
		axis: "h",
		inner: "\\frac{a}{\\sqrt{b}}",
		depth: 1,
	});
	assert.deepEqual(unwrapMirror("\\mirrorv{\\{a\\}}"), { axis: "v", inner: "\\{a\\}", depth: 1 });

	const cases = unwrapMirror("\\mirrorh{\\begin{cases} a & b \\\\ c & d \\end{cases}}");
	assert.ok(cases);
	assert.equal(cases.inner, "\\begin{cases} a & b \\\\ c & d \\end{cases}");
});

test("rewriteMirrorMacros turns partial usage into \\class markers", () => {
	assert.equal(rewriteMirrorMacros("\\mirrorh{x} + y"), "\\class{mjx-mirror-h}{x} + y");
	assert.equal(
		rewriteMirrorMacros("a + \\mirrorv{\\frac{1}{2}}"),
		"a + \\class{mjx-mirror-v}{\\frac{1}{2}}",
	);
	assert.equal(
		rewriteMirrorMacros("\\mirrorh{x} + \\mirrorv{y}"),
		"\\class{mjx-mirror-h}{x} + \\class{mjx-mirror-v}{y}",
	);
	assert.equal(rewriteMirrorMacros("\\mirrorhv{\\vec{v}}"), "\\class{mjx-mirror-hv}{\\vec{v}}");
	assert.equal(rewriteMirrorMacros("\\frac{a}{b}"), "\\frac{a}{b}");
	assert.equal(rewriteMirrorMacros("\\\\mirrorh{x}"), "\\\\mirrorh{x}");
});

test("a macro chain covering the whole argument folds into one class", () => {
	// MathJax puts \class on the argument's own element, so two nested classes
	// would end up on the same element and could not compose.
	assert.equal(
		rewriteMirrorMacros("\\mirrorh{\\mirrorv{x}} + y"),
		"\\class{mjx-mirror-hv}{x} + y",
	);
	assert.equal(rewriteMirrorMacros("\\mirrorh{\\mirrorh{x}} + y"), "x + y");
	assert.equal(
		rewriteMirrorMacros("\\mirrorh{a + \\mirrorv{b}}"),
		"\\class{mjx-mirror-h}{a + \\class{mjx-mirror-v}{b}}",
	);
});

test("splitMathDelimiters understands every delimiter", () => {
	assert.deepEqual(splitMathDelimiters("$x$"), { open: "$", body: "x", close: "$" });
	assert.deepEqual(splitMathDelimiters("$$x$$"), { open: "$$", body: "x", close: "$$" });
	assert.deepEqual(splitMathDelimiters("\\(x\\)"), { open: "\\(", body: "x", close: "\\)" });
	assert.deepEqual(splitMathDelimiters("\\[x\\]"), { open: "\\[", body: "x", close: "\\]" });
	assert.deepEqual(splitMathDelimiters("  $$ x $$  "), { open: "  $$", body: " x ", close: "$$  " });
	assert.deepEqual(splitMathDelimiters("x"), { open: "", body: "x", close: "" });
	assert.deepEqual(splitMathDelimiters(""), { open: "", body: "", close: "" });
	assert.equal(stripMathDelimiters("$\\mirrorh{x}$"), "\\mirrorh{x}");
});

test("planFormula peels whole-formula wrappers", () => {
	assert.deepEqual(planFormula("$\\mirrorh{x}$"), {
		axis: "h",
		tex: "$x$",
		mirrored: true,
	});
	assert.deepEqual(planFormula("$$\\mirrorv{\\frac{a}{b}}$$"), {
		axis: "v",
		tex: "$$\\frac{a}{b}$$",
		mirrored: true,
	});
	assert.deepEqual(planFormula("\\mirrorh{\\mirrorv{x}}"), {
		axis: "hv",
		tex: "x",
		mirrored: true,
	});
	assert.deepEqual(planFormula("\\mirrorh{\\mirrorh{x}}"), {
		axis: null,
		tex: "x",
		mirrored: true,
	});
	assert.deepEqual(planFormula("\\(\\mirrorhv{ \\vec{v} }\\)"), {
		axis: "hv",
		tex: "\\( \\vec{v} \\)",
		mirrored: true,
	});
});

test("planFormula supports macros inside a larger formula", () => {
	assert.deepEqual(planFormula("$\\mirrorh{x} + y$"), {
		axis: null,
		tex: "$\\class{mjx-mirror-h}{x} + y$",
		mirrored: true,
	});
	assert.deepEqual(planFormula("\\sum_i \\mirrorv{x_i}"), {
		axis: null,
		tex: "\\sum_i \\class{mjx-mirror-v}{x_i}",
		mirrored: true,
	});
	// Outer wrapper on the element, inner macro through \class.
	assert.deepEqual(planFormula("$\\mirrorh{a + \\mirrorv{b}}$"), {
		axis: "h",
		tex: "$a + \\class{mjx-mirror-v}{b}$",
		mirrored: true,
	});
});

test("planFormula returns null for formulas without a usable macro", () => {
	assert.equal(planFormula("$x + y$"), null);
	assert.equal(planFormula(""), null);
	assert.equal(planFormula("$\\mirrorh{x$"), null);
	assert.equal(planFormula("$\\\\mirrorh{x}$"), null);
	assert.equal(planFormula("$\\mirror{x}$"), null);
});
