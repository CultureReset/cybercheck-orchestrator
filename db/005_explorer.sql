-- The explorer proposes appmap rows by reading a live screen; nothing it
-- writes is trusted until a person promotes it. These two columns exist only
-- on a candidate row — an authored map (installOnDevice, a manifest's own
-- routes) has neither.
alter table appmap add column if not exists discovered_by text;
alter table appmap add column if not exists evidence jsonb;
