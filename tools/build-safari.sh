#!/bin/bash
# Builds the Safari version of the extension: wraps it in a Mac app (and an iPhone/iPad app) with
# Apple's converter, then builds the Mac app. Run it on a Mac with Xcode, from anywhere:
#     tools/build-safari.sh
# Output in build/safari/:
#     SPRUCE/                               the Xcode project (open it to sign, archive, or build for iOS)
#     SPRUCE-<version>-macos.zip            the built Mac app, signed "to run locally" (ad hoc)
# To try the app on one Mac: Safari → Settings → Advanced → Show features for web developers, then
# Develop → Allow Unsigned Extensions; open the app once and turn the extension on in Safari → Settings →
# Extensions. To give it to others, sign it with your team (see Help → Deploying in organizations).
#
# Optional settings (environment variables):
#     BUNDLE_ID   the app's bundle identifier (default org.example.SPRUCE; use your own domain)
#     APP_NAME    the app's name (default "SPRUCE"; Safari shows the extension as S.P.R.U.C.E+)
#     PLATFORMS   "all" (Mac and iPhone/iPad project, the default) or "macos"
#     TEAM_ID     your Apple Developer team: the Mac app is then signed with it instead of ad hoc
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/build/safari"
APP_NAME="${APP_NAME:-SPRUCE}"
BUNDLE_ID="${BUNDLE_ID:-org.example.SPRUCE}"
PLATFORMS="${PLATFORMS:-all}"
TEAM_ID="${TEAM_ID:-}"

if [ "$(uname)" != "Darwin" ] || ! xcrun --find safari-web-extension-converter >/dev/null 2>&1; then
    echo "This needs a Mac with Xcode (xcrun safari-web-extension-converter was not found)." >&2
    exit 1
fi
VERSION="$(plutil -extract version raw -o - "$ROOT/manifest.json")"
echo "Building $APP_NAME $VERSION for Safari ($BUNDLE_ID)"

# 1. Only the extension's own files (no tests, tools, docs or repository files).
rm -rf "$OUT"
mkdir -p "$OUT/extension"
rsync -a "$ROOT/" "$OUT/extension/" \
    --exclude '/.git' --exclude '/.github' --exclude '/.gitignore' --exclude '/.gitattributes' \
    --exclude '/build' --exclude '/tests' --exclude '/tools' --exclude 'node_modules' --exclude '*.md' --exclude '.DS_Store'

# 2. Apple's converter makes the Xcode project, with a copy of the extension inside it.
CONVERT=(xcrun safari-web-extension-converter "$OUT/extension"
    --project-location "$OUT" --app-name "$APP_NAME" --bundle-identifier "$BUNDLE_ID"
    --swift --copy-resources --no-open --no-prompt --force)
[ "$PLATFORMS" = "macos" ] && CONVERT+=(--macos-only)
"${CONVERT[@]}" 2>&1 | tee "$OUT/converter.log"
PROJECT="$(find "$OUT/$APP_NAME" -maxdepth 1 -name '*.xcodeproj' | head -n 1)"
[ -n "$PROJECT" ] || { echo "The converter made no Xcode project (see $OUT/converter.log)." >&2; exit 1; }

# 3. Build the Mac app. The Mac scheme is the one named "… (macOS)", or the only one.
SCHEMES="$(xcodebuild -list -project "$PROJECT" | sed -n '/Schemes:/,$p' | sed '1d; s/^[[:space:]]*//; /^$/d')"
SCHEME="$(printf '%s\n' "$SCHEMES" | grep -m 1 'macOS' || printf '%s\n' "$SCHEMES" | head -n 1)"
SIGNING=(CODE_SIGN_IDENTITY=- CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM= CODE_SIGNING_REQUIRED=NO)
[ -n "$TEAM_ID" ] && SIGNING=(CODE_SIGN_STYLE=Automatic DEVELOPMENT_TEAM="$TEAM_ID" -allowProvisioningUpdates)
echo "Building scheme \"$SCHEME\" (full log: $OUT/xcodebuild.log)"
STATUS=0
xcodebuild -project "$PROJECT" -scheme "$SCHEME" -configuration Release \
    -derivedDataPath "$OUT/DerivedData" -destination 'generic/platform=macOS' \
    MARKETING_VERSION="$VERSION" CURRENT_PROJECT_VERSION="$VERSION" "${SIGNING[@]}" \
    build > "$OUT/xcodebuild.log" 2>&1 || STATUS=$?
grep -E '^\*\*|error:' "$OUT/xcodebuild.log" || true
[ "$STATUS" -eq 0 ] || { echo "The build failed (see $OUT/xcodebuild.log)." >&2; exit 1; }

APP="$(find "$OUT/DerivedData/Build/Products/Release" -maxdepth 1 -name '*.app' -type d | head -n 1)"
[ -n "$APP" ] || { echo "No app was built (see $OUT/xcodebuild.log)." >&2; exit 1; }
ZIP="$OUT/SPRUCE-$VERSION-macos.zip"
ditto -c -k --keepParent "$APP" "$ZIP"
echo "Done: $ZIP"
echo "Xcode project: $PROJECT"
