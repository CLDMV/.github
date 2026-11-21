# CLDMV self-hosted runner image = the official ARC runner + gh CLI + jq + zip/unzip + Node.js + corepack (pnpm/yarn) + build-essential/python3 + rsync/sqlite3 + Playwright system libraries + node-gyp headers + tmux (distro and 3.8).
#
# The stock ghcr.io/actions/actions-runner image is deliberately minimal and
# ships no gh, jq, or node, unlike GitHub's hosted ubuntu-latest. Once v4.19.1
# routed private CLDMV CI to these self-hosted cldmv-runners, every reusable job
# that shells out to gh started failing with exit 127 (gh: command not found),
# and run steps invoking node/npm directly hit the same gap. This image adds gh,
# jq, and Node.js (current LTS — all preinstalled on hosted runners and
# reasonably assumed by workflow run steps) so those jobs run on self-hosted
# exactly as they did on hosted. Jobs that need a specific Node version still
# use actions/setup-node, which prepends its own toolcache copy to PATH; the
# baked-in LTS is only the default, matching hosted-runner behavior. See #210.
#
# Nothing sensitive is baked in: this is the public base image plus the gh binary
# from GitHub's public apt repo. Runner auth (the GitHub App) lives in the
# cldmv-runners-github-app Kubernetes Secret at runtime, and per-job GH_TOKEN is
# injected by Actions — neither is in the image.

# tmux 3.8, built from the release tarball into /opt/tmux-3.8 in its own stage so
# the compiler and -dev packages stay out of the runner image. Some test suites
# start real private tmux servers and pin 3.8 at that path (same as on
# 01.homelab); Ubuntu 24.04 only ships 3.4. The tarball has no
# signature, so it's pinned by checksum. Same base as the final stage, so the
# binary links against the libevent/ncurses the final stage installs.
FROM ghcr.io/actions/actions-runner:latest AS tmux-build
USER root
ARG TMUX_VERSION=3.8
ARG TMUX_SHA256=e79c699c7e949dccd0a4a125e17b8d1261e311b16979dbc8eb34542f3966d82e
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl build-essential pkg-config bison libevent-dev libncurses-dev \
 && curl -fsSL -o /tmp/tmux.tar.gz "https://github.com/tmux/tmux/releases/download/${TMUX_VERSION}/tmux-${TMUX_VERSION}.tar.gz" \
 && echo "${TMUX_SHA256}  /tmp/tmux.tar.gz" | sha256sum -c - \
 && tar -xzf /tmp/tmux.tar.gz -C /tmp \
 && cd "/tmp/tmux-${TMUX_VERSION}" \
 && ./configure --prefix="/opt/tmux-${TMUX_VERSION}" \
 && make -j"$(nproc)" \
 && make install

FROM ghcr.io/actions/actions-runner:latest

LABEL org.opencontainers.image.source="https://github.com/CLDMV/.github"
LABEL org.opencontainers.image.description="ARC actions-runner + gh, jq, zip/unzip, Node.js LTS, corepack (pnpm/yarn), build-essential, python3, rsync, sqlite3, Playwright system libraries, tmux for CLDMV self-hosted cldmv-runners"
LABEL org.opencontainers.image.licenses="Apache-2.0"

# Package installs need root; the base runs as the non-root `runner` user.
USER root

