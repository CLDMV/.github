#!/usr/bin/env node

/**
 * Detailed Summary Generator
 * Generates detailed GitHub Step Summary from comprehensive tag health operation results
 */

import { writeFileSync } from "fs";

// Get environment variables
const summaryJson = process.env.SUMMARY_JSON || "{}";
const repository = process.env.GITHUB_REPOSITORY || "unknown/repo";
const operationResult = process.env.OPERATION_RESULT || "success";
const totalProcessed = process.env.TOTAL_PROCESSED || "0";
const totalFixed = process.env.TOTAL_FIXED || "0";
const processingSummary = process.env.PROCESSING_SUMMARY || "";
const debug = process.env.INPUT_DEBUG === "true";

const githubStepSummary = process.env.GITHUB_STEP_SUMMARY;
const githubOutput = process.env.GITHUB_OUTPUT;

/**
 * Safely parse JSON with fallback
 */
function safeJsonParse(jsonString, fallback = {}) {
	try {
		return JSON.parse(jsonString);
	} catch (error) {
		console.warn(`Failed to parse JSON: ${error.message}`);
		return fallback;
	}
}

/**
 * Generate detailed summary from comprehensive JSON data
 */
function generateDetailedSummary(summaryData) {
	let summary = `## 📌 Version Tag Update Summary\n\n`;
	summary += `**Repository**: \`${repository}\`\n\n`;

	// Overall status
	const overallSuccess = operationResult === "success" && summaryData.overall_success !== false;
	if (overallSuccess) {
		summary += `✅ **Overall Status**: Version tag operations completed successfully\n\n`;
	} else {
		summary += `❌ **Overall Status**: Version tag operations failed\n\n`;
	}

	// Iterate through all operation sections dynamically
	let hasOperations = false;
	Object.keys(summaryData).forEach((operationKey) => {
		if (operationKey !== "overall_success" && operationKey !== "statistics" && operationKey !== "errors" && operationKey !== "repository") {
			const operation = summaryData[operationKey];

			// Check if this operation has results to display
			if (operation && operation.title && (operation.fixed_count > 0 || operation.updated === true)) {
				hasOperations = true;
				summary += `## ${operation.title}\n\n`;
				summary += `${operation.description}\n\n`;

				// Output the pre-formatted lines from the job
				if (operation.lines && operation.lines.length > 0) {
					operation.lines.forEach((line) => {
						summary += `${line}\n`;
					});
					summary += `\n`;
				}

				// Add any additional notes from the job
				if (operation.notes && operation.notes.length > 0) {
					operation.notes.forEach((note) => {
						summary += `${note}\n`;
					});
					summary += `\n`;
				}
			}
		}
	});

	// Summary Statistics
	if (summaryData.statistics) {
		const stats = summaryData.statistics;
		summary += `## 📊 Summary Statistics\n\n`;
		summary += `- 📋 **Total Tags Processed**: ${stats.total_processed || totalProcessed}\n`;
		summary += `- 🔧 **Total Operations**: ${stats.total_operations || totalFixed}\n`;

		// Dynamic stats breakdown using templates from each job
		let hasDetailedStats = false;
		Object.keys(summaryData).forEach((operationKey) => {
			if (
				operationKey !== "overall_success" &&
				operationKey !== "statistics" &&
				operationKey !== "errors" &&
				operationKey !== "repository"
			) {
				const operation = summaryData[operationKey];
				if (operation && operation.stats_template && (operation.fixed_count > 0 || operation.updated === true)) {
					if (!hasDetailedStats) {
						summary += `\n**Operations Breakdown**:\n`;
						hasDetailedStats = true;
					}
					const count = operation.fixed_count || (operation.updated ? 1 : 0);
					const statsLine = operation.stats_template.replace("{count}", count);
					summary += `- ${statsLine}\n`;
				}
			}
		});

		if (hasDetailedStats) {
			summary += `\n`;
		} else if (stats.by_operation) {
			// Fallback to basic stats if no operation templates available
			summary += `\n**Operations Breakdown**:\n`;
			summary += `- 🏷️ Major/Minor Updates: ${stats.by_operation.major_minor_updates || 0}\n`;
			summary += `- 🤖 Bot Signature Fixes: ${stats.by_operation.bot_signature_fixes || 0}\n`;
			summary += `- 🔏 Unsigned Tag Fixes: ${stats.by_operation.unsigned_fixes || 0}\n`;
			summary += `- 🔗 Orphaned Tag Fixes: ${stats.by_operation.orphaned_fixes || 0}\n\n`;
		}
	}

	// Errors or issues
	if (summaryData.errors && summaryData.errors.length > 0) {
		summary += `## ⚠️ Issues Encountered\n\n`;
		summaryData.errors.forEach((error) => {
			summary += `- ${error}\n`;
		});
		summary += `\n`;
	}

	// Processing summary if available
	if (processingSummary) {
		summary += `**Processing Details**: ${processingSummary}\n\n`;
	}

	// Final message
	if (overallSuccess) {
		if (hasOperations) {
			summary += `All version tag operations completed successfully. Your repository's version tags are now properly maintained and signed.\n`;
		} else {
			summary += `Version tag operations completed. No changes were needed - your repository's tags are already properly maintained.\n`;
		}
	} else {
		summary += `Some operations failed. Please check the workflow logs for details.\n`;
	}

	return summary;
}

