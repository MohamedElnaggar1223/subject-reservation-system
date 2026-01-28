CREATE TABLE "file" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size" numeric NOT NULL,
	"storage_key" text NOT NULL,
	"url" text NOT NULL,
	"file_type" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "file_variant" (
	"id" text PRIMARY KEY NOT NULL,
	"file_id" text NOT NULL,
	"variant" text NOT NULL,
	"storage_key" text NOT NULL,
	"url" text NOT NULL,
	"width" numeric NOT NULL,
	"height" numeric NOT NULL,
	"size" numeric NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "file" ADD CONSTRAINT "file_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_variant" ADD CONSTRAINT "file_variant_file_id_file_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."file"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "file_userId_idx" ON "file" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "file_fileType_idx" ON "file" USING btree ("file_type");--> statement-breakpoint
CREATE INDEX "fileVariant_fileId_idx" ON "file_variant" USING btree ("file_id");