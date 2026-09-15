# CLDMV self-hosted runner image = the official ARC runner + gh CLI + jq + zip/unzip + Node.js.
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
FROM ghcr.io/actions/actions-runner:latest

LABEL org.opencontainers.image.source="https://github.com/CLDMV/.github"
LABEL org.opencontainers.image.description="ARC actions-runner + gh, jq, zip/unzip, Node.js LTS for CLDMV self-hosted cldmv-runners"
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

# Add further hosted-runner tools here as #210's audit surfaces them.

# Back to the runner user the entrypoint expects.
USER runner

# Build-time gate: fail the build if any expected tool isn't on PATH.
RUN gh --version && jq --version && node --version && npm --version \
 && zip -v >/dev/null && unzip -v >/dev/null