/**
 * Generate fallback summary when detailed data is not available
 */
function generateFallbackSummary() {
	let summary = `## 📌 Version Tag Update Summary (Fallback)\n\n`;
	summary += `**Repository**: \`${repository}\`\n\n`;

	if (operationResult === "success") {
		summary += `✅ **Overall Status**: Version tag operations completed successfully\n\n`;
		if (processingSummary) {
			summary += `**Processing Details**: ${processingSummary}\n\n`;
		}
		summary += `📋 **Total Processed**: ${totalProcessed}\n`;
		summary += `🔧 **Total Fixed**: ${totalFixed}\n\n`;
		summary += `All version tag operations completed successfully.\n`;
	} else {
		summary += `❌ **Overall Status**: Version tag operations failed\n\n`;
		summary += `Check the detailed progress above and workflow logs for specific failure details.\n`;
	}

	return summary;
}

/**
 * Generate detailed summary from comprehensive JSON data
 */
/* function generateDetailedSummary(summaryData) {
	let summary = `## 📌 Version Tag Update Summary

`;
	summary += `**Repository**: ${repository}

`;

	// Overall status
	const overallSuccess = operationResult === "success" && summaryData.overall_success !== false;
	if (overallSuccess) {
		summary += `✅ **Overall Status**: Version tag operations completed successfully

`;
	} else {
		summary += `❌ **Overall Status**: Version tag operations failed

`;
	}

	// Iterate through all operation sections dynamically
	let hasOperations = false;
	Object.keys(summaryData).forEach((operationKey) => {
		if (operationKey !== "overall_success" && operationKey !== "statistics" && operationKey !== "errors" && operationKey !== "repository") {
			const operation = summaryData[operationKey];

			// Check if this operation has results to display
			if (operation && operation.title && (operation.fixed_count > 0 || operation.updated === true)) {
				hasOperations = true;
				summary += `## ${operation.title}

`;
				summary += `${operation.description}

`;

				// Output the pre-formatted lines from the job
				if (operation.lines && operation.lines.length > 0) {
					operation.lines.forEach((line) => {
						summary += `${line}
`;
					});
					summary += `
`;
				}

				// Add any additional notes from the job
				if (operation.notes && operation.notes.length > 0) {
					operation.notes.forEach((note) => {
						summary += `${note}
`;
					});
					summary += `
`;
				}
			}
		}
	});

	// Summary Statistics
	if (summaryData.statistics) {
		const stats = summaryData.statistics;
		summary += `## 📊 Summary Statistics

`;
		summary += `- 📋 **Total Tags Processed**: ${stats.total_processed || totalProcessed}
`;
		summary += `- 🔧 **Total Operations**: ${stats.total_operations || totalFixed}
`;

		// Dynamic stats breakdown using templates from each job
		let hasDetailedStats = false;
		Object.keys(summaryData).forEach((operationKey) => {
			if (
				operationKey !== "overall_success" &&
				operationKey !== "statistics" &&
				operationKey !== "errors" &&
				operationKey !== "repository"
			) {
				const operation = summaryData[operationKey];
				if (operation && operation.stats_template && (operation.fixed_count > 0 || operation.updated === true)) {
					if (!hasDetailedStats) {
						summary += `
**Operations Breakdown**:
`;
						hasDetailedStats = true;
					}
					const count = operation.fixed_count || (operation.updated ? 1 : 0);
					const statsLine = operation.stats_template.replace("{count}", count);
					summary += `- ${statsLine}
`;
				}
			}
		});

		if (hasDetailedStats) {
			summary += `
`;
		} else if (stats.by_operation) {
			// Fallback to basic stats if no operation templates available
			summary += `
**Operations Breakdown**:
`;
			summary += `- 🏷️ Major/Minor Updates: ${stats.by_operation.major_minor_updates || 0}
`;
			summary += `- 🤖 Bot Signature Fixes: ${stats.by_operation.bot_signature_fixes || 0}
`;
			summary += `- 🔏 Unsigned Tag Fixes: ${stats.by_operation.unsigned_fixes || 0}
`;
			summary += `- 🔗 Orphaned Tag Fixes: ${stats.by_operation.orphaned_fixes || 0}

`;
		}
	}

	// Errors or issues
	if (summaryData.errors && summaryData.errors.length > 0) {
		summary += `## ⚠️ Issues Encountered

`;
		summaryData.errors.forEach((error) => {
			summary += `- ${error}
`;
		});
		summary += `
`;
	}

	// Processing summary if available
	if (processingSummary) {
		summary += `**Processing Details**: ${processingSummary}

`;
	}

	// Final message
	if (overallSuccess) {
		if (hasOperations) {
			summary += `All version tag operations completed successfully. Your repository's version tags are now properly maintained and signed.
`;
		} else {
			summary += `Version tag operations completed. No changes were needed - your repository's tags are already properly maintained.
`;
		}
	} else {
		summary += `Some operations failed. Please check the workflow logs for details.
`;
	}

	return summary;
} */

