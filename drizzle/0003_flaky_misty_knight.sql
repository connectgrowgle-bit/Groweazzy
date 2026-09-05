CREATE TABLE "rate_limit_buckets" (
	"key" varchar(300) PRIMARY KEY NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"window_start_at" timestamp with time zone DEFAULT now() NOT NULL
);
