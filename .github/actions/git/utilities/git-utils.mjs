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

import { execFileSync } from "node:child_process";
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
		debugLog(`Git command executed: ${command}`, { result: result.substring(0, 100) + (result.length > 100 ? "..." : "") });
		return result;
	} catch (error) {
		if (!silent) {
			console.error(`❌ Git command failed: ${command}`);
			console.error(error.message);
		}
		debugLog(`Git command failed: ${command}`, { error: error.message });

		// For silent calls, return empty string to maintain backward compatibility
		// For non-silent calls, throw the error to properly handle failures
		if (silent) {
			return "";
		} else {
			throw error;
		}
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
/**
 * Get detailed information about a tag, including parsed tagger/author and bot detection.
 * @public
 * @param {string} tagName - Name of the tag
 * @param {string[]} [botPatterns] - Array of bot name/email patterns
 * @returns {object|null} Tag information object or null if tag doesn't exist
 */
export function getTagInfo(tagName, botPatterns = ["CLDMV Bot", "cldmv-bot", "github-actions[bot]"]) {
	if (!tagExists(tagName)) {
		return null;
	}

	function parseNameEmail(str) {
		if (!str) return { name: "", email: "" };
		const match = str.match(/^(.+) <(.+)>$/);
		return match ? { name: match[1], email: match[2] } : { name: str, email: "" };
	}

	function isBot(name, email) {
		const lowerName = (name || "").toLowerCase();
		const lowerEmail = (email || "").toLowerCase();
		return botPatterns.some((pattern) => lowerName.includes(pattern.toLowerCase()) || lowerEmail.includes(pattern.toLowerCase()));
	}

	try {
		const objectType = gitCommand(`git cat-file -t ${tagName}`, true);
		const commit = gitCommand(`git rev-list -n 1 ${tagName}`, true);

		const info = {
			name: tagName,
			commit: commit,
			isAnnotated: objectType === "tag",
			isLightweight: objectType === "commit",
			isSigned: false,
			tagger: null,
			author: null,
			signerName: "",
			signerEmail: "",
			isBot: false,
			message: ""
		};

		if (info.isAnnotated) {
			const tagContent = gitCommand(`git cat-file -p ${tagName}`, true);
			const taggerMatch = tagContent.match(/^tagger (.+) (\d{10,}) ([+-]\d{4})$/m);

			if (taggerMatch) {
				const taggerStr = taggerMatch[1];
				const taggerObj = parseNameEmail(taggerStr);
				info.tagger = taggerObj;
				info.taggerTimestamp = parseInt(taggerMatch[2]);
				info.taggerTimezone = taggerMatch[3];
				info.signerName = taggerObj.name;
				info.signerEmail = taggerObj.email;
				info.isBot = isBot(taggerObj.name, taggerObj.email);
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
			const authorObj = parseNameEmail(authorInfo);
			info.author = authorObj;
			info.signerName = authorObj.name;
			info.signerEmail = authorObj.email;
			info.isBot = isBot(authorObj.name, authorObj.email);
			info.isSigned = false;
		}

		debugLog(`Retrieved tag info for ${tagName}`, info);
		return info;
	} catch (error) {
		debugLog(`Failed to get tag info for ${tagName}`, { error: error.message });
		return null;
	}
}

/**
 * argv for creating (or replacing) an annotated tag from a message file.
 *
 * `--cleanup=verbatim` is required: git's default message cleanup treats every
 * line starting with `#` as a comment and drops it, which stripped all the
 * Markdown headings (`# … Changelog`, `## Overview`, …) from release tag
 * messages built from changelog files.
 * @public
 * @param {object} opts
 * @param {string} opts.tagName - Tag to create.
 * @param {string} opts.target - Commit (or object) the tag points at.
 * @param {string} opts.messageFile - Path of the file holding the tag message.
 * @param {boolean} [opts.sign=false] - GPG-sign the tag (`-s`).
 * @param {boolean} [opts.force=true] - Replace an existing local tag (`-f`).
 * @returns {string[]} Arguments for `git` (pass to execFileSync, no shell).
 */
export function annotatedTagArgs({ tagName, target, messageFile, sign = false, force = true }) {
	return ["tag", ...(force ? ["-f"] : []), "-a", ...(sign ? ["-s"] : []), "--cleanup=verbatim", "-F", messageFile, tagName, target];
}

/**
 * Read a tag's message straight from the repository.
 *
 * Tag messages are whole changelogs, so the detailed-tags JSON that is passed
 * between actions as an input no longer carries them: 100 changelog-sized
 * messages overran the kernel's per-argument limit (`Argument list too long`)
 * and failed every tag-health job. The fix-* actions call this for the few
 * tags they actually rewrite. The PGP signature block is excluded, blank lines
 * and `#` headings are kept, and a lightweight tag (or an empty message)
 * falls back to the tag name.
 * @public
 * @param {string} tagName - Tag to read.
 * @param {string} [cwd] - Repository directory (defaults to the current one).
 * @returns {string} The tag message, or the tag name when there is none.
 */
export function readTagMessage(tagName, cwd = process.cwd()) {
	try {
		const git = (...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
		if (git("cat-file", "-t", tagName).trim() !== "tag") return tagName;
		const raw = git("cat-file", "-p", tagName);
		const headerEnd = raw.indexOf("\n\n");
		if (headerEnd === -1) return tagName;
		let body = raw.slice(headerEnd + 2);
		const sig = body.indexOf("-----BEGIN PGP SIGNATURE-----");
		if (sig !== -1) body = body.slice(0, sig);
		return body.trim() || tagName;
	} catch {
		// git could not read the tag (missing, or not fetched); the tag name is the same fallback an empty message gets.
		return tagName;
	}
}
