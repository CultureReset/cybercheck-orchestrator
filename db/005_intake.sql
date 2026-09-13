-- ============================================================================
-- INTAKE
--
-- What the owner actually said, kept next to what the platform decided it
-- meant. A receipt proves an execution happened; this proves the execution was
-- the one that was asked for. Without the utterance a wrong edit looks correct
-- all the way down the chain.
-- ============================================================================

create table intake_request (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references business(id) on delete cascade,
  person_id     uuid references person(id),
  channel       text not null default 'text',   -- text | voice | dashboard
  utterance     text not null,
  transcript_of text,                           -- audio reference when channel = voice
  parsed        jsonb,                          -- capability, input, assumptions
  source        text,                           -- rules | model
  understood    boolean not null default false,
  question      text,                           -- what we asked back, when we did not act
  execution_id  uuid references execution(id),
  created_at    timestamptz not null default now()
);

create index on intake_request (business_id, created_at desc);