# gh via GitHub's official apt repo (keeps it upgradable with the image); jq and
# zip/unzip come from the base Ubuntu repos. zip is needed by
# workflow-publish.yml's create-package-files step, which shells out to `zip`
# to build the release .zip and failed with "zip: not found" on every private
# release routed here. See #291 (same class as #210's gh gap).
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates \
 && install -m 0755 -d /etc/apt/keyrings \
 && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
      -o /etc/apt/keyrings/githubcli-archive-keyring.gpg \
 && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
 && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
      > /etc/apt/sources.list.d/github-cli.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends gh jq zip unzip \
 && rm -rf /var/lib/apt/lists/*

# Node.js current LTS via NodeSource's lts channel (includes npm/npx). The
# channel resolves to whatever the active LTS major is at build time, so the
# weekly rebuild tracks LTS promotions and security releases without a version
# baked into this file.
RUN curl -fsSL https://deb.nodesource.com/setup_lts.x | bash - \
 && apt-get install -y --no-install-recommends nodejs \
 && rm -rf /var/lib/apt/lists/*

# libatomic1 — actions/setup-node downloads its own prebuilt Node tarballs
# from actions/node-versions, independently of the NodeSource install above,
# whenever a workflow pins a specific version via setup-node. Node 26's
# official linux-x64 build links against libatomic.so.1, which this minimal
# base image doesn't ship (hosted ubuntu-latest runners already have it).
# Without it, any job that requests Node 26 via setup-node fails immediately
# with "error while loading shared libraries: libatomic.so.1: cannot open
# shared object file" before it can even print `node --version`.
RUN apt-get update \
 && apt-get install -y --no-install-recommends libatomic1 \
 && rm -rf /var/lib/apt/lists/*

# C/C++ toolchain for native npm modules. node-gyp (node-pty, ssh2's
# cpu-features, …) needs make, a C++ compiler and python3; without them a pnpm
# or npm install of such a package fails ("not found: make", "Unable to detect
# compiler type"). Hosted ubuntu-latest ships build-essential and python3. See #497.
RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential python3 \
 && rm -rf /var/lib/apt/lists/*

# pnpm and yarn via corepack. Node 25+ no longer bundles corepack, so the
# NodeSource Node 26 above has neither, and anything that runs straight in this
# image (k3s-test pods, run steps that skip the #437 helper) can't install a
# pnpm workspace. corepack is still published on npm; `corepack enable` puts the
# pnpm/yarn shims on PATH, and each repo's `packageManager` pin still picks the
# version. See #497.
# No interactive "about to download pnpm" prompt in CI or test pods.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN npm install -g corepack@latest \
 && corepack enable \
 && npm cache clean --force

# rsync and the sqlite3 CLI, both on hosted ubuntu-latest. Deploy-flow tests
# shell out to rsync, and storage tests inspect databases with sqlite3.
RUN apt-get update \
 && apt-get install -y --no-install-recommends rsync sqlite3 \
 && rm -rf /var/lib/apt/lists/*

# System libraries for Playwright's chromium, webkit and firefox (libnspr4,
# libnss3, libsecret-1, libgtk, gstreamer, …). Browser tests need them, and
# k3s-test pods and CI jobs run without sudo, so `playwright install-deps`
# can't add them at run time. Only the libraries are baked in: the browsers
# stay per-run downloads (`npx playwright install`), pinned by each repo's
# Playwright version. Built from playwright@latest, so the weekly rebuild tracks
# its dependency list.
RUN apt-get update \
 && npx -y playwright@latest install-deps chromium webkit firefox \
 && npm cache clean --force \
 && rm -rf /var/lib/apt/lists/* /root/.npm

# tmux: the distro build (3.4) on PATH, plus 3.8 from the tmux-build stage at
# /opt/tmux-3.8. The distro package also brings the runtime libraries
# (libevent-core, libutempter) the 3.8 binary needs. Tests that start private
# tmux servers can't run in k3s-test pods without it.
RUN apt-get update \
 && apt-get install -y --no-install-recommends tmux \
 && rm -rf /var/lib/apt/lists/*
COPY --from=tmux-build /opt/tmux-3.8 /opt/tmux-3.8

# Add further hosted-runner tools here as #210's audit surfaces them.

# Back to the runner user the entrypoint expects.
USER runner

# Build-time gate: fail the build if any expected tool isn't on PATH.
RUN gh --version && jq --version && node --version && npm --version \
 && corepack --version && pnpm --version \
 && make --version >/dev/null && g++ --version >/dev/null && python3 --version \
 && zip -v >/dev/null && unzip -v >/dev/null \
 && rsync --version >/dev/null && sqlite3 --version \
 && tmux -V && /opt/tmux-3.8/bin/tmux -V \
 && env -u TERM /opt/tmux-3.8/bin/tmux -L gate new -d && /opt/tmux-3.8/bin/tmux -L gate kill-server \
 && env -u TERM tmux -L gate new -d && tmux -L gate kill-server

# node-gyp headers for the baked-in Node, in ~/.cache/node-gyp/<version>.
# Without them every native build in a pod downloads the headers itself, and
# two packages building in parallel (pnpm runs install scripts concurrently)
# each extract their own copy over the shared directory. The second extract
# leaves common.gypi newer than the first package's Makefile, make takes the
# "Regenerating Makefile" path, and that runs gyp_main.py directly, which is
# 644 in the node-gyp tarball: "Permission denied" (node-pty + cpu-features in
# rummage, 2026-11-20). With the headers already here, node-gyp skips the
# download. A job that switches Node with setup-node still downloads headers
# for that version.
RUN npx -y node-gyp@latest install \
 && test -f "$HOME/.cache/node-gyp/$(node -p process.versions.node)/include/node/common.gypi" \
 && rm -rf "$HOME/.npm"

# Gate: headless chromium launches with the baked-in libraries. The browser and
# the scratch project are removed afterwards so the image doesn't carry them.
RUN set -e; d=$(mktemp -d); cd "$d" \
 && npm init -y >/dev/null && npm install --no-audit --no-fund playwright@latest >/dev/null \
 && npx playwright install chromium \
 && node -e 'require("playwright").chromium.launch().then(async (b) => { const p = await b.newPage(); await p.setContent("<p>ok</p>"); if ((await p.textContent("p")) !== "ok") process.exit(1); await b.close(); console.log("chromium headless ok"); })' \
 && cd / && rm -rf "$d" "$HOME/.cache/ms-playwright" "$HOME/.npm"
