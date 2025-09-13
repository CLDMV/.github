/**
 * @fileoverview GitHub Action to revoke a GitHub App installation token
 * @module revoke-app-token
 * 
 * @description
 * This action revokes a GitHub App installation token using the GitHub API.
 * It's typically called at the end of workflows to properly clean up tokens
 * and ensure they don't remain active after the workflow completes.
 */

import { revokeAppToken } from "../_api/core.mjs";
import { debugLog } from "../../../common/common/core.mjs";

/**
 * Main function to revoke GitHub App token
 * @async
 * @function main
 * 
 * @description
 * Retrieves the auth token from environment variables and calls the
 * revokeAppToken function from the core API module.
 * 
 * @throws {Error} If AUTH_TOKEN environment variable is not provided
 * @returns {Promise<void>} Resolves when token revocation is complete
 */
async function main() {
	try {
		const authToken = process.env.AUTH_TOKEN;

		if (!authToken) {
			throw new Error("AUTH_TOKEN environment variable is required");
		}

		debugLog("Revoking GitHub App installation token...");
		debugLog(`Token starts with: ${authToken.substring(0, 10)}...`);

		await revokeAppToken(authToken);

		debugLog("Token revocation completed successfully");
	} catch (error) {
		console.error(`❌ Failed to revoke GitHub App token: ${error.message}`);
		process.exit(1);
	}
}

// Execute main function
main();
