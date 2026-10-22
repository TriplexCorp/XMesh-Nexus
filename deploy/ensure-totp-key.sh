#!/usr/bin/env bash
set -Eeuo pipefail

# Add an MFA encryption key only to existing unconfigured installations.
# NEVER replace a nonempty key: it encrypts the administrator's TOTP secret.
env_file="${1:-.env}"

die() { printf 'MFA key setup: %s\n' "$*" >&2; exit 1; }
[[ -f "$env_file" && ! -L "$env_file" ]] || die "Missing regular .env file: $env_file. Run ./install.sh first."
command -v openssl >/dev/null 2>&1 || die "OpenSSL is required."
umask 077

key_lines="$(grep -Ec '^[[:space:]]*TOTP_ENCRYPTION_KEY[[:space:]]*=' "$env_file" || true)"
[[ "$key_lines" =~ ^[0-9]+$ ]] || die "Unable to inspect TOTP_ENCRYPTION_KEY."
if (( key_lines > 1 )); then
  die "Multiple TOTP_ENCRYPTION_KEY entries detected. Resolve duplicates manually; no key was changed."
fi

previous=''
if (( key_lines == 1 )); then
  previous="$(sed -nE 's/^[[:space:]]*TOTP_ENCRYPTION_KEY[[:space:]]*=(.*)$/\1/p' "$env_file")"
  if [[ "$previous" =~ ^[[:xdigit:]]{64}$ ]]; then
    chmod 600 "$env_file"
    echo "MFA encryption key is already configured; existing value preserved."
    exit 0
  fi
  if [[ -n "$previous" ]]; then
    die "Nonempty but invalid TOTP_ENCRYPTION_KEY. Restore the original 64-character hex key; no key was changed."
  fi
fi

key="$(openssl rand -hex 32)"
[[ "$key" =~ ^[[:xdigit:]]{64}$ ]] || die "OpenSSL generated an invalid key."
tmp="$(mktemp "${env_file}.mfa.XXXXXXXX")" || die "Cannot create a secure temporary .env file."
cleanup() { [[ -z "${tmp:-}" ]] || rm -f -- "$tmp"; }
trap cleanup EXIT

if (( key_lines == 1 )); then
  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ "$line" =~ ^[[:space:]]*TOTP_ENCRYPTION_KEY[[:space:]]*= ]]; then
      printf 'TOTP_ENCRYPTION_KEY=%s\n' "$key"
    else
      printf '%s\n' "$line"
    fi
  done < "$env_file" > "$tmp"
else
  cat "$env_file" > "$tmp"
  printf '\nTOTP_ENCRYPTION_KEY=%s\n' "$key" >> "$tmp"
fi

chmod 600 "$tmp"
mv -f -- "$tmp" "$env_file"
tmp=''
echo "A persistent MFA key was added to .env without modifying other settings."
echo "IMPORTANT: Back up .env securely outside the server. Do not publish the key."
echo "If 2FA was previously enabled, restore the ORIGINAL lost key instead: a new key cannot decrypt existing TOTP secrets."
