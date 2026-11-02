#!/bin/bash
# Downloads Firefox ESR (Linux, x86-64) for the Firefox suite into tests/.firefox/<name>/ (never committed).
#
#     tests/firefox/get-firefox.sh        → the current ESR             (tests/.firefox/esr)
#     tests/firefox/get-firefox.sh 140    → the latest 140 ESR, the oldest version the add-on supports
#                                           (tests/.firefox/140)
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)/.firefox"
WANT="${1:-esr}"
if [ "$WANT" = esr ]; then
  URL="https://download.mozilla.org/?product=firefox-esr-latest-ssl&os=linux64&lang=en-US"
else
  VER="$(curl -fsS https://ftp.mozilla.org/pub/firefox/releases/ | grep -oE "${WANT}\.[0-9]+(\.[0-9]+)?esr" | sort -V | tail -1)"
  [ -n "$VER" ] || { echo "No Firefox $WANT ESR found." >&2; exit 1; }
  URL="https://ftp.mozilla.org/pub/firefox/releases/$VER/linux-x86_64/en-US/firefox-$VER.tar.xz"
fi
rm -rf "${DIR:?}/$WANT" && mkdir -p "$DIR/$WANT"
curl -fsSL "$URL" -o "$DIR/$WANT/firefox.tar.xz"
tar -xJf "$DIR/$WANT/firefox.tar.xz" -C "$DIR/$WANT"
rm "$DIR/$WANT/firefox.tar.xz"
"$DIR/$WANT/firefox/firefox" --version
