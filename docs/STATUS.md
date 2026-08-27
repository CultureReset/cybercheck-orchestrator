STATUS
Everything built, everything not built, and every item raised in this chat with its state.
Nothing below is aspirational. If it says BUILT, it runs in one of the four demos.
Repo: 3,557 lines across 39 JS files, 4 SQL files, 43 tables, 14 packages, 48 HTTP
endpoints. Verified by: 
npm run demo
, 
demo:device
, 
demo:modular
, 
demo:surfaces
 — all
four pass.
PART 1 — WHAT IS BUILT
Kernel (
src/kernel/
, 
db/*.sql
)
#
Thing
File
Proven
by
1
Core contracts — ULID/uuid ids, request/result
envelopes, frozen vocabulary
db/001
 +
executor.js
all
demos
2
Identity & tenancy — person global, membership per
business, business
_
id stamped by kernel
db/001
,
platform.js
demo
3
Permissions — grants not roles, auto/ask/never,
membership grant beats role grant, explicit never
wins
policy.js
demo
4
Canonical business data — business, location,
business
_
fact, regular
_
hours, temporary
_
hours
db/001
,
canonical.js
demo
5
No-per-channel-columns rule — what a channel
shows is an observation, never a column
canonical.js
demo-
device
6
Sources & reconciliation — observation table, 9-tier
authority rank, 
drift()
canonical.js
demo-
device
7
channel
_
sync
_
state — per app per key, in-sync or
drifted
db/002
,
channels.js
demo-
device
8
Capability registry — the only way anything executes
policy.js
all
demos
9
Safety loop — request  ·  plan  ·  route  ·  approval  · execute  ·  verify  ·  receipt
executor.js
demo
10
Approval state — sensitive capability parks in
awaiting_approval
, writes an approval row
executor.js
demo
11
Verification — four states; no verifier means the
receipt says 
unknown
, never success
executor.js
demo
12
Receipt ledger — hash-chained per business,
verifyChain
 catches edits
ledger.js
demo
13
Event outbox — transactional, subscribers, 
drain()
events.js
demo
14
Package registry + manifest validator
registry.js
demo
15
Installer — JSON schema  ·  real DDL, business
_
id +
RLS-ready, uninstall revokes reach not data
installer.js
demo
16
Gateway — the only data path a module gets, scoped
to one package + one business
gateway.js
demo
17
Projection — public profile assembled from installed
apps only
projection.js
demo
18
Workspace — cloud Android + container, per
business, persistent volumes
workspace.js
demo-
device
19
Device apps — install on the business's own device,
logged in as the business
workspace.js
demo-
device
20
AppMaps — carries[] + write/read step routes, per
package version
db/002
,
channels.js
demo-
device
21
Fan-out — one canonical change drives every app
that carries that key. Nobody names Facebook
fanout.js
demo-
device
22
Verification by screen read — replays read steps,
records channel's own observation
channels.js
demo-
device
23
Repair queue — map mismatch stops the run,
captures failing step + screenshot, does not guess
channels.js
demo-
device
24
Device session — live view/control against the same
instance automations drive
workspace.js
demo-
device
25
Shared automations — publish once, install by key,
author publishes v1.1 and everyone gets it
automation.js
demo-
device
26
Provider slots — 6 declared, contract checked at load
providers.js
demo-
modular
27
Provider swap — business binding shadows platform
default, one row
providers.js
demo-
modular
28
Model router — scores across providers, falls back,
records the decision
router.js
demo-
modular
29
Harness runner — offered only the actor's reach,
cannot widen it
harness.js
demo-
modular
30
Scripts-edit / models-read — 
agentSafe:false
 on
device writes
channels.js
,
harness.js
demo-
modular
31
Builder — intent  ·  manifest  ·  preview  ·  approve  · signed package  ·  installed
builder.js
demo-
modular
32
Generated modules — a schema gets
create/list/update/remove + renderer with real
verifiers
generated.js
demo-
modular
33
Package signing + trust tiers, signature covers
manifest hash
signing.js
demo-
modular
34
Import pipeline — 11 gates, rejects record which step
and why
importer.js
demo-
modular
35
Two MCP surfaces — public (no credential) and
private (token  ·  membership  ·  grants)
mcp.js
demo-
surfaces
36
Access tokens — hashed, scoped to one membership
at one business
mcp.js
demo-
surfaces
37
Links page — real HTML, every tile a projection,
opens in place, no outbound redirect
links.js
demo-
surfaces
38
Embed — same section as a fragment for the
business's own site
links.js
demo-
surfaces
39
Open/closed badge computed from canonical hours +
temporary closure
links.js
demo-
surfaces
40
Search intent capture — the search the booking
platform would have kept
db/003
,
availability
demo-
surfaces
Apps (
modules/
)
package
kind
tables
public section
state
business
_
profile
app
none, reads canonical
About / Hours /
Contact
BUILT
qr
_
menu
app
menu
_
item
Menu
BUILT
availability
app
slot
Check Availability
BUILT
forms
app
form, submission
Get in touch
BUILT
crm
app
contact, deal
none
BUILT
facebook
channel
_
app
appmap: hours,
contact.phone
—
BUILT
google
_
business
channel
_
app
appmap: hours,
contact.phone
—
BUILT
yelp
channel
_
app
appmap: hours
—
BUILT
Providers
package
fills
state
android
_
cloud
workspace.executor
BUILT (simulator behind it)
android
_
local
_
node
workspace.executor
BUILT (simulator behind it)
hosted
_
models
model
DECLARES + ROUTES; 
complete()
simulates
local
_
models
model
DECLARES + ROUTES; 
complete()
simulates
loop
_
harness
harness
BUILT, deterministic planner
composer
builder
BUILT
Started this turn, NOT finished
db/004_marketplace.sql
 — resource, listing, directory
_
search, referral
_
click,
subscriber, subscription, waitlist
_
entry, offer, offer
_
send. 
Tables written, not wired to
anything.
src/kernel/directory.js
 — cross-business search + referral recording + demand.
Written, not wired, no demo, never run.
PART 2 — WHERE I HARDWIRED THINGS (you were
right)
These are places I broke the modular rule. Each is a real defect with a location.
Where
What I hardwired
Should be
fanout.js:46
KEY_OF
 maps capability  ·  canonical
key in a literal object
the capability should
declare which key it
touches
canonical.js:9
AUTHORITY
 ranks are a literal object in
the kernel
a table the owner can
reorder
canonical.js
business.set_fact
 / 
set_hours
 /
set_temporary_closure
 live in the
kernel
should be a
business_core
 package
links.js:127-
175
renderer switches on data shape
(
d.categories
, 
d.days
, 
d.weekly
)
the package should
declare its own view, not
be sniffed
installer.js:6
TYPES
 field-type map is fixed
should be extensible by a
package
importer.js:15
license allow/block lists are literals
policy table
platform.js
platform default bindings are a literal
array
seed data
harness-loop
planner is keyword matching
fine as one provider, but it
is the only one
mcp.js
check_availability
 tool is named in
the kernel
should come from the
availability package
PART 3 — EVERY THING YOU RAISED IN THIS CHAT
Status: 
BUILT
 / 
PARTIAL
 / 
NOT BUILT
 / 
NOT STARTED
Foundation layers 1–10
#
Item
Status
1
Core Contracts
BUILT
2
Identity & Tenancy
BUILT
3
Canonical Business Data
BUILT
4
Sources & Reconciliation
BUILT
5
Five Maps — canonical map,
field map, capability map, tenant
install map, AppMap
PARTIAL — capability map, install map, AppMap
exist. Canonical map and field map (external field ·  canonical field) do not
6
Capability Registry
BUILT
7
Provider & Plugin Layer
BUILT
8
Harness Adapter Layer
BUILT
9
Harness Profiles — preset stacks
per industry
NOT BUILT
10
Developer Platform +
Marketplace + Modular
Foundation
PARTIAL — package format, install, signing,
import built. No SDK, no CLI, no marketplace UI,
no ratings, no versioning UI
Layers 11–20
#
Item
Status
11
AI / Model Layer — multi-model
router
PARTIAL — router, scoring, fallback, cost
recording built. No real endpoint calls
12
Local Intelligence — on-device
models, rules engine, smart cache
NOT BUILT (a 
local_models
 provider exists
but simulates)
13
Memory & Context —
episodic/business/user/world/vector
NOT BUILT — slot declared, nothing fills it
14
Builder / Composition Planner
BUILT (deterministic; not model-driven)
15
Builder Harnesses
PARTIAL — one harness, contract exists
16
GitHub / open-source ingestion
BUILT (pipeline + gates; real GitHub fetch
coded, demo uses fixtures)
17
Package standard + marketplace
PARTIAL — standard and install built,
marketplace surface not
18
Developer platform / SDK
NOT BUILT
19
Ghost Node / compute layer
PARTIAL — workspace rows and two executor
providers. No containers, no scheduler, no
autoscale
20
Distributed mesh
NOT BUILT
Execution and device
Item
Status
Android as the executor,
not APIs
BUILT
AppMaps as deterministic
scripts
BUILT
Cloud Android + Docker
container side by side,
same host
PARTIAL — rows exist, no real containers
Persistent volume, apps
stay logged in
PARTIAL — modelled, not real
Live Android screen in the
owner's dashboard
PARTIAL — session + token rows; no stream transport
Remote control of the
device
NOT BUILT
Voice interaction with any
app on the device
NOT BUILT
AI navigates read-only to
answer questions
PARTIAL — 
channel.read
 exists and is agent-safe; no model
driving it
Scripts do edits, AI never
does
BUILT
Screenshot on failure +
self-healing + resume from
checkpoint
PARTIAL — screenshot + repair row + stop-safely built. No
checkpoint resume, no proposed repair, no "unknown states
become new maps"
Browser executor
NOT BUILT
Remote computer /
desktop executor
NOT BUILT
Physical Android phone as
a node
NOT BUILT
Ghost Box (HDMI, signage,
kiosk)
NOT BUILT
Ghost Node USB adapter
(4G LTE, secure enclave)
NOT BUILT
Raspberry Pi bridge / Mac
mini local node
NOT BUILT (the 
android_local_node
 provider is a stand-in)
Data, sync, publishing
Item
Status
One update, everywhere
BUILT
Verify each destination
BUILT
Drift view: canonical vs every app
BUILT
Public profile from installed apps
BUILT
Links page, stay-on-page, sections
expand in place
BUILT
Embed / snippet into their own website
BUILT
Website builder / modular website
sections
NOT BUILT
Calendar display of availability on their
own site
BUILT (as embed)
GCR directory / cross-business search
NOT BUILT — tables + 
directory.js
 written this
turn, never run
QR menus
BUILT (as an app)
Digital signage
NOT BUILT
Widgets
NOT BUILT
Availability, waitlist, offers
Item
Status
Availability as a 
count
, not a yes ("how
many jet skis")
PARTIAL — slot has capacity/held.
resource.units
 table written, not wired
Search across every platform for one
thing (condos at Phoenix East)
NOT BUILT — 
directory.js
 written, never
run
Display from Airbnb / VRBO / FareHarbor /
Peek, book on the source
NOT BUILT — 
listing.source
 + 
book_url
designed only
Referral click recorded so the business
sees demand
NOT BUILT — table written only
Last-minute availability blast ("5 seats,
leaves in 2 hours, 50% off")
NOT BUILT — 
offer
 tables written only
Waitlist with position and a response
deadline
NOT BUILT — 
waitlist_entry
 written only
Cascade to the next person when the first
does not answer
NOT BUILT
Service businesses — "I need a plumber
ASAP"
NOT BUILT
Doctor's office cancellation  ·  offer to
first in line
NOT BUILT
Consumer opt-in / consent
NOT BUILT — 
subscriber
 table written only
Messaging, notification, assistant
Item
Status
SMS through the platform's own number
NOT BUILT — and I have not named a vendor,
per your instruction
SMS approval (reply YES 5812)
NOT BUILT
Owner texted an exception,
approves/rejects/takes over
NOT BUILT
Daily intelligence text ("yesterday at a
glance")
NOT BUILT
Opt-in streams: catch, music, deals,
loyalty
NOT BUILT
Quiet hours, rate limits, usefulness check
NOT BUILT
AI phone assistant fed by canonical data
NOT BUILT
Consumer-side app (tourist interest
filter)
NOT BUILT
Content, reviews, customers
Item
Status
Content creation: AI drafts, human approves, scripts publish
NOT BUILT
Review collection / authentic reviews app
NOT BUILT
Review intelligence (themes, recover unhappy first)
NOT BUILT
AI drafts review replies, owner approves
NOT BUILT
Customer identity / loyalty
NOT BUILT
Follow-up after a completed visit
NOT BUILT
Business / commercial
Item
Status
Admin dashboard vs user dashboard
split
NOT BUILT — the split is enforced in data, but no
UI and no admin capabilities
Every UI except the links page
NOT BUILT
Billing / plans / subscriptions
NOT BUILT
Per-tool pricing, some free with
subscription
NOT BUILT
White-label GoHighLevel as a back end,
each tool a separate app
NOT BUILT
Apps sellable standalone, off-platform
PARTIAL — packages are self-contained by
design; no standalone runtime
Payments (Square / PayPal / Stripe, fee
passed to customer)
NOT BUILT
Referral link generation by asking
NOT BUILT — would be an appmap route,
plumbing supports it
Chamber / municipal / industry packs
NOT BUILT
PART 4 — HONEST TOTALS
Foundation and execution spine: 
built and running
.
Everything consumer-facing except the links page: 
not built
.
Everything messaging: 
not built
.
Everything commercial: 
not built
.
Two files written this turn that have never executed: 
db/004_marketplace.sql
,
src/kernel/directory.js
.
Roughly: the part that makes apps possible is done. The apps themselves, the reach into
customers, and the money are not.
PART 5 — WHAT I WILL NOT DO NEXT
I will not pick the next thing. Everything above is either done, half-done, or untouched, and
you can see which. Tell me which line to work on and I will work on that line only.
