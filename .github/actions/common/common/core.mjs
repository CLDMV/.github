/**
 * @fileoverview Common utilities for CLDMV GitHub Actions.
 * @module @cldmv/.github.common.core
 * @public
 *
 * @description
 * Provides shared utilities and logging functions for use across all CLDMV GitHub Actions.
 * Centralizes common functionality to ensure consistency and easy maintenance.
 *
 * @example
 * // Usage in GitHub Actions
 * import { debugLog } from '../../common/common/core.mjs';
 * debugLog('Processing started', { tag: 'v1.0.0' });
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import { randomUUID } from "node:crypto";

export const sh = (cmd) =>
	execSync(cmd, { stdio: ["ignore", "pipe", "inherit"], env: process.env })
		.toString()
		.trim();

/**
 * Execute a command, streaming its stdout/stderr to the parent process.
 * Throws if the command exits non-zero.
 * @public
 * @param {string} cmd - Command to execute (run via the system shell).
 * @param {Record<string, string>} [env={}] - Extra environment variables to merge in.
 * @returns {void}
 */
export function exec(cmd, env = {}) {
	execSync(cmd, { stdio: "inherit", env: { ...process.env, ...env } });
}

/**
 * Read a GitHub Actions input (the `INPUT_<NAME>` environment variable).
 * @public
 * @param {string} name - Input name as declared in action.yml.
 * @param {object} [opts] - Options.
 * @param {boolean} [opts.required=false] - Throw if the input is empty.
 * @param {string} [opts.default=""] - Value returned when the input is empty.
 * @returns {string} The trimmed input value.
 *
 * @example
 * const version = getInput("node-version", { default: "lts/*" });
 */
export function getInput(name, { required = false, default: def = "" } = {}) {
	const key = "INPUT_" + String(name).toUpperCase().replace(/ /g, "_");
	const raw = process.env[key];
	const value = (raw == null ? "" : String(raw)).trim();
	if (!value) {
		if (required) throw new Error(`Input '${name}' is required and was not provided`);
		return def;
	}
	return value;
}

/**
 * Read a GitHub Actions input as a boolean.
 * @public
 * @param {string} name - Input name as declared in action.yml.
 * @param {boolean} [def=false] - Value returned when the input is empty.
 * @returns {boolean} The parsed boolean.
 */
export function getBooleanInput(name, def = false) {
	const value = getInput(name).toLowerCase();
	if (!value) return def;
	return value === "true" || value === "1" || value === "yes";
}

/**
 * Append one output to the `GITHUB_OUTPUT` file, handling multiline values.
 * @public
 * @param {string} name - Output name.
 * @param {*} value - Output value (coerced to string).
 * @returns {void}
 */
export function setOutput(name, value) {
	const file = process.env.GITHUB_OUTPUT;
	const str = value == null ? "" : String(value);
	if (!file) {
		console.log(`(no GITHUB_OUTPUT) ${name}=${str}`);
		return;
	}
	if (str.includes("\n")) {
		const delim = `ghadelimiter_${randomUUID()}`;
		fs.appendFileSync(file, `${name}<<${delim}\n${str}\n${delim}\n`);
	} else {
		fs.appendFileSync(file, `${name}=${str}\n`);
	}
}

/**
 * Append multiple outputs to the `GITHUB_OUTPUT` file.
 * @public
 * @param {Record<string, *>} values - Key/value pairs to write.
 * @returns {void}
 */
export function setOutputs(values) {
	for (const [key, value] of Object.entries(values)) {
		setOutput(key, value);
	}
}

/**
 * Append markdown to the GitHub Actions step summary (`GITHUB_STEP_SUMMARY`).
 * @public
 * @param {string} text - Markdown content; a trailing newline is ensured.
 * @returns {void}
 */
