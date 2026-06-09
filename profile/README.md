<div align="center">

# CLDMV

**Software, developer tooling, and automation — built mostly on Node.js.**

[![Website](https://img.shields.io/badge/web-cldmv.net-2563eb?style=flat-square)](https://cldmv.net)
[![npm scope](https://img.shields.io/badge/npm-%40cldmv-cb3837?style=flat-square&logo=npm)](https://www.npmjs.com/org/cldmv)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue?style=flat-square)](https://www.apache.org/licenses/LICENSE-2.0)
[![Sponsor](https://img.shields.io/badge/sponsor-%E2%9D%A4-db61a2?style=flat-square&logo=githubsponsors)](https://github.com/sponsors/shinrai)

</div>

---

CLDMV builds software — open-source libraries and developer tooling, smart-home and device-control integrations, document- and workflow-automation systems, and the shared CI/CD infrastructure that ships it all. Most of our work runs on Node, though not all of it. Published packages live under the [`@cldmv`](https://www.npmjs.com/org/cldmv) npm scope and are licensed **Apache-2.0**; several larger projects are still in private development.

## ⭐ Featured

| Project | What it does |
|---|---|
| [**slothlet**](https://github.com/CLDMV/slothlet) | Modular API loader for Node.js — lazy-loads modules and submodules only when accessed, with live-binding, context isolation, and ESM/CJS dual support. Zero dependencies. |
| [**jsonv**](https://github.com/CLDMV/jsonv) | Modern JSON parser extending JSON5 with ES2015–2025 features and a year-based API. |
| [**uuid**](https://github.com/CLDMV/uuid) | Extended RFC 4122 / RFC 9562 UUID implementation with custom variant structures, issuer-based identification, and timestamp variants. |
| [**stubborn-tcp**](https://github.com/CLDMV/stubborn-tcp) | A stubbornly persistent TCP/TLS client that auto-reconnects with exponential backoff, keep-alive, and application heartbeats. |
| [**git-embedded**](https://github.com/CLDMV/git-embedded) | Manage embedded git repositories (anonymous gitlinks) without `.gitmodules` — keeps a child's origin URL out of the public parent while restoring normal git ergonomics. |
| [**vitest-runner**](https://github.com/CLDMV/vitest-runner) | Sequential Vitest runner that sidesteps the OOM crashes large test suites hit when running in parallel. |

## 🧰 Libraries & utilities

- [**envm**](https://github.com/CLDMV/envm) — Cross-platform environment-variable manager for Node.js (ESM, no classes).
- [**wisp**](https://github.com/CLDMV/wisp) — Version-agnostic JSON importing for Node.js with fallback handling and caller-path resolution.
- [**holdmytask**](https://github.com/CLDMV/holdmytask) — A tiny task queue that waits until your task is ready.
- [**fix-headers**](https://github.com/CLDMV/fix-headers) — Multi-language project-header normalizer with auto-detection and override support.
- [**polyfillme**](https://github.com/CLDMV/polyfillme) — Scans a codebase for unsupported JS features by ES version and generates a polyfill bundle for the gaps.

## 🏠 Smart-home & device control

- [**node-android-tv-remote**](https://github.com/CLDMV/node-android-tv-remote) — Control Android TV devices via ADB keycodes and text input.
- [**io-kasa-api**](https://github.com/CLDMV/io-kasa-api) — Local-network API for TP-Link **Kasa** smart devices — plugs, switches, dimmers, bulbs, motion sensors.
- [**wol-proxy**](https://github.com/CLDMV/wol-proxy) — Cross-platform Wake-on-LAN HTTP proxy: power on devices on your network with a single HTTP request.

## 🧩 Editor & format tooling

- [**jsonv-vscode**](https://github.com/CLDMV/jsonv-vscode) — JSONV language support for Visual Studio Code.
- [**jsonv-eslint-plugin-jsonv**](https://github.com/CLDMV/jsonv-eslint-plugin-jsonv) — ESLint plugin for JSONV.
- [**jsonv-prettier-plugin-jsonv**](https://github.com/CLDMV/jsonv-prettier-plugin-jsonv) — Prettier plugin for JSONV.
- [**deskport**](https://github.com/CLDMV/deskport) — VS Code extension that launches dev targets on your local machine even when the repo lives on a remote SSH host.

## ⚙️ Org CI/CD infrastructure

The [**`.github`**](https://github.com/CLDMV/.github) repository is the backbone of every CLDMV project: a complete CI / release / publish pipeline built on reusable GitHub Actions workflows.

- **v4 staging-branch release flow** — feature work batches onto `next`, urgent fixes onto `hotfixes`, and `master` stays a clean, release-only history. One persistent release PR ships the accumulated bundle when a maintainer clicks merge.
- **Security by default** — CodeQL, dependency review, OpenSSF Scorecard, container scanning, and CLA enforcement, all as drop-in reusable workflows.
- **One-shot onboarding** — branches, rulesets, security toggles, and repo settings applied org-wide from a single dispatch.

Consumer repos pin `@v4` and get the whole pipeline; the `.github` repo dogfoods every workflow on itself.

## 🚧 In development

Several larger projects are in private development and will be announced when they're ready:

- A construction-plan production automation suite spanning Adobe Illustrator, Bluebeam Revu, and PDF workflows — with a broader scope on the way.
- A pure-Node.js ADB driver that speaks the protocol directly, with no platform-tools download required.
- A self-hosted MCP server and CLI that turns your Claude Code and VS Code chat history into fast, hybrid-searchable agent memory — with "fade, don't forget" ranking that lets unused knowledge decay without ever evicting it.
- A cross-platform application platform — desktop, iOS, and Android — with batteries-included primitives: a process-isolated extension host, a built-in widget and icon library, boot/splash orchestration, and i18n, plus CLIs that scaffold new apps and extensions so app-level code stays thin.
- A desktop app built on that platform that discovers, classifies, reconciles, and migrates git repositories across local and SSH sources.

## 💜 Support

CLDMV is independently maintained. If our work saves you time, consider [sponsoring on GitHub](https://github.com/sponsors/shinrai).

<div align="center">
<sub>Built and maintained by <a href="https://github.com/Shinrai">Shinrai</a> · <a href="https://cldmv.net">cldmv.net</a></sub>
</div>
