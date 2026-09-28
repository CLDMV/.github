/**
 * @fileoverview Build the default publish command for NPM or GitHub Packages.
 * Single source of truth shared by repo-detection (the authoritative builder)
 * and the publish-npm / publish-github-packages fallbacks.
 * @module @cldmv/.github.npm.utilities.publish-command.build
 */

/**
 * Build the default (non-custom) publish command.
 *
 * Always passes `--ignore-scripts`: the command runs inside the downloaded
 * `package-contents/` artifact — `npm pack` output with no `node_modules` and
 * no lockfile. The build job already ran `build_command` before packing, so no
 * lifecycle script (`prepack`, `prepublishOnly`, `postpack`, …) has legitimate
 * work left, and one that needs devDependencies (e.g. a bundler in `prepack`)
 * would crash the publish (#320).
 *
 * Public packages published via the npm CLI to the npm registry also carry
 * SLSA build provenance + a publish attestation (sigstore). Private packages
 * can't (provenance is public-only), `yarn publish` / `pnpm publish` have no
 * equivalent flag, and GitHub Packages doesn't take it — so it's gated on all
 * three.
 *
 * @param {object} options
 * @param {"npm"|"yarn"|"pnpm"} options.packageManager - Resolved package manager.
 * @param {boolean} options.isPrivate - Whether the repository is private.
 * @param {"npm"|"github-packages"} options.registry - Target registry.
 * @returns {string} The publish command.
 */
export function buildPublishCommand({ packageManager, isPrivate, registry }) {
	const tool = packageManager === "yarn" ? "yarn publish" : packageManager === "pnpm" ? "pnpm publish" : "npm publish";
	const accessLevel = isPrivate ? "restricted" : "public";
	let command = `${tool} --access ${accessLevel} --ignore-scripts`;
	if (registry === "npm" && !isPrivate && tool === "npm publish") {
		command += " --provenance";
	}
	return command;
}
