import { pgTable, index, uniqueIndex, foreignKey, pgPolicy, check, uuid, text, boolean, timestamp, integer, unique, bigint, inet, jsonb, bigserial, pgView, pgEnum } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

export const classStandingT = pgEnum("class_standing_t", ['freshman', 'sophomore', 'junior', 'senior', 'graduate', 'phd', 'alumni'])
export const consentTypeT = pgEnum("consent_type_t", ['privacy_policy', 'terms_of_service', 'recruiter_resume_sharing', 'email_marketing', 'sms_marketing', 'age_confirmation'])
export const deletionRequestStatusT = pgEnum("deletion_request_status_t", ['pending', 'processing', 'completed', 'cancelled'])
export const interestedRoleT = pgEnum("interested_role_t", ['software_engineering', 'data_science', 'data_engineering', 'machine_learning', 'product_management', 'ui_ux_design', 'devops_sre', 'cybersecurity', 'research', 'consulting', 'quant_finance', 'other'])
export const resumeStatusT = pgEnum("resume_status_t", ['pending', 'active', 'deleted'])
export const verificationMethodT = pgEnum("verification_method_t", ['email_otp', 'admin_manual'])


export const profiles = pgTable("profiles", {
	id: uuid().primaryKey().notNull(),
	googleEmail: text("google_email").notNull(),
	firstName: text("first_name"),
	lastName: text("last_name"),
	preferredName: text("preferred_name"),
	avatarUrl: text("avatar_url"),
	studentEmail: text("student_email"),
	studentEmailDomain: text("student_email_domain").generatedAlwaysAs(sql`
CASE
    WHEN (student_email IS NULL) THEN NULL::citext
    ELSE (split_part((student_email)::text, '@'::text, 2))::citext
END`),
	studentEmailVerified: boolean("student_email_verified").default(false).notNull(),
	studentEmailVerifiedAt: timestamp("student_email_verified_at", { withTimezone: true, mode: 'string' }),
	verificationMethod: verificationMethodT("verification_method"),
	school: text(),
	major: text(),
	minor: text(),
	classStanding: classStandingT("class_standing"),
	gradYear: integer("grad_year"),
	gradTerm: text("grad_term"),
	interestedRoles: interestedRoleT("interested_roles").array().default([]).notNull(),
	linkedinUrl: text("linkedin_url"),
	githubUrl: text("github_url"),
	portfolioUrl: text("portfolio_url"),
	phoneNumber: text("phone_number"),
	isAdmin: boolean("is_admin").default(false).notNull(),
	profileCompleted: boolean("profile_completed").default(false).notNull(),
	openToRecruiters: boolean("open_to_recruiters").default(false).notNull(),
	isArchived: boolean("is_archived").default(false).notNull(),
	archivedAt: timestamp("archived_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	pendingDomainName: text("pending_domain_name"),
}, (table) => [
	index("profiles_archived_idx").using("btree", table.isArchived.asc().nullsLast().op("timestamptz_ops"), table.archivedAt.asc().nullsLast().op("bool_ops")),
	index("profiles_class_standing_idx").using("btree", table.classStanding.asc().nullsLast().op("enum_ops")),
	index("profiles_first_name_trgm").using("gin", table.firstName.asc().nullsLast().op("gin_trgm_ops")),
	uniqueIndex("profiles_google_email_idx").using("btree", table.googleEmail.asc().nullsLast().op("citext_ops")),
	index("profiles_grad_year_idx").using("btree", table.gradYear.asc().nullsLast().op("int4_ops")),
	index("profiles_interested_roles_gin").using("gin", table.interestedRoles.asc().nullsLast().op("array_ops")),
	index("profiles_is_admin_idx").using("btree", table.isAdmin.asc().nullsLast().op("bool_ops")).where(sql`is_admin`),
	index("profiles_last_name_trgm").using("gin", table.lastName.asc().nullsLast().op("gin_trgm_ops")),
	index("profiles_recruiter_export_idx").using("btree", table.studentEmailVerified.asc().nullsLast().op("bool_ops"), table.openToRecruiters.asc().nullsLast().op("bool_ops")).where(sql`(student_email_verified AND open_to_recruiters AND (NOT is_archived))`),
	index("profiles_student_domain_idx").using("btree", table.studentEmailDomain.asc().nullsLast().op("citext_ops")),
	index("profiles_student_email_trgm").using("gin", sql`((student_email)::text)`),
	uniqueIndex("profiles_student_email_verified_idx").using("btree", table.studentEmail.asc().nullsLast().op("citext_ops")).where(sql`((student_email IS NOT NULL) AND (student_email_verified = true))`),
	// FK to auth.users.id lives in Postgres; auth schema is filtered out of introspection.
	pgPolicy("profiles_select_own", { as: "permissive", for: "select", to: ["authenticated"], using: sql`(auth.uid() = id)` }),
	pgPolicy("profiles_update_own", { as: "permissive", for: "update", to: ["authenticated"] }),
	pgPolicy("profiles_select_admin", { as: "permissive", for: "select", to: ["authenticated"] }),
	pgPolicy("profiles_update_admin", { as: "permissive", for: "update", to: ["authenticated"] }),
	check("profiles_grad_year_check", sql`(grad_year IS NULL) OR ((grad_year >= 2000) AND (grad_year <= 2100))`),
	check("profiles_grad_term_check", sql`(grad_term IS NULL) OR (grad_term ~ '^(Spring|Summer|Fall|Winter) [0-9]{4}$'::text)`),
	check("profiles_linkedin_url_check", sql`(linkedin_url IS NULL) OR (linkedin_url ~* '^https?://([a-z0-9-]+\.)*linkedin\.com/'::text)`),
	check("profiles_github_url_check", sql`(github_url IS NULL) OR (github_url ~* '^https?://([a-z0-9-]+\.)*github\.com/'::text)`),
	check("profiles_portfolio_url_check", sql`(portfolio_url IS NULL) OR (portfolio_url ~* '^https?://'::text)`),
	check("profiles_phone_number_check", sql`(phone_number IS NULL) OR (phone_number ~ '^\+?[0-9\-\(\) ]{7,20}$'::text)`),
	check("profiles_interested_roles_max_six", sql`cardinality(interested_roles) <= 6`),
]);

export const schoolDomains = pgTable("school_domains", {
	domain: text("domain").primaryKey().notNull(),
	schoolName: text("school_name").notNull(),
	schoolSlug: text("school_slug").notNull(),
	isActive: boolean("is_active").default(true).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("school_domains_active_idx").using("btree", table.isActive.asc().nullsLast().op("bool_ops")).where(sql`is_active`),
	unique("school_domains_school_slug_key").on(table.schoolSlug),
	pgPolicy("school_domains_select_auth", { as: "permissive", for: "select", to: ["authenticated"], using: sql`true` }),
	pgPolicy("school_domains_write_admin", { as: "permissive", for: "all", to: ["authenticated"] }),
	check("school_domains_school_slug_check", sql`school_slug ~ '^[a-z0-9\-]+$'::text`),
]);

export const consentVersions = pgTable("consent_versions", {
	consentType: consentTypeT("consent_type").primaryKey().notNull(),
	version: text().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	pgPolicy("consent_versions_select_auth", { as: "permissive", for: "select", to: ["authenticated"], using: sql`true` }),
	pgPolicy("consent_versions_write_admin", { as: "permissive", for: "all", to: ["authenticated"] }),
	check("consent_versions_version_check", sql`version ~ '^v[0-9]+(\.[0-9]+)?$'::text`),
]);

export const emailVerificationCodes = pgTable("email_verification_codes", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	email: text("email").notNull(),
	codeHash: text("code_hash").notNull(),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'string' }).notNull(),
	attempts: integer().default(0).notNull(),
	maxAttempts: integer("max_attempts").default(5).notNull(),
	consumedAt: timestamp("consumed_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("email_verification_codes_expires_idx").using("btree", table.expiresAt.asc().nullsLast().op("timestamptz_ops")).where(sql`(consumed_at IS NULL)`),
	index("email_verification_codes_user_email_idx").using("btree", table.userId.asc().nullsLast().op("uuid_ops"), table.email.asc().nullsLast().op("uuid_ops")).where(sql`(consumed_at IS NULL)`),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [profiles.id],
			name: "email_verification_codes_user_id_fkey"
		}).onDelete("cascade"),
	pgPolicy("evc_no_select", { as: "permissive", for: "select", to: ["authenticated"], using: sql`false` }),
	pgPolicy("evc_no_insert", { as: "permissive", for: "insert", to: ["authenticated"] }),
	pgPolicy("evc_no_update", { as: "permissive", for: "update", to: ["authenticated"] }),
	pgPolicy("evc_no_delete", { as: "permissive", for: "delete", to: ["authenticated"] }),
	check("evc_email_has_at", sql`POSITION(('@'::text) IN ((email)::text)) > 0`),
	check("evc_attempts_range", sql`(attempts >= 0) AND (attempts <= (max_attempts + 1))`),
]);

