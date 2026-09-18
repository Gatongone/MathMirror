import { App, PluginSettingTab, SettingDefinitionItem } from "obsidian";

import type MathMirrorPlugin from "./main";

export interface MirrorSettings {
	/** Mirror formulas in Live Preview as well as in Reading view. */
	livePreview: boolean;
	/** Log mirroring problems to the developer console. */
	debug: boolean;
}

export const DEFAULT_SETTINGS: MirrorSettings = {
	livePreview: true,
	debug: false,
};

/**
 * Settings are declared instead of rendered imperatively, so Obsidian can index
 * them for the settings search (1.13.0 and later).
 */
export class MathMirrorSettingTab extends PluginSettingTab {
	private readonly plugin: MathMirrorPlugin;

	constructor(app: App, plugin: MathMirrorPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				name: "Mirror in Live Preview",
				desc:
					"Apply the reflection while editing, not only in Reading view. " +
					"Turning this off leaves the editor untouched until the note is read.",
				aliases: ["live preview", "editor", "editing"],
				control: {
					type: "toggle",
					key: "livePreview",
					defaultValue: DEFAULT_SETTINGS.livePreview,
				},
			},
			{
				name: "Debug logging",
				desc: "Print a console message when a formula uses a broken mirror macro.",
				aliases: ["debug", "console", "log"],
				control: { type: "toggle", key: "debug", defaultValue: DEFAULT_SETTINGS.debug },
			},
			{
				name: "Supported macros",
				desc:
					"$\\mirrorh{...}$ reflects horizontally, $\\mirrorv{...}$ vertically, " +
					"$\\mirrorhv{...}$ on both axes. A macro can also cover only part of a " +
					"formula, for example $x + \\mirrorv{\\frac{a}{b}} = y$.",
				aliases: ["syntax", "usage", "mirrorh", "mirrorv", "mirrorhv"],
			},
		];
	}

	getControlValue(key: string): unknown {
		return (this.plugin.settings as unknown as Record<string, unknown>)[key];
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		if (key === "livePreview") this.plugin.settings.livePreview = value === true;
		else if (key === "debug") this.plugin.settings.debug = value === true;
		else return;

		await this.plugin.saveSettings();
		this.plugin.applySettings();
	}
}
