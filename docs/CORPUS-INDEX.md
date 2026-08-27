CORPUS INDEX
What is actually inside everything uploaded in this chat. Read programmatically, not from memory.
2,811 real files
 (after stripping macOS resource forks) from 6 zips plus loose files. 
385,753 words
across 34 unique .docx.
 2,376 HTML, 104 XLSX, 95 JSON, 88 MD, 28 PDF, 24 SQL.
I had read 3 of the 34 documents. The rest is listed below with what is in it.
1. THE TWO CATALOGS I SHOULD HAVE BUILT FROM
04
_
Complete
_
32
_
Platform
_
Capability
_
Catalog.docx — 9,028 words
Thirty-two named platforms, each with a 
"Mapped field and control inventory"
 — which fields the
platform holds and which controls exist. This is the appmap source material.
Google Business Profile  ·  Google Analytics  ·  Google Ads  ·  Google Search Console  ·  Yelp for Business  · Toast  ·  Shopify  ·  Square  ·  FareHarbor  ·  Peek Pro  ·  BoatBooker  ·  Airbnb  ·  Vrbo  ·  Booking.com  ·  ZenMaid ·  Vagaro  ·  ServiceTitan  ·  FieldEdge  ·  Housecall Pro  ·  Jobber  ·  Workiz  ·  Momentum CRM  ·  DAT One  · Carrier411  ·  Launch27  ·  Swept  ·  Janitorial Manager  ·  Boulevard  ·  Fresha  ·  GlossGenius  ·  Phorest  · Service Fusion
I built appmaps for 3 of 32
 (Facebook, Google Business, Yelp) — and Facebook is not even on this
list. I invented it.
05
_
Complete
_
27
_
Industry
_
Structure
_
and
_
Use
_
Case
_
Catalog.docx — 3,739 words,
163 headings
Twenty-seven industries. Each has five fixed sections: 
Universal foundation used
, 
Specialized table
families
, 
Worked structured example
, 
Business / AI intake questions
, 
Public profile / customer-facing
sections
.
The stated rule: industries do not get separate incompatible products — same universal foundation,
then light up the structured modules that match the data that business has.
1 Restaurant/Bar/Caf/Brewery/Food Truck  ·  2 Fishing Charter  ·  3 Dolphin/Sunset/Sightseeing Cruise  · 4 Parasailing  ·  5 Boat/Pontoon/Jet Ski/Kayak/Paddleboard Rental  ·  6 Hotel/Resort  ·  7 Condo
Building/Unit/Vacation Rental  ·  8 Hair Salon/Barber  ·  9 Plumber  ·  10 Electrician  ·  11 HVAC  ·  12
Photographer/Videographer  ·  13 Marina  ·  14 Golf Course/Country Club  ·  15 Water
Park/Amusement/Arcade/Attraction  ·  16 Movie Theater  ·  17 Shopping Center/Mixed-Use  ·  18
Artist/Musician/Band/DJ  ·  19 Retail/Gift Shop/Seafood Market  ·  20 Automotive Dealership  ·  21 Real
Estate/Property Management  ·  22 Education/Classes/Training  ·  23 Membership/Subscription  ·  24
Event Venue  ·  25 Cleaning/Home Service/Contractor  ·  26 Museum/Cultural Attraction  ·  27
Bowling/Entertainment Venue
Example of the depth I ignored — industry 5, specialized table families: 
rental_asset_categories,
rental_assets, specs, features, capacity, status, duration options, hourly/half-day/full-
day/multi-day rates, add-ons, equipment, delivery zones, pickup locations, fuel policies,
damage/security deposits, operator/license rules, checklists, inspections, damage reports,
maintenance
I built zero industry packs.
 My 
availability
 app has one flat 
slot
 table.
2. THE 66-SCREEN CONTRACT MAP — the thing that already
specifies the whole UI
Ghost_UI_Backend_Contract_Map_66_Screens_2026-08-17.json
 + matching .docx.
