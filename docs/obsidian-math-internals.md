# Obsidian 1.13.7 math internals (verified)

Why this plugin is built the way it is. Every claim below was read out of the
shipped bundle (`obsidian-1.13.7.asar` → `app.js`, `app.css`,
`lib/mathjax/tex-chtml-full.js`) and, where noted, confirmed in a real Chromium by
running Obsidian's own extracted `tex-chtml-full.js` with Obsidian's exact
startup configuration. MathJax version: **3.2.2**; output jax: **CHTML only**
(there is no SVG jax anywhere in the archive).

## 1. Reading view DOM

Obsidian's markdown parser already strips the `$` delimiters, so the element text
is the bare TeX:

```html
<span class="math math-inline">\frac{a}{b}</span>   <!-- $...$            -->
<span class="math math-block">x^2</span>             <!-- $$...$$ inline    -->
<div  class="math math-block">x^2</div>              <!-- $$...$$ as a block -->
```

There is no `data-latex`/`data-tex` attribute, no `\(...\)` delimiters, and no
copy of the TeX in the DOM once MathJax has run: the processor reads
`element.innerHTML` (through a four-entity decoder), calls `element.empty()`,
appends the MathJax container and adds `is-loaded`. The TeX survives only in a
module-private `WeakMap`.

```js
// app.js, reading-view math processor (sortOrder 0)
var t = e.findAll(".math:not(.is-loaded)");
return aW.then(function () {                       // aW = MathJax loader
  for (var i of t) { var r = qd(i.innerHTML); i.empty();
    i.appendChild(lW(r, i.classList.contains("math-block")));  // lW = renderMath
    i.addClass("is-loaded"); BW.set(i, r); } });
```

## 2. Post processor ordering

`registerMarkdownPostProcessor(fn, sortOrder)` pushes onto a queue that is sorted
(stably) by `sortOrder`; Obsidian's math processor sits at `0` and is registered at
app start-up. A plugin processor therefore runs *after* it by default — and whether
the math is still raw TeX then depends on the loader:

```js
// app.js, lazy loader
then: function (e) { return n ? Promise.resolve(e()) : this.promise.then(e) }
```

* MathJax not loaded yet → Obsidian's callback is deferred past the synchronous
  processor loop, so a default (sortOrder 0) plugin processor still sees raw TeX.
* MathJax already loaded → Obsidian's callback runs **synchronously inside the
  loop**, so a later processor sees finished MathJax output.

**Consequence for this plugin:** register at `sortOrder = -1`. That runs before
Obsidian's processor in both cases, so the raw TeX is always available — no second
pass, no re-render, no race.

## 3. Live Preview

Math is rendered by a CodeMirror widget (`app.js` ~2980500):

```js
i.math = t; i.block = n;                                  // TeX lives in JS, not DOM
initDOM: t = this.containerEl = createEl(this.block ? "div" : "span", "math");
render:  e.toggleClass("math-block", r); e.toggleClass("cm-embed-block", r);
         e.empty(); e.appendChild(lW(this.math, r));       // renderMath
```

* inline: `span.math` (no `math-inline`, no `is-loaded`)
* display: `div.math.math-block.cm-embed-block` (+ two `<br>`, + edit button)
* `noReuse: true` → CodeMirror builds a new DOM node for it on every re-render
* the decoration is `Decoration.replace({widget, block, side: 1})` over the whole
  `$...$` range, supplied from a **StateField**
* CodeMirror refuses block decorations from plugin ViewPlugins
  (`RangeError: Block decorations may not be specified via plugins`), which rules
  out a competing plugin widget for display math

The TeX is present only in the widget's `.math` field. Recovering it requires the
*document* (`view.posAtDOM` + the source, or the syntax tree), which is what
`src/live-preview.ts` does.

## 4. MathJax configuration (why the fancy routes are closed)

```js
window.MathJax = {
  tex: { inlineMath: [], displayMath: [], processEscapes: false, processEnvironments: false, processRefs: false },
  startup: { typeset: false },
  options: { enableMenu: false, menuOptions: { settings: { renderer: "CHTML" } },
             renderActions: { assistiveMml: [] },
             safeOptions: { safeProtocols: { ... } } } };
```

* **Assistive MathML / `<annotation encoding="application/x-tex">` is disabled.**
  `renderActions: { assistiveMml: [] }` *replaces* the default `[153]`, and an
  action whose priority is `undefined` is never registered. Confirmed in Chromium:
  rendered output contains no `mjx-assistive-mml` and no annotation. So the TeX can
  never be recovered from rendered math.
