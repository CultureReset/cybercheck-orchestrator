-- ============================================================================
-- WORKSPACE / DEVICE / CHANNEL APPS
-- The execution side. One workspace per business: a cloud Android instance
-- and a container running side by side on the same host.
-- ============================================================================

create table workspace (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references business(id) on delete cascade,
  kind          text not null,              -- cloud_android | container | local_node
  host          text,
  region        text,
  state         text not null default 'provisioning',  -- provisioning | ready | paused | error
  persistent_volume text,
  created_at    timestamptz not null default now(),
  last_started  timestamptz
);

create index on workspace (business_id);

-- A live look at the device from the owner's dashboard. Same instance the
-- automations drive, not a copy of it.
create table device_session (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspace(id) on delete cascade,
  business_id   uuid not null references business(id) on delete cascade,
  opened_by     uuid references person(id),
  mode          text not null default 'view',   -- view | control
  stream_url    text,
  control_token text,
  state         text not null default 'open',
  opened_at     timestamptz not null default now(),
  closed_at     timestamptz
);

-- An app the business installed onto their own device, and the account
-- it is logged in as. The credential never leaves the workspace.
create table device_app (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspace(id) on delete cascade,
  business_id   uuid not null references business(id) on delete cascade,
  package_key   text not null,
  android_package text,
  account_label text,
  logged_in     boolean not null default false,
  last_seen     timestamptz,
  installed_at  timestamptz not null default now(),
  unique (workspace_id, package_key)
);

-- The map of an app's screens: how to reach a field, how to change it,
-- how to read it back. Versioned, because apps move things around.
create table appmap (
  id            uuid primary key default gen_random_uuid(),
  package_key   text not null,
  version       text not null,
  android_package text,
  carries       jsonb not null default '[]',  -- which canonical keys this app holds
  routes        jsonb not null default '{}',  -- key -> { write: [...steps], read: [...steps] }
  status        text not null default 'active',
  created_at    timestamptz not null default now(),
  unique (package_key, version)
);

-- When a map stops matching reality, the run lands here instead of silently
-- writing the wrong thing.
create table repair_item (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid references business(id) on delete cascade,
  package_key   text not null,
  execution_id  uuid references execution(id) on delete set null,
  step          jsonb,
  reason        text not null,
  screen        jsonb,
  state         text not null default 'open',
  created_at    timestamptz not null default now()
);

-- What one user built and chose to share. Another business installs it as-is.
create table shared_automation (
  id            uuid primary key default gen_random_uuid(),
  author_business_id uuid references business(id) on delete set null,
  key           text not null,
  version       text not null,
  name          text not null,
  definition    jsonb not null,
  visibility    text not null default 'private',  -- private | marketplace
  created_at    timestamptz not null default now(),
  unique (key, version)
);
