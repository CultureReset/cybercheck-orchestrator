# The platform

A standalone, modular app store. One login, many apps, and nothing about it is
particular to any one product: the platform owns identity, tenancy, a catalog,
installation state and a permission model, and knows nothing about what the apps
installed on it actually do.

The thing that makes it modular rather than an ecosystem with a plugin folder:
**an app is a manifest and a URL.** Adding one touches no platform code, no
platform build, and no platform deploy. The two apps in `apps/` were written
against the published contract and nothing else — one of them is 90 lines of
Express with no UI at all.

```bash
createdb platform
DATABASE_URL=postgres://localhost/platform npm run platform:demo
```

That boots the platform, serves two example apps from their own origins,
publishes both, and prints a login. Install them, put the song request form on
the public page, and open it as a customer.

```bash
DATABASE_URL=postgres://localhost/platform_test npm run platform:test
```

48 cases, each asserting one specific rejection or one specific success.

## How a request resolves

Three questions, answered in this order, before anything runs:

| Question | Answered by |
|---|---|
| **Who is this?** | a platform session (a human) or a scoped token (an installation) |
| **Which workspace?** | membership, checked against the URL — never taken from it |
| **May they do this?** | a permission the owner granted by name, read live |

Those are three different middlewares in `src/http/auth.js`, and a credential
for one is never accepted by another. A platform session cannot call an app
route; an app token cannot call a user route. There is a test for both.

## The four states people confuse

    installed    the app exists in this workspace
    enabled      it is allowed to run
    published    a public surface of it is on the customer-facing page
    data         the owner's records, which outlive all three

They are four columns and four operations. Collapsing any two is how a platform
ends up deleting a customer's records because they hid a card. Uninstalling
keeps the records unless the manifest said otherwise or the owner asked, and
reinstalling picks them back up — verified end to end.

## Why apps run in iframes

The alternative is importing a third party's JavaScript into the platform's own
page, where one bad app blanks the dashboard and any app can read every other
app's token. So a surface is an iframe on the app's **own origin**, and the
bridge in `sdk/host.js` does three things that matter:

- it only trusts a `postMessage` whose `event.origin` is the origin the manifest
  pinned — one line, and it is the line the whole model rests on;
- a surface that throws, hangs or 404s becomes a small "unavailable" card, and
  the rest of the page keeps working;
- the handoff code in the frame URL is single-use, expires in 60 seconds, and is
  redeemable only from that pinned origin, so a leaked one buys nothing.

## What an app may do

Everything, and only, this:

| | Needs |
|---|---|
| Read and write its **own** tables | nothing — they are its tables |
| Read the workspace profile, its members | `workspace.profile.read`, `workspace.members.read` |
| Read and write **shared contacts** | `contacts.read`, `contacts.write` |
| Announce an event | `events.emit`, and the event must be in its manifest |
| Call another app's capability | `capability.invoke` |
| Appear on the customer-facing page | `surface.public` |

Grants are read from the table on **every** request, not from the token. A
permission revoked thirty seconds ago stops working now, not in fifteen minutes.

Shared contacts are the reason to install a second app: one app writes a
contact, another reads it, and neither knows the other exists.

## Public surfaces

A public surface runs for whoever loads the page — there is no logged-in human
to authorise anything. So its token is anonymous, narrowed to the safe subset of
what the owner granted, and a table it can touch has to say so in the manifest:

```json
"requests": { "public": "append", "columns": { … } }
```

Default is `none`. A public form that writes has to declare that it writes, and
`append` does not imply read: a stranger can leave a song request and cannot
read the list back. Tested three ways.

## Writing an app

Two files. A manifest, and a page.

```json
{
  "schema_version": 1,
  "id": "acme.hello",
  "name": "Hello",
  "version": "1.0.0",
  "publisher": "acme",
  "requires": { "platform": "^1" },
  "runtime": { "type": "hosted", "url": "https://hello.acme.dev" },
  "surfaces": [{ "id": "main", "kind": "dashboard", "path": "/index.html" }],
  "permissions": [
    { "id": "contacts.read", "reason": "Show you who has been in touch." }
  ],
  "data": {
    "namespace": "acme_hello",
    "tables": { "notes": { "columns": { "body": { "type": "text", "required": true } } } }
  }
}
```

```html
<script type="module">
  const platform = new URLSearchParams(location.search).get('cc_platform');
  const { connect } = await import(`${platform}/sdk/app.js`);
  const cc = await connect();

  await cc.table('notes').create({ body: 'written by an app that has no server' });
  if (cc.can('contacts.read')) console.log(await cc.contacts.list());
  cc.resize();
</script>
```

`POST /v1/catalog/publish` with the manifest and it is in the store. The platform
provisions the tables, derives the consent screen from the permission reasons,
and mints the tokens. The app never sees a database, a session, or another app.

`cc.can(...)` is not decoration: optional permissions are optional, and an app
that assumes it has one it was not granted is an app that breaks for half its
installs.

## The contract

`contract/app-manifest.v1.json` is a copy. The canonical schema lives in
[`cybercheck-marketplace`](../../cybercheck-marketplace/contract/), because the
catalog is what decides what an app may declare. `npm run sync:contract` copies
it, and the test suite fails if the two have drifted.

Validation is two layers, deliberately. The JSON Schema decides shape. `validate`
in `src/manifest.js` decides everything the schema cannot know — that the
permission exists on *this* platform, that a public surface asked for
`surface.public`, that the id carries its publisher's prefix, that a hosted app
declared somewhere to appear. A manifest that passes both is safe to normalise;
after that, nothing downstream reads a manifest again. The store UI renders
`app_declared_*` rows, which came out of columns.

## Multi-store

`stores` is a table, not a constant. A store is a slug, a URL and a public key,
and a deployment can enable several — the official one, a vertical pack, a
customer's private store. This is the difference between an app store and an
ecosystem somebody else controls, and it is why the schema carries `public_key`
from the first migration. Remote store fetching is not implemented yet; the
shape it has to fit into is.

## Layout

    db/          four migrations; every boundary in this README is a constraint here
    contract/    the app manifest schema (vendored from cybercheck-marketplace)
    src/         the platform: catalog, installs, tokens, identity, appdata, events
    sdk/         app.js (loaded by apps) and host.js (loaded by the store)
    ui/          the store, and the customer-facing page
    apps/        two example apps, written against the contract like anyone else's
    test/        48 end-to-end cases against real Postgres and real HTTP

## Postgres, and no substitute

`src/db.js` requires a real database. Every rule above is a constraint in
`db/*.sql` — the partial unique index that lets an app reinstall onto its old
data, the check that only a public surface can be published, the one that says
an installed row must record when. An in-memory stand-in ignores most of them,
and a test suite that passes against it would be agreeing with itself.

## Not built yet

Named, so nobody has to discover them:

- **Remote stores.** The table and the signing column exist; fetching and
  signature verification do not.
- **Billing.** `pricing` is declared, validated and stored. Nothing charges.
- **Rate limiting.** A public surface accepts writes from strangers, which is
  what a public form is. It needs a limiter before it faces the internet.
- **App review.** Any signed-in developer can publish to the local store.
- **Update UI.** `POST /installations/:id/update` works and refuses to widen
  permissions silently; the store has no button for it.
