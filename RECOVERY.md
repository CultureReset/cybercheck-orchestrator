# Recovery notice — read this first

This repository was reconstituted from a set of PDF printouts. It is not a
normal checkout, and the difference matters.

## Where it came from

The working `ghost-platform` source existed only as four `.sql` files and
forty-five PDFs inside a directory named `untitled folder`, with five copies
of the README and no version control of any kind. That folder was the only
copy. This commit is that folder turned back into source.

## What is verified

- **28 of 28 recovered `.js` files parse** — `node --check` passes on every one.
- **4 SQL migrations are byte-identical** to the originals; they were plain
  text in the source folder and were copied, not extracted.
- `package.json`, `modules/availability/manifest.json` and
  `modules/business_profile/index.js` were also plain text and were copied.

## What was repaired, and exactly how

The PDF text layer mangled five characters. Each replacement was checked
against its surrounding context before being applied:

| In the PDF | Restored to | Where |
|---|---|---|
| `Ñ` (×10) | `—` em dash | comments in `importer.js`, `mcp.js`, `registry.js`, `links.js` |
| `Ð` (×4) | `–` en dash | rendered time ranges in `links.js` |
| `É` (×1) | `…` ellipsis | the string `'checking…'` in `links.js` |
| `Ý` (×1) | `›` chevron | the `.chev` glyph in `links.js` |
| a bare `!` on its own line (×3) | `·` middle dot | inside single-quoted strings in `links.js` |

Before the repair, `links.js` was the one file that failed to parse — the
middle dot had been emitted as a newline, splitting a template literal across
three lines. Nothing else was edited. No logic was changed, added or inferred.

## What is missing

Derived from the imports and from `package.json`, not guessed:

| Missing | Consequence |
|---|---|
| ~~`src/db.js`~~ | **Reconstructed** — see below. Every relative import now resolves. |
| `demo.js`, `demo-device.js`, `demo-modular.js`, `demo-surfaces.js` | The four demos `STATUS.md` says all pass cannot be re-run to confirm it. |
| 12 of 14 packages under `modules/` | `qr_menu`, `forms`, `crm`, `facebook`, `google_business`, `yelp`, `android_cloud`, `android_local_node`, `hosted_models`, `local_models`, `loop_harness`, `composer`. Only `availability` and `business_profile` survived. |

`docs/STATUS.md` reports the original as 3,557 lines across 39 JS files. This
recovery holds 29. The kernel itself is complete; the demos and most package
implementations are not.

## The one reconstructed file

`src/db.js` was missing and 24 files import it, so nothing ran. It is now
reconstructed rather than recovered, and the file says so in its own header.
Its four signatures were not invented — each is fixed by its call sites:

- `q(sql, params)` returns an array, because callers do `rows.length`,
  `[...rows]`, `.map` and `.filter`, and nothing anywhere reads `.rows`.
- `one(sql, params)` returns the first row or `null`, because callers do
  `row?.value` and `if (!row)`.
- `j(value)` parses a jsonb column that pg returns parsed and pg-mem returns
  as text, and must pass `undefined` through unchanged so that
  `j(row?.settings) ?? {}` still reaches its default.
- `connect({ url, schemaDir })` applies the migrations in filename order,
  which is why they are numbered.

Behaviour beyond those four signatures is the minimum that makes them work.
`pg-mem` backs it when `DATABASE_URL` is unset, so a fresh checkout runs with
no database to set up; `gen_random_uuid()` is registered by hand there because
pg-mem does not ship `pgcrypto`.

## What is now verified by running it

`npm install && npm run verify` — `verify.mjs` exercises the kernel with no
packages involved beyond the one that survived:

```
1. db.connect + 4 migrations           OK
2. tables created                      44
3. packages loaded                     1  [availability]
4. capabilities registered             9
5. slots declared                      6  [workspace.executor, model, harness, builder, memory, sandbox]
6. capabilities persisted to table     9
7. business + person + membership      OK
8. capability executed                 state=succeeded verification=verified
9. receipt chain                       {"ok":true,"count":1}
10. ungranted capability               refused: not permitted: business.set_hours
```

Line 8 is the claim that matters: the capability ran, and then its verifier
re-read the fact and returned `verified` — not `unknown`, which is what the
kernel gives anything that cannot prove itself. Line 9 is the hash chain
holding. Line 10 is the policy gate denying a capability with no grant.