* **Runtime macros are impossible.** `macros` is read once, when the TeX input jax
  is constructed (`configmacros` copies them into a `CommandMap`); mutating
  `MathJax.config.tex.macros` afterwards does nothing. Confirmed in Chromium: a
  macro added after startup is still an undefined control sequence.
* **`\class` is usable, with a restricted name.** The `html` extension is loaded
  (`\class`, `\style`, `\cssId` all parse), but MathJax's Safe extension filters the
  values: `classPattern: /^mjx-[-a-zA-Z0-9_.]+$/`, plus a `safeStyles` whitelist that
  does **not** include `transform`. Confirmed in Chromium: `\class{probe-class}{x}`
  is silently dropped while **`\class{mjx-mirror-h}{x}` survives** as
  `class="mjx-mirror-h"`. This is the hook partial mirroring uses.
* **`mjx-container` for inline math computes to `display: inline`** (no CSS rule
  sets anything else), i.e. it is *not* transformable; display math gets
  `display: block` via `mjx-container[jax="CHTML"][display="true"]`. Mirrored math
  must therefore be wrapped in / marked with an explicit `inline-block`/`block`.

## 4b. The `\class` route in detail (what partial mirroring uses)

All measured in Chromium with Obsidian's own `tex-chtml-full.js`:

* `\class{mjx-mirror-h}{a + b}` renders as `<mjx-mrow class="mjx-mirror-h">…` and
  `\class{mjx-mirror-h}{\frac{a}{b}}` as `<mjx-mfrac class="mjx-mirror-h">…`: the
  class lands on the argument's **own wrapper element**, not on a new one.
* Those elements get `display: inline-block` from MathJax's generated CSS
  (`addClassStyles` emits `mjx-<kind>{display:inline-block}` per wrapper kind used,
  `adaptiveCSS: true`), so a transform applies. The stylesheet only covers kinds
  rendered so far and is produced by `MathJax.chtmlStylesheet()`, which Obsidian
  attaches after its render loop (`dW`/`pW`). Measured after that refresh:
  `display=inline-block`, `transformable=true` for `mjx-mrow`, `mjx-mfrac`, `mjx-mi`,
  `mjx-msub`, `mjx-msubsup`, `mjx-texatom`.
* Two nested `\class`es can land on the **same** element
  (`\mirrorh{\mirrorv{A}}` -> `<mjx-mi class="mjx-mirror-v mjx-mirror-h">`), so the
  CSS carries a combined rule `.mjx-mirror-h.mjx-mirror-v { transform: scale(-1, -1) }`.
  The plugin additionally folds a macro chain that covers a whole argument into one
  class name (`\mirrorh{\mirrorv{x}}` -> `mjx-mirror-hv`), which also makes
  same-axis nesting cancel out.
* Reflections on *different* elements (the interesting case, `$\mirrorh{x} + \mirrorv{y}$`)
  compose exactly like nested transforms.

## 5. Useful public API (all present in `obsidian.d.ts`)

| API | Notes |
| --- | --- |
| `renderMath(latex, display)` | `MathJax.tex2chtml`, synchronous, returns the `<mjx-container>`; throws before MathJax is loaded |
| `loadMathJax()` | resolves once the loader finished |
| `finishRenderMath()` | refreshes the CHTML stylesheet; call after inserting new math |
| `registerMarkdownPostProcessor(fn, sortOrder?)` | `sortOrder` is honoured (stable sort) |
| `registerEditorExtension(ext)` | CodeMirror extension, cannot be removed later |

## 6. Verification method

* DOM shapes, ordering, config and widget behaviour: static analysis of the
  extracted `app.js` / `app.css` / `tex-chtml-full.js`.
* MathJax behaviour (`assistiveMml`, `\class`, `\style`, runtime macros, CHTML
  `display`): Obsidian's own `tex-chtml-full.js` executed in headless Chromium with
  Obsidian's startup object.
* The plugin's own pipeline: unit and integration tests (`npm test`) plus a browser
  run of the built reading-view module against the real MathJax bundle, which
  confirmed `display: inline-block` + `matrix(-1, 0, 0, 1, 0, 0)` on inline
  formulas, `display: block` and the mirrored block layout for display formulas,
  unchanged baseline alignment for inline math, and the partial cases
  (`x + \mirrorv{\frac{a}{b}}`, `\sum_i \mirrorhv{x_i}`, an outer wrapper with an
  inner macro, and a cancelling `\mirrorh{\mirrorh{x}}`).
