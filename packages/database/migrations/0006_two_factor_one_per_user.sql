DROP INDEX "two_factors_user_id_idx";--> statement-breakpoint
ALTER TABLE "two_factors" ADD CONSTRAINT "two_factors_user_id_unique" UNIQUE("user_id");