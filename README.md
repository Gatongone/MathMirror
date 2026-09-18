# Math Mirror

Mirror LaTeX formulas in Obsidian: `$\mirrorh{...}$` flips a formula left/right,
`$\mirrorv{...}$` flips it upside down.

```markdown
$\mirrorh{\frac{a}{b}}$                     whole formula, horizontal reflection
$\mirrorv{\vec{v}}$                         whole formula, vertical reflection
$$\mirrorh{\begin{cases}a&b\\c&d\end{cases}}$$
$\mirrorhv{\int_0^1 f(x)\,dx}$               both axes (180° rotation)
$\mirrorh{\mirrorv{x}}$                      nesting composes, same as \mirrorhv
$x + \mirrorv{\frac{a}{b}} = y$              only the fraction is flipped
```

The reflection is a CSS transform (`scaleX(-1)` / `scaleY(-1)`) applied to the
**real MathJax output**, not an image and not reordered characters, so mirrored
formulas stay selectable, searchable, theme-aware and vector-sharp when printed.

Requires Obsidian 1.13.7 or later (that is the version the MathJax internals it
relies on were verified against). Works on desktop and mobile.

## Install

Install **Math Mirror** from the community plugin directory: *Settings → Community
plugins → Browse*, search for "Math Mirror", then *Install* and *Enable*.

Before the directory listing is live, either use [BRAT](https://github.com/TfTHacker/obsidian42-brat)
with the repository `Gatongone/MathMirror`, or build it yourself:

```powershell
npm install
npm run build
npm run deploy      # copies into C:\Projects\Obsidian\Notes\.obsidian\plugins\math-mirror
```

Use `$env:OBSIDIAN_VAULT = "D:\MyVault"; npm run deploy` for another vault, or copy
`manifest.json`, `main.js` and `styles.css` into
`<vault>/.obsidian/plugins/math-mirror/` yourself, then enable **Math Mirror** in
Settings → Community plugins. The folder name has to match the plugin id,
`math-mirror`.

> Math that is already on screen when the plugin is enabled is not re-rendered by
> Obsidian (post processors only run while rendering). Reopen the note or toggle
> between editing and reading mode.

## Privacy

Math Mirror does not use the network, does not collect telemetry, does not show
ads, and does not require an account. It only reads the notes you have open, works
with the MathJax build Obsidian already ships, and writes nothing outside the
rendered math in the DOM.

## Principle

Two cases, decided per formula:

* **A macro around the whole formula** is removed from the TeX and turned into a
  reflection of the rendered formula element itself (`math-mirror` + axis classes
  on the `.math` element). Nested wrappers compose as reflections do - the same
  axis twice cancels - so `\mirrorh{\mirrorv{x}}` is 180° and `\mirrorh{\mirrorh{x}}`
  is the identity.
* **A macro around part of a formula** (`$x + \mirrorv{\frac{a}{b}} = y$`) is
  rewritten to MathJax's own `\class{mjx-mirror-v}{...}`: MathJax then puts that
  class on the rendered element of exactly that part (`mjx-mfrac`, `mjx-mrow`, …,
  which its stylesheet already makes `display: inline-block`) and CSS reflects it.
  The class name must start with `mjx-`, because MathJax's Safe extension filters
  out every other class.

Those two cases are implemented differently per view, because Obsidian renders math
in two very different ways:

* **Reading view, embedded notes, hover previews, canvas** — the markdown renderer
  emits `<span class="math math-inline">TeX</span>` (delimiters already stripped)
  and typesets it later. The plugin's markdown post processor registers with
  `sortOrder = -1`, i.e. *before* Obsidian's math processor (`sortOrder = 0`), so it
  always sees the raw TeX, whatever the MathJax loading state: it rewrites the TeX
  and marks the element when the whole formula is wrapped. MathJax then typesets
  into that same element, so the CSS transform applies to the real output.
* **Live Preview** — math is a CodeMirror widget: no post processors run, the DOM
  holds only MathJax output, and Obsidian disables MathJax's assistive MathML, so
  the TeX cannot be recovered from the DOM. The plugin instead maps the widget back
  to the document with `view.posAtDOM`, reads the `$...$` source from the document,
  re-renders the rewritten TeX with `renderMath`, swaps the MathJax node and marks
  the widget. Obsidian's widget stays in charge of layout, click-to-edit and the
  block edit button.
* **Anything else that renders the macro itself** — LaTeX Suite's math popup
  preview, another plugin's preview, or reading view math that Obsidian typeset
  before the post processor saw it. There the macro reaches MathJax, which does not
  know it, and MathJax draws its name in red. A DOM observer notices that error
  rendering, decodes the macro name from the glyph elements, deletes the red text
  and puts the mirror class on the group that follows it - the argument, including
  when a script is attached to it (`$\mirrorh{\mathcal{f}}_x$` mirrors the `f` and
  leaves the subscript alone). Genuinely undefined macros, and a macro written
  without braces, keep their red error.

Everything is verified against Obsidian 1.13.7 (MathJax 3.2.2); the evidence is
collected in [`docs/obsidian-math-internals.md`](docs/obsidian-math-internals.md).

## Settings

Mirror in Live Preview · Debug logging.

## Limitations

* Only `\mirrorh`, `\mirrorv`, `\mirrorhv` (and `\mirrorvh`) are recognised, case
  sensitively.
* Braces must balance: `$\mirrorh{x$` cannot be parsed, so the formula keeps
  MathJax's red error rendering (with a console message when debug logging is on).
* Reading view math that was already typeset before the plugin saw it, and math
  rendered by another plugin, is repaired after the fact rather than rewritten
  first: the red macro name disappears and the reflection is applied a moment
  later, in the same frame.
* Partial reflections use the class names `mjx-mirror-h`, `mjx-mirror-v` and
  `mjx-mirror-hv`; a `\class{mjx-mirror-...}` written by hand is treated as a mirror
  request as well.
* The rescue pass understands MathJax's undefined-macro rendering as Obsidian
  1.13.7 (MathJax 3.2.2) produces it. If a future version changes that markup, the
  rescue pass stops working - all other paths are unaffected.

## Development

`npm run dev` (watch) · `npm run build` (type check + production bundle) ·
`npm test` (62 unit and integration tests, including a real CodeMirror 6 editor in
jsdom) · `npm run deploy` (copy the built plugin into a vault).

`main.js` and `styles.css` are build artifacts and are not committed; they are
attached to each release.

## Releases

`.github/workflows/release.yml` builds and tests the plugin on every tag, then
opens a draft release with the three files Obsidian downloads. Push a tag that
matches `manifest.json`:

```powershell
git tag -a 1.0.0 -m "1.0.0"
git push origin 1.0.0
```

Review the draft release, add the notes from [`CHANGELOG.md`](CHANGELOG.md) and
publish it. See [`docs/submission.md`](docs/submission.md) for the community
directory checklist.

## License

Math Mirror is released under the [MIT](LICENSE) Copyright (c) 2026, Gatongone.