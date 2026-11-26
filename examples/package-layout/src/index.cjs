"use strict";

// Drop-in CommonJS entry for a CLDMV library (docs/conventions/package-layout.md).
// Copy it as src/index.cjs and change only the package name and the Node.js floor in the message.

if (!process.features?.require_module) {
	const error = new Error(
		`@cldmv/<pkg>: require() needs Node.js ^20.19.0 or >=22.13.0 (this is ${process.version}). On older Node.js, load the package with import() instead.`
	);
	error.code = "ERR_REQUIRE_ESM";
	throw error;
}

// Same exports as `import`. One distinct exported value (aliases of it count once) comes back as that value,
// so require(x)(...) works; anything else comes back as the module object ({ default, ...named }).
const esm = require("./index.mjs");
const values = new Set(
	Object.keys(esm)
		.filter((key) => key !== "__esModule")
		.map((key) => esm[key])
);
module.exports = values.size === 1 ? values.values().next().value : esm;
