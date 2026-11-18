CREATE TABLE "favourite_listings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "favourite_listings_user_location_unique" UNIQUE("user_id","location_id")
);
--> statement-breakpoint
CREATE TABLE "saved_vehicles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"plate" text NOT NULL,
	"name" text,
	"height_cm" smallint,
	"length_cm" smallint,
	"width_cm" smallint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "saved_vehicles_user_plate_unique" UNIQUE("user_id","plate"),
	CONSTRAINT "saved_vehicles_plate_check" CHECK ("saved_vehicles"."plate" ~ '^[A-Z0-9]{2,10}$'),
	CONSTRAINT "saved_vehicles_name_check" CHECK ("saved_vehicles"."name" is null or char_length("saved_vehicles"."name") between 1 and 40),
	CONSTRAINT "saved_vehicles_size_check" CHECK (("saved_vehicles"."height_cm" is null or "saved_vehicles"."height_cm" between 100 and 500) and ("saved_vehicles"."length_cm" is null or "saved_vehicles"."length_cm" between 200 and 1500) and ("saved_vehicles"."width_cm" is null or "saved_vehicles"."width_cm" between 100 and 400))
);
--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "vehicle_id" uuid;--> statement-breakpoint
ALTER TABLE "favourite_listings" ADD CONSTRAINT "favourite_listings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favourite_listings" ADD CONSTRAINT "favourite_listings_location_id_parking_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."parking_locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_vehicles" ADD CONSTRAINT "saved_vehicles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "favourite_listings_user_created_idx" ON "favourite_listings" USING btree ("user_id","created_at" DESC NULLS LAST,"id");--> statement-breakpoint
CREATE INDEX "favourite_listings_location_idx" ON "favourite_listings" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "saved_vehicles_user_created_idx" ON "saved_vehicles" USING btree ("user_id","created_at");--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_vehicle_id_saved_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."saved_vehicles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bookings_vehicle_idx" ON "bookings" USING btree ("vehicle_id") WHERE "bookings"."vehicle_id" is not null;