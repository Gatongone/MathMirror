import { EditorView } from "@codemirror/view";
import { Plugin, finishRenderMath, loadMathJax, renderMath } from "obsidian";

import {
	clearLivePreviewMirrors,
	createLivePreviewExtension,
	LivePreviewHost,
	refreshLivePreview,
} from "./live-preview";
import { mirrorMathIn } from "./math-dom";
import { rescueMirroredMath } from "./rescue";
import { DEFAULT_SETTINGS, MathMirrorSettingTab, MirrorSettings } from "./settings";

/** Settings are stored as JSON by the user, so their types cannot be trusted. */
function readBoolean(value: unknown, fallback: boolean): boolean {
	return typeof value === "boolean" ? value : fallback;
}

/**
 * Math Mirror
 *
 * `$\mirrorh{...}$` renders a formula flipped left/right, `$\mirrorv{...}$`
 * flips it upside down, `$\mirrorhv{...}$` does both. The macro is stripped
 * before MathJax ever sees it and the reflection is a CSS transform on the
 * rendered math, so the formula stays real typeset maths: selectable,
 * searchable, and printed at full quality.
 *
 * Three code paths are needed because Obsidian renders math in three ways:
 *
 *   - Reading view, embeds, hover previews, canvas: a markdown post processor
 *     running just *before* Obsidian's own math processor (`sortOrder -1`), so
 *     the raw TeX is rewritten before MathJax typesets it.
 *   - Live Preview: CodeMirror widgets that no post processor sees; there the
 *     widget's math output is re-rendered from the source read out of the
 *     document. See live-preview.ts.
 *   - Anybody else rendering the macro themselves (LaTeX Suite's math popup,
 *     another plugin's preview, math Obsidian typeset before the post processor
 *     ran): MathJax shows its red "unknown macro" rendering, which is detected
 *     and repaired afterwards. See rescue.ts.
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

		this.startRescue();
		this.applySettings();
	}

	async loadSettings(): Promise<void> {
		const stored = (await this.loadData()) as Partial<Record<keyof MirrorSettings, unknown>> | null;
		// Read the known keys one by one: a data.json written by an older version
		// may still carry settings that no longer exist.
		this.settings = {
			livePreview: readBoolean(stored?.livePreview, DEFAULT_SETTINGS.livePreview),
			debug: readBoolean(stored?.debug, DEFAULT_SETTINGS.debug),
		};
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	/** Push the current settings to any editor that is already open. */
	applySettings(): void {
		for (const editor of this.findEditors()) {
			if (this.settings.livePreview) refreshLivePreview(editor, this.livePreviewHost);
			else clearLivePreviewMirrors(editor);
		}
	}

	/*
	 * Watches for math that somebody else rendered with the macro still inside
	 * (a popup preview, or reading view math typed before we saw it) so the red
	 * "unknown macro" output can be repaired. The work is a single query on the
	 * nodes that were just added, and it runs before the browser paints.
	 */
	private startRescue(): void {
		const sweep = () => {
			rescueMirroredMath(document.body);
		};

		const observer = new MutationObserver((records) => {
			for (const record of records) {
				for (const node of Array.from(record.addedNodes)) {
					if (node.nodeType === Node.ELEMENT_NODE) rescueMirroredMath(node as Element);
				}
			}
		});
		observer.observe(document.body, { childList: true, subtree: true });

		this.app.workspace.onLayoutReady(sweep);
		this.register(() => observer.disconnect());
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
