# The node that holds the phone.
#
# One of these per host with a device attached. It runs the platform and the
# ADB server together, because ADB owns the USB handle and only one process on
# a machine may hold it — running adb on the host and in the container at the
# same time is the most common reason a device shows up as "offline".

FROM node:22-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends android-tools-adb usbutils ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

ENV ADB_BINARY=adb
EXPOSE 3000

# Start the ADB server explicitly so a failure to see the device is loud at
# boot rather than silent on the first push.
CMD ["sh", "-c", "adb start-server && adb devices && node src/http/server.js"]
