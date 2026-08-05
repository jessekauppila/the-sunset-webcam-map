#!/usr/bin/env bash
# Create/refresh ~/.config/sunset/router.env — the single local secrets file
# for the GL-X3000 tooling. Generates the rotation targets (new admin password,
# new wifi PSK) and prompts once for the CURRENT admin password. Nothing is
# ever printed to stdout, so it's safe to run inside an AI session; open the
# file yourself afterwards to copy values into the password manager.
set -euo pipefail
ENV_FILE="$HOME/.config/sunset/router.env"
mkdir -p "$(dirname "$ENV_FILE")"
touch "$ENV_FILE"
chmod 600 "$ENV_FILE"

getk() { grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- || true; }
setk() {
  grep -vE "^$1=" "$ENV_FILE" > "$ENV_FILE.tmp" || true
  printf '%s=%s\n' "$1" "$2" >> "$ENV_FILE.tmp"
  mv "$ENV_FILE.tmp" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
}
gen() { python3 -c "import secrets,string; print(''.join(secrets.choice(string.ascii_letters+string.digits) for _ in range($1)))"; }

[ -n "$(getk GLINET_HOST)" ] || setk GLINET_HOST 192.168.8.1

if [ -z "$(getk GLINET_PASSWORD)" ]; then
  read -rs -p "CURRENT router admin password (from your password manager, never echoed): " CUR
  echo
  setk GLINET_PASSWORD "$CUR"
fi

# Rotation targets — generated alphanumeric-only so they pass safely through
# ssh/nmcli quoting. Kept under separate keys until rotate-creds.sh confirms
# the router actually accepted them, then promoted.
[ -n "$(getk GLINET_NEW_PASSWORD)" ] || setk GLINET_NEW_PASSWORD "$(gen 20)"
[ -n "$(getk WIFI_NEW_PSK)" ] || setk WIFI_NEW_PSK "$(gen 16)"

echo "OK — $ENV_FILE ready (chmod 600)."
echo "Keys: GLINET_HOST, GLINET_PASSWORD (current), GLINET_NEW_PASSWORD, WIFI_NEW_PSK."
echo "View it yourself (outside any AI session) to file the new values in your password manager."
