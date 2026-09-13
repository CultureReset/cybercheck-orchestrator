-- ============================================================================
-- REPAIR
--
-- A repair_item is written when an appmap step cannot find its target. These
-- columns are what closes one: which field the step moved to, how that was
-- decided, and which map version replaced the one that went stale.
-- ============================================================================

alter table repair_item add column resolved_at timestamptz;
alter table repair_item add column resolution jsonb;

-- Maps are versioned already. This says which version a repaired one came from,
-- so a bad repair can be read back to the map it replaced.
alter table appmap add column derived_from uuid;
alter table appmap add column note text;
