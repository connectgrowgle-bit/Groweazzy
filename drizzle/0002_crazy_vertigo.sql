ALTER TABLE "service_plans" ADD COLUMN "key" varchar(100) NOT NULL;--> statement-breakpoint
ALTER TABLE "service_plans" ADD COLUMN "billing_note" varchar(100) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "tagline" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "audience" varchar(200) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "features" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "how_it_works" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "service_plans_key_uidx" ON "service_plans" USING btree ("key");