-- ============================================================================
-- KERNEL SCHEMA
-- The part of the platform that never ships as a module.
-- Everything above this line is a package.
-- ============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- IDENTITY
-- A person is global. A person's relationship to a business is separate.
-- ---------------------------------------------------------------------------

create table person (
  id            uuid primary key default gen_random_uuid(),
  email         text unique,
  phone         text unique,
  display_name  text,
  password_hash text,
  created_at    timestamptz not null default now()
);

create table business (
  id            uuid primary key default gen_random_uuid(),
  slug          text unique not null,
  legal_name    text,
  display_name  text not null,
  status        text not null default 'active',
  created_at    timestamptz not null default now()
);

-- A person's seat at a business. Roles are labels; grants are the real thing.
create table membership (
  id            uuid primary key default gen_random_uuid(),
  person_id     uuid not null references person(id) on delete cascade,
  business_id   uuid not null references business(id) on delete cascade,
  role          text not null,
  status        text not null default 'active',
  created_at    timestamptz not null default now(),
  unique (person_id, business_id)
);

-- ---------------------------------------------------------------------------
-- PERMISSIONS
-- Grants, not roles. A grant says: this membership may invoke this capability
-- on this resource, at this disposition.
-- ---------------------------------------------------------------------------

create type disposition as enum ('auto', 'ask', 'never');

create table grant_row (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references business(id) on delete cascade,
  membership_id uuid references membership(id) on delete cascade,
  role          text,
  capability    text not null,
  resource      text not null default '*',
  disposition   disposition not null default 'ask',
  created_at    timestamptz not null default now(),
  check (membership_id is not null or role is not null)
);

create index on grant_row (business_id, capability);

-- ---------------------------------------------------------------------------
-- PACKAGES
-- Apps, plugins, connectors, automations, models, industry packs.
-- Everything installable enters here.
-- ---------------------------------------------------------------------------

create table package (
  id            uuid primary key default gen_random_uuid(),
  key           text not null,
  version       text not null,
  kind          text not null,
  name          text not null,
  summary       text,
  manifest      jsonb not null,
  source        text,
  content_hash  text not null,
  status        text not null default 'published',
  created_at    timestamptz not null default now(),
  unique (key, version)
);

create table install (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references business(id) on delete cascade,
  package_id    uuid references package(id),   -- null for automations, which install by key
  package_key   text not null,
  version       text not null,
  settings      jsonb not null default '{}',
  status        text not null default 'active',
  installed_at  timestamptz not null default now(),
  removed_at    timestamptz,
  unique (business_id, package_key)
);

-- Tables a package declared and the kernel provisioned on its behalf.
create table provisioned_table (
  id            uuid primary key default gen_random_uuid(),
  install_id    uuid not null references install(id) on delete cascade,
  package_key   text not null,
  logical_name  text not null,
  physical_name text not null,
  schema_json   jsonb not null,
  created_at    timestamptz not null default now(),
  unique (physical_name)
);

-- ---------------------------------------------------------------------------
-- CAPABILITIES
-- The verbs. Modules never touch the database; they invoke capabilities.
-- ---------------------------------------------------------------------------

