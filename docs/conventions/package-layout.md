# Package layout: entry points, build and dev condition

Every CLDMV JavaScript library published to npm uses one source layout: the code lives in `src/`, tsup bundles it into `dist/`, the package has exactly two entry points (`index.mjs` for ESM and `index.cjs` for CommonJS), and a namespaced `<pkg>-dev` export condition switches a source checkout between `src/` and `dist/`. There is no development check: the condition is how a developer picks `src/` or `dist/`, and both are legitimate (see [No devcheck](#no-devcheck)).

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
tsup.config.mjs
src/
  index.mjs       ESM entry: the public exports
  index.cjs       CJS entry: require(esm) guard + require("./index.mjs")
  …               the rest of the source
dist/             build output (gitignored, rebuilt by prepack)
  index.mjs       tsup bundle of src/index.mjs
  index.cjs       verbatim copy of src/index.cjs
bin/              CLI build output from src/bin/ (gitignored)
types/            generated declarations (gitignored)
  src/            tsc output for src/: the <pkg>-dev condition and the types package read it
  stub/           the published re-export stubs
packaging/
  <pkg>-types/    authored package.json fields + README for @cldmv/<pkg>-types
dist-packages/    carved satellite packages (gitignored)
  <pkg>-types/    the publishable @cldmv/<pkg>-types
```

Rules that follow from it:

- **`bin/` only holds build output.** A CLI's source is `src/bin/<name>.mjs`, and tsup builds it: into `bin/<name>.mjs` for a bundled build (see [Build](#build)), or into `dist/bin/<name>.mjs` when `dist/` mirrors `src/` file by file (see [Libraries built on slothlet](#libraries-built-on-slothlet)); `"bin"` in `package.json` points at the built file. Either way the published package ships no `src/`. Nothing in `bin/` is hand-written or committed, not even a thin launcher, and vendored binaries live outside it (for example `vendor/`). The fleet `.gitignore` ([`examples/gitignore/Node.gitignore`](../../examples/gitignore/Node.gitignore)) ignores `/bin/`.
- **`index.mjs` and `index.cjs` are the only entry points.** There is no `./main` subpath and no self-import by package name (`import … from "@cldmv/<pkg>/main"`). Extra public subpaths (e.g. `./cli`, `./parser`) are fine; each gets its own tsup entry and its own `<pkg>-dev` mapping.
- **The CJS entry is a sibling of the ESM entry, with the same name.** It is `src/index.cjs`, published as `dist/index.cjs`. It does not live in a `src/cjs/` folder, is not copied via tsup's `publicDir`, and is not named differently (`cjs-shim.cjs`) and renamed during the build. Because the two files sit side by side in both `src/` and `dist/`, `require("./index.mjs")` resolves in a checkout and in the published package, so the CJS entry can be tested from source.
- **The CJS entry is never a second bundle.** It is a few lines of hand-written code that loads the ESM build through Node's synchronous `require(esm)`. Bundling the library a second time with `format: ["cjs"]` duplicates the whole package.

## Entry points

### `src/index.mjs`

```js
export { … } from "./<module>.mjs";
```

The module graph reachable from `src/index.mjs` must not use top-level `await` anywhere, or `require()` of the package fails with `ERR_REQUIRE_ASYNC_MODULE`.

### `src/index.cjs`

```js
"use strict";

if (!process.features?.require_module) {
	const error = new Error(
		`@cldmv/<pkg>: require() needs Node.js ^20.19.0 or >=22.13.0 (this is ${process.version}). On older Node.js, load the package with import() instead.`
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
	"types": "./types/stub/index.d.mts",
	"exports": {
		".": {
			"<pkg>-dev": {
				"types": "./types/src/index.d.mts",
				"import": "./src/index.mjs",
				"require": "./src/index.cjs"
			},
			"types": "./types/stub/index.d.mts",
			"import": "./dist/index.mjs",
			"require": "./dist/index.cjs"
		},
		"./package.json": "./package.json"
	},
	"files": ["dist/", "!dist/**/*.map", "types/stub/"],
	"peerDependencies": { "@cldmv/<pkg>-types": "^<major>.0.0" },
	"peerDependenciesMeta": { "@cldmv/<pkg>-types": { "optional": true } },
	"engines": { "node": "<runtime floor, e.g. >=18.0.0>" },
	"devEngines": { "runtime": { "name": "node", "version": ">=22.22.0", "onFail": "error" } },
	"scripts": {
		"build": "tsup",
		"build:ci": "npm run lint && npm run format:check && npm run types:build && npm run build && npm run build:subpackages && npm run test:types",
		"build:subpackages": "node tools/build/build-subpackages.mjs",
		"prepack": "npm run build",
		"types:build": "tsc -p .configs/tsconfig.json && node tools/build/build-typestubs.mjs",
		"types:check": "tsc -p .configs/tsconfig.json --noEmit",
		"test": "node tests/run-vitest.mjs && npm run test:cjs && npm run test:dist",
		"test:cjs": "npm run build && node --conditions=<pkg>-dev --test tests/cjs/entry.test.cjs",
		"test:dist": "npm run build && node tests/run-vitest.mjs --mode=dist",
		"coverage": "node tests/run-vitest.mjs --coverage-quiet",
		"ci:coverage": "npm run coverage && npm run test:cjs && npm run test:dist"
	}
}
```

- **`engines.node` is the runtime floor**: the oldest Node.js the published package actually runs on, for consumers. It is the highest of the runtime and peer dependencies' own `engines`, what the shipped code's syntax and APIs need, and the floor the package has always promised. Don't raise it to the dev toolchain's floor: a library built to run on older Node.js (wisp, for example) keeps its low floor. tsup's `target` matches it (`node<major>`).
- **`devEngines.runtime` is the dev floor**: the Node.js the toolchain needs to build and test the package (`>=22.22.0` for vitest 5, tsup 9 and the rest), or the runtime floor if that is higher. npm checks `devEngines` on the project's own `install`, `ci` and `run`, never for consumers. CI's `min_node_version` in `ci.yml` and `publish.yml` follows the dev floor, since the toolchain can't run below it; the README states both floors.
- **`require()` needs `require(esm)`.** The guard in `index.cjs` rejects a Node.js without it and says `^20.19.0 or >=22.13.0` (22.12 prints an `ExperimentalWarning`), or the runtime floor if that is higher. `import` works down to the runtime floor.
- **Type scripts use three fixed names.** `types:check` type-checks the source without emitting (`tsc --noEmit`), and it's the script CI runs: `ci.yml` passes `type_check_command: "npm run types:check"`. `types:build` emits the declarations into `types/src/`, generates the stubs in `types/stub/`, and is part of `build:ci`. `test:types` is only for a test of the published types from a consumer's side (for example, compiling a consumer file against the built `.d.mts`), and it runs as part of `test`. Don't use `typecheck`, `build:types` or `test:types` for the plain source check. A repo with nothing to type-check sets `skip_type_check: true` in `ci.yml` and says why.
- **`test:cjs` runs the CommonJS tests**: the entry check on the build (`tests/cjs/entry.test.cjs`) and any CommonJS-only tests the repo has (see [Tests](#tests)). **`test:dist` runs the full vitest suite against `dist/` instead of `src/`** (see [Tests](#tests)). Don't swap the two names.
- **`files` ships `dist/` and `types/stub/`, never `src/` and never the declarations themselves.** They ship in `@cldmv/<pkg>-types` (see [Type declarations](#type-declarations-cldmvpkg-types)).
- **`dist/` is gitignored** and rebuilt by `prepack`.

## Type declarations (`@cldmv/<pkg>-types`)

A package doesn't publish its own `.d.mts` files. They go in a companion package, `@cldmv/<pkg>-types`, built from the same commit and published at the same version as the runtime. The runtime ships only small stubs that re-export from it. This is the layout `@cldmv/slothlet` uses (its `docs/TYPESCRIPT.md`, "Type Declarations"), and it keeps the declarations out of the runtime tarball for the JavaScript consumers who never read them.

Consumers who want types install both:

```bash
npm install @cldmv/<pkg>
npm install -D @cldmv/<pkg>-types
```

A TypeScript project without the types package gets `Cannot find module '@cldmv/<pkg>-types' or its corresponding type declarations`, which names exactly what to add. The README says so in its install section.

**How the pieces fit.**

| Piece             | Where                                             | What it is                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Real declarations | `types/src/` (gitignored)                         | `types:build` runs `tsc` on `src/`. The `<pkg>-dev` condition's `types` points here, so the repo's own checks and editors in a checkout use them directly.                                                                                                                                                                                                                                                                                                                                                |
| Stubs             | `types/stub/` (gitignored, published)             | One `.d.mts` per typed export, generated by `tools/build/build-typestubs.mjs` after `tsc`. `types/stub/index.d.mts` is `export * from "@cldmv/<pkg>-types";`, plus `export { default } from "@cldmv/<pkg>-types";` when the entry has a default export. The default (published) `types` condition points here.                                                                                                                                                                                            |
| Authored fields   | `packaging/<pkg>-types/package.json`, `README.md` | `description`, `keywords` and any deliberate overrides. Nothing else.                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Carved package    | `dist-packages/<pkg>-types/` (gitignored)         | `tools/build/build-subpackages.mjs` copies `types/src/**/*.d.mts` (no `.map` files) and writes its `package.json` in three layers: org and legal fields inherited from the root `package.json` (`license`, `author`, `contributors`, `funding`, `repository`, `bugs`, `homepage`, `publishConfig`, `type`), the authored fields, and the computed ones (`name`, `version` = the root version, `exports` with a `types` entry per subpath, `files`). Computed wins over authored, authored over inherited. |

**Version lockstep.** The types package has no version of its own: the carve stamps the root version on it, and the release pipeline publishes it next to the runtime as a satellite. The runtime declares it as an optional peer at the current major, `"@cldmv/<pkg>-types": "^<major>.0.0"`, so npm never installs it for a JavaScript consumer and warns a TypeScript consumer who pairs mismatched majors.

**Publishing.** `publish.yml` names the carve and the satellite (see [satellite-packages.md](satellite-packages.md)):

```yaml
build_subpackages_command: "npm run build:subpackages"
extra_packages: '[{ "name": "@cldmv/<pkg>-types", "dir": "dist-packages/<pkg>-types" }]'
```

A new satellite name needs a one-time manual first publish before OIDC trusted publishing can take over; follow [Bootstrapping a new satellite](satellite-packages.md#bootstrapping-a-new-satellite-first-publish) before the first release that carries it, then register the types package's own Trusted Publisher.

**`test:types`.** It tests the published shape from a consumer's side: build, carve, then type-check `tests/types/consumer.mts` (which imports `@cldmv/<pkg>` and uses its API) with a `tsconfig` whose `paths` map `@cldmv/<pkg>` to the repo root, resolving through the stubs, and `@cldmv/<pkg>-types` to `dist-packages/<pkg>-types`. That proves stub → types package resolution for every typed export. It runs in `build:ci`, so CI and the release build both check it. `types:check` stays the plain `tsc --noEmit` source check.

**Reference implementation.** `@cldmv/slothlet`: `tools/build/build-typestubs.mjs`, `tools/build/build-subpackages.mjs`, `packaging/slothlet-types/` and `tests/validate-typestubs.mjs`. Slothlet carves other satellites too and maps many subpaths; a single-entry library needs only the `index` stub and one carve entry, so copy the shape, not the whole scripts.

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
	clean: true,
	outExtension() {
		return { js: ".mjs" };
	},
	onSuccess() {
		copyFileSync("src/index.cjs", "dist/index.cjs");
	}
});
```

- **`keepNames: true`** keeps function and class names through minification (stack traces, `fn.name`).
- **`removeNodeProtocol: false`** keeps `node:` specifiers on built-in imports.
- A CLI gets a second entry (e.g. `{ "<name>": "src/bin/<name>.mjs" }` into `bin/`); if it imports the library entry, mark that entry `external` so the CLI doesn't carry a second copy. Runtime dependencies stay external (tsup's default for `dependencies` / `peerDependencies`).
- Code that discovers modules at runtime (`readdir` + `import()` of computed paths) doesn't survive bundling; use static imports.

## Libraries built on slothlet

A library that composes its own API with `@cldmv/slothlet` (`slothlet({ base: <dir>/api, … })`) keeps the layout above but publishes a different `dist/`. [`CLDMV/llm-translator`](https://github.com/CLDMV/llm-translator) is the reference implementation. This is not the host-loaded api folder case from [Scope](#scope): here the package itself owns the `api/` folder and boots slothlet from its entry point.

- **`dist/` mirrors `src/` file by file.** Slothlet scans the `api/` folder at runtime and derives endpoint names from the file tree, so a single bundle leaves nothing to discover. The tsup config uses `entry: ["src/**/*.mjs"]` with `bundle: false` (keep `minify`, `keepNames`, `removeNodeProtocol: false`, `outExtension` → `.mjs`, `clean`). The result is `dist/index.mjs`, `dist/api/**`, `dist/lib/**` and, for a CLI, `dist/bin/**`, with the same relative paths as in `src/`. `index.mjs` resolves the folder with `new URL("./api", import.meta.url)`, which then works unchanged from `src/` and from `dist/`.
- **Internals stay outside `api/`.** Helpers live in `src/lib/` and are imported by relative path, so they never show up as endpoints. Because the build keeps every file, those relative imports keep working in `dist/`.
- **`src/index.cjs` is still copied verbatim** to `dist/index.cjs` in `onSuccess`; with `bundle: false` it is not part of the `entry` glob, so nothing else produces it.
- **No top-level `await` in `index.mjs` or anything it imports statically.** `index.cjs` loads the ESM entry through `require(esm)`, which rejects a module graph that contains one. Leaves that slothlet imports at runtime are loaded with `import()` and are not part of this graph, but prefer an explicit async `load()` over a top-level `await` there too.
- **`test:cjs` composes the built API.** After `npm run build`, `tests/cjs/entry.test.cjs` should `require("dist/index.cjs")`, call the library's factory, and exercise a few endpoints, so a missing or misplaced file under `dist/api/` fails the test. Also assert that the expected `dist/api/**` and `dist/bin/**` files exist.
- **Vitest coverage.** Create instances in tests with `slothlet: { import: (url) => import(url) }` so leaves load through Vite's module graph and attribute coverage (see slothlet's `docs/TESTING.md`).
- **The engines floor follows slothlet's.** The package's `engines.node` is at least the floor of the slothlet version it depends on, since slothlet runs at import time.

## The `<pkg>-dev` condition

The condition is named after the package (`uuid-dev`, `llm-translator-dev`), never the generic `development`, so a consumer's own `--conditions=development` can't switch this package to a source tree it doesn't ship. In a checkout:

| Run                                                | Resolves to                                            |
| -------------------------------------------------- | ------------------------------------------------------ |
| `node app.mjs`                                     | `dist/index.mjs` (`ERR_MODULE_NOT_FOUND` if not built) |
| `node --conditions=<pkg>-dev app.mjs`              | `src/index.mjs`                                        |
| `NODE_OPTIONS=--conditions=<pkg>-dev node app.mjs` | `src/index.mjs`                                        |
| `require("@cldmv/<pkg>")` with the condition       | `src/index.cjs` → `src/index.mjs`                      |
| installed from npm                                 | `dist/`                                                |

Contributors set it once per shell (`export NODE_OPTIONS=--conditions=<pkg>-dev`) or pass it per command. The README documents it for anyone running a checkout.

## No devcheck

Packages don't ship or keep a `devcheck.mjs`. Consumers only get `dist/`, so a check would never run for them. In a checkout, the `<pkg>-dev` condition already chooses: with it the code runs from `src/`, without it from `dist/`, and both are legitimate (for example, trying the build before a release). A check that exits without the condition blocks the second case, and one that only fires when `dist/` is missing never runs, because resolving the package name to a missing `dist/` fails with `ERR_MODULE_NOT_FOUND` before any code loads. A package that still has one removes it (see [Migrating an existing package](#migrating-an-existing-package)).

## Tests

- **Tests run against `src/` by default.** Vitest runs with the condition, both in Vite's resolvers and in the worker processes, so Node's own resolver sees it too. `devCondition()` from `@cldmv/configs` builds the settings from `package.json`:

  ```js
  import base, { devCondition } from "@cldmv/configs/vitest.config.mjs";

  export default mergeConfig(mergeConfig(base, devCondition({ root: new URL("..", import.meta.url) })), defineConfig({ … }));
  ```

  It sets `resolve.conditions` and `ssr.resolve.conditions` to the condition followed by Vite's defaults (setting them replaces the defaults), and `test.execArgv: ["--conditions=<pkg>-dev"]` for the workers. `test.nodeOptions` is not a Vitest option and passes nothing to the workers; replace it where a config still has it.

- **Tests import the package by name**, `import { … } from "@cldmv/<pkg>"`, never `../src/index.mjs`. The condition then decides what they run: `src/` by default, the build when the condition is off. A test of an internal module that isn't exported keeps its relative `src/` import; it runs from source only.
- **`test:dist` runs the suite against `dist/`.** The vitest config is a function of Vite's `mode` and leaves `devCondition()` out for `--mode=dist`:

  ```js
  export default defineConfig(({ mode }) =>
  	mergeConfig(mode === "dist" ? base : mergeConfig(base, devCondition({ root })), { … })
  );
  ```

  `test:dist` builds, then runs `node tests/run-vitest.mjs --mode=dist` (one token: the runner treats a bare word as a test file pattern). Without a build it fails to resolve the package, it never falls back to `src/`.

- **A resolve test guards the switch.** `tests/resolve.test.vitest.mjs` imports the package by name and checks its exports are the same objects as `../dist/index.mjs`'s when `import.meta.env.MODE === "dist"`, and as `../src/index.mjs`'s otherwise. Reference: [`CLDMV/gitmulti`](https://github.com/CLDMV/gitmulti).
- **An unbundled build can redirect `src/` instead.** When tsup runs with `bundle: false`, `dist/` mirrors `src/` file by file, so in dist mode the vitest config can redirect every resolved `src/` path to the same path under `dist/`. That runs the tests of internal modules against the build too, and existing `../src/…` imports keep working unchanged. It only works when the file layout matches, so a bundled build uses the by-name imports above. Reference: [`CLDMV/llm-translator#126`](https://github.com/CLDMV/llm-translator/pull/126).
- **A source-level CJS test** loads `src/index.cjs` through `createRequire` and checks it exports the same keys and values as `src/index.mjs`.
- **`tests/cjs/entry.test.cjs`** (run by `test:cjs` through `node --test`, after a build) checks the build itself: that `dist/index.cjs` re-exports `dist/index.mjs`. Don't put it under `tests/dist/`: the usual `dist/` gitignore rule matches that folder too. Other CommonJS-only tests go in `tests/cjs/` as well and are added to `test:cjs`.

## CI wiring

- `ci.yml`: `coverage_build_command: "npm run build:ci"`, so the coverage legs run the real build. Don't use `skip_build: true` or a no-op `build` script for a library.
- `bundle-size.yml`: `build_command: "npm run build:ci"` and `dist_paths` set to the published files, e.g. `dist/**.mjs,dist/**.cjs`.

## Migrating an existing package

| Starting point                                                                            | Change                                                                                                                                                                               |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Hand-written root `index.mjs` / `index.cjs` reaching the code through `@cldmv/<pkg>/main` | `git mv` both into `src/`, import the code by relative path, move `<pkg>-dev` onto `"."`, keep `./main` as a deprecated alias, replace the custom build with tsup                    |
| `src/cjs-shim.cjs` or `src/cjs/index.cjs`                                                 | `git mv` to `src/index.cjs` beside `src/index.mjs`; rename a differently named ESM entry (`runner.mjs`, `fix-header.mjs`) to `src/index.mjs`; copy with `onSuccess`, not `publicDir` |
| No build (`echo` stub) shipping `src/`                                                    | add tsup, ship `dist/`, add the entries and condition                                                                                                                                |
| CommonJS source                                                                           | convert to ESM, keep the CJS shape in `src/index.cjs`; ship as a major when the new `exports` map closes deep imports                                                                |
| Has a `devcheck.mjs`                                                                      | remove it with the loader in the entry, its test, the tsup `external` and the `files` exclude                                                                                        |
| Ships or commits `types/`                                                                 | see [Moving declarations to `@cldmv/<pkg>-types`](#moving-declarations-to-cldmvpkg-types) below                                                                                      |

### Moving declarations to `@cldmv/<pkg>-types`

For a package that publishes `types/` today (and often commits it: uuid, fix-headers, vitest-runner, holdmytask and others):

1. Stop tracking the generated output: `git rm -r --cached types/`, and make sure `.gitignore` carries `types/` and `dist-packages/` (the fleet [`Node.gitignore`](../../examples/gitignore/Node.gitignore) has `types/`).
2. Point `types:build` at `types/src/` and add `tools/build/build-typestubs.mjs` after `tsc`. Add `packaging/<pkg>-types/package.json` (description, keywords) and its `README.md`, and `tools/build/build-subpackages.mjs` behind a `build:subpackages` script.
3. Rewrite `package.json`: `types` and the default `types` condition → `./types/stub/index.d.mts`, `<pkg>-dev` `types` → `./types/src/index.d.mts`, `files` → `types/stub/` instead of `types/`, add the optional peer on `@cldmv/<pkg>-types`.
4. Add `test:types` (consumer type-check against the stub and the carved package) and put `build:subpackages` and `test:types` into `build:ci`.
5. Set `build_subpackages_command` and `extra_packages` in `publish.yml`, then bootstrap the new name with the manual first publish and register its Trusted Publisher.
6. Document `npm install -D @cldmv/<pkg>-types` in the README.

Ship it as a major release: a TypeScript consumer's build fails until they add `@cldmv/<pkg>-types` (the error names it), so the upgrade notes say to install it. JavaScript consumers see no change. Slothlet made this move in v4.0.0.
