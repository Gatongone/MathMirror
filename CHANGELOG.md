# Changelog

## 1.0.1

Addresses the community directory review.

- Settings are now declared with `getSettingDefinitions()`, so they are indexed by
  Obsidian's settings search (1.13.0 and later). The tab also reads and writes the
  plugin's own settings through `getControlValue`/`setControlValue`.
- Removed priority escalation from the stylesheet. The `display` rules the reflection
  depends on now use more specific selectors instead of forcing the declaration, and
  the comment no longer names the keyword either, so a plain text scan of
  `styles.css` finds nothing.

## 1.0.0

First public release.

- `$\mirrorh{...}$` reflects a formula horizontally, `$\mirrorv{...}$` vertically
  and `$\mirrorhv{...}$` on both axes (180°). Nested wrappers compose like
  reflections, so `\mirrorh{\mirrorv{x}}` is 180° and `\mirrorh{\mirrorh{x}}` is
  the identity.
- Works on the whole formula or on a part of one: `$x + \mirrorv{\frac{a}{b}} = y$`
  reflects only the fraction, including when a script is attached to the argument
  (`$\mirrorh{\mathcal{f}}_x$` mirrors the `f` and leaves `_x` alone).
- Reflections are CSS transforms on the real MathJax output, so mirrored formulas
  stay selectable, searchable, theme aware and vector sharp when printed.
- Reading view, embedded notes, hover previews, canvas and Live Preview. Math
  rendered by other plugins (for example LaTeX Suite's math popup preview) is
  repaired as well.
- Settings: mirror in Live Preview, and debug logging for broken macros.
