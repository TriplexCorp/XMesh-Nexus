#!/bin/sh
# Build-time panel display version: 6.0.0 at the rollout anchor, 6.0.1
# after the next main commit, then 6.0.2, etc. The canonical VERSION
# remains the v6 protocol compatibility contract for nodes and XSP.
# This script never contacts GitHub or writes to the checkout.
set -eu
revision=${1:-unknown}
checkout=${2:-.}
anchor=${3:-23297ed23c473be3a509f2f57dd4fc1409c768ca}
base=$(tr -d '\r\n' < "$checkout/VERSION") || exit 1
case "$base" in
  *.*.*) ;;
  *) printf '%s\n' "$base"; exit 0 ;;
esac
major=${base%%.*}
rest=${base#*.}
minor=${rest%%.*}
patch=${rest#*.}
case "$major$minor$patch" in *[!0-9]*|'') printf '%s\n' "$base"; exit 0 ;; esac
valid_sha() {
  [ "${#1}" -eq 40 ] || return 1
  case "$1" in *[!0123456789abcdef]*) return 1 ;; esac
}
if ! valid_sha "$revision" || ! valid_sha "$anchor" || ! command -v git >/dev/null 2>&1; then
  printf '%s\n' "$base"; exit 0
fi
# A build must never report another checkout's version or invent an update
# for source archives, dirty checkouts or shallow clones missing the anchor.
head=$(GIT_OPTIONAL_LOCKS=0 git -C "$checkout" rev-parse HEAD 2>/dev/null || true)
if [ "$head" != "$revision" ] ||
   ! GIT_OPTIONAL_LOCKS=0 git -C "$checkout" cat-file -e "$anchor^{commit}" 2>/dev/null ||
   ! GIT_OPTIONAL_LOCKS=0 git -C "$checkout" merge-base --is-ancestor "$anchor" "$revision" 2>/dev/null; then
  printf '%s\n' "$base"; exit 0
fi
count=$(GIT_OPTIONAL_LOCKS=0 git -C "$checkout" rev-list --first-parent --count "$anchor..$revision" 2>/dev/null || true)
case "$count" in ''|*[!0-9]*) printf '%s\n' "$base"; exit 0 ;; esac
# Guard against arbitrarily large or corrupted histories.
[ "$count" -le 100000 ] || { printf '%s\n' "$base"; exit 0; }
printf '%s.%s.%s\n' "$major" "$minor" "$((patch + count))"
