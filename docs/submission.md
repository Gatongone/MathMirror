# Submitting Math Mirror to the community directory

Everything in this repository that the submission process asks for, plus the exact
steps left to do. Requirements are taken from the official docs:

- [Submit your plugin](https://docs.obsidian.md/Plugins/Releasing/Submit+your+plugin)
- [Submission requirements for plugins](https://docs.obsidian.md/community-directory/submission-requirements-for-plugins)
- [Developer policies](https://docs.obsidian.md/community-directory/developer-policies)
- [Manifest reference](https://docs.obsidian.md/Reference/Manifest)

## Plugin identity

| Field | Value | Notes |
| --- | --- | --- |
| `id` | `math-mirror` | Lowercase and hyphens only, does not end in `plugin`, does not contain `obsidian`. **`mirror` was already taken** by `jdsimcoe/obsidian-mirror`, so the id had to change. |
| `name` | `Math Mirror` | Unique across all 7768 published plugins (checked); no punctuation, no "Obsidian", no "Plugin". |
| `version` | `1.0.0` | Semver `x.y.z`; must equal the release tag. |
| `minAppVersion` | `1.13.7` | The version every mechanism was verified against (see `obsidian-math-internals.md`). MathJax's DOM and configuration are version dependent, so older versions are untested and deliberately not claimed. |
| `author` / `authorUrl` | `Gatongone` / GitHub profile | |
| `isDesktopOnly` | `false` | No Node.js or Electron API is used at runtime. |
| `fundingUrl` | absent | Only allowed when donations are accepted. |

## Status

- **Release `1.0.0` is published** with `main.js`, `manifest.json` and `styles.css`
  attached; the release's `main.js` is byte-identical to the tested local build.
- The Release workflow ran green end to end (install, tag check, build, 62 tests,
  attestation, draft release).
- Repository workflow permissions were switched from *read* to **read and write**
  so the workflow can create releases. To revert:
  `gh api -X PUT repos/Gatongone/MathMirror/actions/permissions/workflow -f default_workflow_permissions=read`.
- **Remaining: Step 2 below**, submitting through <https://community.obsidian.md>
  (needs the author's Obsidian account).


## Required files

| File | Status |
| --- | --- |
| `README.md` | Purpose, usage, install, how it works, limitations, development. |
| `LICENSE` | MIT, copyright Gatongone. |
| `manifest.json` | At the repository root, matches the values above. |
| `versions.json` | `{ "1.0.0": "1.13.7" }`. |
| `CHANGELOG.md` | Release notes source. |
| `.github/workflows/release.yml` | Builds and attaches the release assets when a tag is pushed. |
| `main.js`, `styles.css` | Build artifacts; not committed (`.gitignore`), attached to each release. |

## Checklist

- [x] `README.md`, `LICENSE` and `manifest.json` in the repository root.
- [x] Unique `id` and `name`; `id` restrictions respected.
- [x] Description: 143 characters, one sentence, ends with a period, ASCII only,
      starts with an action ("Flip LaTeX formulas …"), no emoji.
- [x] `minAppVersion` set to the version the plugin was verified against.
- [x] No `fundingUrl` (no donations are accepted).
- [x] No Node.js/Electron API at runtime, so `isDesktopOnly` is `false`.
- [x] No commands, so no command id can collide with the plugin id.
- [x] No sample plugin code left; classes are named after the plugin.
- [x] No `innerHTML`/`outerHTML`/`insertAdjacentHTML`, no global `app`,
      no `workspace.activeLeaf`, no default hotkeys, no `var`, no regex
      lookbehind, no hardcoded styling in TypeScript (verified by grep).
- [x] Console output only behind the opt-in "Debug logging" setting.
- [x] Resources cleaned up on unload (`register()` for the observer).
- [x] Policies: no ads, no telemetry, no account, no network access at all — the
      plugin only reads the DOM and the editor, and uses the MathJax that Obsidian
      already ships.
- [x] Build provenance attestation for the release assets (in the workflow).

## Step 1 — release

The workflow needs write access once, in the repository settings:
**Settings → Actions → General → Workflow permissions → Read and write permissions**.

Then push a tag that matches `manifest.json`:

```powershell
npm run build          # refresh the local main.js
git tag -a 1.0.0 -m "1.0.0"
git push origin 1.0.0
```

The **Release** workflow builds, tests, attests and opens a **draft** release with
`main.js`, `manifest.json` and `styles.css` attached. Add the notes from
`CHANGELOG.md` and press **Publish release** — a release that stays a draft is not
installable.

Without GitHub Actions, create the release by hand: tag `1.0.0`, then upload the
three files as binary attachments.

## Step 2 — submit

1. Sign in at <https://community.obsidian.md> with an Obsidian account.
2. Link the GitHub account that owns `Gatongone/MathMirror`.
3. Add the plugin and point it at that repository.

The directory reads `manifest.json` from the HEAD of the default branch, so the
committed manifest has to be the released one. Reviews are automated and the result
appears on the plugin's page; fix anything listed and publish a new release with an
incremented version.

## Notes for future versions

- Bump `version` in `manifest.json`, `package.json` and `versions.json`
  (`{ "1.1.0": "1.13.7" }`), then tag the same number. The workflow refuses to
  release when the tag and the manifest disagree.
- Keep the deployed folder in a vault named after the `id` (`math-mirror`), which
  is what `npm run deploy` does.
