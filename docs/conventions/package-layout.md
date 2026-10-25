# Package layout: entry points, build, dev condition and devcheck

Every CLDMV JavaScript library published to npm uses one source layout: the code lives in `src/`, tsup bundles it into `dist/`, the package has exactly two entry points (`index.mjs` for ESM and `index.cjs` for CommonJS), and a namespaced `<pkg>-dev` export condition switches a source checkout between `src/` and `dist/`. A small, unpublished `devcheck.mjs` warns when a checkout runs without that condition.

The reference implementation is [`CLDMV/llm-translator`](https://github.com/CLDMV/llm-translator).

## Scope

This applies to published JavaScript **libraries**: packages whose consumers `import` or `require` them. It does not apply to:

- **config-only packages** such as `@cldmv/configs` (they export config files, not a JS API);
- **CLI-only packages** with a `bin` and no `exports` (e.g. `git-embedded`, `wol-proxy`);
- **slothlet api folders** loaded by a host (stratax/packrat extensions) and applications;
- **`@cldmv/slothlet`**, which has its own build and satellite-package layout (see [satellite-packages.md](satellite-packages.md)).

## Layout

```text
package.json      "." → { "<pkg>-dev": { import: ./src/index.mjs, require: ./src/index.cjs },
                          import: ./dist/index.mjs, require: ./dist/index.cjs }
devcheck.mjs      repo root, never published
tsup.config.mjs
src/
  index.mjs       ESM entry: devcheck import first, then the public exports
  index.cjs       CJS entry: require(esm) guard + require("./index.mjs")
  …               the rest of the source
dist/             build output (gitignored, rebuilt by prepack)
  index.mjs       tsup bundle of src/index.mjs; still imports "../devcheck.mjs"
  index.cjs       verbatim copy of src/index.cjs
types/            generated declarations
```

Rules that follow from it:

- **`index.mjs` and `index.cjs` are the only entry points.** There is no `./main` subpath and no self-import by package name (`import … from "@cldmv/<pkg>/main"`). Extra public subpaths (e.g. `./cli`, `./parser`) are fine; each gets its own tsup entry and its own `<pkg>-dev` mapping.
- **The CJS entry is a sibling of the ESM entry, with the same name.** It is `src/index.cjs`, published as `dist/index.cjs`. It does not live in a `src/cjs/` folder, is not copied via tsup's `publicDir`, and is not named differently (`cjs-shim.cjs`) and renamed during the build. Because the two files sit side by side in both `src/` and `dist/`, `require("./index.mjs")` resolves in a checkout and in the published package, so the CJS entry can be tested from source.
- **The CJS entry is never a second bundle.** It is a few lines of hand-written code that loads the ESM build through Node's synchronous `require(esm)`. Bundling the library a second time with `format: ["cjs"]` duplicates the whole package.

## Entry points

### `src/index.mjs`

```js
// Development environment check. devcheck.mjs lives at the repo root and exists only in
// a source checkout; it is never published, so the import is allowed to fail. tsup keeps
// the specifier external, so dist/index.mjs imports the same root file. It runs inside an
// async function rather than as a top-level await: index.cjs loads this module through
// Node's synchronous require(esm), which rejects any module graph containing top-level
// await (ERR_REQUIRE_ASYNC_MODULE).
(async () => {
	try {
		await import("../devcheck.mjs");
	} catch {
		// ignore - devcheck.mjs is not published
	}
})();

export { … } from "./<module>.mjs";
```

The module graph reachable from `src/index.mjs` must not use top-level `await` anywhere, or `require()` of the package fails with `ERR_REQUIRE_ASYNC_MODULE`. The devcheck import is deliberately fire-and-forget: static imports are hoisted and evaluated first, so it is a warning, not a gate.

### `src/index.cjs`

```js
"use strict";

if (!process.features?.require_module) {
	const error = new Error(
		`@cldmv/<pkg>: require() needs Node.js ^20.19.0 or >=22.12.0 (this is ${process.version}). On older Node.js, load the package with import() instead.`
	);
	error.code = "ERR_REQUIRE_ESM";
	throw error;
}

module.exports = require("./index.mjs");
```

When the package's CommonJS shape is something other than the ESM namespace, map it here, for example `module.exports = require("./index.mjs").default` for a package whose CJS export is a single function or plugin object, adding named properties on top where the historical shape had them.

### Deprecating an existing `./main` subpath

A package that already published a `./main` subpath keeps it as a deprecated alias of the root until its next major version, instead of removing it:

```js
// src/main.mjs — deprecated alias for the package root
const message = '"@cldmv/<pkg>/main" is deprecated; import "@cldmv/<pkg>" instead.';
if (typeof process !== "undefined" && typeof process.emitWarning === "function") {
	process.emitWarning(message, { type: "DeprecationWarning", code: "CLDMV_<PKG>_MAIN" });
} else {
	console.warn(`DeprecationWarning: ${message}`);
}
export * from "./index.mjs";
export { default } from "./index.mjs";
```

```jsonc
"./main": {
	"<pkg>-dev": { "types": "./types/src/index.d.mts", "import": "./src/main.mjs" },
	"types": "./types/src/index.d.mts",
	"import": "./dist/main.mjs"
}
```

The alias re-exports the root, so `./main` and `"."` return the same objects, and the warning prints once per process (`node --no-deprecation` silences it). Build it as its own tsup entry with `./index.mjs` marked external, so `dist/main.mjs` imports `dist/index.mjs` instead of carrying a second copy. Before switching, check that the root exports everything the old `./main` target exported, as the same values; if it doesn't, fix the root first. Adding the alias is a minor release; removing it waits for a major.

## `package.json`

```jsonc
{
	"type": "module",
	"main": "./dist/index.cjs",
	"module": "./dist/index.mjs",
	"types": "./types/src/index.d.mts",
	"exports": {
		".": {
			"<pkg>-dev": {
				"types": "./types/src/index.d.mts",
				"import": "./src/index.mjs",
				"require": "./src/index.cjs"
			},
			"types": "./types/src/index.d.mts",
			"import": "./dist/index.mjs",
			"require": "./dist/index.cjs"
		},
		"./package.json": "./package.json"
	},
	"files": ["dist/", "!dist/**/*.map", "types/", "!types/devcheck.d.mts"],
	"engines": { "node": ">=20.19.0" },
	"scripts": {
		"build": "tsup",
		"build:ci": "npm run lint && npm run format:check && npm run types:build && npm run build",
		"prepack": "npm run build",
		"types:build": "tsc -p .configs/tsconfig.json",
		"test": "node tests/run-vitest.mjs && npm run test:dist",
		"test:dist": "npm run build && node --conditions=<pkg>-dev --test tests/cjs/entry.test.cjs",
		"coverage": "node tests/run-vitest.mjs --coverage-quiet",
		"ci:coverage": "npm run coverage && npm run test:dist"
	}
}
```

- **`engines.node` is `>=20.19.0`** because the CJS entry needs `require(esm)` (Node ^20.19 / ≥22.12). Any lower floor is wrong: the guard in `index.cjs` already rejects older versions at runtime.
- **`files` ships `dist/` and `types/`, never `src/`** or the root `devcheck.mjs`. `tsc` follows the dynamic devcheck import and emits `types/devcheck.d.mts`, so it is excluded explicitly.
- **`dist/` is gitignored** and rebuilt by `prepack`.

## Build

```js
import { copyFileSync } from "node:fs";
import { defineConfig } from "tsup";

export default defineConfig({
	entry: { index: "src/index.mjs" },
	format: ["esm"],
	outDir: "dist",
	target: "node20",
	platform: "node",
	splitting: false,
	sourcemap: true,
	dts: false,
	minify: true,
	keepNames: true,
	removeNodeProtocol: false,
	// devcheck.mjs stays at the repo root and is never published; keep the import as-is
	// so dist/index.mjs loads the same root file instead of bundling it.
	external: ["../devcheck.mjs"],
	clean: true,
	outExtension() {
		return { js: ".mjs" };
	},
	onSuccess() {
		copyFileSync("src/index.cjs", "dist/index.cjs");
	}
});
```

- **`external: ["../devcheck.mjs"]`** is what keeps devcheck out of the bundle. The specifier is relative to the file importing it, and `../devcheck.mjs` points at the repo root from both `src/` and `dist/`, so the same root file runs in both modes and the import fails silently once published.
- **`keepNames: true`** keeps function and class names through minification (stack traces, `fn.name`).
- **`removeNodeProtocol: false`** keeps `node:` specifiers on built-in imports.
- A CLI gets a second entry (e.g. `{ "<name>": "src/bin/<name>.mjs" }` into `bin/`); if it imports the library entry, it needs the same `external`. Runtime dependencies stay external (tsup's default for `dependencies` / `peerDependencies`).
- Code that discovers modules at runtime (`readdir` + `import()` of computed paths) doesn't survive bundling; use static imports.

## The `<pkg>-dev` condition

The condition is named after the package (`uuid-dev`, `llm-translator-dev`), never the generic `development`, so a consumer's own `--conditions=development` can't switch this package to a source tree it doesn't ship. In a checkout:

| Run                                                | Resolves to                                                    |
| -------------------------------------------------- | -------------------------------------------------------------- |
| `node app.mjs`                                     | `dist/index.mjs` (or fails if not built), and devcheck exits 1 |
| `node --conditions=<pkg>-dev app.mjs`              | `src/index.mjs`                                                |
| `NODE_OPTIONS=--conditions=<pkg>-dev node app.mjs` | `src/index.mjs`                                                |
| `require("@cldmv/<pkg>")` with the condition       | `src/index.cjs` → `src/index.mjs`                              |
| installed from npm                                 | `dist/`; devcheck isn't published                              |

Contributors set it once per shell (`export NODE_OPTIONS=--conditions=<pkg>-dev`) or pass it per command.

## devcheck

`devcheck.mjs` sits at the repo root and is never published. Its job is to stop a source checkout from silently running the built `dist/` (or failing because it isn't built) when the developer meant to run `src/`. The canonical copy is [`@cldmv/uuid`'s `devcheck.mjs`](https://github.com/CLDMV/uuid/blob/master/devcheck.mjs); copy it and replace the package name.

It runs only when all of these hold:

- a `src/` directory sits next to it (a source checkout);
- it isn't running in CI (`CI`, `GITHUB_ACTIONS`, `TRAVIS`, `CIRCLECI`, `GITLAB_CI`, `BUILDKITE`, `JENKINS_URL`, `TF_BUILD`);
- its path has no `node_modules` segment (a git or tarball install inside a consumer's app must never exit).

It then collects every `--conditions` value from both `process.execArgv` (the node CLI, which is how vitest passes conditions to its workers) and `NODE_OPTIONS`, in all three valid forms (`--conditions=x`, `--conditions x`, `-C x`), and requires an **exact** `<pkg>-dev` match. Node doesn't split a condition value on `,` or `|`, so `<pkg>-dev,x`, `not-<pkg>-dev` and `<pkg>-dev|production` all correctly fail. `NODE_ENV` is ignored because it doesn't affect resolution. A built checkout still nags: with both `src/` and `dist/` present, only the condition selects `src/`. On failure it prints how to set the condition (cmd, PowerShell, POSIX, or directly on the node CLI) and calls `process.exit(1)`.

## Tests

- **Vitest** runs with the condition, so Node's resolver inside workers and devcheck both see it. `resolve.conditions` replaces Vite's defaults, so keep them:

  ```js
  resolve: { conditions: ["<pkg>-dev", "module", "browser", "development|production"] },
  ssr: { resolve: { conditions: ["<pkg>-dev", "node", "development|production"] } },
  test: { nodeOptions: ["--conditions=<pkg>-dev"], … }
  ```

- **`tests/devcheck.test.vitest.mjs`** is uuid's 15-case suite with the name swapped. Each case copies `devcheck.mjs` into a purpose-built fixture directory and runs it in a subprocess with a from-scratch environment, covering every flag form, the substring/comma/pipe traps, `NODE_ENV`, a built checkout, CI, a scoped `node_modules` install and a published layout with no `src/`.
- **A source-level CJS test** loads `src/index.cjs` through `createRequire` and checks it exports the same keys and values as `src/index.mjs`.
- **`tests/cjs/entry.test.cjs`** (run by `test:dist` through `node --test`, after a build) checks that `dist/index.cjs` re-exports `dist/index.mjs`, and that `dist/index.mjs` still contains `import("../devcheck.mjs")` and none of devcheck's code, which catches a missing `external`. Don't put it under `tests/dist/`: the usual `dist/` gitignore rule matches that folder too.

## CI wiring

- `ci.yml`: `coverage_build_command: "npm run build:ci"`, so the coverage legs run the real build. Don't use `skip_build: true` or a no-op `build` script for a library.
- `bundle-size.yml`: `build_command: "npm run build:ci"` and `dist_paths` set to the published files, e.g. `dist/**.mjs,dist/**.cjs`.

## Migrating an existing package

| Starting point                                                                            | Change                                                                                                                                                                                                             |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Hand-written root `index.mjs` / `index.cjs` reaching the code through `@cldmv/<pkg>/main` | `git mv` both into `src/`, import the code by relative path, move `<pkg>-dev` onto `"."`, keep `./main` as a deprecated alias, replace the custom build with tsup, keep devcheck (moved import: `../devcheck.mjs`) |
| `src/cjs-shim.cjs` or `src/cjs/index.cjs`                                                 | `git mv` to `src/index.cjs` beside `src/index.mjs`; rename a differently named ESM entry (`runner.mjs`, `fix-header.mjs`) to `src/index.mjs`; copy with `onSuccess`, not `publicDir`                               |
| No build (`echo` stub) shipping `src/`                                                    | add tsup, ship `dist/`, add the entries, condition and devcheck                                                                                                                                                    |
| CommonJS source                                                                           | convert to ESM, keep the CJS shape in `src/index.cjs`; ship as a major when the new `exports` map closes deep imports                                                                                              |
| Older or substring-matching devcheck                                                      | replace with uuid's version and add its test suite                                                                                                                                                                 |