export const resumes = pgTable("resumes", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	storagePath: text("storage_path").notNull(),
	fileName: text("file_name").notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	fileSize: bigint("file_size", { mode: "number" }).notNull(),
	mimeType: text("mime_type").notNull(),
	status: resumeStatusT().default('pending').notNull(),
	isCurrent: boolean("is_current").default(false).notNull(),
	uploadedAt: timestamp("uploaded_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	deletedAt: timestamp("deleted_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	uniqueIndex("resumes_one_current_per_user").using("btree", table.userId.asc().nullsLast().op("uuid_ops")).where(sql`is_current`),
	index("resumes_user_status_idx").using("btree", table.userId.asc().nullsLast().op("uuid_ops"), table.status.asc().nullsLast().op("enum_ops")),
	index("resumes_user_uploaded_idx").using("btree", table.userId.asc().nullsLast().op("uuid_ops"), table.uploadedAt.desc().nullsFirst().op("timestamptz_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [profiles.id],
			name: "resumes_user_id_fkey"
		}).onDelete("cascade"),
	unique("resumes_storage_path_unique").on(table.storagePath),
	pgPolicy("resumes_select_own", { as: "permissive", for: "select", to: ["authenticated"], using: sql`(auth.uid() = user_id)` }),
	pgPolicy("resumes_insert_own", { as: "permissive", for: "insert", to: ["authenticated"] }),
	pgPolicy("resumes_select_admin", { as: "permissive", for: "select", to: ["authenticated"] }),
	pgPolicy("resumes_no_update_client", { as: "permissive", for: "update", to: ["authenticated"] }),
	pgPolicy("resumes_delete_own_noncurrent", { as: "permissive", for: "delete", to: ["authenticated"] }),
	check("resumes_file_name_check", sql`(length(file_name) >= 1) AND (length(file_name) <= 255)`),
	check("resumes_file_size_check", sql`(file_size > 0) AND (file_size <= ((10 * 1024) * 1024))`),
	check("resumes_mime_type_check", sql`mime_type = 'application/pdf'::text`),
	check("resumes_current_requires_active", sql`(NOT is_current) OR (status = 'active'::resume_status_t)`),
	check("resumes_deleted_not_current", sql`(deleted_at IS NULL) OR (NOT is_current)`),
]);

