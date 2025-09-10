/**
 * @fileoverview Git utilities for CLDMV GitHub Actions.
 * @module @cldmv/.github.git.utils
 * @public
 *
 * @description
 * Provides shared Git command execution utilities for use across
 * all CLDMV Git-related GitHub Actions. Centralizes Git operations to ensure
 * consistency and proper error handling.
 *
 * For GPG setup, use existing utilities from github/api/_api/gpg.mjs:
 * - importGpgIfNeeded()
 * - configureGitIdentity()
 * - shouldSign()
 */

import { sh, debugLog } from "../../common/common/core.mjs";

/**
 * Execute a git command safely with proper error handling
 * @public
 * @param {string} command - Git command to execute
 * @param {boolean} silent - Whether to suppress output on error
 * @returns {string} Command output
 *
 * @example
 * // Execute git command with error handling
 * const tags = gitCommand('git tag -l');
 *
 * @example
 * // Silent execution (no error output)
 * const result = gitCommand('git rev-parse HEAD', true);
 */
export function gitCommand(command, silent = false) {
	try {
		const result = sh(command);
		debugLog(`Git command executed: ${command}`, { result: result.substring(0, 100) });
		return result;
	} catch (error) {
		if (!silent) {
			console.error(`❌ Git command failed: ${command}`);
			console.error(error.message);
		}
		debugLog(`Git command failed: ${command}`, { error: error.message });
		return "";
	}
}

/**
 * Check if a tag exists locally
 * @public
 * @param {string} tagName - Name of the tag to check
 * @returns {boolean} True if tag exists
 *
 * @example
 * // Check if tag exists
 * if (tagExists('v1.0.0')) {
 *   console.log('Tag v1.0.0 exists');
 * }
 */
export function tagExists(tagName) {
	const result = gitCommand(`git tag -l ${tagName}`, true);
	return result.trim() === tagName;
}

/**
 * Get detailed information about a tag
 * @public
 * @param {string} tagName - Name of the tag
 * @returns {object|null} Tag information object or null if tag doesn't exist
 *
 * @example
 * // Get tag information
 * const tagInfo = getTagInfo('v1.0.0');
 * if (tagInfo) {
 *   console.log(`Tag ${tagInfo.name} points to ${tagInfo.commit}`);
 * }
 */
export function getTagInfo(tagName) {
	if (!tagExists(tagName)) {
		return null;
	}

	try {
		const objectType = gitCommand(`git cat-file -t ${tagName}`, true);
		const commit = gitCommand(`git rev-list -n 1 ${tagName}`, true);

		const info = {
			name: tagName,
			commit: commit,
			isAnnotated: objectType === "tag",
			isLightweight: objectType === "commit"
		};

		if (info.isAnnotated) {
			const tagContent = gitCommand(`git cat-file -p ${tagName}`, true);
			const taggerMatch = tagContent.match(/^tagger (.+) (\d{10,}) ([\+\-]\d{4})$/m);

			if (taggerMatch) {
				info.tagger = taggerMatch[1];
				info.taggerTimestamp = parseInt(taggerMatch[2]);
				info.taggerTimezone = taggerMatch[3];
			}

			// Check for GPG signature
			info.isSigned = tagContent.includes("-----BEGIN PGP SIGNATURE-----");

			// Extract message
			const lines = tagContent.split("\n");
			let inMessage = false;
			let message = "";

			for (const line of lines) {
				if (inMessage && !line.startsWith("-----BEGIN PGP SIGNATURE-----")) {
					message += line + "\n";
				} else if (line.startsWith("tagger ")) {
					inMessage = true;
				}
			}

			info.message = message.trim();
		} else {
			// For lightweight tags, get commit author info
			const authorInfo = gitCommand(`git log -1 --format="%an <%ae>" ${commit}`, true);
			info.author = authorInfo;
			info.isSigned = false;
		}

		debugLog(`Retrieved tag info for ${tagName}`, info);
		return info;
	} catch (error) {
		debugLog(`Failed to get tag info for ${tagName}`, { error: error.message });
		return null;
	}
}
