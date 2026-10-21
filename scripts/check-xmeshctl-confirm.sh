#!/usr/bin/env bash
set -Eeuo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
# Sourcing the CLI must not enter the interactive menu or require Docker.
source ./xmeshctl

accepted() {
  if ! printf "%b" "$1" | confirm_yes "Подтвердить? [y/N] " >/dev/null 2>&1; then
    printf "Unexpected rejection of input %q\n" "$1" >&2
    return 1
  fi
}
rejected() {
  if printf "%b" "$1" | confirm_yes "Подтвердить? [y/N] " >/dev/null 2>&1; then
    printf "Unexpected approval of input %q\n" "$1" >&2
    return 1
  fi
}

accepted "y\n"
accepted "Y\n"
accepted "yes\n"
accepted "YES\n"
accepted "да\n"
accepted "Да\n"
accepted "   y  \r\n"
accepted "y\r\n"
accepted "  ДА  \r\n"
accepted "непонятно\ny\r\n"
rejected "n\n"
rejected "N\r\n"
rejected "no\n"
rejected "нет\r\n"
rejected "\n"
rejected " \r\n"
rejected "nope\nn\n"
rejected ""

# No local backups, stashes or git status checks may run before approval.
update_code="$(sed -n '/^update_panel() {/,/^}/p' xmeshctl)"
confirmation_line="$(printf "%s\n" "$update_code" | grep -n -m 1 'if ! confirm_yes "Продолжить?' | cut -d: -f1)"
status_line="$(printf "%s\n" "$update_code" | grep -n -m 1 'status_lines="$(git' | cut -d: -f1)"
[[ -n "$confirmation_line" && -n "$status_line" && "$confirmation_line" -lt "$status_line" ]] || {
  echo "Update side effects must occur only after confirmation" >&2
  exit 1
}

# Regression integration: a negative answer must never touch the repo state.
git() {
  case "$*" in
    *"rev-parse --is-inside-work-tree"*) return 0 ;;
    *"branch --show-current"*) printf "main\n" ;;
    *"rev-parse --abbrev-ref --symbolic-full-name"*) printf "origin/main\n" ;;
    *) echo "Unexpected git operation: $*" >&2; return 99 ;;
  esac
}
result="$(update_panel <<< "n" 2>&1)"
[[ "$result" == *"Обновление отменено"* ]] || { echo "Update cancellation was not honored" >&2; exit 1; }
result="$(update_panel <<< $(printf "n\r") 2>&1)"
[[ "$result" == *"Обновление отменено"* ]] || { echo "CRLF cancellation was not honored" >&2; exit 1; }

echo "xmeshctl interactive confirmations: OK"
