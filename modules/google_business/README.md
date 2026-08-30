# Channel app maps

Each route names every element three ways — `id`, `desc`, `text` — and the
driver resolves them in that order. The maps in this directory ship with the
`desc` and `text` rungs filled in, because those are readable off the visible
UI. The `id` rung is empty until a real phone has been seen.

Fill it in with:

    node scripts/capture-map.mjs --serial <serial> --package com.google.android.apps.vega

That prints the resource-ids present on the current screen. Add the ids to the
selectors and the map stops depending on English button labels, which is what
makes it survive a redesign and a locale change.

Until then the maps still run: `text` is a valid rung, and a step that fails
files a repair item carrying the whole ladder it tried, which is exactly the
input the repair loop needs.
