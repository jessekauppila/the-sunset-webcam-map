#!/bin/zsh
# Fast domain availability check hitting each TLD's authoritative RDAP server
# directly, so we avoid the slow rdap.org redirect chain.
#
# HTTP 404  -> AVAILABLE
# HTTP 200  -> TAKEN
# anything else -> UNKNOWN

rdap_base_for() {
  case "$1" in
    com|net)  echo "https://rdap.verisign.com/${1}/v1/domain" ;;
    ai)       echo "https://rdap.nic.ai/domain" ;;
    live|studio|today|world|ws|wiki|pro|sh) echo "https://rdap.identitydigital.services/rdap/domain" ;;
    io)       echo "https://rdap.identitydigital.services/rdap/domain" ;;
    cam)      echo "https://tld-rdap.verisign.com/cam/v1/domain" ;;
    xyz|art)  echo "https://rdap.centralnic.com/${1}/domain" ;;
    earth)    echo "https://rdap.nic.earth/domain" ;;
    app)      echo "https://www.registry.google/rdap/domain" ;;
    *)        echo "" ;;
  esac
}

DOMAINS=(
  sunrisesunset.ai
  sunrisesunset.com
  sunrisesunset.net
  sunrisesunset.live
  sunrisesunset.earth
  sunrisesunset.world
  sunrisesunset.app
  sunrisesunset.io
  sunrisesunset.xyz
  sunrisesunset.art
  sunrisesunset.studio
  sunrisesunset.today
  sunrisesunset.cam
  sunsets.live
  sunsets.earth
  sunrises.live
  sunrises.earth
  sunset.earth
  sunsetsnow.com
  terminator.earth
  goldenhour.live
  goldenhour.earth
  alwaysgoldenhour.com
  realsunset.com
  realsunsets.com
  livesunset.com
  livesunsets.com
  neverendingsunset.com
  eternalsunset.com
  sunsetmap.com
  sunsetring.com
  sunsetnow.com
  aroundthesun.com
  aroundthesun.live
  planetarysunset.com
  realgoldenhour.com
  therealsunset.com
  worldsunset.com
  worldsunsets.com
  thesunsetproject.com
  alwayssunset.com
  sunsetlive.com
  thesunsetmap.com
  sunsetsoftheworld.com
)

for d in "${DOMAINS[@]}"; do
  tld="${d##*.}"
  base=$(rdap_base_for "$tld")
  if [ -z "$base" ]; then
    printf 'SKIP       %s   (no RDAP for .%s)\n' "$d" "$tld"
    continue
  fi
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 4 "$base/$d")
  case "$code" in
    404) printf 'AVAILABLE  %s\n' "$d" ;;
    200) printf 'TAKEN      %s\n' "$d" ;;
    000) printf 'TIMEOUT    %s\n' "$d" ;;
    *)   printf 'UNK(%s)   %s\n' "$code" "$d" ;;
  esac
done