Every screen has 
read_permission
, 
data_contract.reads/writes
, 
api_contract.queries
,
api_contract.realtime_events
, 
ui_inventory
, 
actions
.
Extracted totals: 
127 tables read  ·  67 tables written  ·  124 endpoints  ·  56 realtime events  ·  16
permission scopes.
Screen areas: signup 12  ·  builder 8  ·  ghost 8  ·  profile 7  ·  apps 5  ·  automations 5  ·  connections 5  · dashboard 3  ·  customers 2  ·  marketplace 2  ·  public 2  ·  agency 1  ·  analytics 1  ·  developer 1  ·  multi-
location 1  ·  settings 1  ·  team 1.
The 56 events, verbatim, include ones I never implemented: 
canonical.conflict.detected
,
canonical.conflict.resolved
, 
appmap.degraded
, 
connection.health.changed
,
connection.reauth.started
, 
execution.human_control.started
, 
execution.paused
,
compatibility.changed
, 
attention.changed
, 
verification.completed
, 
song_request.created
,
qr.destination.updated
, 
package.release.created
, 
builder.scaffold.created
,
onboarding.published
, 
pricing.changed
, 
availability.changed
.
Its top tables by screen usage: 
connections
 (13), 
package_installs
 (11), 
executions
 (10),
onboarding_drafts
 (10), 
businesses
 (9), 
package_catalog
 (7), 
capability_implementations
 (7),
verification_results
 (6), 
package_versions
 (6), 
package_compatibility
 (6),
capability_registry
 (6).
Naming conflict:
 my tables are singular (
install
, 
execution
, 
package
); this map is plural and
splits things I merged (
capability_registry
 vs 
capability_implementations
; 
package_catalog
 /
package_versions
 / 
package_compatibility
 / 
package_requirements
 / 
package_permissions
 /
package_recommendations
 — six tables where I have one).
