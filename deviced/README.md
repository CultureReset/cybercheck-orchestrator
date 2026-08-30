# deviced

The one process that owns the phone.

Everything above `src/drivers/` speaks in steps. This is where a step becomes a
touch on real glass.

## Run it

    pip install -r requirements.txt
    python -m uiautomator2 init          # pushes the agent to the phone, once
    uvicorn app:app --host 127.0.0.1 --port 8391

Bind to loopback only. This service can drive every logged-in business account
on the phone; it must never be reachable from the network.

## What it will not do

It has no endpoint that takes a coordinate. `tap x=423 y=713` is correct for
exactly one phone, one font size and one app version, and silently wrong on
every other one — including the same phone after the owner changes their
display size. Every element is named three ways and resolved through the
ladder `resource-id -> content-desc -> text`, and the rung that matched comes
back in the response, so a later repair knows which identifier the app moved.

## The fingerprint

`/fingerprint` returns the sorted set of resource-ids on screen, hashed. Ids
and not text, because text changes with the data — a shop's own name, today's
date — and would make every screen unique. Ids change when the layout changes,
which is exactly the event worth stopping for.

## Challenges

Every response that dumps the hierarchy also reports `challenge`: a 2FA prompt,
a CAPTCHA, an expired session. Automation cannot get past any of them. The
right move is to park the job and hand the phone to the owner through the
mirror — same device, same session — not to retry.