export const consents = pgTable("consents", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	consentType: consentTypeT("consent_type").notNull(),
	accepted: boolean().notNull(),
	version: text().notNull(),
	acceptedAt: timestamp("accepted_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	ipAddress: inet("ip_address"),
	userAgent: text("user_agent"),
}, (table) => [
	index("consents_type_accepted_idx").using("btree", table.consentType.asc().nullsLast().op("bool_ops"), table.accepted.asc().nullsLast().op("enum_ops")).where(sql`accepted`),
	index("consents_user_type_version_idx").using("btree", table.userId.asc().nullsLast().op("uuid_ops"), table.consentType.asc().nullsLast().op("uuid_ops"), table.acceptedAt.desc().nullsFirst().op("enum_ops"), table.id.desc().nullsFirst().op("uuid_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [profiles.id],
			name: "consents_user_id_fkey"
		}).onDelete("cascade"),
	pgPolicy("consents_select_own", { as: "permissive", for: "select", to: ["authenticated"], using: sql`(auth.uid() = user_id)` }),
	pgPolicy("consents_insert_own", { as: "permissive", for: "insert", to: ["authenticated"] }),
	pgPolicy("consents_select_admin", { as: "permissive", for: "select", to: ["authenticated"] }),
	pgPolicy("consents_no_update", { as: "permissive", for: "update", to: ["authenticated"] }),
	pgPolicy("consents_no_delete", { as: "permissive", for: "delete", to: ["authenticated"] }),
	check("consents_version_check", sql`version ~ '^v[0-9]+(\.[0-9]+)?$'::text`),
]);

