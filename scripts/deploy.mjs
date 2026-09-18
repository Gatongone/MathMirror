/**
 * Copies the built plugin into a vault's community plugin folder.
 *
 *   npm run build
 *   npm run deploy
 *
 * The vault defaults to C:\Projects\Obsidian\Notes and can be overridden:
 *
 *   $env:OBSIDIAN_VAULT = "D:\MyVault"; npm run deploy
 */
import { access, cp, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_VAULT = "C:\\Projects\\Obsidian\\Notes";

const required = ["manifest.json", "main.js", "styles.css"];
const optional = ["versions.json"];

const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));

for (const file of required) {
	try {
		await access(path.join(root, file));
	} catch {
		console.error(
			`Missing ${file}. Build the plugin first:\n\n  npm run build\n`,
		);
		process.exit(1);
	}
}

const vault = process.env.OBSIDIAN_VAULT ?? DEFAULT_VAULT;
const pluginDir = path.join(vault, ".obsidian", "plugins", manifest.id);

await mkdir(pluginDir, { recursive: true });
for (const file of [...required, ...optional]) {
	try {
		await cp(path.join(root, file), path.join(pluginDir, file));
	} catch {
		// versions.json is optional.
	}
}

console.log(`Deployed ${manifest.id} v${manifest.version} to:\n  ${pluginDir}\n`);
console.log("Reload Obsidian (or use the Hot Reload plugin) and enable Math Mirror in Settings → Community plugins.");
