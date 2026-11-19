#!/usr/bin/env bash
set -euo pipefail

export PATH="$HOME/.local/bin:$PATH"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="$HOME/.local/opt/lurkr"
BIN_DIR="$HOME/.local/bin"
APPS_DIR="$HOME/.local/share/applications"
ICONS_DIR="$HOME/.local/share/icons/hicolor"

cd "$ROOT_DIR"

echo "Building and packaging Lurkr..."
npm run package:linux

echo "Installing application bundle to $APP_DIR..."
rm -rf "$APP_DIR"
mkdir -p "$APP_DIR"
cp -a "$ROOT_DIR/release/linux-unpacked/." "$APP_DIR/"

echo "Installing icons to $ICONS_DIR..."
mkdir -p \
  "$ICONS_DIR/16x16/apps" \
  "$ICONS_DIR/32x32/apps" \
  "$ICONS_DIR/192x192/apps" \
  "$ICONS_DIR/512x512/apps" \
  "$ICONS_DIR/scalable/apps"

cp "$ROOT_DIR/public/favicon-16.png" "$ICONS_DIR/16x16/apps/lurkr.png"
cp "$ROOT_DIR/public/favicon-32.png" "$ICONS_DIR/32x32/apps/lurkr.png"
cp "$ROOT_DIR/public/lurker-icon-192.png" "$ICONS_DIR/192x192/apps/lurkr.png"
cp "$ROOT_DIR/public/lurker-icon-512.png" "$ICONS_DIR/512x512/apps/lurkr.png"
cp "$ROOT_DIR/public/lurker-icon.svg" "$ICONS_DIR/scalable/apps/lurkr.svg"

echo "Installing launcher to $BIN_DIR/lurkr..."
mkdir -p "$BIN_DIR"
cat > "$BIN_DIR/lurkr" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
APP_DIR="$HOME/.local/opt/lurkr"
EXTRA_FLAGS=()
# If unprivileged user namespaces are unavailable and chrome-sandbox is not setuid root,
# fall back gracefully instead of failing to boot on Ubuntu AppArmor setups.
if [ ! -u "$APP_DIR/chrome-sandbox" ] && [ "$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>/dev/null || echo 0)" = "1" ]; then
  EXTRA_FLAGS+=(--no-sandbox)
fi
if [ -n "${WAYLAND_DISPLAY:-}" ] && [[ " $* " != *" --ozone-platform"* ]]; then
  EXTRA_FLAGS+=(--ozone-platform-hint=auto)
fi
exec "$APP_DIR/lurkr" "${EXTRA_FLAGS[@]}" "$@"
EOF
chmod +x "$BIN_DIR/lurkr"

echo "Installing desktop entry to $APPS_DIR/lurkr.desktop..."
mkdir -p "$APPS_DIR"
cat > "$APPS_DIR/lurkr.desktop" <<EOF
[Desktop Entry]
Version=1.2
Type=Application
Name=Lurkr
GenericName=IRC Client
Comment=Standalone React desktop client for Lurker IRC
Exec=$BIN_DIR/lurkr %U
Icon=lurkr
Terminal=false
Categories=Network;InstantMessaging;Chat;
Keywords=irc;lurker;lurkr;chat;bouncer;
StartupWMClass=Lurker
StartupNotify=true
EOF
chmod +x "$APPS_DIR/lurkr.desktop"

if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$APPS_DIR" >/dev/null 2>&1 || true
fi
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache -f -t "$ICONS_DIR" >/dev/null 2>&1 || true
fi
if command -v kbuildsycoca6 >/dev/null 2>&1; then
  kbuildsycoca6 >/dev/null 2>&1 || true
fi

echo "Lurkr installed successfully!"