export const auditLog = pgTable("audit_log", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	actorUserId: uuid("actor_user_id"),
	targetUserId: uuid("target_user_id"),
	action: text().notNull(),
	metadata: jsonb().default({}).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("audit_log_action_idx").using("btree", table.action.asc().nullsLast().op("text_ops"), table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	index("audit_log_actor_idx").using("btree", table.actorUserId.asc().nullsLast().op("timestamptz_ops"), table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	index("audit_log_metadata_gin").using("gin", table.metadata.asc().nullsLast().op("jsonb_ops")),
	index("audit_log_target_idx").using("btree", table.targetUserId.asc().nullsLast().op("uuid_ops"), table.createdAt.desc().nullsFirst().op("uuid_ops")),
	foreignKey({
			columns: [table.actorUserId],
			foreignColumns: [profiles.id],
			name: "audit_log_actor_user_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.targetUserId],
			foreignColumns: [profiles.id],
			name: "audit_log_target_user_id_fkey"
		}).onDelete("set null"),
	pgPolicy("audit_log_select_admin", { as: "permissive", for: "select", to: ["authenticated"], using: sql`is_admin(auth.uid())` }),
	pgPolicy("audit_log_no_client_write", { as: "permissive", for: "all", to: ["authenticated"] }),
]);

export const accountDeletionRequests = pgTable("account_deletion_requests", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	reason: text(),
	status: deletionRequestStatusT().default('pending').notNull(),
	requestedAt: timestamp("requested_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	processedAt: timestamp("processed_at", { withTimezone: true, mode: 'string' }),
	processedBy: uuid("processed_by"),
}, (table) => [
	uniqueIndex("account_deletion_requests_one_pending_per_user").using("btree", table.userId.asc().nullsLast().op("uuid_ops")).where(sql`(status = ANY (ARRAY['pending'::deletion_request_status_t, 'processing'::deletion_request_status_t]))`),
	index("account_deletion_requests_status_idx").using("btree", table.status.asc().nullsLast().op("timestamptz_ops"), table.requestedAt.desc().nullsFirst().op("timestamptz_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [profiles.id],
			name: "account_deletion_requests_user_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.processedBy],
			foreignColumns: [profiles.id],
			name: "account_deletion_requests_processed_by_fkey"
		}).onDelete("set null"),
	pgPolicy("account_deletion_select_own", { as: "permissive", for: "select", to: ["authenticated"], using: sql`(auth.uid() = user_id)` }),
	pgPolicy("account_deletion_insert_own", { as: "permissive", for: "insert", to: ["authenticated"] }),
	pgPolicy("account_deletion_select_admin", { as: "permissive", for: "select", to: ["authenticated"] }),
	pgPolicy("account_deletion_update_admin", { as: "permissive", for: "update", to: ["authenticated"] }),
	pgPolicy("account_deletion_no_client_delete", { as: "permissive", for: "delete", to: ["authenticated"] }),
	check("account_deletion_requests_reason_check", sql`(reason IS NULL) OR (length(reason) <= 2000)`),
]);

export const rateLimitHits = pgTable("rate_limit_hits", {
	id: bigserial({ mode: "bigint" }).primaryKey().notNull(),
	bucket: text().notNull(),
	key: text().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("rate_limit_hits_bucket_key_idx").using("btree", table.bucket.asc().nullsLast().op("timestamptz_ops"), table.key.asc().nullsLast().op("text_ops"), table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	pgPolicy("rate_limit_hits_no_auth_select", { as: "permissive", for: "select", to: ["authenticated"], using: sql`false` }),
	pgPolicy("rate_limit_hits_no_auth_write", { as: "permissive", for: "all", to: ["authenticated"] }),
]);

export const domainRequests = pgTable("domain_requests", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	domain: text("domain").notNull(),
	userId: uuid("user_id").notNull(),
	exampleEmail: text("example_email"),
	requestedAt: timestamp("requested_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("domain_requests_domain_idx").using("btree", table.domain.asc().nullsLast().op("timestamptz_ops"), table.requestedAt.desc().nullsFirst().op("citext_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [profiles.id],
			name: "domain_requests_user_id_fkey"
		}).onDelete("cascade"),
	unique("domain_requests_unique_per_user").on(table.domain, table.userId),
	pgPolicy("domain_requests_select_own", { as: "permissive", for: "select", to: ["authenticated"], using: sql`(auth.uid() = user_id)` }),
	pgPolicy("domain_requests_select_admin", { as: "permissive", for: "select", to: ["authenticated"] }),
	pgPolicy("domain_requests_insert_own", { as: "permissive", for: "insert", to: ["authenticated"] }),
	pgPolicy("domain_requests_no_update", { as: "permissive", for: "update", to: ["authenticated"] }),
	pgPolicy("domain_requests_no_delete", { as: "permissive", for: "delete", to: ["authenticated"] }),
]);
export const recruiterEligibleMembers = pgView("recruiter_eligible_members", {	id: uuid(),
	firstName: text("first_name"),
	lastName: text("last_name"),
	preferredName: text("preferred_name"),
	googleEmail: text("google_email"),
	studentEmail: text("student_email"),
	phoneNumber: text("phone_number"),
	school: text(),
	major: text(),
	minor: text(),
	classStanding: classStandingT("class_standing"),
	gradYear: integer("grad_year"),
	gradTerm: text("grad_term"),
	interestedRoles: interestedRoleT("interested_roles"),
	linkedinUrl: text("linkedin_url"),
	githubUrl: text("github_url"),
	portfolioUrl: text("portfolio_url"),
	currentResumeId: uuid("current_resume_id"),
	resumeFileName: text("resume_file_name"),
	resumeStoragePath: text("resume_storage_path"),
	resumeUploadedAt: timestamp("resume_uploaded_at", { withTimezone: true, mode: 'string' }),
}).as(sql`WITH latest_consent AS ( SELECT c.user_id, c.consent_type, (array_agg(c.accepted ORDER BY c.accepted_at DESC, c.id DESC))[1] AS latest_accepted, (array_agg(c.version ORDER BY c.accepted_at DESC, c.id DESC))[1] AS latest_version FROM consents c WHERE c.consent_type = 'recruiter_resume_sharing'::consent_type_t GROUP BY c.user_id, c.consent_type ) SELECT p.id, p.first_name, p.last_name, p.preferred_name, p.google_email, p.student_email, p.phone_number, p.school, p.major, p.minor, p.class_standing, p.grad_year, p.grad_term, p.interested_roles, p.linkedin_url, p.github_url, p.portfolio_url, r.id AS current_resume_id, r.file_name AS resume_file_name, r.storage_path AS resume_storage_path, r.uploaded_at AS resume_uploaded_at FROM profiles p JOIN resumes r ON r.user_id = p.id AND r.is_current = true AND r.status = 'active'::resume_status_t JOIN latest_consent lc ON lc.user_id = p.id JOIN consent_versions cv ON cv.consent_type = 'recruiter_resume_sharing'::consent_type_t WHERE p.student_email_verified = true AND p.open_to_recruiters = true AND p.is_archived = false AND p.is_admin = false AND lc.latest_accepted = true AND lc.latest_version = cv.version`);