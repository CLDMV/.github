/**
 * @fileoverview Shared utilities for the release-notifier channels.
 * @module @cldmv/.github.community.jobs.release-notifier.util
 */

/** Take the first N lines of `text`; append truncation marker if truncated. */
export function truncate(text, maxLines) {
	const lines = (text || "").split(/\r?\n/);
	if (lines.length <= maxLines) return text.trim();
	return lines.slice(0, maxLines).join("\n").trim() + "\n…";
}
