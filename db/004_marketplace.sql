-- ============================================================================
-- RESOURCES, CROSS-BUSINESS SEARCH, WAITLIST, LAST-MINUTE OFFERS
--
-- Availability is a count, not a yes. "Available" tells a visitor nothing;
-- "three left at 2pm" is the whole product.
-- ============================================================================

-- What a business actually has units of. Set once, during setup.
create table resource (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references business(id) on delete cascade,
  key           text not null,
  name          text not null,
  category      text not null,             -- condo | jetski | charter | cruise | appointment | service_call
  units         int not null default 1,    -- how many of this thing exist
  party_max     int,
  duration_min  int,
  created_at    timestamptz not null default now(),
  unique (business_id, key)
);

-- The cross-business index. Only rows a business chose to publish appear here.
-- Booking and payment stay wherever they already are; this is the shelf.
create table listing (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references business(id) on delete cascade,
  resource_id   uuid references resource(id) on delete cascade,
  category      text not null,
  title         text not null,
  area          text,
  on_date       date not null,
  starts        time,
  ends          time,
  units_total   int not null default 1,
  units_left    int not null default 1,
  price         numeric(12,2),
  source        text not null default 'direct',   -- direct | airbnb | vrbo | fareharbor | peek | other
  book_url      text,
  published     boolean not null default false,
  updated_at    timestamptz not null default now()
);

create index on listing (category, on_date, published);
create index on listing (business_id, on_date);

-- A search that spans businesses. No single business owns it, so it lands here.
create table directory_search (
  id            uuid primary key default gen_random_uuid(),
  category      text,
  area          text,
  on_date       date,
  party_size    int,
  matched       int not null default 0,
  businesses_matched int not null default 0,
  created_at    timestamptz not null default now()
);

-- The visitor left for the source platform. The business still learns it happened.
create table referral_click (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references business(id) on delete cascade,
  listing_id    uuid references listing(id) on delete set null,
  source        text not null,
  on_date       date,
  party_size    int,
  created_at    timestamptz not null default now()
);

-- --------------------------------------------------------------------------
-- CONSUMERS
-- A person who asked to hear about something. Consent is a row with a date on it.
-- --------------------------------------------------------------------------

create table subscriber (
  id            uuid primary key default gen_random_uuid(),
  contact_hash  text not null unique,      -- the raw contact is never stored here
  channel       text not null default 'sms',
  consented_at  timestamptz not null default now(),
  revoked_at    timestamptz,
  created_at    timestamptz not null default now()
);

create table subscription (
  id            uuid primary key default gen_random_uuid(),
  subscriber_id uuid not null references subscriber(id) on delete cascade,
  business_id   uuid references business(id) on delete cascade,
  category      text,
  area          text,
  created_at    timestamptz not null default now()
);

-- --------------------------------------------------------------------------
-- WAITLIST
-- Someone wants a thing that is full. When it opens, position decides who
-- hears first, and the clock decides how long they have.
-- --------------------------------------------------------------------------

create table waitlist_entry (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references business(id) on delete cascade,
  resource_id   uuid references resource(id) on delete cascade,
  subscriber_id uuid references subscriber(id) on delete set null,
  wanted_date   date,
  wanted_window text,
  party_size    int not null default 1,
  position      int not null,
  state         text not null default 'waiting',  -- waiting | offered | accepted | passed | expired | withdrawn
  offered_at    timestamptz,
  responds_by   timestamptz,
  settled_at    timestamptz,
  created_at    timestamptz not null default now()
);

create index on waitlist_entry (business_id, resource_id, state, position);

-- --------------------------------------------------------------------------
-- OFFERS
-- Seats that will otherwise expire worthless.
-- --------------------------------------------------------------------------

create table offer (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references business(id) on delete cascade,
  listing_id    uuid references listing(id) on delete set null,
  headline      text not null,
  units         int not null,
  units_claimed int not null default 0,
  discount_pct  int,
  starts_at     timestamptz,
  expires_at    timestamptz not null,
  state         text not null default 'draft',    -- draft | sent | expired | filled
  created_at    timestamptz not null default now()
);

create table offer_send (
  id            uuid primary key default gen_random_uuid(),
  offer_id      uuid not null references offer(id) on delete cascade,
  subscriber_id uuid references subscriber(id) on delete set null,
  waitlist_id   uuid references waitlist_entry(id) on delete set null,
  channel       text not null,
  state         text not null default 'sent',     -- sent | claimed | declined | expired | failed
  responds_by   timestamptz,
  sent_at       timestamptz not null default now(),
  settled_at    timestamptz
);

create index on offer_send (offer_id, state);
