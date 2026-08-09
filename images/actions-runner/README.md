# CLDMV self-hosted runner image

The image the `cldmv-runners` [actions-runner-controller](https://github.com/actions/actions-runner-controller) scale set runs: the official `ghcr.io/actions/actions-runner` plus the `gh` CLI and `jq`.

## Why

The stock ARC runner image is minimal and ships no `gh` or `jq`, unlike GitHub's hosted `ubuntu-latest`. Once private CLDMV CI moved to these self-hosted runners (v4.19.1), every reusable job that shells out to `gh` failed with exit 127 (`gh: command not found`); `jq` closes the same hosted-vs-self-hosted gap for run steps that parse JSON. See issue #210. Nothing sensitive is baked in (public base + the `gh` and `jq` binaries); runner auth stays in the `cldmv-runners-github-app` Kubernetes Secret and per-job `GH_TOKEN` is injected by Actions.

## Build & publish

`build-runner-image.yml` builds this on a GitHub-hosted runner and pushes `ghcr.io/cldmv/actions-runner:latest` (+ a commit-SHA tag) via the workflow's `GITHUB_TOKEN` — on every push to the default branch that touches this directory, weekly (to pick up base-image and `gh` updates), and on demand via `workflow_dispatch`. The package is public, so the cluster pulls it anonymously.

## Point the scale set at it

`cldmv-runners.values.yaml` in this directory is the scale set's values with the runner container overridden to this image. Apply with:

```bash
helm upgrade cldmv-runners \
  oci://ghcr.io/actions/actions-runner-controller-charts/gha-runner-scale-set \
  --version 0.14.2 --namespace arc-runners \
  -f images/actions-runner/cldmv-runners.values.yaml
```

New runners then pull the published image. `minRunners: 0`, so a runner spins up only when a job is queued.
