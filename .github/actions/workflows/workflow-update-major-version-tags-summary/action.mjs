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
