#!/bin/bash
# Builds the Chrome and Edge zips from the last commit.
#
#     tools/build-webstore.sh            → build/spruce-<version>-webstore.zip
#     tools/build-webstore.sh --manual   → build/spruce-<version>-chrome-manual-install.zip
#
# Store zip (default): what to upload to the Chrome Web Store (and Microsoft Edge Add-ons): the same
# files as any release, minus the "key" field of manifest.json, which the stores refuse on a new
# item's first upload (they give the extension its own ID). Tools are left out.
#
# Manual-install zip (--manual): for the GitHub releases page, for people who load the extension
# themselves (Developer mode → Load unpacked). It keeps the "key" (a public key, safe to publish), so
# every manual install has the same extension ID as the test version and managed policies reach it.
# Everything is inside one folder, S.P.R.U.C.E+-<version>, with INSTALL.md (the install steps) next
# to manifest.json.
set -euo pipefail

MODE=store
case "${1:-}" in
  "") ;;
  --manual) MODE=manual ;;
  *) echo "Usage: $0 [--manual]" >&2; exit 2 ;;
esac

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
[ -z "$(git status --porcelain -- . ':!build')" ] || echo "Note: uncommitted changes are not included (the zip is built from the last commit)." >&2
VERSION="$(python3 -c 'import json; print(json.load(open("manifest.json"))["version"])')"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

if [ "$MODE" = manual ]; then
  DIR="$TMP/S.P.R.U.C.E+-$VERSION"
  ZIP="$ROOT/build/spruce-$VERSION-chrome-manual-install.zip"
else
  DIR="$TMP"
  ZIP="$ROOT/build/spruce-$VERSION-webstore.zip"
fi
mkdir -p "$DIR"
git archive --format=tar HEAD | tar -x -C "$DIR"
rm -rf "$DIR/tools"

if [ "$MODE" = manual ]; then
  python3 - "$DIR/manifest.json" <<'PY'
import json, sys
if 'key' not in json.load(open(sys.argv[1], encoding='utf-8')):
    sys.exit('manifest.json has no "key": manual installs would each get a different extension ID.')
PY
  git show HEAD:docs/INSTALL-FOR-TESTERS.md > "$DIR/INSTALL.md"
else
  python3 - "$DIR/manifest.json" <<'PY'
import json, sys
path = sys.argv[1]
with open(path, encoding='utf-8') as f:
    m = json.load(f)
m.pop('key', None)
if len(m.get('description', '')) > 132:
    sys.exit('manifest.json: the description is over 132 characters, which the Chrome Web Store refuses.')
with open(path, 'w', encoding='utf-8') as f:
    json.dump(m, f, indent=2, ensure_ascii=False)
    f.write('\n')
PY
fi

mkdir -p "$ROOT/build"
rm -f "$ZIP"
(cd "$TMP" && zip -qr -X "$ZIP" .)
echo "Done: $ZIP"
