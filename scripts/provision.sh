#!/usr/bin/env bash
# Make a cloned drive its own machine.
#
# Imaging a working box is the fast way to build the second one. Without this,
# every clone shares a machine-id, SSH host keys and a disk passphrase, and you
# have one breach surface instead of many.
set -euo pipefail

MARKER=/var/lib/ghost/provisioned
[ -e "$MARKER" ] && { echo "already provisioned"; exit 0; }

echo "==> machine identity"
sudo rm -f /etc/machine-id /var/lib/dbus/machine-id
sudo systemd-machine-id-setup
sudo ln -sf /etc/machine-id /var/lib/dbus/machine-id

echo "==> ssh host keys"
sudo rm -f /etc/ssh/ssh_host_*
sudo dpkg-reconfigure -f noninteractive openssh-server

echo "==> disk passphrase"
# The drive holds live logged-in sessions to this customer's Google Business,
# Facebook and payment accounts. A shared passphrase across clones is the same
# as no passphrase.
ROOT_DEV=$(lsblk -npo PKNAME "$(findmnt -no SOURCE /)" 2>/dev/null | head -1 || true)
if [ -n "${ROOT_DEV:-}" ] && sudo cryptsetup isLuks "$ROOT_DEV" 2>/dev/null; then
  echo "    changing the LUKS passphrase on $ROOT_DEV"
  sudo cryptsetup luksChangeKey "$ROOT_DEV"
else
  echo "    !! root is not on LUKS. This drive is not encrypted."
fi

echo "==> database password"
sudo rm -f /opt/ghost/secrets/db_password
head -c 32 /dev/urandom | base64 | tr -d '\n' | sudo tee /opt/ghost/secrets/db_password >/dev/null
sudo chmod 600 /opt/ghost/secrets/db_password

sudo mkdir -p "$(dirname "$MARKER")" && sudo touch "$MARKER"
echo
echo "Provisioned. Reboot, then run scripts/bootstrap.sh."