3. THE 34 DOCUMENTS
words
headings
document
read · 106,066
805
CyberCheck
_
GhostOS
_
GCR
_
Complete
_
Developer
_
Encyclopedia (+
_
FIXED
dup)
no
39,925
812
CyberCheck
_
GhostOS
_
GCR
_
COMPLETE
_
CHAT
_
MASTER
_
ARCHIVE
_
Aug11
no
37,723
798
CyberCheck
_
Complete
_
Rebuild
_
White
_
Paper
_
and
_
Master
_
Specification
no
11,709
113
CyberCheck
_
Developer
_
Build
_
Bible
_
From
_
Zero
no
9,402
135
Ghost
_
CyberCheck
_
GCR
_
Authoritative
_
Full
_
Business
_
and
_
Technical
_
Plan
no
9,028
65
04
_
Complete
_
32
_
Platform
_
Capability
_
Catalog
no
6,154
95
Ghost
_
UI
_
to
_
Backend
_
Contract
_
Map
_
66
_
Screens
no
5,714
61
Ghost
_
Business
_
OS
_
Master
_
Build
_
Specification
no
5,175
63
Ghost
_
CyberCheck
_
GCR
_
Complete
_
Architecture
_
Master
_
Document
no
4,713
70
CyberCheck
_
GhostOS
_
Cloudflare
_
Grok
_
Master
_
Architecture
_
White
_
Paper
no
4,055
56
CyberCheck
_
From
_
Scratch
_
Developer
_
Implementation
_
White
_
Paper
no
3,878
70
CyberCheck
_
Agent
_
OS
_
Capability
_
Network
_
White
_
Paper
no
3,739
163
05
_
Complete
_
27
_
Industry
_
Structure
_
and
_
Use
_
Case
_
Catalog
no
3,283
67
Ghost
_
CyberCheck
_
Ultimate
_
Platform
_
Blueprint
no
2,985
58
Ghost
_
Tool
_
Mapping
_
and
_
Execution
_
Wiring
_
Manual
no
2,800
95
Ghost
_
Complete
_
UI
_
Backend
_
Contract
_
Map
_
66
_
Screens
no
2,285
30
Ghost
_
Business
_
OS
_
Developer
_
Specification
no
2,226
73
Ghost
_
Complete
_
Platform
_
Technical
_
Build
_
Documentation
no
2,168
31
01
_
Ghost
_
CyberCheck
_
GCR
_
Complete
_
Platform
_
Explained
no
2,092
23
07
_
Ghost
_
Documentation
_
Control
_
and
_
Reconciliation
_
Report
no
1,952
39
Ghost
_
Master
_
Developer
_
Architecture
_
and
_
Implementation
_
Spec
no
1,928
25
Ghost
_
Platform
_
White
_
Paper
_
Competitive
_
Research
_
2026
no
1,848
28
Gulf
_
Coast
_
Radar
_
Ghost
_
Network
_
Master
_
White
_
Paper
_
2026
no
1,700
24
Elon
_
Companies
_
Open
_
Source
_
Deep
_
Dive
_
for
_
CyberCheck
no
1,211
21
03
_
Ghost
_
Technical
_
Architecture
_
and
_
Execution
_
Manual
no
1,050
18
06
_
Ghost
_
Business
_
Model
_
Investor
_
and
_
Market
_
Strategy
no
1,021
16
02
_
Universal
_
Business
_
Layer
_
Customer
_
White
_
Paper
no
972
16
Ghost
_
Business
_
OS
_
Business
_
Owner
_
Guide
no
919
15
Ghost
_
Business
_
OS
_
Investor
_
White
_
Paper
no
764
17
Per
_
User
_
Cloud
_
Computer
_
Architecture
no
763
14
Ghost
_
Business
_
OS
_
Fifth
_
Grader
_
Explanation
no
246
6
CyberCheck
_
GCR
_
Database
_
Constitution
no
193
8
CyberCheck
_
AI
_
Analytics
_
Recommendation
_
Strategy
no
—
—
Ghost
_
Foundation
_
Complete
_
Concept
_
Build
_
and
_
Web
_
Lineage
yes
—
—
Ghost
_
Complete
_
Concept
_
Architecture
_
UI
_
UX
_
and
_
Build
_
Guide
yes
—
—
Ghost
_
Master
_
Platform
_
Architecture
_
and
_
Build
_
Specification
yes
The encyclopedia alone has 120 top-level sections including: Voice-First Cloud Execution Master
Blueprint  ·  Permanent Tenant and Elastic Computer Model  ·  Phone-First Authorization and the
Governance Kernel  ·  Control Plane Services  ·  Execution Plane and Compute Classes  ·  OAuth,
Composio, MCP and Secret Handling  ·  Normalized Data Model  ·  App Store and Automation
Marketplace  ·  
thirteen sections on xAI components
 (Grok Build, xAI SDK, xAI Proto, Cookbook,
Plugin Marketplace, Grok Build Plugin for Claude Code, X Algorithm, Grok Prompts, Grok-1 Open
Weights, Grok UI, Grok Desktop, Grok Remote, Grok2API, Grok Register Panel)  ·  Security and Threat
Model  ·  Billing and Resource Metering  ·  Repository Topology  ·  Phased Build Plan  ·  Appendix B
Database Tables  ·  Requirement Traceability Matrix  ·  four full repo wiring blueprints (gcr-api-clean,
Admin-dashboard-main, Dashboards-users-, gcr-unified)  ·  Four-Repo Interconnection Map.
4. WORKING SOURCE MATERIAL I NEVER TOUCHED
Real business data — Data1
_
2.zip (513 files)
104 XLSX: 
orange_beach_gulf_shores_all_restaurants_master
, batches 01–10 of deep
research, 
Gulf_Shores_Orange_Beach_Lodging_Master_List
, dockside batches (boats, marinas +
fuel, supplies + services, stay), 
August_2026_Gulf_Coast_Events_Full_Published_Snapshot
RAW_research_json_51_businesses
 — 
51 fully structured business profiles
, M0xx/R0xx/T0xx
ids, each with operating
_
status, city
_
area, address, phone, parent
_
brand, concept
_
role,
official
_
website, primary
_
menu
_
urls, menu
_
extraction
_
status, and full menus
RAW_menu_items.csv
Lunas_Eat_Drink_Structured_Package
 — a complete worked business: master profile MD,
