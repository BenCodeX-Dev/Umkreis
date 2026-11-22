#!/bin/bash
# Builds Umkreis.app (native window + bundled web app and server) and installs it for this user.
#
#   npm run mac                         build and install to ~/Applications
#   UMKREIS_INSTALL_DIR=/Applications npm run mac
#   UMKREIS_NO_INSTALL=1 npm run mac    only build into build/mac.noindex/Umkreis.app
#   UMKREIS_BUNDLE_NODE=0 npm run mac   leave Node.js out (the app then needs an installed Node ≥ 22.18)
#
# By default the official Node.js build for Apple silicon (nodejs.org) goes into the app, so it runs on Macs
# without Node. It is downloaded once into build/node-cache and checked against the SHA-256 below, taken from
# the release's SHASUMS256.txt (signature checked with the Node.js release keys). On Intel Macs the app falls
# back to an installed Node.
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

NODE_VERSION=v26.13.1
NODE_SHA256=aec2514ea1ceb2ba52455e9ec65986f6749a06dd759e5db2a72e6889668c9735
NODE_DIST=node-$NODE_VERSION-darwin-arm64
NODE_TGZ=build/node-cache/$NODE_DIST.tar.gz

fetch_node() {
  mkdir -p build/node-cache
  if [[ ! -f "$NODE_TGZ" ]] || ! echo "$NODE_SHA256  $NODE_TGZ" | shasum -a 256 -c -s; then
    echo "→ Node.js $NODE_VERSION von nodejs.org laden (≈ 58 MB, einmalig)"
    curl -fL --progress-bar --proto '=https' --tlsv1.2 --retry 2 -o "$NODE_TGZ.part" "https://nodejs.org/dist/$NODE_VERSION/$NODE_DIST.tar.gz"
    if ! echo "$NODE_SHA256  $NODE_TGZ.part" | shasum -a 256 -c -s; then
      rm -f "$NODE_TGZ.part"
      echo "✗ Prüfsumme von $NODE_DIST.tar.gz stimmt nicht – Download verworfen." >&2
      exit 1
    fi
    mv "$NODE_TGZ.part" "$NODE_TGZ"
  fi
}

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

if [[ "${UMKREIS_BUNDLE_NODE:-1}" != 0 ]]; then
  fetch_node
  echo "→ Node.js $NODE_VERSION beilegen"
  rm -rf build/node-cache/x && mkdir -p build/node-cache/x
  tar -xzf "$NODE_TGZ" -C build/node-cache/x "$NODE_DIST/bin/node" "$NODE_DIST/LICENSE"
  ditto build/node-cache/x/$NODE_DIST/bin/node "$CONTENTS/MacOS/node"
  mkdir -p "$CONTENTS/Resources/node"
  cp build/node-cache/x/$NODE_DIST/LICENSE "$CONTENTS/Resources/node/LICENSE"
  rm -rf build/node-cache/x
  "$CONTENTS/MacOS/node" --version >/dev/null
fi

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
