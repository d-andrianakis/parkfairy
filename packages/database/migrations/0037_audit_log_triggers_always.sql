-- The append-only triggers fire whatever the session says: `session_replication_role = replica` (a
-- bulk-load convenience) would otherwise skip ordinary triggers. Whoever owns the table can still
-- drop a trigger, so production runs the API as a role that only inserts and selects on audit_log
-- (Phase 6, memory.md).
ALTER TABLE audit_log ENABLE ALWAYS TRIGGER audit_log_no_update_delete;--> statement-breakpoint
ALTER TABLE audit_log ENABLE ALWAYS TRIGGER audit_log_no_truncate;