`npm start` and the four demos still do not run: `demo*.js` are absent, and
`boot()` fails at `defaults()` binding `android_cloud`, which is one of the 12
absent packages. That failure is a missing module, not a broken kernel.

## Before trusting any claim in docs/

`docs/README.md` and `docs/STATUS.md` are the original author's, recovered
alongside the code. Their claims were true of the original tree. They have not
been re-verified against this one, and cannot be until `src/db.js` exists and
the demos run. Treat every "BUILT" in `STATUS.md` as unconfirmed here.

## Naming

This code uses singular table names — `install`, `execution`, `package`,
`capability` — and an API shaped `/api/b/:slug/…`. The 66-screen contract map
that specifies the product uses plural names and splits several of these, and
an API shaped `/v1/businesses/{business_id}/…`. Reconciling the two is the
next decision, and it is cheaper now than it will ever be again.

---

## Restored since the recovery

The recovery left the kernel complete and the packages gone. Three of the
missing pieces have been rebuilt, and the difference between *recovered* and
*rebuilt* still matters — none of the below is the original code.

### The platform could not start

`src/platform.js` bound four platform defaults by name, and all four packages
were among the twelve lost. `bind()` throws on an unknown package, so `boot()`
failed on the first one:

    BOOT FAILED: no such package: android_cloud

That was a modularity bug as much as a recovery gap: a kernel that refuses to
start because an optional provider is absent is not a modular kernel. `defaults()`
now names candidates in preference order per slot, binds the first that is
actually installed, and skips a slot whose candidates are all missing. It also
leaves a slot alone once anything is bound, instead of re-binding its own default
over an operator's choice on every restart.

### The kernel stopped naming packages

The first pass at the above put the fix in the wrong place: `defaults()` grew a
hardcoded list of six package names and a special case for the `model` slot,
three lines below the comment in `providers.js` that says *the kernel declares
the slots, packages fill them, nothing here names a vendor*. That is the same
bug as the one it was fixing, written more neatly.

`defaults()` now iterates the slots the kernel declares and asks the installed
packages which of them volunteer:

    "kind": "provider",
    "fills": "workspace.executor",
    "defaultPriority": 900

Lower wins. Declaring nothing means never bound automatically, which is how a
real device stays an explicit per-business choice. `defaultConfig` replaces the
`model`-slot special case. Both fields are validated at load in `registry.js`.

Two older instances of the same violation went with it:

- `workspace.js` imported `deviceFor` from `src/drivers/android.js` and called
  one specific executor directly, in `provision()` and `installOnDevice()`.
  Both now go through the bound provider. `installApp` is declared `optional`
  on the slot contract, because a simulator can conjure an app onto a device
  and a phone in someone's hand cannot.
- `server.js` had a hardcoded `POST /public/:slug/availability/search`. The
  route is now generic and reaches a capability only when the package's own
  manifest lists it in `publicActions` *and* the business has that package
  installed. Nothing is public by default, and the old URL still resolves.

`npm run test:modularity` keeps it that way: it fails if a package name appears
in any of the eleven deciding files, and it boots the kernel against an empty
modules directory to prove it still starts with nothing installed.

### `workspace.executor` has two providers again

| Package | What it is |
|---|---|
| `android_simulator` | Wraps the surviving `Simulator` in `src/drivers/android.js`. Needs no hardware. The platform default. |
| `android_local_node` | Real ADB against a phone or emulator, in a container. A per-business binding. |

Neither is the lost `android_cloud` or the lost `android_local_node`; both are
new code written against the slot contract the kernel already declared
(`run`, `screenshot`, `prepare`). If the originals ever resurface, compare
rather than assume.

### `modules/business_profile/manifest.json` is reconstructed

`index.js` survived; its manifest did not, so the package never loaded and
`availability` — which `requires` it — could not install. The manifest is
derived from the code, not invented:

- `key` from the directory and the `business_profile.` capability namespace
- `capabilities` from the one entry in the exported `capabilities` array
- `public` sections from the three keys of the exported `renderers`

Titles, icons and sort order have no source in the code and were chosen. They
are presentation only; nothing depends on them.

### What now proves it runs

`npm run test:device` — the four original demos are still lost, so this replaces
their coverage of the device path: push a canonical value onto the device, read
it back off the screen, confirm the observation and sync state, then rename a
field on the app and confirm the same push fails into the repair queue with
screen evidence instead of reporting success. Five checks, no hardware.

The ADB module's own ADB calls remain untested — there is no phone attached to
CI.
