import { App, PluginSettingTab, Setting } from "obsidian";

import type MathMirrorPlugin from "./main";

export interface MirrorSettings {
	/** Mirror formulas in Live Preview as well as in Reading view. */
	livePreview: boolean;
	/** Duration of the flip animation in milliseconds (`0` flips instantly). */
	animationMs: number;
	/** Log mirroring problems to the developer console. */
	debug: boolean;
}

export const DEFAULT_SETTINGS: MirrorSettings = {
	livePreview: true,
	animationMs: 0,
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
					"Turning this off keeps Live Preview untouched until the note is read.",
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.livePreview).onChange(async (value) => {
					this.plugin.settings.livePreview = value;
					await this.plugin.saveSettings();
					this.plugin.applySettings();
				}),
			);

		new Setting(containerEl)
			.setName("Flip animation")
			.setDesc(
				"Duration in milliseconds used when a formula changes between mirrored " +
					"and unmirrored, or between axes. 0 disables the animation.",
			)
			.addSlider((slider) =>
				slider
					.setLimits(0, 1000, 50)
					.setValue(this.plugin.settings.animationMs)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.animationMs = value;
						await this.plugin.saveSettings();
						this.plugin.applySettings();
					}),
			);

		new Setting(containerEl)
			.setName("Debug logging")
			.setDesc("Print a console message when a formula cannot be mirrored.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.debug).onChange(async (value) => {
					this.plugin.settings.debug = value;
					await this.plugin.saveSettings();
					this.plugin.applySettings();
				}),
			);

		const help = containerEl.createDiv({ cls: "math-mirror-help" });
		help.createEl("p", {
			text: "Wrap a whole formula in one of these macros:",
		});
		const list = help.createEl("ul");
		list.createEl("li", { text: "$\\mirrorh{...}$ — horizontal (left/right) reflection" });
		list.createEl("li", { text: "$\\mirrorv{...}$ — vertical (up/down) reflection" });
		list.createEl("li", { text: "$\\mirrorhv{...}$ — both axes at once (180° rotation)" });
		help.createEl("p", {
			text: "The macro has to wrap the entire formula, e.g. $\\mirrorh{\\frac{a}{b}}$.",
		});
	}
}
