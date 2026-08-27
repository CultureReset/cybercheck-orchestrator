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
| `src/db.js` | **Blocks everything.** 24 files import it. It is the `q` / `one` / `j` helper layer over `pg`, with `pg-mem` behind it when `DATABASE_URL` is unset. |
| `demo.js`, `demo-device.js`, `demo-modular.js`, `demo-surfaces.js` | The four demos `STATUS.md` says all pass cannot be re-run to confirm it. |
| 12 of 14 packages under `modules/` | `qr_menu`, `forms`, `crm`, `facebook`, `google_business`, `yelp`, `android_cloud`, `android_local_node`, `hosted_models`, `local_models`, `loop_harness`, `composer`. Only `availability` and `business_profile` survived. |

`docs/STATUS.md` reports the original as 3,557 lines across 39 JS files. This
recovery holds 28. The kernel itself is complete; the demos and most package
implementations are not.

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
