# Math Mirror

Flip LaTeX formulas in Obsidian: `\mirrorh` horizontally, `\mirrorv` vertically, `\mirrorhv` both.

```markdown
$\mirrorh{\frac{a}{b}}$            horizontal
$\mirrorv{\vec{v}}$                vertical
$\mirrorhv{\int_0^1 f(x)\,dx}$     both axes (180°)
$\mirrorh{\mirrorv{x}}$            same as \mirrorhv
$x + \mirrorv{\frac{a}{b}} = y$    flips only the fraction
```

Mirroring is a CSS transform on the MathJax output, so the formula stays selectable, searchable and vector sharp.

## Install

- **Community plugins**: search "Math Mirror" (once listed), then install and enable.
- **BRAT**: add the repository `Gatongone/MathMirror`.
- **Manual**: `npm install && npm run build`, then copy `main.js`, `manifest.json` and `styles.css` into `<vault>/.obsidian/plugins/math-mirror/`. The folder name must match the plugin id.

## License

Math Mirror is released under the [MIT](LICENSE) Copyright (c) 2026, Gatongone.