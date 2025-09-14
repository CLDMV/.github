#!/usr/bin/env node

/**
 * Comprehensive Summary Generator Action
 * Generates detailed summaries from multiple tag health operation results
 */

import { writeFileSync } from "fs";

// Get environment variables
const repository = process.env.REPO_NAME || "unknown/repo";
const finalCount = parseInt(process.env.FINAL_COUNT || "0");
const botFixed = parseInt(process.env.BOT_FIXED || "0");
const unsignedFixed = parseInt(process.env.UNSIGNED_FIXED || "0");
const orphanedFixed = parseInt(process.env.ORPHANED_FIXED || "0");
const majorUpdated = parseInt(process.env.MAJOR_UPDATED || "0");

// Get individual job summaries
const botSummaryJson = process.env.BOT_SUMMARY_JSON || "{}";
const unsignedSummaryJson = process.env.UNSIGNED_SUMMARY_JSON || "{}";
const orphanedSummaryJson = process.env.ORPHANED_SUMMARY_JSON || "{}";
const majorMinorSummaryJson = process.env.MAJOR_MINOR_SUMMARY_JSON || "{}";

const githubOutput = process.env.GITHUB_OUTPUT;
const debug = process.env.INPUT_DEBUG === "true";

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
 * Build comprehensive summary data from individual job outputs
 */
function buildComprehensiveSummary() {
	// Parse all individual summaries
	const botSummary = safeJsonParse(botSummaryJson);
	const unsignedSummary = safeJsonParse(unsignedSummaryJson);
	const orphanedSummary = safeJsonParse(orphanedSummaryJson);
	const majorMinorSummary = safeJsonParse(majorMinorSummaryJson);

	// Build comprehensive summary by merging all job data
	const comprehensiveSummary = {
		overall_success: true,
		repository: repository,
		statistics: {
			total_processed: finalCount,
			total_operations: botFixed + unsignedFixed + orphanedFixed + majorUpdated,
			by_operation: {
				major_minor_updates: majorUpdated,
				bot_signature_fixes: botFixed,
				unsigned_fixes: unsignedFixed,
				orphaned_fixes: orphanedFixed
			}
		}
	};

	// Merge job data dynamically
	const jobSummaries = [
		{ key: "major_minor_updates", data: majorMinorSummary },
		{ key: "bot_signature_fixes", data: botSummary },
		{ key: "unsigned_tag_fixes", data: unsignedSummary },
		{ key: "orphaned_tag_fixes", data: orphanedSummary }
	];

	jobSummaries.forEach(({ key, data }) => {
		if (data && Object.keys(data).length > 0) {
			// Find the operation key in the data
			const operationKey = Object.keys(data).find(
				(k) => k.includes(key.split("_")[0]) || k.includes(key.replace("_fixes", "").replace("_updates", ""))
			);

			if (operationKey && data[operationKey]) {
				comprehensiveSummary[operationKey] = data[operationKey];
			}
		}
	});

	return comprehensiveSummary;
}

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
		} else {
			// Fallback to basic stats if no operation templates available
			summary += `\n**Operations Breakdown**:\n`;
			summary += `- 🏷️ Major/Minor Updates: ${majorUpdated}\n`;
			summary += `- 🤖 Bot Signature Fixes: ${botFixed}\n`;
			summary += `- 🔏 Unsigned Tag Fixes: ${unsignedFixed}\n`;
			summary += `- 🔗 Orphaned Tag Fixes: ${orphanedFixed}\n\n`;
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

	console.log("✅ Generated comprehensive summary using Node.js action");

	if (debug) {
		console.log("Generated comprehensive summary:");
		console.log(JSON.stringify(summaryData, null, 2));
	}
} catch (error) {
	console.error("❌ Node.js action failed:", error.message);

	// Fallback outputs
	const totalOperations = botFixed + unsignedFixed + orphanedFixed + majorUpdated;
	const fallbackOutputs =
		`total-processed=${finalCount}\n` +
		`total-fixed=${totalOperations}\n` +
		`summary-json={"overall_success": false, "error": "comprehensive summary action failed"}\n` +
		`processing-summary=Fallback: processed ${finalCount} tags with ${totalOperations} operations\n`;

	if (githubOutput) {
		writeFileSync(githubOutput, fallbackOutputs, { flag: "a" });
	}

	console.log(`total-processed=${finalCount}`);
	console.log(`total-fixed=${totalOperations}`);
	console.log('summary-json={"overall_success": false, "error": "comprehensive summary action failed"}');
	console.log(`processing-summary=Fallback: processed ${finalCount} tags with ${totalOperations} operations`);

	process.exit(1);
}
