# The device build

What was added, why, and what is still missing.

The kernel already had the architecture: canonical facts with authority
ranking, fan-out to every installed app that carries a key, verify-by-read-back
on every action, app maps stored as data, a repair queue, and a hard rule that a
model may read an outside app but never write to one. It ran against a
simulator. This build gives it a body.

## What is new

| | Where |
|---|---|
| Selector ladder — every element named `id`, `desc`, `text`, resolved in that order, never a coordinate | `src/drivers/android.js` |
| Real ADB driver, same interface as the simulator | `src/drivers/adb.js` |
| `deviced` — the one process that owns the phone, resolving selectors against the accessibility tree | `deviced/` |
| Screen fingerprints, so a step knows it is on the screen the map was written against | `deviced/app.py`, `screen_print` |
| Both executors, filling the same slot | `modules/android_cloud`, `modules/android_local_node` |
| Channel maps for Google Business, Facebook and Yelp | `modules/{google_business,facebook,yelp}` |
| The repair loop, closed: propose → dry-run → a person promotes → new map version | `src/kernel/repair.js` |
| Voice and text to a capability call, from a closed set, confirmed before it runs | `src/kernel/intent.js`, `voice/` |
| App version tracking — a `versionCode` change marks maps `needs_revalidation` | `app_version_seen` |
| Challenge detection — 2FA, CAPTCHA, expired session | `deviced/app.py` |
| Migration ledger, so real Postgres survives a reboot | `src/db.js`, `schema_migration` |
| The boot medium | `scripts/`, `systemd/`, `docker-compose.yml` |

## Two rules the code enforces

**Never a coordinate.** `tap x=423 y=713` is correct for exactly one phone, one
font size and one app version, and silently wrong on every other one —
including the same phone after the owner changes their display size. Every
element is named three ways. When a step fails, the repair item carries the
whole ladder it tried, which is what tells you *which* identifier the app moved.
`repair.js` rejects a proposed route containing coordinates outright.

**Never a blind tap.** Before acting, a step marked `{ at: "hours_editor" }` is
checked against the fingerprint the map recorded — the sorted set of
resource-ids on screen, hashed. Ids and not text, because text changes with the
data and would make every screen unique. On a mismatch the run stops and files a
repair item. A blind tap on an unexpected screen inside a live Google Business
Profile is how you delete a location instead of editing its hours.

## Running it

    npm run verify        # migrations, packages, capabilities, grants, receipts
    npm run demo:device   # the whole loop, no phone and no key needed

The demo sets one canonical fact, watches fan-out carry it into three apps,
reads it back off each screen, then renames a field in Yelp and shows the run
stop rather than guess.

## Putting it on a phone

    ./scripts/bootstrap.sh                      # docker, adb, udev, deviced, voice
    adb devices
    node scripts/attach-phone.mjs --business <slug> --serial <serial>

`attach-phone` binds `android_local_node` for that business — one row in
`provider_binding`. Nothing above `src/drivers/` changes.

Maps ship with their `desc` and `text` rungs filled in. Capture the `id` rungs
from a real phone and add them:

    node scripts/capture-map.mjs --serial <serial> --package com.yelp.android.biz

## Putting it on a drive

Install Ubuntu Server to a **USB SSD, not a thumb drive** — Postgres and Docker
are heavy random writes and a thumb drive dies in weeks. Encrypt it: the drive
holds live logged-in sessions to the customer's Google Business, Facebook and
payment accounts.

    ./scripts/make-portable.sh    # initramfs MODULES=most, grub --removable, net.ifnames=0

Those three settings are what separate a drive that boots on one machine from
one that boots anywhere. Cloning a working box is the fast way to build the
second one; `scripts/provision.sh` runs once on the clone and gives it its own
machine-id, host keys, disk passphrase and database password.

## Still missing

- **`id` rungs on every shipped map.** They need a real phone. Until then the
  maps run on `text`, which works and breaks on a redesign.
- **Screen mirroring and human takeover.** `scrcpy` is installed by
  `bootstrap.sh` and works on the box; putting it in the browser needs
  `ws-scrcpy` behind the authenticated surface.
- **A nightly reconciliation schedule.** The endpoint exists
  (`POST /api/b/:slug/reconcile/:key`); nothing calls it on a timer yet.
- **Battery duty-cycling.** `uhubctl` is installed; nothing drives it. A phone
  held at 100% and warm swells inside a year.
- **The other channel apps** — Toast, Square, Instagram, FareHarbor.

## What will actually cost you

Map maintenance is the business, not the automation. Ten apps across a hundred
customers is a hundred map versions a year drifting underneath you. Judge every
design decision by whether it makes a repair cheaper.

Automating Facebook and Yelp through a logged-in account sits outside those
platforms' terms even when the account is the owner's own, and the practical
risk — an account lock — lands on the customer's business. Where an official API
exists (Google Business Profile, Square, Toast), route through it and keep the
phone as the fallback. `capability.route` already supports this; it is a mapping
decision, not a rewrite.