create table capability (
  key           text primary key,
  package_key   text not null,
  summary       text,
  input_schema  jsonb,
  output_schema jsonb,
  sensitivity   text not null default 'normal',
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- CANONICAL BUSINESS DATA
-- What the owner says is true. Never a channel's opinion.
-- No per-channel columns, ever.
-- ---------------------------------------------------------------------------

create table location (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references business(id) on delete cascade,
  label         text not null,
  street1       text,
  street2       text,
  city          text,
  region        text,
  postal_code   text,
  country       text,
  latitude      numeric(9,6),
  longitude     numeric(9,6),
  timezone      text,
  is_primary    boolean not null default false,
  created_at    timestamptz not null default now()
);

create table business_fact (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references business(id) on delete cascade,
  location_id   uuid references location(id) on delete cascade,
  key           text not null,
  value         jsonb not null,
  effective_from timestamptz not null default now(),
  effective_to  timestamptz,
  set_by        uuid references person(id),
  created_at    timestamptz not null default now()
);

create index on business_fact (business_id, key);

create table regular_hours (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references business(id) on delete cascade,
  location_id   uuid references location(id) on delete cascade,
  weekday       smallint not null check (weekday between 0 and 6),
  opens         time,
  closes        time,
  closed        boolean not null default false
);

create table temporary_hours (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references business(id) on delete cascade,
  location_id   uuid references location(id) on delete cascade,
  starts_at     timestamptz not null,
  ends_at       timestamptz not null,
  opens         time,
  closes        time,
  closed        boolean not null default false,
  reason        text,
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- CONNECTIONS + PROVENANCE
-- What each outside channel currently believes, and how far it has drifted.
-- ---------------------------------------------------------------------------

create table connection (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references business(id) on delete cascade,
  provider_key  text not null,
  external_id   text,
  display_name  text,
  status        text not null default 'connected',
  credential_ref text,
  connected_at  timestamptz not null default now(),
  unique (business_id, provider_key, external_id)
);

-- Append-only. An observation is what a source claimed, when, with what rank.
create table observation (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references business(id) on delete cascade,
  connection_id uuid references connection(id) on delete set null,
  source        text not null,
  authority_rank smallint not null,
  subject       text not null,
  key           text not null,
  value         jsonb not null,
  observed_at   timestamptz not null default now()
);

create index on observation (business_id, key, observed_at desc);

create table channel_sync_state (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references business(id) on delete cascade,
  connection_id uuid not null references connection(id) on delete cascade,
  key           text not null,
  canonical_hash text,
  channel_hash  text,
  in_sync       boolean not null default false,
  last_checked  timestamptz,
  last_pushed   timestamptz,
  unique (connection_id, key)
);

-- ---------------------------------------------------------------------------
-- EXECUTION + SAFETY LOOP
-- Request -> plan -> approval -> execute -> verify -> receipt -> ledger.
-- ---------------------------------------------------------------------------

create type execution_state as enum (
  'requested','planned','awaiting_approval','approved','rejected',
  'running','verifying','succeeded','failed','cancelled'
);

create type verification_state as enum ('verified','partial','unknown','failed');

create table execution (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references business(id) on delete cascade,
  requested_by  uuid references person(id),
  capability    text not null,
  input         jsonb not null default '{}',
  plan          jsonb,
  route         text,
  state         execution_state not null default 'requested',
  idempotency_key text,
  result        jsonb,
  error         jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (business_id, idempotency_key)
);

create table approval (
  id            uuid primary key default gen_random_uuid(),
  execution_id  uuid not null references execution(id) on delete cascade,
  business_id   uuid not null references business(id) on delete cascade,
  asked_at      timestamptz not null default now(),
  decided_at    timestamptz,
  decided_by    uuid references person(id),
  decision      text,
  note          text
);

create table receipt (
  id            uuid primary key default gen_random_uuid(),
  execution_id  uuid not null references execution(id) on delete cascade,
  business_id   uuid not null references business(id) on delete cascade,
  capability    text not null,
  verification  verification_state not null,
  evidence      jsonb not null default '[]',
  payload_hash  text not null,
  prev_hash     text,
  chain_hash    text not null,
  created_at    timestamptz not null default now()
);

create index on receipt (business_id, created_at desc);

-- ---------------------------------------------------------------------------
-- EVENTS
-- Transactional outbox. Modules subscribe; nothing polls the database.
-- ---------------------------------------------------------------------------

create table event_outbox (
  id            bigserial primary key,
  business_id   uuid references business(id) on delete cascade,
  topic         text not null,
  payload       jsonb not null,
  created_at    timestamptz not null default now(),
  delivered_at  timestamptz
);

create index on event_outbox (delivered_at) where delivered_at is null;

-- ---------------------------------------------------------------------------
-- PUBLIC PROJECTION
-- What a module chooses to expose on the public profile.
-- ---------------------------------------------------------------------------

create table projection_map (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references business(id) on delete cascade,
  install_id    uuid not null references install(id) on delete cascade,
  section_key   text not null,
  title         text not null,
  icon          text,
  sort_order    int not null default 100,
  visible       boolean not null default true,
  renderer      text not null,
  unique (business_id, section_key)
);
