#!/bin/bash
# Parallel whois-based availability check. Writes results to a temp file and
# prints them sorted at the end.

DOMAINS=(
  "sunrisesunset.ai"
  "sunrisesunset.com"
  "sunrisesunset.live"
  "sunrisesunset.earth"
  "sunrisesunset.world"
  "sunrisesunset.app"
  "sunrisesunset.net"
  "sunrisesunset.io"
  "sunrisesunset.xyz"
  "sunrisesunset.today"
  "sunrisesunset.studio"
  "sunrisesunset.art"
  "sunrisesunset.cam"
  "realsunset.com"
  "realsunsets.com"
  "realsunset.live"
  "realsunsets.live"
  "livesunset.com"
  "livesunset.live"
  "livesunsets.com"
  "livesunsets.live"
  "sunsets.live"
  "sunrises.live"
  "sunset.earth"
  "sunrises.earth"
  "sunsets.earth"
  "goldenhour.live"
  "goldenhour.earth"
  "goldenhour.today"
  "alwaysgoldenhour.com"
  "alwaysgoldenhour.live"
  "neverendingsunset.com"
  "neverendingsunset.live"
  "eternalsunset.com"
  "eternalsunset.live"
  "terminator.earth"
  "theterminator.live"
  "aroundthesun.com"
  "aroundthesun.live"
  "aroundthesun.earth"
  "sunsetring.com"
  "sunsetring.live"
  "planetarysunset.com"
  "planetarysunset.live"
  "realgoldenhour.com"
  "sunsetnow.com"
  "sunsetnow.live"
  "sunsetsnow.com"
  "realsunrise.com"
  "livesunrise.com"
  "therealsunset.com"
  "thesunsetmap.com"
  "sunsetmap.com"
  "sunsetmap.live"
  "sunsetmap.earth"
  "thesunsetproject.com"
  "sunsetsoftheworld.com"
  "worldsunset.com"
  "worldsunsets.com"
)

TMP=$(mktemp)

check_one() {
  local d="$1"
  local out
  # macOS lacks `timeout`; use perl's alarm instead to cap each whois at ~8s.
  out=$(perl -e 'alarm 8; exec @ARGV' whois "$d" 2>/dev/null)
  if printf '%s' "$out" | grep -qiE '^(no match|not found|no data found|no entries found|domain not found|the queried object does not exist|available|status: *free|status: *available|%% no entries found)'; then
    printf 'AVAILABLE  %s\n' "$d"
    return
  fi
  if ! printf '%s' "$out" | grep -qiE '^(creation date|created|registrar:|registry registrar id|domain status:|updated date|name server|nserver)'; then
    printf 'UNKNOWN    %s  (whois empty or rate-limited)\n' "$d"
    return
  fi
  printf 'TAKEN      %s\n' "$d"
}

run_in_bg() {
  local d="$1"
  { check_one "$d" >> "$TMP"; } &
}

# Launch in batches to avoid overwhelming whois servers.
BATCH=8
i=0
for d in "${DOMAINS[@]}"; do
  run_in_bg "$d"
  i=$((i+1))
  if (( i % BATCH == 0 )); then
    wait
  fi
done
wait

sort "$TMP"
rm -f "$TMP"
