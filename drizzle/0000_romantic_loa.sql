-- Current sql file was generated after introspecting the database
-- If you want to run this migration please uncomment this code before executing migrations
/*
CREATE TYPE "public"."class_standing_t" AS ENUM('freshman', 'sophomore', 'junior', 'senior', 'graduate', 'phd', 'alumni');--> statement-breakpoint
CREATE TYPE "public"."consent_type_t" AS ENUM('privacy_policy', 'terms_of_service', 'recruiter_resume_sharing', 'email_marketing', 'sms_marketing');--> statement-breakpoint
CREATE TYPE "public"."deletion_request_status_t" AS ENUM('pending', 'processing', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."interested_role_t" AS ENUM('software_engineering', 'data_science', 'data_engineering', 'machine_learning', 'product_management', 'ui_ux_design', 'devops_sre', 'cybersecurity', 'research', 'consulting', 'quant_finance', 'other');--> statement-breakpoint
CREATE TYPE "public"."resume_status_t" AS ENUM('pending', 'active', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."verification_method_t" AS ENUM('email_otp', 'admin_manual');--> statement-breakpoint
CREATE TABLE "school_domains" (
	"domain" "citext" PRIMARY KEY NOT NULL,
	"school_name" text NOT NULL,
	"school_slug" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "school_domains_school_slug_key" UNIQUE("school_slug"),
	CONSTRAINT "school_domains_school_slug_check" CHECK (school_slug ~ '^[a-z0-9\-]+$'::text)
);
--> statement-breakpoint
ALTER TABLE "school_domains" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"google_email" "citext" NOT NULL,
	"first_name" text,
	"last_name" text,
	"preferred_name" text,
	"avatar_url" text,
	"student_email" "citext",
	"student_email_domain" "citext" GENERATED ALWAYS AS (
CASE
    WHEN (student_email IS NULL) THEN NULL::citext
    ELSE (split_part((student_email)::text, '@'::text, 2))::citext
END) STORED,
	"student_email_verified" boolean DEFAULT false NOT NULL,
	"student_email_verified_at" timestamp with time zone,
	"verification_method" "verification_method_t",
	"school" text,
	"major" text,
	"minor" text,
	"class_standing" "class_standing_t",
	"grad_year" integer,
	"grad_term" text,
	"interested_roles" "interested_role_t"[] DEFAULT '{""}' NOT NULL,
	"linkedin_url" text,
	"github_url" text,
	"portfolio_url" text,
	"phone_number" text,
	"is_admin" boolean DEFAULT false NOT NULL,
	"profile_completed" boolean DEFAULT false NOT NULL,
	"open_to_recruiters" boolean DEFAULT false NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profiles_grad_year_check" CHECK ((grad_year IS NULL) OR ((grad_year >= 2000) AND (grad_year <= 2100))),
	CONSTRAINT "profiles_grad_term_check" CHECK ((grad_term IS NULL) OR (grad_term ~ '^(Spring|Summer|Fall|Winter) [0-9]{4}$'::text)),
	CONSTRAINT "profiles_linkedin_url_check" CHECK ((linkedin_url IS NULL) OR (linkedin_url ~* '^https?://([a-z0-9-]+\.)*linkedin\.com/'::text)),
	CONSTRAINT "profiles_github_url_check" CHECK ((github_url IS NULL) OR (github_url ~* '^https?://([a-z0-9-]+\.)*github\.com/'::text)),
	CONSTRAINT "profiles_portfolio_url_check" CHECK ((portfolio_url IS NULL) OR (portfolio_url ~* '^https?://'::text)),
	CONSTRAINT "profiles_phone_number_check" CHECK ((phone_number IS NULL) OR (phone_number ~ '^\+?[0-9\-\(\) ]{7,20}$'::text)),
	CONSTRAINT "profiles_interested_roles_max_six" CHECK (cardinality(interested_roles) <= 6)
);
--> statement-breakpoint
ALTER TABLE "profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "consent_versions" (
	"consent_type" "consent_type_t" PRIMARY KEY NOT NULL,
	"version" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consent_versions_version_check" CHECK (version ~ '^v[0-9]+(\.[0-9]+)?$'::text)
);
--> statement-breakpoint
ALTER TABLE "consent_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "email_verification_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"email" "citext" NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evc_email_has_at" CHECK (POSITION(('@'::text) IN ((email)::text)) > 0),
	CONSTRAINT "evc_attempts_range" CHECK ((attempts >= 0) AND (attempts <= (max_attempts + 1)))
);
--> statement-breakpoint
ALTER TABLE "email_verification_codes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "resumes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"storage_path" text NOT NULL,
	"file_name" text NOT NULL,
	"file_size" bigint NOT NULL,
	"mime_type" text NOT NULL,
	"status" "resume_status_t" DEFAULT 'pending' NOT NULL,
	"is_current" boolean DEFAULT false NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "resumes_storage_path_unique" UNIQUE("storage_path"),
	CONSTRAINT "resumes_file_name_check" CHECK ((length(file_name) >= 1) AND (length(file_name) <= 255)),
	CONSTRAINT "resumes_file_size_check" CHECK ((file_size > 0) AND (file_size <= ((10 * 1024) * 1024))),
	CONSTRAINT "resumes_mime_type_check" CHECK (mime_type = 'application/pdf'::text),
	CONSTRAINT "resumes_current_requires_active" CHECK ((NOT is_current) OR (status = 'active'::resume_status_t)),
	CONSTRAINT "resumes_deleted_not_current" CHECK ((deleted_at IS NULL) OR (NOT is_current))
);
--> statement-breakpoint
ALTER TABLE "resumes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"consent_type" "consent_type_t" NOT NULL,
	"accepted" boolean NOT NULL,
	"version" text NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" "inet",
	"user_agent" text,
	CONSTRAINT "consents_version_check" CHECK (version ~ '^v[0-9]+(\.[0-9]+)?$'::text)
);
--> statement-breakpoint
ALTER TABLE "consents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid,
	"target_user_id" uuid,
	"action" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "account_deletion_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"reason" text,
	"status" "deletion_request_status_t" DEFAULT 'pending' NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"processed_by" uuid,
	CONSTRAINT "account_deletion_requests_reason_check" CHECK ((reason IS NULL) OR (length(reason) <= 2000))
);
--> statement-breakpoint
ALTER TABLE "account_deletion_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_verification_codes" ADD CONSTRAINT "email_verification_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resumes" ADD CONSTRAINT "resumes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_target_user_id_fkey" FOREIGN KEY ("target_user_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_deletion_requests" ADD CONSTRAINT "account_deletion_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_deletion_requests" ADD CONSTRAINT "account_deletion_requests_processed_by_fkey" FOREIGN KEY ("processed_by") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "school_domains_active_idx" ON "school_domains" USING btree ("is_active" bool_ops) WHERE is_active;--> statement-breakpoint
CREATE INDEX "profiles_archived_idx" ON "profiles" USING btree ("is_archived" timestamptz_ops,"archived_at" bool_ops);--> statement-breakpoint
CREATE INDEX "profiles_class_standing_idx" ON "profiles" USING btree ("class_standing" enum_ops);--> statement-breakpoint
CREATE INDEX "profiles_first_name_trgm" ON "profiles" USING gin ("first_name" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "profiles_google_email_idx" ON "profiles" USING btree ("google_email" citext_ops);--> statement-breakpoint
CREATE INDEX "profiles_grad_year_idx" ON "profiles" USING btree ("grad_year" int4_ops);--> statement-breakpoint
CREATE INDEX "profiles_interested_roles_gin" ON "profiles" USING gin ("interested_roles" array_ops);--> statement-breakpoint
CREATE INDEX "profiles_is_admin_idx" ON "profiles" USING btree ("is_admin" bool_ops) WHERE is_admin;--> statement-breakpoint
CREATE INDEX "profiles_last_name_trgm" ON "profiles" USING gin ("last_name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "profiles_recruiter_export_idx" ON "profiles" USING btree ("student_email_verified" bool_ops,"open_to_recruiters" bool_ops) WHERE (student_email_verified AND open_to_recruiters AND (NOT is_archived));--> statement-breakpoint
CREATE INDEX "profiles_student_domain_idx" ON "profiles" USING btree ("student_email_domain" citext_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "profiles_student_email_idx" ON "profiles" USING btree ("student_email" citext_ops) WHERE (student_email IS NOT NULL);--> statement-breakpoint
CREATE INDEX "profiles_student_email_trgm" ON "profiles" USING gin (((student_email)::text) gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "email_verification_codes_expires_idx" ON "email_verification_codes" USING btree ("expires_at" timestamptz_ops) WHERE (consumed_at IS NULL);--> statement-breakpoint
CREATE INDEX "email_verification_codes_user_email_idx" ON "email_verification_codes" USING btree ("user_id" uuid_ops,"email" uuid_ops) WHERE (consumed_at IS NULL);--> statement-breakpoint
CREATE UNIQUE INDEX "resumes_one_current_per_user" ON "resumes" USING btree ("user_id" uuid_ops) WHERE is_current;--> statement-breakpoint
CREATE INDEX "resumes_user_status_idx" ON "resumes" USING btree ("user_id" uuid_ops,"status" enum_ops);--> statement-breakpoint
CREATE INDEX "resumes_user_uploaded_idx" ON "resumes" USING btree ("user_id" uuid_ops,"uploaded_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "consents_type_accepted_idx" ON "consents" USING btree ("consent_type" bool_ops,"accepted" enum_ops) WHERE accepted;--> statement-breakpoint
CREATE INDEX "consents_user_type_version_idx" ON "consents" USING btree ("user_id" uuid_ops,"consent_type" uuid_ops,"accepted_at" enum_ops,"id" uuid_ops);--> statement-breakpoint
CREATE INDEX "audit_log_action_idx" ON "audit_log" USING btree ("action" text_ops,"created_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "audit_log_actor_idx" ON "audit_log" USING btree ("actor_user_id" timestamptz_ops,"created_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "audit_log_metadata_gin" ON "audit_log" USING gin ("metadata" jsonb_ops);--> statement-breakpoint
CREATE INDEX "audit_log_target_idx" ON "audit_log" USING btree ("target_user_id" uuid_ops,"created_at" uuid_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "account_deletion_requests_one_pending_per_user" ON "account_deletion_requests" USING btree ("user_id" uuid_ops) WHERE (status = ANY (ARRAY['pending'::deletion_request_status_t, 'processing'::deletion_request_status_t]));--> statement-breakpoint
CREATE INDEX "account_deletion_requests_status_idx" ON "account_deletion_requests" USING btree ("status" timestamptz_ops,"requested_at" timestamptz_ops);--> statement-breakpoint
CREATE POLICY "school_domains_select_auth" ON "school_domains" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "school_domains_write_admin" ON "school_domains" AS PERMISSIVE FOR ALL TO "authenticated";--> statement-breakpoint
CREATE POLICY "profiles_select_own" ON "profiles" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((auth.uid() = id));--> statement-breakpoint
CREATE POLICY "profiles_update_own" ON "profiles" AS PERMISSIVE FOR UPDATE TO "authenticated";--> statement-breakpoint
CREATE POLICY "profiles_select_admin" ON "profiles" AS PERMISSIVE FOR SELECT TO "authenticated";--> statement-breakpoint
CREATE POLICY "profiles_update_admin" ON "profiles" AS PERMISSIVE FOR UPDATE TO "authenticated";--> statement-breakpoint
CREATE POLICY "consent_versions_select_auth" ON "consent_versions" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "consent_versions_write_admin" ON "consent_versions" AS PERMISSIVE FOR ALL TO "authenticated";--> statement-breakpoint
CREATE POLICY "evc_no_select" ON "email_verification_codes" AS PERMISSIVE FOR SELECT TO "authenticated" USING (false);--> statement-breakpoint
CREATE POLICY "evc_no_insert" ON "email_verification_codes" AS PERMISSIVE FOR INSERT TO "authenticated";--> statement-breakpoint
CREATE POLICY "evc_no_update" ON "email_verification_codes" AS PERMISSIVE FOR UPDATE TO "authenticated";--> statement-breakpoint
CREATE POLICY "evc_no_delete" ON "email_verification_codes" AS PERMISSIVE FOR DELETE TO "authenticated";--> statement-breakpoint
CREATE POLICY "resumes_select_own" ON "resumes" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((auth.uid() = user_id));--> statement-breakpoint
CREATE POLICY "resumes_insert_own" ON "resumes" AS PERMISSIVE FOR INSERT TO "authenticated";--> statement-breakpoint
CREATE POLICY "resumes_select_admin" ON "resumes" AS PERMISSIVE FOR SELECT TO "authenticated";--> statement-breakpoint
CREATE POLICY "resumes_no_update_client" ON "resumes" AS PERMISSIVE FOR UPDATE TO "authenticated";--> statement-breakpoint
CREATE POLICY "resumes_delete_own_noncurrent" ON "resumes" AS PERMISSIVE FOR DELETE TO "authenticated";--> statement-breakpoint
CREATE POLICY "consents_select_own" ON "consents" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((auth.uid() = user_id));--> statement-breakpoint
CREATE POLICY "consents_insert_own" ON "consents" AS PERMISSIVE FOR INSERT TO "authenticated";--> statement-breakpoint
CREATE POLICY "consents_select_admin" ON "consents" AS PERMISSIVE FOR SELECT TO "authenticated";--> statement-breakpoint
CREATE POLICY "consents_no_update" ON "consents" AS PERMISSIVE FOR UPDATE TO "authenticated";--> statement-breakpoint
CREATE POLICY "consents_no_delete" ON "consents" AS PERMISSIVE FOR DELETE TO "authenticated";--> statement-breakpoint
CREATE POLICY "audit_log_select_admin" ON "audit_log" AS PERMISSIVE FOR SELECT TO "authenticated" USING (is_admin(auth.uid()));--> statement-breakpoint
CREATE POLICY "audit_log_no_client_write" ON "audit_log" AS PERMISSIVE FOR ALL TO "authenticated";--> statement-breakpoint
CREATE POLICY "account_deletion_select_own" ON "account_deletion_requests" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((auth.uid() = user_id));--> statement-breakpoint
CREATE POLICY "account_deletion_insert_own" ON "account_deletion_requests" AS PERMISSIVE FOR INSERT TO "authenticated";--> statement-breakpoint
CREATE POLICY "account_deletion_select_admin" ON "account_deletion_requests" AS PERMISSIVE FOR SELECT TO "authenticated";--> statement-breakpoint
CREATE POLICY "account_deletion_update_admin" ON "account_deletion_requests" AS PERMISSIVE FOR UPDATE TO "authenticated";--> statement-breakpoint
CREATE POLICY "account_deletion_no_client_delete" ON "account_deletion_requests" AS PERMISSIVE FOR DELETE TO "authenticated";
*/