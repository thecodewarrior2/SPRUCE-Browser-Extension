#!/bin/bash
# Builds the zip to upload to the Chrome Web Store (and Microsoft Edge Add-ons) from the last commit:
# the same files as any release, minus the "key" field of manifest.json, which the stores refuse on a
# new item's first upload (they give the extension its own ID). The key stays in the repository, so
# the unpacked test version keeps its ID. Tester notes and tools are left out too.
#     tools/build-webstore.sh        → build/spruce-<version>-webstore.zip
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
[ -z "$(git status --porcelain -- . ':!build')" ] || echo "Note: uncommitted changes are not included (the zip is built from the last commit)." >&2
VERSION="$(python3 -c 'import json; print(json.load(open("manifest.json"))["version"])')"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

git archive --format=tar HEAD | tar -x -C "$TMP"
rm -rf "$TMP/tools" "$TMP/INSTALL-FOR-TESTERS.md"
python3 - "$TMP/manifest.json" <<'PY'
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

mkdir -p "$ROOT/build"
ZIP="$ROOT/build/spruce-$VERSION-webstore.zip"
rm -f "$ZIP"
(cd "$TMP" && zip -qr -X "$ZIP" .)
echo "Done: $ZIP"
