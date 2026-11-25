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
 * Always the npm CLI, whatever the repo's package manager (#544). The
 * artifact was already packed with the repo's own manager (`pnpm pack`
 * rewrites `workspace:*` ranges, the reason `pnpm publish` was used before),
 * so publishing it needs no manager-specific behaviour. `pnpm publish` in that
 * directory would also refuse on its git checks (the untracked artifact makes
 * the tree dirty), and the publish jobs never provision pnpm or yarn.
 *
 * Public packages published to the npm registry also carry SLSA build
 * provenance + a publish attestation (sigstore). Private packages can't
 * (provenance is public-only) and GitHub Packages doesn't take it, so it's
 * gated on both.
 *
 * @param {object} options
 * @param {"npm"|"yarn"|"pnpm"} [options.packageManager] - Resolved package manager. Accepted for compatibility; the command is npm for every manager.
 * @param {boolean} options.isPrivate - Whether the repository is private.
 * @param {"npm"|"github-packages"} options.registry - Target registry.
 * @returns {string} The publish command.
 */
export function buildPublishCommand({ isPrivate, registry }) {
	const accessLevel = isPrivate ? "restricted" : "public";
	let command = `npm publish --access ${accessLevel} --ignore-scripts`;
	if (registry === "npm" && !isPrivate) {
		command += " --provenance";
	}
	return command;
}