structured JSON, media manifest, image attachments
HANDOFF_INSTRUCTIONS.md
, Alabama Gulf Coast Attractions Directory PDF
This is real seed data for 51 businesses and I demoed with a made-up bistro.
UI prototypes — Plans
_
2.zip (337 files)
ghost-complete-ui-ux-html-self-contained
 — the 66 screens as working HTML with 
SITE-
MAP.json
, 
VALIDATION.json
, 
BACKEND-BUILD-SUMMARY.json
, shared 
app.js
 / 
style.css
. Includes
public/song-request.html
, 
marketplace/detail.html
, 
builder/private-ui.html
,
builder/public-ui.html
, 
ghost/watch.html
, 
ghost/receipts.html
, 
ghost/compatibility.html
,
connections/attention.html
, all 12 signup steps.
Plus 
MARKETPLACE_ARCHITECTURE.md
 — a read of 
xai-org/grok-build (Apache 2.0)
 naming six
mechanisms to take: two-file manifest model (
marketplace.json
 + 
plugin-index.json
), 
SHA
pinning
 (
require_sha
, catalog hidden if catalog SHA  ≠  index SHA), fail-closed everywhere, and
three more. My signing is HMAC over a manifest hash — close, but it is not the two-file model and
there is no catalog/index SHA agreement.
His existing SQL
001_auth_tenants.sql
 (app
_
user, tenant, tenant
_
user, session
_
token)  ·  
002_modules.sql
 (module,
tenant
_
module, module
_
record)  ·  
003_marketplace.sql
 (developer, module
_
version,
module
_
permission, tenant
_
module
_
grant, app
_
token, webhook
_
subscription, webhook
_
delivery)  · schema.sql
 (requests, request
_
logs, api
_
clients, rate
_
limit
_
buckets).
module_record
 is the generic per-module row store — a different design from my compile-
schema-to-DDL installer. 
webhook_subscription
/
webhook_delivery
 do not exist in mine at all.
Websites.zip
ghost-complete-page-library
 — ~30 industry landing pages (marinas, charters-tours, condos-
vacation-rentals, golf-courses-clubs, rv-parks-campgrounds, food-trucks, parking, cities-municipal,
chambers-agencies-tourism, franchises-multi-location, …), plus
ghost_free_availability_match_sales_page.html
, 
cybercheck-widget-sales-page.html
,
ghost_business_updates_publisher_page.html
,
Ghost_Unified_Commercial_Site_Master_Plan.html
, 
Ghost_Product_Category_Sales_Demo_Suite
with a MANIFEST defining the taxonomy: 
connected
_
app / ghost
_
app / automation / tool / plugin
.
5. WHAT THIS CHANGES ABOUT WHAT I BUILT
I built
Corpus says
3 appmaps, one invented
(Facebook)
32 platforms with field+control inventories
0 industry packs
27 industries with named table families each
1 flat 
slot
 table
rental
_
assets + specs + rates + deposits + inspections + …
singular table names, 43
tables
plural, 127 tables read across 66 screens
1 package table
package
_
catalog + versions + compatibility + requirements +
permissions + recommendations
my own event names
56 named events already specified
demo data invented
51 real structured businesses + 104 spreadsheets sitting unused
HMAC signature
two-file manifest + SHA pinning per grok-build
compile schema 
#
 DDL
his 
module_record
 generic row store
no webhooks
webhook_subscription
 + 
webhook_delivery
5 permission scopes in
practice
16 named permission scopes
song requests as an example
I invented
public/song-request.html
 + 
song_request.created
 event
already exist
6. THE HONEST CONCLUSION
I built a working spine, and I built it from images and from three documents, while 385,000 words of
specification and 51 real business records sat unread in the same folder. The spine's shape is mostly
right. Its vocabulary, its table names, its event names, its scope counts and its data are all mine
instead of yours, which means every one of them is wrong.
Nothing further should be built until the vocabulary is reconciled against the 66-screen contract map
and the two catalogs.
