import { App, PluginSettingTab, Setting } from "obsidian";

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

export class MathMirrorSettingTab extends PluginSettingTab {
	private readonly plugin: MathMirrorPlugin;

	constructor(app: App, plugin: MathMirrorPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Mirror in Live Preview")
			.setDesc(
				"Apply the reflection while editing, not only in Reading view. " +
					"Turning this off leaves Live Preview untouched until the note is read.",
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.livePreview).onChange(async (value) => {
					this.plugin.settings.livePreview = value;
					await this.plugin.saveSettings();
					this.plugin.applySettings();
				}),
			);

		new Setting(containerEl)
			.setName("Debug logging")
			.setDesc("Print a console message when a formula uses a broken mirror macro.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.debug).onChange(async (value) => {
					this.plugin.settings.debug = value;
					await this.plugin.saveSettings();
					this.plugin.applySettings();
				}),
			);

		const help = containerEl.createDiv({ cls: "math-mirror-help" });
		help.createEl("p", { text: "Reflect a whole formula:" });
		const whole = help.createEl("ul");
		whole.createEl("li", { text: "$\\mirrorh{\\frac{a}{b}}$ — horizontal (left/right)" });
		whole.createEl("li", { text: "$\\mirrorv{\\vec{v}}$ — vertical (up/down)" });
		whole.createEl("li", { text: "$\\mirrorhv{...}$ — both axes at once (180° rotation)" });
		help.createEl("p", { text: "…or only part of one:" });
		const partial = help.createEl("ul");
		partial.createEl("li", { text: "$x + \\mirrorv{\\frac{a}{b}} = y$" });
		help.createEl("p", {
			text: "Nested wrappers compose, so $\\mirrorh{\\mirrorv{x}}$ is the same as $\\mirrorhv{x}$.",
		});
	}
}
