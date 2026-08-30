-- The real device. Everything here exists because a physical phone is not a
-- simulator: it has a serial, a battery, an app version, and screens that stop
-- looking the way the map remembers.

-- The phone itself, bound to one workspace. One node owns one phone; two runs
-- may not drive the same screen at once, and the serial is what enforces it.
create table device_node (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references workspace(id) on delete cascade,
  business_id     uuid not null references business(id) on delete cascade,
  serial          text not null,
  endpoint        text not null default 'http://127.0.0.1:8391',
  transport       text not null default 'usb',      -- usb | tcp
  state           text not null default 'offline',  -- offline | ready | busy | challenged
  android_version text,
  battery_level   int,
  last_seen       timestamptz,
  created_at      timestamptz not null default now(),
  unique (serial)
);

-- What a screen looks like, as the sorted set of resource-ids on it. A step
-- that says { at: "hours_editor" } is checked against this before it acts.
-- Unknown name on the first run: learned. Known name that does not match:
-- stop, because a blind tap on an unexpected screen inside a live business
-- account is how you delete a location instead of editing its hours.
create table screen_print (
  id            uuid primary key default gen_random_uuid(),
  package_key   text not null,
  version       text not null,
  name          text not null,
  fingerprint   text not null,
  ids           jsonb not null default '[]',
  captured_at   timestamptz not null default now(),
  unique (package_key, version, name)
);

-- Which build of the app a map was proven against. A versionCode change is not
-- cosmetic: it invalidates every map for that package until re-verified.
create table app_version_seen (
  id              uuid primary key default gen_random_uuid(),
  device_node_id  uuid references device_node(id) on delete cascade,
  android_package text not null,
  version_code    text not null,
  version_name    text,
  first_seen      timestamptz not null default now(),
  last_seen       timestamptz not null default now(),
  unique (device_node_id, android_package, version_code)
);

-- Voice and text both land here before anything is executed, so a wrong
-- reading is visible next to what it was turned into.
create table intent_log (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references business(id) on delete cascade,
  person_id     uuid references person(id) on delete set null,
  surface       text not null default 'text',   -- voice | text | dashboard
  transcript    text,
  audio_seconds numeric,
  capability    text,
  input         jsonb,
  confidence    numeric,
  state         text not null default 'proposed', -- proposed | confirmed | rejected | executed
  execution_id  uuid references execution(id) on delete set null,
  created_at    timestamptz not null default now()
);

-- A repaired map is a new version with an approval on it, never an edit in
-- place. These columns are what make that traceable.
alter table appmap add column source text not null default 'authored';
alter table appmap add column repaired_from uuid;
alter table appmap add column superseded_by uuid;
alter table appmap add column approved_by uuid;
alter table appmap add column proven_version_code text;

-- What the repair loop proposed, and what came of it.
alter table repair_item add column tried jsonb not null default '[]';
alter table repair_item add column observed_fingerprint text;
alter table repair_item add column expected_fingerprint text;
alter table repair_item add column proposed_routes jsonb;
alter table repair_item add column resulting_appmap_id uuid;
alter table repair_item add column resolved_at timestamptz;
