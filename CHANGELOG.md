# Changelog

## 1.0.1

- Settings use `getSettingDefinitions()`, so they appear in the settings search (Obsidian 1.13.0+). Values are read and written through `getControlValue`/`setControlValue`.
- `styles.css` no longer escalates priority; the `display` rules use more specific selectors instead.

## 1.0.0

- `\mirrorh`, `\mirrorv` and `\mirrorhv`; nested wrappers compose, so `\mirrorh{\mirrorv{x}}` is 180° and `\mirrorh{\mirrorh{x}}` is the identity.
- Works on the whole formula or part of one, including arguments with scripts.
- Reading view, embeds, hover previews, canvas and Live Preview; math rendered by other plugins is fixed too.
- Settings: mirror in Live Preview, debug logging.
