#!/bin/sh
# Resolve immutable build metadata, never using a mutable runtime checkout.
# Explicit trusted SHA wins. For ordinary source builds, accept HEAD only when
# the complete worktree is clean; otherwise a GitHub comparison would lie.
set -eu

requested=${1:-unknown}
source_dir=${2:-.}

valid_sha() {
  printf '%s\n' "$1" | LC_ALL=C grep -Eq '^[0-9a-f]{40}$'
}

if [ "$requested" != "unknown" ] && [ -n "$requested" ]; then
  if valid_sha "$requested"; then
    printf '%s\n' "$requested"
  else
    printf 'unknown\n'
  fi
  exit 0
fi

# Source archives / remote BuildKit contexts may not include .git.
if [ ! -e "$source_dir/.git" ]; then
  printf 'unknown\n'
  exit 0
fi

revision="$(git -c "safe.directory=$source_dir" -C "$source_dir" rev-parse --verify HEAD 2>/dev/null || true)"
if valid_sha "$revision" &&
   git -c "safe.directory=$source_dir" -C "$source_dir" diff --quiet HEAD -- &&
   dirt="$(git -c "safe.directory=$source_dir" -C "$source_dir" status --porcelain --untracked-files=normal 2>/dev/null)" &&
   [ -z "$dirt" ]; then
  printf '%s\n' "$revision"
else
  printf 'unknown\n'
fi