export function appendSummary(text) {
	const file = process.env.GITHUB_STEP_SUMMARY;
	const content = text.endsWith("\n") ? text : `${text}\n`;
	if (!file) {
		process.stdout.write(content);
		return;
	}
	fs.appendFileSync(file, content);
}

/**
 * Parse and return the triggering event payload (`GITHUB_EVENT_PATH`).
 * @public
 * @returns {object} The parsed event payload, or an empty object if unavailable.
 */
export function getEventPayload() {
	const eventPath = process.env.GITHUB_EVENT_PATH;
	if (!eventPath || !fs.existsSync(eventPath)) return {};
	try {
		return JSON.parse(fs.readFileSync(eventPath, "utf8"));
	} catch {
		return {};
	}
}

/**
 * Check if debug logging is currently enabled
 * @private
 * @returns {boolean} True if debug logging is enabled
 */
function isDebugEnabledInternal() {
	// Check both runtime override and environment variable
	if (globalThis.CI_DEBUG_ENABLED !== undefined) {
		return globalThis.CI_DEBUG_ENABLED;
	}

	// Check multiple environment variable patterns
	// CI_DEBUG=false explicitly disables debug
	if (process.env.CI_DEBUG === "false") {
		return false;
	}

	// CI_DEBUG=true explicitly enables debug
	if (process.env.CI_DEBUG === "true") {
		return true;
	}

	// Check INPUT_DEBUG for GitHub Actions step inputs
	if (process.env.INPUT_DEBUG === "true") {
		return true;
	}

	if (process.env.INPUT_DEBUG === "false") {
		return false;
	}

	// Default behavior: enabled unless explicitly disabled
	return true;
}

/**
 * Centralized debug logging function for GitHub Actions
 * @public
 * @param {string} message - The debug message to log
 * @param {any} [data] - Optional data to include in the log output
 *
 * @description
 * Provides consistent debug logging across all CLDMV GitHub Actions.
 * Can be controlled by setting CI_DEBUG environment variable to 'false' to disable.
 * Automatically formats messages with debug prefix and optional data.
 *
 * @example
 * // Simple message
 * debugLog('Starting tag processing');
 *
 * @example
 * // Message with data
 * debugLog('Processing tag', { name: 'v1.0.0', sha: 'abc123' });
 *
 * @example
 * // Multi-line content
 * debugLog('Raw tag info', tagInfoString);
 *
 * @example
 * // Disable debug logging
 * process.env.CI_DEBUG = 'false';
 * debugLog('This will not appear');
 */
export function debugLog(message, data = undefined) {
	if (!isDebugEnabledInternal()) return;

	const prefix = "🔍 DEBUG:";

	if (data !== undefined) {
		console.log(`${prefix} ${message}`, data);
	} else {
		console.log(`${prefix} ${message}`);
	}
}

/**
 * Toggle debug logging on or off
 * @public
 * @param {boolean} enabled - Whether to enable debug logging
 *
 * @description
 * Allows runtime control of debug logging. Useful for conditional debugging
 * based on environment variables or action inputs.
 *
 * @example
 * // Enable debug logging conditionally
 * setDebugEnabled(process.env.DEBUG_MODE === 'true');
 */
export function setDebugEnabled(enabled) {
	// Note: This modifies the module-level constant
	// In practice, you might want to use a different approach for runtime control
	Object.defineProperty(globalThis, "CI_DEBUG_ENABLED", {
		value: enabled,
		writable: true,
		configurable: true
	});
}

/**
 * Check if debug logging is currently enabled
 * @public
 * @returns {boolean} True if debug logging is enabled
 *
 * @description
 * Allows other parts of the codebase to conditionally execute
 * expensive debug operations only when logging is enabled.
 *
 * @example
 * // Conditional expensive debug operation
 * if (isDebugEnabled()) {
 *   const expensiveDebugData = generateDetailedReport();
 *   debugLog('Detailed report', expensiveDebugData);
 * }
 */
export function isDebugEnabled() {
	return isDebugEnabledInternal();
}
