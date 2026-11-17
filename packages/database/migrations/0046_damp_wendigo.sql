CREATE TABLE "overstay_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"reported_by" uuid NOT NULL,
	"reported_at" timestamp with time zone NOT NULL,
	"note" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"resolution" text,
	CONSTRAINT "overstay_reports_booking_id_unique" UNIQUE("booking_id"),
	CONSTRAINT "overstay_reports_status_check" CHECK ("overstay_reports"."status" in ('open', 'resolved')),
	CONSTRAINT "overstay_reports_note_check" CHECK (char_length("overstay_reports"."note") between 1 and 300),
	CONSTRAINT "overstay_reports_resolution_check" CHECK (case when "overstay_reports"."status" = 'resolved' then "overstay_reports"."resolved_by" is not null and "overstay_reports"."resolved_at" is not null and "overstay_reports"."resolution" is not null and char_length("overstay_reports"."resolution") between 1 and 100 else "overstay_reports"."resolved_by" is null and "overstay_reports"."resolved_at" is null and "overstay_reports"."resolution" is null end)
);
--> statement-breakpoint
ALTER TABLE "audit_log" DROP CONSTRAINT "audit_log_action_check";--> statement-breakpoint
ALTER TABLE "overstay_reports" ADD CONSTRAINT "overstay_reports_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "overstay_reports" ADD CONSTRAINT "overstay_reports_reported_by_users_id_fk" FOREIGN KEY ("reported_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "overstay_reports" ADD CONSTRAINT "overstay_reports_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "overstay_reports_open_idx" ON "overstay_reports" USING btree ("reported_at","id") WHERE "overstay_reports"."status" = 'open';--> statement-breakpoint
CREATE INDEX "overstay_reports_resolved_idx" ON "overstay_reports" USING btree ("reported_at","id") WHERE "overstay_reports"."status" = 'resolved';--> statement-breakpoint
CREATE INDEX "overstay_reports_reported_by_idx" ON "overstay_reports" USING btree ("reported_by");--> statement-breakpoint
CREATE INDEX "overstay_reports_resolved_by_idx" ON "overstay_reports" USING btree ("resolved_by") WHERE "overstay_reports"."resolved_by" is not null;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_action_check" CHECK ("audit_log"."action" in ('listing.approved', 'listing.changes_requested', 'listing.proof_opened', 'user.two_factor_removed', 'user.viewed', 'listing.suspended', 'listing.reinstated', 'user.suspended', 'user.reinstated', 'booking.viewed', 'booking.cancelled', 'booking.refund_retried', 'booking.refund_settled', 'dispute.decided', 'overstay.resolved'));