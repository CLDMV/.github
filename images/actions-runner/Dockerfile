# CLDMV self-hosted runner image = the official ARC runner + gh CLI + jq.
#
# The stock ghcr.io/actions/actions-runner image is deliberately minimal and
# ships no gh or jq, unlike GitHub's hosted ubuntu-latest. Once v4.19.1 routed
# private CLDMV CI to these self-hosted cldmv-runners, every reusable job that
# shells out to gh started failing with exit 127 (gh: command not found). This
# image adds gh (and jq, which hosted runners also preinstall and workflow run
# steps reasonably assume) so those jobs run on self-hosted exactly as they did
# on hosted. See #210.
#
# Nothing sensitive is baked in: this is the public base image plus the gh binary
# from GitHub's public apt repo. Runner auth (the GitHub App) lives in the
# cldmv-runners-github-app Kubernetes Secret at runtime, and per-job GH_TOKEN is
# injected by Actions — neither is in the image.
FROM ghcr.io/actions/actions-runner:latest

LABEL org.opencontainers.image.source="https://github.com/CLDMV/.github"
LABEL org.opencontainers.image.description="ARC actions-runner + gh CLI for CLDMV self-hosted cldmv-runners"
LABEL org.opencontainers.image.licenses="Apache-2.0"

# Package installs need root; the base runs as the non-root `runner` user.
USER root

# gh via GitHub's official apt repo (keeps it upgradable with the image).
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates \
 && install -m 0755 -d /etc/apt/keyrings \
 && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
      -o /etc/apt/keyrings/githubcli-archive-keyring.gpg \
 && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
 && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
      > /etc/apt/sources.list.d/github-cli.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends gh jq \
 && rm -rf /var/lib/apt/lists/*

# Add further hosted-runner tools here as #210's audit surfaces them.

# Back to the runner user the entrypoint expects.
USER runner

# Build-time gate: fail the build if gh or jq isn't on PATH.
RUN gh --version && jq --version
