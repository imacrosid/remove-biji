ALTER TABLE "invoices" ADD COLUMN "created_at" timestamp with time zone DEFAULT now();