#!/bin/bash
# Builds Umkreis.app (native window + bundled web app and server) and installs it for this user.
#
#   npm run mac                         build and install to ~/Applications
#   UMKREIS_INSTALL_DIR=/Applications npm run mac
#   UMKREIS_NO_INSTALL=1 npm run mac    only build into build/mac.noindex/Umkreis.app
#
# Needs the Xcode command line tools (swiftc, iconutil). The app is signed ad hoc: it runs on the Mac
# that built it, but it is NOT signed with a Developer ID or notarized, so it is not ready to give to others.
set -euo pipefail
cd "$(dirname "$0")/.."

# Staged inside a .noindex folder so Spotlight only lists the installed copy.
APP=build/mac.noindex/Umkreis.app
CONTENTS=$APP/Contents
VERSION=$(node -p "require('./package.json').version")
DEST=${UMKREIS_INSTALL_DIR:-$HOME/Applications}

echo "→ Web-App bauen"
npm run build --silent

echo "→ Programmpaket zusammenstellen (Version $VERSION)"
rm -rf build/mac.noindex build/icon
mkdir -p "$CONTENTS/MacOS" "$CONTENTS/Resources/app/config" build/icon

SWIFT_FLAGS=(-swift-version 5 -O -framework AppKit -framework WebKit -framework CoreLocation)
swiftc "${SWIFT_FLAGS[@]}" -target arm64-apple-macos13 -o build/icon/Umkreis-arm64 mac/Umkreis.swift
swiftc "${SWIFT_FLAGS[@]}" -target x86_64-apple-macos13 -o build/icon/Umkreis-x86_64 mac/Umkreis.swift
lipo -create build/icon/Umkreis-arm64 build/icon/Umkreis-x86_64 -output "$CONTENTS/MacOS/Umkreis"

ditto server "$CONTENTS/Resources/app/server"
ditto shared "$CONTENTS/Resources/app/shared"
ditto dist "$CONTENTS/Resources/app/dist"
cp package.json "$CONTENTS/Resources/app/"
cp config/feeds.example.json "$CONTENTS/Resources/app/config/"

cp mac/Info.plist "$CONTENTS/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $VERSION" -c "Set :CFBundleVersion $VERSION" "$CONTENTS/Info.plist"
plutil -lint -s "$CONTENTS/Info.plist"

echo "→ Symbol erzeugen"
swift mac/make-icon.swift build/icon/icon_1024.png >/dev/null
SET=build/icon/AppIcon.iconset
mkdir -p "$SET"
for s in 16 32 128 256 512; do
  sips -z $s $s build/icon/icon_1024.png --out "$SET/icon_${s}x${s}.png" >/dev/null
  d=$((s * 2))
  sips -z $d $d build/icon/icon_1024.png --out "$SET/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$SET" -o "$CONTENTS/Resources/AppIcon.icns"

echo "→ Ad-hoc signieren (nur für diesen Mac)"
codesign --force --sign - --timestamp=none "$APP"
codesign --verify --strict "$APP"

if [[ -n "${UMKREIS_NO_INSTALL:-}" ]]; then
  echo "✓ Gebaut: $APP (nicht installiert)"
  exit 0
fi

if pgrep -xq Umkreis; then
  echo "✗ Umkreis läuft gerade. Bitte zuerst beenden (⌘Q) und dann erneut ausführen." >&2
  exit 1
fi

echo "→ Installieren nach $DEST"
mkdir -p "$DEST"
rm -rf "$DEST/Umkreis.app"
ditto "$APP" "$DEST/Umkreis.app"
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$DEST/Umkreis.app"
mdimport "$DEST/Umkreis.app" 2>/dev/null || true

echo "✓ Installiert: $DEST/Umkreis.app"
echo "  Starten: Spotlight (⌘ Leertaste) → „Umkreis“, oder: open -a Umkreis"
