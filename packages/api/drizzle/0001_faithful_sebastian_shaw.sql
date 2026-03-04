ALTER TABLE "users" ADD COLUMN "sub" varchar(255);--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_sub_unique" UNIQUE("sub");