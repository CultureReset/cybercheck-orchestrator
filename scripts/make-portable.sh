#!/usr/bin/env bash
# Turn a normal Ubuntu install on a USB SSD into a drive that boots on any
# machine, not just the one it was installed from.
#
# Three settings do all the work. Run once, on the box, after installing.
set -euo pipefail

echo "==> carry drivers for hardware this drive has not met yet"
sudo sed -i 's/^MODULES=.*/MODULES=most/' /etc/initramfs-tools/initramfs.conf
sudo update-initramfs -u -k all

echo "==> install the bootloader at the removable-media path"
# /EFI/BOOT/BOOTX64.EFI is the path every UEFI firmware will boot without an
# NVRAM entry pointing at it. This is the whole trick.
sudo grub-install --target=x86_64-efi --efi-directory=/boot/efi --removable --recheck

echo "==> stop networking depending on a NIC name that changes per machine"
if ! grep -q net.ifnames /etc/default/grub; then
  sudo sed -i 's/GRUB_CMDLINE_LINUX_DEFAULT="/GRUB_CMDLINE_LINUX_DEFAULT="net.ifnames=0 biosdevname=0 /' \
    /etc/default/grub
fi
sudo update-grub

echo "==> checking nothing references a drive letter"
# /dev/sdX is assigned in discovery order and changes with the host machine.
if grep -nE '^[^#]*\/dev\/sd[a-z]' /etc/fstab /etc/crypttab 2>/dev/null; then
  echo
  echo "  ^ these must be UUID= instead, or the drive will not boot elsewhere."
  exit 1
fi

echo
echo "Portable. Turn Secure Boot off in the host firmware, or sign the kernel."
