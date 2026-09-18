import { EditorView } from "@codemirror/view";
import { Plugin, finishRenderMath, loadMathJax, renderMath } from "obsidian";

import {
	clearLivePreviewMirrors,
	createLivePreviewExtension,
	LivePreviewHost,
	refreshLivePreview,
} from "./live-preview";
import { mirrorMathIn } from "./math-dom";
import { DEFAULT_SETTINGS, MathMirrorSettingTab, MirrorSettings } from "./settings";

const CSS_DURATION_VARIABLE = "--math-mirror-duration";

/**
 * Math Mirror
 *
 * `$\mirrorh{...}$` renders a formula flipped left/right, `$\mirrorv{...}$`
 * flips it upside down, `$\mirrorhv{...}$` does both. The macro is stripped
 * before MathJax ever sees it and the reflection is a CSS transform on the
 * rendered math, so the formula stays real typeset maths: selectable,
 * searchable, and printed at full quality.
 *
 * Two very different code paths are needed because Obsidian renders math twice:
 *
 *   - Reading view, embeds, hover previews, canvas: a markdown post processor
 *     running just *before* Obsidian's own math processor (`sortOrder -1`), so
 *     the raw TeX is rewritten before MathJax typesets it.
 *   - Live Preview: CodeMirror widgets that no post processor sees; there the
 *     widget's math output is re-rendered from the source read out of the
 *     document. See live-preview.ts.
 */
export default class MathMirrorPlugin extends Plugin {
	settings: MirrorSettings = { ...DEFAULT_SETTINGS };

	private readonly livePreviewHost: LivePreviewHost = {
		renderMath: (latex, display) => renderMath(latex, display),
		finishRenderMath: () => finishRenderMath(),
		loadMathJax: () => loadMathJax(),
		enabled: () => this.settings.livePreview,
		onProblem: (message, element) => this.reportProblem(message, element),
	};

	async onload(): Promise<void> {
		await this.loadSettings();
		this.addSettingTab(new MathMirrorSettingTab(this.app, this));

		// Reading view and every other markdown-rendered surface. Obsidian's own
		// math processor is registered with sortOrder 0, so -1 runs first and the
		// math is still raw TeX at that point, whatever the loading state.
		this.registerMarkdownPostProcessor((element) => {
			mirrorMathIn(element, {
				onProblem: (message, holder) => this.reportProblem(message, holder),
			});
		}, -1);

		this.registerEditorExtension(createLivePreviewExtension(this.livePreviewHost));

		// Live Preview re-renders math itself, which needs MathJax in memory.
		void loadMathJax().catch(() => undefined);

		this.applySettings();

		this.register(() => {
			document.body.style.removeProperty(CSS_DURATION_VARIABLE);
		});
	}

	async loadSettings(): Promise<void> {
		const stored = (await this.loadData()) as Partial<MirrorSettings> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, stored ?? {});
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	/** Re-apply everything that depends on the current settings. */
	applySettings(): void {
		document.body.style.setProperty(
			CSS_DURATION_VARIABLE,
			`${this.settings.animationMs}ms`,
		);

		for (const editor of this.findEditors()) {
			if (this.settings.livePreview) refreshLivePreview(editor, this.livePreviewHost);
			else clearLivePreviewMirrors(editor);
		}
	}

	private findEditors(): EditorView[] {
		const editors: EditorView[] = [];
		if (typeof EditorView.findFromDOM !== "function") return editors;
		for (const element of Array.from(document.querySelectorAll<HTMLElement>(".cm-editor"))) {
			try {
				const view = EditorView.findFromDOM(element);
				if (view !== null) editors.push(view);
			} catch {
				// Not an editor we can reach; nothing to refresh.
			}
		}
		return editors;
	}

	private readonly reportedProblems = new Set<string>();

	private reportProblem(message: string, element: Element): void {
		if (!this.settings.debug || this.reportedProblems.has(message)) return;
		this.reportedProblems.add(message);
		console.warn(`[Math Mirror] ${message}`, element);
	}
}
