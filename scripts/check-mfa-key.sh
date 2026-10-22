#!/usr/bin/env bash
set -Eeuo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
helper="$PWD/deploy/ensure-totp-key.sh"
bash -n "$helper"
bash -n install.sh
bash -n xmeshctl

work="$(mktemp -d)"
trap 'rm -rf -- "$work"' EXIT

valid_key() {
  local val
  val="$(sed -n 's/^TOTP_ENCRYPTION_KEY=//p' "$1")"
  [[ "$val" =~ ^[[:xdigit:]]{64}$ ]]
}

# New .env without MFA key: generate one once and preserve ordinary configuration.
printf 'ADMIN_USERNAME=admin\nREDIS_PASSWORD=test-placeholder\n' > "$work/missing.env"
bash "$helper" "$work/missing.env" >/dev/null
valid_key "$work/missing.env"
grep -qx 'REDIS_PASSWORD=test-placeholder' "$work/missing.env"
first="$(sed -n 's/^TOTP_ENCRYPTION_KEY=//p' "$work/missing.env")"
bash "$helper" "$work/missing.env" >/dev/null
[[ "$(sed -n 's/^TOTP_ENCRYPTION_KEY=//p' "$work/missing.env")" == "$first" ]]

# A blank entry is repaired (not duplicated) without changing unrelated values.
printf 'ADMIN_USERNAME=admin\nTOTP_ENCRYPTION_KEY=\nDB_MAX_CONNECTIONS=20\n' > "$work/blank.env"
bash "$helper" "$work/blank.env" >/dev/null
valid_key "$work/blank.env"
[[ "$(grep -c '^TOTP_ENCRYPTION_KEY=' "$work/blank.env")" == 1 ]]
grep -qx 'DB_MAX_CONNECTIONS=20' "$work/blank.env"

# Existing valid keys are never replaced even if the installer runs repeatedly.
printf 'TOTP_ENCRYPTION_KEY=%064d\n' 0 > "$work/stable.env"
bash "$helper" "$work/stable.env" >/dev/null
grep -qx "TOTP_ENCRYPTION_KEY=$(printf '%064d' 0)" "$work/stable.env"

# Invalid populated keys must fail closed, not generate a replacement.
printf 'TOTP_ENCRYPTION_KEY=old-encrypted-secret\n' > "$work/broken.env"
if bash "$helper" "$work/broken.env" >/dev/null 2>&1; then
  echo 'An invalid nonempty key must not be replaced automatically' >&2
  exit 1
fi
grep -qx 'TOTP_ENCRYPTION_KEY=old-encrypted-secret' "$work/broken.env"

# Duplicate entries must never be modified or silently reduced to one.
printf 'TOTP_ENCRYPTION_KEY=\nTOTP_ENCRYPTION_KEY=\n' > "$work/duplicate.env"
if bash "$helper" "$work/duplicate.env" >/dev/null 2>&1; then
  echo 'Duplicate MFA key entries must be rejected' >&2
  exit 1
fi
[[ "$(grep -c '^TOTP_ENCRYPTION_KEY=' "$work/duplicate.env")" == 2 ]]

for file in missing.env blank.env stable.env; do
  [[ "$(stat -c '%a' "$work/$file")" == 600 ]]
done
echo 'MFA key migration, persistence, no key rotation and shell syntax: OK'
