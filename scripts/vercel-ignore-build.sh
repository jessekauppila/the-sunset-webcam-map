#!/usr/bin/env bash
# Vercel "Ignored Build Step" (vercel.json ignoreCommand).
#
# Exit 0 = skip this build, exit 1 = build. Vercel fails the deployment on any
# OTHER exit code, so every uncertain path here must end in `exit 1`: a wrong
# "build" costs ~100 s, a wrong "skip" or an error can strand production.
#
# Skips only when nothing outside docs/ and *.md changed since the last
# successful deploy of this branch (VERCEL_GIT_PREVIOUS_SHA), not since HEAD^:
# a push of several commits ending in a docs commit must still build.

base="${VERCEL_GIT_PREVIOUS_SHA:-}"

# No previous deploy, or it is older than Vercel's shallow clone: build.
if [ -z "$base" ] || ! git cat-file -e "${base}^{commit}" 2>/dev/null; then
  echo "ignore-build: no usable previous deploy sha (${base:-unset}); building"
  exit 1
fi

if git diff --quiet "$base" HEAD -- . ':!docs' ':!*.md'; then
  echo "ignore-build: only docs/Markdown changed since ${base:0:7}; skipping"
  exit 0
fi

echo "ignore-build: app changes since ${base:0:7}; building"
exit 1
