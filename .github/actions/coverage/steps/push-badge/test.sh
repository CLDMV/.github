#!/usr/bin/env bash
# End-to-end test for push-badge: publishes to a local bare repo (via url.insteadOf) with a stub signer. Covers the coverage index (#540). Run via npm test.
set -euo pipefail
ACTION="$PWD/.github/actions/coverage/steps/push-badge/action.mjs"
W=$(mktemp -d); trap 'rm -rf "$W"' EXIT
git init -q --bare "$W/remote.git"
cat > "$W/fakegpg" <<'G'
#!/usr/bin/env bash
cat >/dev/null; echo "[GNUPG:] SIG_CREATED D 1 8 00 0 0" >&2; printf -- "-----BEGIN PGP SIGNATURE-----\nfake\n-----END PGP SIGNATURE-----\n"
G
chmod +x "$W/fakegpg"
export GIT_CONFIG_GLOBAL="$W/gitconfig"
git config --global url."$W/remote.git".insteadOf "https://x-access-token:tok@github.com/o/r.git"
git config --global gpg.program "$W/fakegpg"
git config --global init.defaultBranch master
run() { # $1 workdir, then NAME=VALUE inputs
  local d="$1"; shift
  ( cd "$d" && env BOT_TOKEN=tok RUNNER_TEMP="$W/tmp" INPUT_REPOSITORY=o/r 'INPUT_BOT-NAME=bot' 'INPUT_BOT-EMAIL=b@x' "$@" node "$ACTION" )
}
mkdir -p "$W/tmp"
mk() { local d="$W/$1"; git init -q "$d"; (cd "$d"; git config user.name t; git config user.email t@x; git commit -q --allow-empty -m init; git remote add origin https://x-access-token:tok@github.com/o/r.git; echo '{"x":1}' > badge.json); echo "$d"; }

# 1. with an index
d=$(mk a); mkdir -p "$d/coverage"; echo '{"src/a.mjs":["t.test.mjs"]}' > "$d/coverage/coverage-index.json"
run "$d" 'INPUT_BADGE-FILENAME=coverage-next.json' 'INPUT_INDEX-PATH=coverage/coverage-index.json' 'INPUT_INDEX-FILENAME=coverage-index-next.json'
files=$(git --git-dir="$W/remote.git" ls-tree --name-only badges | tr '\n' ' ')
[ "$files" = "coverage-index-next.json coverage-next.json " ] || { echo "FAIL 1: $files"; exit 1; }
msg=$(git --git-dir="$W/remote.git" log -1 --format=%s badges)
[ "$msg" = "ci: update coverage badge and index" ] || { echo "FAIL 1 msg: $msg"; exit 1; }
echo "ok 1 - index published per branch with the badge"

# 2. no index produced → badge only, silently
d=$(mk b)
run "$d" 'INPUT_BADGE-FILENAME=coverage.json' 'INPUT_INDEX-PATH=coverage/coverage-index.json' 'INPUT_INDEX-FILENAME=coverage-index.json' > "$W/out2"
files=$(git --git-dir="$W/remote.git" ls-tree --name-only badges | tr '\n' ' ')
[ "$files" = "coverage-index-next.json coverage-next.json coverage.json " ] || { echo "FAIL 2: $files"; exit 1; }
grep -q "No coverage index" "$W/out2" || { echo "FAIL 2: no skip message"; exit 1; }
! grep -q "::warning\|::error" "$W/out2" || { echo "FAIL 2: warned"; exit 1; }
echo "ok 2 - missing index skipped silently"

# 3. rerun unchanged → no new commit
before=$(git --git-dir="$W/remote.git" rev-parse badges)
d=$(mk c); mkdir -p "$d/coverage"; echo '{"src/a.mjs":["t.test.mjs"]}' > "$d/coverage/coverage-index.json"
run "$d" 'INPUT_BADGE-FILENAME=coverage-next.json' 'INPUT_INDEX-PATH=coverage/coverage-index.json' 'INPUT_INDEX-FILENAME=coverage-index-next.json' > "$W/out3"
[ "$(git --git-dir="$W/remote.git" rev-parse badges)" = "$before" ] || { echo "FAIL 3: committed"; exit 1; }
echo "ok 3 - unchanged badge+index skips the commit"

# 4. bad index filename rejected
d=$(mk e)
if run "$d" 'INPUT_BADGE-FILENAME=coverage.json' 'INPUT_INDEX-PATH=x' 'INPUT_INDEX-FILENAME=../evil.json' >"$W/out4" 2>&1; then echo "FAIL 4"; exit 1; fi
echo "ok 4 - path-like index filename rejected"
# 5. tests failed → "tests failing" badge (no number) + index
d=$(mk f); mkdir -p "$d/coverage"; echo '{"src/b.mjs":["u.test.mjs"]}' > "$d/coverage/coverage-index.json"; rm "$d/badge.json"
run "$d" 'INPUT_BADGE-FILENAME=coverage-next.json' 'INPUT_INDEX-PATH=coverage/coverage-index.json' 'INPUT_INDEX-FILENAME=coverage-index-next.json' 'INPUT_TESTS-FAILED=true'
badge=$(git --git-dir="$W/remote.git" show badges:coverage-next.json)
[ "$badge" = '{"schemaVersion":1,"label":"coverage","message":"tests failing","color":"red"}' ] || { echo "FAIL 5: badge $badge"; exit 1; }
[ "$(git --git-dir="$W/remote.git" show badges:coverage-index-next.json)" = '{"src/b.mjs":["u.test.mjs"]}' ] || { echo "FAIL 5: index not updated"; exit 1; }
msg=$(git --git-dir="$W/remote.git" log -1 --format=%s badges)
[ "$msg" = "ci: mark coverage badge as tests failing and update index" ] || { echo "FAIL 5 msg: $msg"; exit 1; }
echo "ok 5 - failed run publishes a tests-failing badge and the index"

# 6. next passing run puts a number back
d=$(mk g); echo '{"x":2}' > "$d/badge.json"
run "$d" 'INPUT_BADGE-FILENAME=coverage-next.json'
[ "$(git --git-dir="$W/remote.git" show badges:coverage-next.json)" = '{"x":2}' ] || { echo "FAIL 6: number not restored"; exit 1; }
echo "ok 6 - passing run replaces the tests-failing badge"

# 7. publish-badge false + no index → nothing to do
before=$(git --git-dir="$W/remote.git" rev-parse badges)
d=$(mk h); rm "$d/badge.json"
run "$d" 'INPUT_BADGE-FILENAME=coverage.json' 'INPUT_INDEX-PATH=coverage/coverage-index.json' 'INPUT_PUBLISH-BADGE=false' > "$W/out7"
[ "$(git --git-dir="$W/remote.git" rev-parse badges)" = "$before" ] || { echo "FAIL 7: committed"; exit 1; }
grep -q "nothing to do" "$W/out7" || { echo "FAIL 7: no message"; exit 1; }
echo "ok 7 - publish-badge false with no index is a no-op"
echo "all push-badge e2e checks passed"
