# appmaps

One directory per app, per version of that app:

    appmaps/<package key>/<app version>/map.json

A map names the canonical keys an app carries and the steps to write and read
each one. It is data, not code. It ships as a signed bundle on its own channel —
a box verifies the signature, installs the map, and restarts nothing. When an
app moves a button, a new bundle goes out. Nothing else moves.

Old versions stay. A box running an older build of an app keeps using the map
that matches it, which is why the version is in the path.

## The step vocabulary

    { "open":   "com.example.app" }
    { "tap":    "Hours" }                  matched by text, resource id or content-desc
    { "type":   "20:00", "into": "closes_at" }
    { "read":   "closes_at" }              returns a value into the run's readings
    { "expect": "Saved" }                  fails the run if not present
    { "wait":   500 }

Elements are found by what they are, never by where they are. A step that
locates something by a number is refused at load time — pixel coordinates break
on the next screen size, and a map that breaks silently is worse than no map.

## Rules the loader enforces

- A key listed in `carries` must have a route.
- A route that writes must also read. A write nobody reads back is a write
  nobody can trust; the verifier would have nothing to compare against.
- The signature covers the package key, app version, android package, carries
  and routes. Change any of them and it stops verifying.
- The path and the file must agree about which app and which version this is.

## Making one

Maps are authored in the shop, against a real device, with whatever tooling is
slowest and smartest — that work happens once per app per version. The box only
ever runs the result.

    node scripts/sign-appmaps.mjs        # sign everything in this directory
    node scripts/sign-appmaps.mjs google_business/542.0.3

Signing uses `PACKAGE_SIGNING_KEY`. The development default is not a secret and
is not for release.

## This directory is temporary

The catalog is meant to be its own repository with its own release train,
separate from the kernel. It lives here until there is enough of it to move.
The loader (`src/kernel/appmaps.js`) stays in the kernel either way — installing
a map is a kernel act, authoring one is not.
