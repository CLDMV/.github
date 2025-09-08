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
