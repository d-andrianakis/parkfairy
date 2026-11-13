-- Co-ownership (#53-#56): a listing's owners with their shares, invites to join (the email's
-- token minted by the worker as it sends), each booking's payees copied at the hold, a transfer
-- per payee (Stripe's id moves off the booking), the ledger's transfers per payee, and outbox
-- rows that go to an invite rather than an account. Backfilled: every listing's owner is its
-- primary at 100%, every confirmed booking's payee that owner.
CREATE TABLE "booking_payees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"share_bps" integer NOT NULL,
	"transfer_minor" integer,
	"transfer_status" text,
	"stripe_transfer_id" text,
	"transferred_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_payees_share_check" CHECK ("booking_payees"."share_bps" between 1 and 10000),
	CONSTRAINT "booking_payees_transfer_check" CHECK ("booking_payees"."transfer_status" is null or ("booking_payees"."transfer_status" in ('sending', 'sent') and "booking_payees"."transfer_minor" is not null and "booking_payees"."transfer_minor" >= 0 and ("booking_payees"."transfer_status" = 'sent') = ("booking_payees"."transferred_at" is not null) and ("booking_payees"."stripe_transfer_id" is not null) = ("booking_payees"."transfer_status" = 'sent' and "booking_payees"."transfer_minor" > 0)))
);
--> statement-breakpoint
CREATE TABLE "listing_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" uuid NOT NULL,
	"invited_by" uuid,
	"email" text NOT NULL,
	"locale" text NOT NULL,
	"token_hash" text,
	"expires_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"withdrawn_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "listing_invites_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "listing_invites_email_check" CHECK ("listing_invites"."email" = lower("listing_invites"."email")),
	CONSTRAINT "listing_invites_locale_check" CHECK ("listing_invites"."locale" in ('el', 'en')),
	CONSTRAINT "listing_invites_token_check" CHECK (("listing_invites"."token_hash" is null) = ("listing_invites"."expires_at" is null) and ("listing_invites"."token_hash" is null or "listing_invites"."token_hash" ~ '^[0-9a-f]{64}$')),
	CONSTRAINT "listing_invites_settled_check" CHECK ("listing_invites"."accepted_at" is null or "listing_invites"."withdrawn_at" is null)
);
--> statement-breakpoint
CREATE TABLE "listing_owners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"role" text NOT NULL,
	"share_bps" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "listing_owners_role_check" CHECK ("listing_owners"."role" in ('primary', 'co_owner')),
	CONSTRAINT "listing_owners_share_check" CHECK ("listing_owners"."share_bps" between 0 and 10000 and "listing_owners"."share_bps" % 100 = 0)
);
--> statement-breakpoint
ALTER TABLE "email_outbox" DROP CONSTRAINT "email_outbox_kind_check";--> statement-breakpoint
ALTER TABLE "bookings" DROP CONSTRAINT "bookings_transfer_check";--> statement-breakpoint
DROP INDEX "ledger_entries_booking_kind_idx";--> statement-breakpoint
ALTER TABLE "email_outbox" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "email_outbox" ADD COLUMN "invite_id" uuid;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD COLUMN "owner_id" uuid;--> statement-breakpoint
ALTER TABLE "booking_payees" ADD CONSTRAINT "booking_payees_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_payees" ADD CONSTRAINT "booking_payees_owner_id_owner_profiles_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owner_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_invites" ADD CONSTRAINT "listing_invites_location_id_parking_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."parking_locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_invites" ADD CONSTRAINT "listing_invites_invited_by_owner_profiles_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."owner_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_owners" ADD CONSTRAINT "listing_owners_location_id_parking_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."parking_locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_owners" ADD CONSTRAINT "listing_owners_owner_id_owner_profiles_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owner_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "booking_payees_booking_owner_idx" ON "booking_payees" USING btree ("booking_id","owner_id");--> statement-breakpoint
CREATE INDEX "booking_payees_owner_idx" ON "booking_payees" USING btree ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "listing_invites_open_idx" ON "listing_invites" USING btree ("location_id","email") WHERE "listing_invites"."accepted_at" is null and "listing_invites"."withdrawn_at" is null;--> statement-breakpoint
CREATE INDEX "listing_invites_created_idx" ON "listing_invites" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "listing_owners_listing_owner_idx" ON "listing_owners" USING btree ("location_id","owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "listing_owners_one_primary_idx" ON "listing_owners" USING btree ("location_id") WHERE "listing_owners"."role" = 'primary';--> statement-breakpoint
CREATE INDEX "listing_owners_owner_idx" ON "listing_owners" USING btree ("owner_id");--> statement-breakpoint
ALTER TABLE "email_outbox" ADD CONSTRAINT "email_outbox_invite_id_listing_invites_id_fk" FOREIGN KEY ("invite_id") REFERENCES "public"."listing_invites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_owner_id_owner_profiles_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owner_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_outbox_invite_idx" ON "email_outbox" USING btree ("invite_id");--> statement-breakpoint
CREATE INDEX "ledger_entries_owner_idx" ON "ledger_entries" USING btree ("owner_id");--> statement-breakpoint
-- Every listing's owner is its primary, with all of the owners' share.
INSERT INTO "listing_owners" ("location_id", "owner_id", "role", "share_bps")
SELECT "id", "owner_id", 'primary', 10000 FROM "parking_locations" WHERE "owner_id" IS NOT NULL;--> statement-breakpoint
-- Every booking made's payee is its listing's owner, with any transfer already made moved onto
-- it. Holds never booked have none: they are deleted like any lapsed hold.
INSERT INTO "booking_payees" ("booking_id", "owner_id", "share_bps", "transfer_minor", "transfer_status", "stripe_transfer_id", "transferred_at")
SELECT b."id", l."owner_id", 10000, b."transfer_minor", b."transfer_status", b."stripe_transfer_id", b."transferred_at"
FROM "bookings" b JOIN "parking_locations" l ON l."id" = b."location_id"
WHERE l."owner_id" IS NOT NULL AND b."confirmed_at" IS NOT NULL;--> statement-breakpoint
-- A transfer entered names its payee.
UPDATE "ledger_entries" e SET "owner_id" = l."owner_id"
FROM "bookings" b JOIN "parking_locations" l ON l."id" = b."location_id"
WHERE e."booking_id" = b."id" AND e."kind" = 'transfer';--> statement-breakpoint
ALTER TABLE "bookings" DROP COLUMN "stripe_transfer_id";--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_booking_kind_owner_key" UNIQUE NULLS NOT DISTINCT("booking_id","kind","owner_id");--> statement-breakpoint
ALTER TABLE "email_outbox" ADD CONSTRAINT "email_outbox_recipient_check" CHECK (("email_outbox"."user_id" is null) <> ("email_outbox"."invite_id" is null) and ("email_outbox"."invite_id" is null) = ("email_outbox"."kind" <> 'listing-invite'));--> statement-breakpoint
ALTER TABLE "email_outbox" ADD CONSTRAINT "email_outbox_kind_check" CHECK ("email_outbox"."kind" in ('listing-submitted', 'listing-approved', 'listing-changes-requested', 'onboarding-reminder', 'booking-confirmed', 'booking-cancelled', 'booking-payment-refunded', 'booking-received', 'booking-cancelled-by-driver', 'listing-invite'));--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_transfer_check" CHECK ("bookings"."transfer_status" is null or ("bookings"."transfer_status" in ('sending', 'sent') and "bookings"."payment_status" = 'succeeded' and "bookings"."refund_status" is distinct from 'owed' and "bookings"."transfer_minor" is not null and "bookings"."commission_minor" is not null and "bookings"."transfer_minor" > 0 and "bookings"."commission_minor" >= 0 and "bookings"."transfer_minor" + "bookings"."commission_minor" = "bookings"."total_minor" - coalesce("bookings"."refund_minor", 0) and ("bookings"."transfer_status" = 'sent') = ("bookings"."transferred_at" is not null)));--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_owner_check" CHECK (("ledger_entries"."owner_id" is not null) = ("ledger_entries"."kind" = 'transfer'));