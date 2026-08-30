#!/usr/bin/env bash
# Bring a fresh box up to a working Ghost node.
#
# Run once, on the box, after the drive boots. Idempotent.
set -euo pipefail

REPO_DIR=${REPO_DIR:-/opt/ghost}

echo "==> packages"
sudo apt-get update
sudo apt-get install -y \
  docker.io docker-compose-v2 android-tools-adb scrcpy \
  python3 python3-pip python3-venv uhubctl git ffmpeg curl

sudo usermod -aG docker,plugdev "$USER"

echo "==> udev rules for the phone"
# Google/Pixel is 18d1. Add your phone's vendor id if it is not a Pixel:
#   lsusb   -> "ID 22b8:2e76 Motorola ..."  -> 22b8
sudo tee /etc/udev/rules.d/51-android.rules >/dev/null <<'RULES'
SUBSYSTEM=="usb", ATTR{idVendor}=="18d1", MODE="0660", GROUP="plugdev"
SUBSYSTEM=="usb", ATTR{idVendor}=="22b8", MODE="0660", GROUP="plugdev"
SUBSYSTEM=="usb", ATTR{idVendor}=="04e8", MODE="0660", GROUP="plugdev"
RULES
sudo udevadm control --reload-rules && sudo udevadm trigger

echo "==> deviced"
python3 -m venv "$REPO_DIR/deviced/.venv"
"$REPO_DIR/deviced/.venv/bin/pip" install -q -r "$REPO_DIR/deviced/requirements.txt"

echo "==> voice"
python3 -m venv "$REPO_DIR/voice/.venv"
"$REPO_DIR/voice/.venv/bin/pip" install -q -r "$REPO_DIR/voice/requirements.txt"

echo "==> services"
sudo cp "$REPO_DIR"/systemd/*.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now ghost-deviced.service ghost-voice.service

echo "==> database password"
mkdir -p "$REPO_DIR/secrets"
if [ ! -s "$REPO_DIR/secrets/db_password" ]; then
  head -c 32 /dev/urandom | base64 | tr -d '\n' > "$REPO_DIR/secrets/db_password"
  chmod 600 "$REPO_DIR/secrets/db_password"
fi

echo "==> kernel"
cd "$REPO_DIR"
GHOST_DB_PASSWORD="$(cat secrets/db_password)" docker compose up -d --build

echo
echo "Ghost is up. Plug the phone in and run:"
echo "    adb devices"
echo "    node scripts/attach-phone.mjs --business <slug> --serial <serial>"
