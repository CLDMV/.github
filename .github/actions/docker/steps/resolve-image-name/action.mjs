import fs from "node:fs";
import path from "node:path";

/**
 * Convert a string to a registry-safe image segment.
 * @param {string} value - Raw namespace or image segment.
 * @returns {string} Normalized lowercase segment.
 */
function normalizeImageSegment(value) {
	return String(value || "")
		.trim()
		.toLowerCase()
		.replace(/^@/, "")
		.replace(/[^a-z0-9._-]+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^[-_.]+|[-_.]+$/g, "");
}

/**
 * Read and parse package.json from the repository.
 * @param {string} packageJsonPath - Relative or absolute package.json path.
 * @returns {{name: string}} Parsed package metadata.
 */
function readPackageJson(packageJsonPath) {
	const resolvedPath = path.resolve(process.cwd(), packageJsonPath);
	if (!fs.existsSync(resolvedPath)) {
		throw new Error(`package.json not found at: ${resolvedPath}`);
	}

	const content = fs.readFileSync(resolvedPath, "utf8");
	const parsed = JSON.parse(content);

	if (!parsed.name || typeof parsed.name !== "string") {
		throw new Error(`package.json at ${resolvedPath} is missing a valid 'name' field`);
	}

	return parsed;
}

/**
 * Extract the final package segment from a package name.
 * Examples: "@scope/pkg" -> "pkg", "pkg" -> "pkg".
 * @param {string} packageName - NPM package name.
 * @returns {string} Last name segment.
 */
function getPackageImageBase(packageName) {
	const normalized = String(packageName || "").trim();
	if (!normalized) {
		return "";
	}

	if (normalized.includes("/")) {
		return normalized.split("/").pop() || "";
	}

	return normalized;
}

/**
 * Append GitHub Action outputs in a safe format.
 * @param {Record<string, string>} values - Key/value pairs to write.
 * @returns {void}
 */
function writeOutputs(values) {
	const outputFile = process.env.GITHUB_OUTPUT;
	if (!outputFile) {
		return;
	}

	const lines = Object.entries(values).map(([key, value]) => `${key}=${value}`);
	fs.appendFileSync(outputFile, `${lines.join("\n")}\n`, "utf8");
}

try {
	const packageJsonPath = process.env.INPUT_PACKAGE_JSON_PATH || "package.json";
	const namespaceInput = process.env.INPUT_IMAGE_NAMESPACE || "";
	const imageNameOverride = process.env.INPUT_IMAGE_NAME_OVERRIDE || "";
	const registryInput = process.env.INPUT_REGISTRY || "ghcr.io";
	const repositoryOwner = process.env.GITHUB_REPOSITORY_OWNER || "";

	const packageJson = readPackageJson(packageJsonPath);
	const packageName = packageJson.name;
	const packageBase = normalizeImageSegment(getPackageImageBase(packageName));

	if (!packageBase && !imageNameOverride) {
		throw new Error("Unable to derive image name from package.json name; provide image_name_override input");
	}

	const namespace = normalizeImageSegment(namespaceInput || repositoryOwner);
	if (!namespace) {
		throw new Error("Unable to resolve image namespace; set image_namespace input or ensure repository owner is available");
	}

	const imageNameOnly = normalizeImageSegment(imageNameOverride || packageBase);
	if (!imageNameOnly) {
		throw new Error("Resolved image name is empty after normalization");
	}

	const imageName = `${namespace}/${imageNameOnly}`;
	const image = `${registryInput}/${imageName}`;

	console.log(`Resolved package name: ${packageName}`);
	console.log(`Resolved image: ${image}`);

	writeOutputs({
		"image-name": imageName,
		image,
		"package-name": packageName
	});
} catch (error) {
	console.error(`::error::${error.message}`);
	process.exit(1);
}
