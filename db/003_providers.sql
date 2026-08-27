-- ============================================================================
-- PROVIDERS, BUILDER, IMPORT
-- Every layer is a slot. A slot has a contract. A provider package fills it.
-- Nothing in the kernel names a vendor.
-- ============================================================================

-- Declared by the kernel. The contract a provider must satisfy to fill it.
create table provider_slot (
  key           text primary key,          -- model | harness | builder | workspace.executor | sandbox | memory | mesh
  summary       text,
  contract      jsonb not null,            -- required exports
  multiple      boolean not null default false,  -- can more than one be bound at once
  created_at    timestamptz not null default now()
);

-- Which provider a business is using for a slot right now. Swapping is a row.
create table provider_binding (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid references business(id) on delete cascade,  -- null = platform default
  slot_key      text not null references provider_slot(key),
  package_key   text not null,
  priority      int not null default 100,
  config        jsonb not null default '{}',
  active        boolean not null default true,
  bound_at      timestamptz not null default now()
);

create index on provider_binding (slot_key, business_id);

-- What the router decided and why. Cost and latency are recorded, not guessed.
create table routing_decision (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid references business(id) on delete cascade,
  execution_id  uuid references execution(id) on delete set null,
  slot_key      text not null,
  candidates    jsonb not null default '[]',
  chose         text not null,
  reason        text,
  fell_back_from text,
  latency_ms    int,
  cost_cents    numeric(10,4),
  created_at    timestamptz not null default now()
);

-- Import pipeline. Anything from outside becomes a package or it stops here.
create table import_job (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid references business(id) on delete set null,
  source        text not null,             -- github | url | upload | marketplace
  reference     text not null,             -- owner/repo, url, filename
  state         text not null default 'queued',
  pinned_commit text,
  findings      jsonb not null default '{}',
  produced_package text,
  produced_version text,
  failed_at_step text,
  reason        text,
  created_at    timestamptz not null default now(),
  finished_at   timestamptz
);

-- A package is not installable until it is signed. The hash covers the manifest.
create table package_signature (
  id            uuid primary key default gen_random_uuid(),
  package_key   text not null,
  version       text not null,
  content_hash  text not null,
  signature     text not null,
  signer        text not null,
  trust_tier    text not null default 'community',  -- official | partner | community | unverified
  signed_at     timestamptz not null default now(),
  unique (package_key, version)
);

-- The builder's output before it becomes a package. Preview, then approve.
create table build_plan (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references business(id) on delete cascade,
  requested_by  uuid references person(id),
  intent        text not null,
  plan          jsonb not null,
  state         text not null default 'proposed',   -- proposed | approved | rejected | deployed
  produced_package text,
  created_at    timestamptz not null default now(),
  decided_at    timestamptz
);

-- A harness run: an agent loop. Every step it takes is still an execution.
create table harness_run (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references business(id) on delete cascade,
  harness_key   text not null,
  goal          text not null,
  state         text not null default 'running',
  steps         jsonb not null default '[]',
  result        jsonb,
  created_at    timestamptz not null default now(),
  finished_at   timestamptz
);

-- ============================================================================
-- ACCESS + INTENT
-- ============================================================================

-- A business has two surfaces. The private one needs one of these.
create table access_token (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references business(id) on delete cascade,
  membership_id uuid references membership(id) on delete cascade,
  label         text not null,
  token_hash    text not null unique,
  scopes        jsonb not null default '[]',
  surface       text not null default 'private',
  created_at    timestamptz not null default now(),
  revoked_at    timestamptz
);

-- What a visitor was looking for, captured on the business's own page.
-- The booking platform normally keeps this and never gives it back.
create table search_intent (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references business(id) on delete cascade,
  surface       text not null,             -- links | website | embed | assistant
  requested_for date,
  party_size    int,
  resource      text,
  matched       int not null default 0,
  converted     boolean not null default false,
  created_at    timestamptz not null default now()
);

create index on search_intent (business_id, created_at desc);