/**
 * Generate fallback summary when detailed data is not available
 */
/* function generateFallbackSummary() {
	let summary = `## 📌 Version Tag Update Summary (Fallback)

`;
	summary += `**Repository**: ${repository}

`;

	if (operationResult === "success") {
		summary += `✅ **Overall Status**: Version tag operations completed successfully

`;
		if (processingSummary) {
			summary += `**Processing Details**: ${processingSummary}

`;
		}
		summary += `📋 **Total Processed**: ${totalProcessed}
`;
		summary += `🔧 **Total Fixed**: ${totalFixed}

`;
		summary += `All version tag operations completed successfully.
`;
	} else {
		summary += `❌ **Overall Status**: Version tag operations failed

`;
		summary += `Check the detailed progress above and workflow logs for specific failure details.
`;
	}

	return summary;
} */

/**
 * Set GitHub outputs
 */
function setGitHubOutputs(summaryData) {
	const totalOperations = summaryData.statistics.total_operations;
	const totalProcessed = summaryData.statistics.total_processed;
	const summaryJson = JSON.stringify(summaryData);

	// Create legacy summary for backwards compatibility
	const legacySummary = `Processed tags for ${repository}. Updated ${majorUpdated} major/minor tags, then fixed: ${botFixed} bot signatures, ${unsignedFixed} unsigned tags, ${orphanedFixed} orphaned tags. Final count: ${totalProcessed}. Total operations: ${totalOperations}`;

	// Output to console (for GitHub Actions log)
	console.log(`total-processed=${totalProcessed}`);
	console.log(`total-fixed=${totalOperations}`);
	console.log(`summary-json=${summaryJson}`);
	console.log(`processing-summary=${legacySummary}`);

	// Write to GitHub output file if available
	if (githubOutput) {
		const outputContent =
			`total-processed=${totalProcessed}\n` +
			`total-fixed=${totalOperations}\n` +
			`summary-json=${summaryJson}\n` +
			`processing-summary=${legacySummary}\n`;

		writeFileSync(githubOutput, outputContent, { flag: "a" });
	}

	return { totalOperations, totalProcessed, summaryJson, legacySummary };
}

/**
 * Generate detailed summary from job summary data
 */
function generateSummary(summaryData) {
	let summary = `## 📌 Version Tag Update Summary\n\n`;
	summary += `**Repository**: \`${repository}\`\n\n`;

	// Overall status
	const overallSuccess = summaryData.overall_success !== false;
	if (overallSuccess) {
		summary += `✅ **Overall Status**: Version tag operations completed successfully\n\n`;
	} else {
		summary += `❌ **Overall Status**: Version tag operations failed\n\n`;
	}

	// Iterate through all operation sections dynamically
	Object.keys(summaryData).forEach((operationKey) => {
		if (operationKey !== "overall_success" && operationKey !== "statistics" && operationKey !== "errors" && operationKey !== "repository") {
			const operation = summaryData[operationKey];

			// Check if this operation has results to display
			if (operation && operation.title && (operation.fixed_count > 0 || operation.updated === true)) {
				summary += `## ${operation.title}\n\n`;
				summary += `${operation.description}\n\n`;

				// Output the pre-formatted lines from the job
				if (operation.lines && operation.lines.length > 0) {
					operation.lines.forEach((line) => {
						summary += `${line}\n`;
					});
					summary += `\n`;
				}

				// Add any additional notes from the job
				if (operation.notes && operation.notes.length > 0) {
					operation.notes.forEach((note) => {
						summary += `${note}\n`;
					});
					summary += `\n`;
				}
			}
		}
	});

	// Summary Statistics
	if (summaryData.statistics) {
		const stats = summaryData.statistics;
		summary += `## 📊 Summary Statistics\n\n`;
		summary += `- 📋 **Total Tags Processed**: ${stats.total_processed || 0}\n`;
		summary += `- 🔧 **Total Operations**: ${stats.total_operations || 0}\n`;

		// Dynamic stats breakdown using templates from each job
		let hasOperations = false;
		Object.keys(summaryData).forEach((operationKey) => {
			if (
				operationKey !== "overall_success" &&
				operationKey !== "statistics" &&
				operationKey !== "errors" &&
				operationKey !== "repository"
			) {
				const operation = summaryData[operationKey];
				if (operation && operation.stats_template && (operation.fixed_count > 0 || operation.updated === true)) {
					if (!hasOperations) {
						summary += `\n**Operations Breakdown**:\n`;
						hasOperations = true;
					}
					const count = operation.fixed_count || (operation.updated ? 1 : 0);
					const statsLine = operation.stats_template.replace("{count}", count);
					summary += `- ${statsLine}\n`;
				}
			}
		});

		if (hasOperations) {
			summary += `\n`;
		}
	}

	// Errors or issues
	if (summaryData.errors && summaryData.errors.length > 0) {
		summary += `## ⚠️ Issues Encountered\n\n`;
		summaryData.errors.forEach((error) => {
			summary += `- ${error}\n`;
		});
		summary += `\n`;
	}

	// Final message
	if (overallSuccess) {
		summary += `All version tag operations completed successfully. Your repository's version tags are now properly maintained and signed.\n`;
	} else {
		summary += `Some operations failed. Please check the workflow logs for details.\n`;
	}

	return summary;
}

