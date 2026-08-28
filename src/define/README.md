# src/define — ported from Twenty

This is Twenty's application-definition layer (`packages/twenty-sdk/src/sdk/define/`,
twentyhq/twenty, AGPL-3.0), ported to plain ESM JavaScript and rewritten to
target this kernel's manifest instead of Twenty's metadata engine.

## Why port instead of `npm install twenty-sdk`

`twenty-sdk` is a real published package (2.38.0), but installing it buys
nothing here: every `define*` in it produces config for a **running Twenty
server** and is inert without one. It also cannot be altered, which is the
entire point of taking it.

So this is the source, changed:

| Twenty | here |
| --- | --- |
| TypeScript, needs a build | plain ESM, no build (this repo has 3 deps and no compiler) |
| `defineObject` targets Twenty's metadata engine | compiles to `manifest.schema`, which `installer.js` turns into a real Postgres table |
| `FieldMetadataType` (40+ CRM types) | the 14 types `installer.js` can actually emit |
| `defineNavigationMenuItem`, `definePageLayout*`, `defineCommandMenuItem`, `defineView*`, `defineFrontComponent` | **dropped** — every one adds a screen to a sidebar. This platform is one dashboard whose sections come from data. |
| `defineApplication` | `definePackage` |

## What survived, and why each one earns its place

`universalIdentifier` is the best idea in their design and it is kept
verbatim: a stable id per object and per field, chosen once by the package
author. It is what lets a package be upgraded, renamed, or reinstalled without
the rows underneath it being orphaned. Nothing in this repo had that before.

`defineField` pointing at an object the package does **not** own is the second
one. It is how a package composes with another package instead of merely
sitting beside it — a reviews package can add `accepts_walk_ins` to the profile
package's table without either one knowing about the other.

## The loop this completes

    defineObject(...)          ← you declare it
      → compile()              ← becomes manifest.schema
      → registerGenerated()    ← already in this repo
      → moduleFor()            ← free create/list/update/remove, each verified
      → installer.provision()  ← a real table, business_id enforced by the kernel

Declare a thing; get a tenant-scoped table, four capabilities, verifiers and
receipts. No handler written.