// Main execution
console.log("📋 Generating detailed summary for " + repository + "...");

try {
	// Parse the comprehensive summary JSON
	const summaryData = safeJsonParse(summaryJson);

	if (debug) {
		console.log("Summary JSON input:");
		console.log(JSON.stringify(summaryData, null, 2));
	}

	// Generate the detailed summary
	let summary;
	if (summaryData && Object.keys(summaryData).length > 0 && summaryData.overall_success !== undefined) {
		console.log("✅ Using detailed summary data");
		summary = generateDetailedSummary(summaryData);
	} else {
		console.log("⚠️ Using fallback summary (detailed data not available)");
		summary = generateFallbackSummary();
	}

	// Write to GitHub Step Summary
	if (githubStepSummary) {
		writeFileSync(githubStepSummary, summary, { flag: "a" });
		console.log("✅ Detailed summary written to GitHub Step Summary");
	} else {
		console.log("⚠️ GITHUB_STEP_SUMMARY not available, outputting to console:");
		console.log(summary);
	}

	// Set output
	if (githubOutput) {
		writeFileSync(githubOutput, "summary_generated=true\n", { flag: "a" });
	}

	console.log("✅ Generated detailed summary using Node.js action");
} catch (error) {
	console.error("❌ Node.js detailed summary action failed:", error.message);

	// Generate fallback summary on error
	const fallbackSummary = generateFallbackSummary();

	if (githubStepSummary) {
		writeFileSync(githubStepSummary, fallbackSummary, { flag: "a" });
	}

	if (githubOutput) {
		writeFileSync(githubOutput, "summary_generated=false\n", { flag: "a" });
	}

	console.log("⚠️ Used fallback summary due to error");
}

/* 
// Main execution
console.log("🔄 Building comprehensive summary for " + repository + "...");

try {
	// Build comprehensive summary data
	const summaryData = buildComprehensiveSummary();

	// Set GitHub outputs
	const outputs = setGitHubOutputs(summaryData);

	// Generate and write the detailed summary
	const summaryText = generateSummary(summaryData);

	// Write to GitHub Step Summary
	const githubStepSummary = process.env.GITHUB_STEP_SUMMARY;
	if (githubStepSummary) {
		writeFileSync(githubStepSummary, summaryText, { flag: "a" });
	}

	console.log("✅ Generated comprehensive summary using Node.js");

	if (debug) {
		console.log("Generated comprehensive summary:");
		console.log(JSON.stringify(summaryData, null, 2));
	}
} catch (error) {
	console.error("❌ Node.js script failed:", error.message);

	// Fallback outputs
	const totalOperations = botFixed + unsignedFixed + orphanedFixed + majorUpdated;
	const fallbackOutputs =
		`total-processed=${finalCount}\n` +
		`total-fixed=${totalOperations}\n` +
		`summary-json={"overall_success": false, "error": "comprehensive summary script failed"}\n` +
		`processing-summary=Fallback: processed ${finalCount} tags with ${totalOperations} operations\n`;

	if (githubOutput) {
		writeFileSync(githubOutput, fallbackOutputs, { flag: "a" });
	}

	console.log(`total-processed=${finalCount}`);
	console.log(`total-fixed=${totalOperations}`);
	console.log('summary-json={"overall_success": false, "error": "comprehensive summary script failed"}');
	console.log(`processing-summary=Fallback: processed ${finalCount} tags with ${totalOperations} operations`);

	process.exit(1);
}
 */
