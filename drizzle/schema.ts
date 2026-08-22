import { pgTable, index, unique, pgPolicy, check, text, boolean, timestamp, foreignKey, uuid, integer, uniqueIndex, bigint, inet, jsonb, bigserial, primaryKey, pgView, pgEnum } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

export const attendanceMethodT = pgEnum("attendance_method_t", ['admin_click', 'self_code', 'qr_token'])
export const classStandingT = pgEnum("class_standing_t", ['freshman', 'sophomore', 'junior', 'senior', 'graduate', 'phd', 'alumni'])
export const consentTypeT = pgEnum("consent_type_t", ['privacy_policy', 'terms_of_service', 'recruiter_resume_sharing', 'email_marketing', 'sms_marketing', 'age_confirmation'])
export const deletionRequestStatusT = pgEnum("deletion_request_status_t", ['pending', 'processing', 'completed', 'cancelled'])
export const eventNotificationKindT = pgEnum("event_notification_kind_t", ['confirmation', 'reminder', 'cancellation'])
export const eventNotificationStatusT = pgEnum("event_notification_status_t", ['pending', 'in_flight', 'sent', 'failed', 'skipped'])
export const eventStatusT = pgEnum("event_status_t", ['draft', 'published', 'cancelled', 'archived'])
export const eventVisibilityT = pgEnum("event_visibility_t", ['members', 'private_invite'])
export const interestedRoleT = pgEnum("interested_role_t", ['software_engineering', 'data_science', 'data_engineering', 'machine_learning', 'product_management', 'ui_ux_design', 'devops_sre', 'cybersecurity', 'research', 'consulting', 'quant_finance', 'other'])
export const resumeStatusT = pgEnum("resume_status_t", ['pending', 'active', 'deleted'])
export const rsvpStatusT = pgEnum("rsvp_status_t", ['going', 'waitlisted', 'declined', 'cancelled'])
export const verificationMethodT = pgEnum("verification_method_t", ['email_otp', 'admin_manual'])


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
	check("evc_attempts_range", sql`(attempts >= 0) AND (attempts <= (max_attempts + 1))`),
	check("evc_email_has_at", sql`POSITION(('@'::text) IN ((email)::text)) > 0`),
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
	check("resumes_current_requires_active", sql`(NOT is_current) OR (status = 'active'::resume_status_t)`),
	check("resumes_deleted_not_current", sql`(deleted_at IS NULL) OR (NOT is_current)`),
	check("resumes_file_name_check", sql`(length(file_name) >= 1) AND (length(file_name) <= 255)`),
	check("resumes_file_size_check", sql`(file_size > 0) AND (file_size <= ((10 * 1024) * 1024))`),
	check("resumes_mime_type_check", sql`mime_type = 'application/pdf'::text`),
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
			columns: [table.processedBy],
			foreignColumns: [profiles.id],
			name: "account_deletion_requests_processed_by_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [profiles.id],
			name: "account_deletion_requests_user_id_fkey"
		}).onDelete("cascade"),
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

export const eventNotificationJobs = pgTable("event_notification_jobs", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	eventId: uuid("event_id").notNull(),
	kind: eventNotificationKindT().notNull(),
	userId: uuid("user_id"),
	scheduledFor: timestamp("scheduled_for", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	status: eventNotificationStatusT().default('pending').notNull(),
	attempts: integer().default(0).notNull(),
	lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true, mode: 'string' }),
	sentAt: timestamp("sent_at", { withTimezone: true, mode: 'string' }),
	errorText: text("error_text"),
	dedupeKey: text("dedupe_key"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	uniqueIndex("event_notification_jobs_dedupe_idx").using("btree", table.eventId.asc().nullsLast().op("text_ops"), table.kind.asc().nullsLast().op("enum_ops"), table.userId.asc().nullsLast().op("uuid_ops"), table.dedupeKey.asc().nullsLast().op("enum_ops")).where(sql`(dedupe_key IS NOT NULL)`),
	index("event_notification_jobs_due_idx").using("btree", table.scheduledFor.asc().nullsLast().op("timestamptz_ops")).where(sql`(status = 'pending'::event_notification_status_t)`),
	index("event_notification_jobs_event_idx").using("btree", table.eventId.asc().nullsLast().op("uuid_ops"), table.kind.asc().nullsLast().op("uuid_ops"), table.status.asc().nullsLast().op("enum_ops")),
	foreignKey({
			columns: [table.eventId],
			foreignColumns: [events.id],
			name: "event_notification_jobs_event_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [profiles.id],
			name: "event_notification_jobs_user_id_fkey"
		}).onDelete("cascade"),
	pgPolicy("event_notification_jobs_select_admin", { as: "permissive", for: "select", to: ["authenticated"], using: sql`is_admin(auth.uid())` }),
	pgPolicy("event_notification_jobs_no_client_write", { as: "permissive", for: "all", to: ["authenticated"] }),
	check("event_notification_jobs_attempts_check", sql`(attempts >= 0) AND (attempts <= 10)`),
	check("event_notification_jobs_error_text_check", sql`(error_text IS NULL) OR (length(error_text) <= 2000)`),
	check("event_notification_jobs_sent_shape", sql`((status = ANY (ARRAY['sent'::event_notification_status_t, 'skipped'::event_notification_status_t])) AND (sent_at IS NOT NULL)) OR (status <> ALL (ARRAY['sent'::event_notification_status_t, 'skipped'::event_notification_status_t]))`),
]);

export const profileVisibilitySettings = pgTable("profile_visibility_settings", {
	userId: uuid("user_id").primaryKey().notNull(),
	discoverable: boolean().default(true).notNull(),
	shareAttendedEvents: boolean("share_attended_events").default(false).notNull(),
	shareSharedEventCounts: boolean("share_shared_event_counts").default(false).notNull(),
	profileSlug: text("profile_slug"),
	lastDiscoverabilityChangeAt: timestamp("last_discoverability_change_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("profile_visibility_settings_discoverable_idx").using("btree", table.lastDiscoverabilityChangeAt.desc().nullsFirst().op("timestamptz_ops"), table.userId.asc().nullsLast().op("timestamptz_ops")).where(sql`(discoverable = true)`),
	uniqueIndex("profile_visibility_settings_slug_discoverable_idx").using("btree", table.profileSlug.asc().nullsLast().op("text_ops")).where(sql`((discoverable = true) AND (profile_slug IS NOT NULL))`),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [profiles.id],
			name: "profile_visibility_settings_user_id_fkey"
		}).onDelete("cascade"),
	pgPolicy("pvs_select_own", { as: "permissive", for: "select", to: ["authenticated"], using: sql`(auth.uid() = user_id)` }),
	pgPolicy("pvs_select_admin", { as: "permissive", for: "select", to: ["authenticated"] }),
	pgPolicy("pvs_no_client_insert", { as: "permissive", for: "insert", to: ["authenticated"] }),
	pgPolicy("pvs_no_client_update", { as: "permissive", for: "update", to: ["authenticated"] }),
	pgPolicy("pvs_no_client_delete", { as: "permissive", for: "delete", to: ["authenticated"] }),
	check("profile_visibility_settings_profile_slug_check", sql`(profile_slug IS NULL) OR (profile_slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'::text)`),
	check("pvs_share_counts_requires_discoverable", sql`(share_shared_event_counts = false) OR (discoverable = true)`),
]);

export const majors = pgTable("majors", {
	slug: text().primaryKey().notNull(),
	label: text().notNull(),
	sortOrder: integer("sort_order").default(0).notNull(),
	isActive: boolean("is_active").default(true).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	pgPolicy("majors_select_active", { as: "permissive", for: "select", to: ["authenticated"], using: sql`(is_active = true)` }),
	pgPolicy("majors_admin_write", { as: "permissive", for: "all", to: ["authenticated"] }),
	check("majors_label_check", sql`(length(label) >= 1) AND (length(label) <= 100)`),
	check("majors_slug_check", sql`slug ~ '^[a-z0-9_]+$'::text`),
]);

export const legacyMembers = pgTable("legacy_members", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	fullName: text("full_name"),
	firstName: text("first_name"),
	lastName: text("last_name"),
	personalEmail: text("personal_email"),
	campusEmail: text("campus_email"),
	phoneNumber: text("phone_number"),
	smsInterest: boolean("sms_interest"),
	source: text().notNull(),
	sourceDetail: text("source_detail"),
	importedAt: timestamp("imported_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	claimedAt: timestamp("claimed_at", { withTimezone: true, mode: 'string' }),
	claimedProfileId: uuid("claimed_profile_id"),
}, (table) => [
	uniqueIndex("legacy_members_campus_email_idx").using("btree", table.campusEmail.asc().nullsLast().op("citext_ops")).where(sql`(campus_email IS NOT NULL)`),
	uniqueIndex("legacy_members_personal_email_idx").using("btree", table.personalEmail.asc().nullsLast().op("citext_ops")).where(sql`(personal_email IS NOT NULL)`),
	index("legacy_members_unclaimed_idx").using("btree", table.claimedAt.asc().nullsLast().op("timestamptz_ops")).where(sql`(claimed_at IS NULL)`),
	foreignKey({
			columns: [table.claimedProfileId],
			foreignColumns: [profiles.id],
			name: "legacy_members_claimed_profile_id_fkey"
		}),
	pgPolicy("legacy_members_admin_all", { as: "permissive", for: "all", to: ["public"], using: sql`is_admin(auth.uid())`, withCheck: sql`is_admin(auth.uid())`  }),
	pgPolicy("legacy_members_select_own_claimed", { as: "permissive", for: "select", to: ["authenticated"] }),
	check("legacy_members_has_email", sql`(personal_email IS NOT NULL) OR (campus_email IS NOT NULL)`),
]);

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
	majorOtherText: text("major_other_text"),
	discordUsername: text("discord_username"),
	discordUserId: text("discord_user_id"),
	bio: text(),
	note: text(),
	bannerUrl: text("banner_url"),
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
	check("profiles_bio_check", sql`(bio IS NULL) OR ((length(bio) <= 220) AND (bio !~ '[\r\n]'::text))`),
	check("profiles_discord_username_check", sql`(discord_username IS NULL) OR (discord_username ~ '^[a-z0-9._]{2,32}$'::text)`),
	check("profiles_github_url_check", sql`(github_url IS NULL) OR (github_url ~* '^https?://([a-z0-9-]+\.)*github\.com/'::text)`),
	check("profiles_grad_term_check", sql`(grad_term IS NULL) OR (grad_term ~ '^(Spring|Summer|Fall|Winter) [0-9]{4}$'::text)`),
	check("profiles_grad_year_check", sql`(grad_year IS NULL) OR ((grad_year >= 2000) AND (grad_year <= 2100))`),
	check("profiles_interested_roles_max_six", sql`cardinality(interested_roles) <= 6`),
	check("profiles_linkedin_url_check", sql`(linkedin_url IS NULL) OR (linkedin_url ~* '^https?://([a-z0-9-]+\.)*linkedin\.com/'::text)`),
	check("profiles_major_other_text_check", sql`(major_other_text IS NULL) OR ((length(btrim(major_other_text)) >= 1) AND (length(btrim(major_other_text)) <= 100))`),
	check("profiles_note_check", sql`(note IS NULL) OR ((length(note) <= 80) AND (note !~ '[\r\n]'::text))`),
	check("profiles_phone_number_check", sql`(phone_number IS NULL) OR (phone_number ~ '^\+?[0-9\-\(\) ]{7,20}$'::text)`),
	check("profiles_portfolio_url_check", sql`(portfolio_url IS NULL) OR (portfolio_url ~* '^https?://'::text)`),
]);

export const events = pgTable("events", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	slug: text().notNull(),
	title: text().notNull(),
	descriptionMd: text("description_md"),
	status: eventStatusT().default('draft').notNull(),
	visibility: eventVisibilityT().default('members').notNull(),
	startsAt: timestamp("starts_at", { withTimezone: true, mode: 'string' }).notNull(),
	endsAt: timestamp("ends_at", { withTimezone: true, mode: 'string' }).notNull(),
	locationText: text("location_text"),
	locationUrl: text("location_url"),
	capacity: integer(),
	waitlistEnabled: boolean("waitlist_enabled").default(false).notNull(),
	coverImagePath: text("cover_image_path"),
	sendRsvpEmail: boolean("send_rsvp_email").default(true).notNull(),
	sendReminderEmail: boolean("send_reminder_email").default(true).notNull(),
	reminderSentAt: timestamp("reminder_sent_at", { withTimezone: true, mode: 'string' }),
	cancellationReason: text("cancellation_reason"),
	cancelledAt: timestamp("cancelled_at", { withTimezone: true, mode: 'string' }),
	isSensitive: boolean("is_sensitive").default(false).notNull(),
	publishedAt: timestamp("published_at", { withTimezone: true, mode: 'string' }),
	archivedAt: timestamp("archived_at", { withTimezone: true, mode: 'string' }),
	createdBy: uuid("created_by"),
	updatedBy: uuid("updated_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	importSource: text("import_source"),
}, (table) => [
	index("events_discovery_idx").using("btree", table.startsAt.asc().nullsLast().op("timestamptz_ops")).where(sql`(status = 'published'::event_status_t)`),
	index("events_ends_at_idx").using("btree", table.endsAt.asc().nullsLast().op("timestamptz_ops")).where(sql`(status = ANY (ARRAY['published'::event_status_t, 'cancelled'::event_status_t, 'archived'::event_status_t]))`),
	index("events_not_sensitive_idx").using("btree", table.id.asc().nullsLast().op("uuid_ops")).where(sql`(is_sensitive = false)`),
	index("events_reminder_due_idx").using("btree", table.startsAt.asc().nullsLast().op("timestamptz_ops")).where(sql`((status = 'published'::event_status_t) AND (send_reminder_email = true) AND (reminder_sent_at IS NULL))`),
	index("events_status_starts_at_idx").using("btree", table.status.asc().nullsLast().op("enum_ops"), table.startsAt.desc().nullsFirst().op("timestamptz_ops")),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [profiles.id],
			name: "events_created_by_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.updatedBy],
			foreignColumns: [profiles.id],
			name: "events_updated_by_fkey"
		}).onDelete("set null"),
	unique("events_slug_unique").on(table.slug),
	pgPolicy("events_select_admin", { as: "permissive", for: "select", to: ["authenticated"], using: sql`is_admin(auth.uid())` }),
	pgPolicy("events_select_member", { as: "permissive", for: "select", to: ["authenticated"] }),
	pgPolicy("events_admin_all", { as: "permissive", for: "all", to: ["authenticated"] }),
	check("events_cancellation_pair", sql`((status = ANY (ARRAY['draft'::event_status_t, 'published'::event_status_t])) AND (cancelled_at IS NULL)) OR ((status = 'cancelled'::event_status_t) AND (cancelled_at IS NOT NULL)) OR (status = 'archived'::event_status_t)`),
	check("events_cancellation_reason_check", sql`(cancellation_reason IS NULL) OR (length(cancellation_reason) <= 2000)`),
	check("events_capacity_check", sql`(capacity IS NULL) OR (capacity >= 0)`),
	check("events_cover_image_path_check", sql`(cover_image_path IS NULL) OR (length(cover_image_path) <= 500)`),
	check("events_description_md_check", sql`(description_md IS NULL) OR (length(description_md) <= 20000)`),
	check("events_import_source_check", sql`(import_source IS NULL) OR (import_source = 'legacy_luma_import'::text)`),
	check("events_location_text_check", sql`(location_text IS NULL) OR (length(location_text) <= 500)`),
	check("events_location_url_check", sql`(location_url IS NULL) OR (location_url ~* '^https?://'::text)`),
	check("events_slug_check", sql`slug ~ '^[a-z0-9](?:[a-z0-9\-]{0,62}[a-z0-9])?$'::text`),
	check("events_time_order", sql`starts_at < ends_at`),
	check("events_title_check", sql`(length(title) >= 1) AND (length(title) <= 200)`),
]);

export const eventGuestRsvps = pgTable("event_guest_rsvps", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	eventId: uuid("event_id").notNull(),
	name: text().notNull(),
	email: text("email").notNull(),
	phone: text().notNull(),
	status: rsvpStatusT().default('going').notNull(),
	waitlistedAt: timestamp("waitlisted_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	statusChangedAt: timestamp("status_changed_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	checkinToken: uuid("checkin_token"),
}, (table) => [
	uniqueIndex("event_guest_rsvps_checkin_token_idx").using("btree", table.checkinToken.asc().nullsLast().op("uuid_ops")).where(sql`(checkin_token IS NOT NULL)`),
	uniqueIndex("event_guest_rsvps_event_email_idx").using("btree", table.eventId.asc().nullsLast().op("uuid_ops"), table.email.asc().nullsLast().op("uuid_ops")),
	index("event_guest_rsvps_event_status_idx").using("btree", table.eventId.asc().nullsLast().op("uuid_ops"), table.status.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.eventId],
			foreignColumns: [events.id],
			name: "event_guest_rsvps_event_id_fkey"
		}).onDelete("cascade"),
	pgPolicy("event_guest_rsvps_no_client_access", { as: "permissive", for: "all", to: ["anon", "authenticated"], using: sql`false`, withCheck: sql`false`  }),
	check("event_guest_rsvps_status_check", sql`status = ANY (ARRAY['going'::rsvp_status_t, 'waitlisted'::rsvp_status_t, 'cancelled'::rsvp_status_t])`),
]);

export const historicalEventAttendances = pgTable("historical_event_attendances", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	eventId: uuid("event_id").notNull(),
	legacyMemberId: uuid("legacy_member_id").notNull(),
	registeredAt: timestamp("registered_at", { withTimezone: true, mode: 'string' }),
	approvalStatus: text("approval_status"),
	checkedInAt: timestamp("checked_in_at", { withTimezone: true, mode: 'string' }),
	ticketName: text("ticket_name"),
	sourceDetail: text("source_detail"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("historical_event_attendances_event_idx").using("btree", table.eventId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.eventId],
			foreignColumns: [events.id],
			name: "historical_event_attendances_event_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.legacyMemberId],
			foreignColumns: [legacyMembers.id],
			name: "historical_event_attendances_legacy_member_id_fkey"
		}).onDelete("cascade"),
	unique("historical_event_attendances_unique").on(table.eventId, table.legacyMemberId),
	pgPolicy("historical_event_attendances_admin_all", { as: "permissive", for: "all", to: ["public"], using: sql`is_admin(auth.uid())`, withCheck: sql`is_admin(auth.uid())`  }),
]);

export const eventHosts = pgTable("event_hosts", {
	eventId: uuid("event_id").notNull(),
	sortOrder: integer("sort_order").default(0).notNull(),
	displayName: text("display_name").notNull(),
	profileId: uuid("profile_id"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("event_hosts_profile_idx").using("btree", table.profileId.asc().nullsLast().op("uuid_ops")).where(sql`(profile_id IS NOT NULL)`),
	foreignKey({
			columns: [table.eventId],
			foreignColumns: [events.id],
			name: "event_hosts_event_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.profileId],
			foreignColumns: [profiles.id],
			name: "event_hosts_profile_id_fkey"
		}).onDelete("set null"),
	primaryKey({ columns: [table.eventId, table.sortOrder], name: "event_hosts_pk"}),
	pgPolicy("event_hosts_select_admin", { as: "permissive", for: "select", to: ["authenticated"], using: sql`is_admin(auth.uid())` }),
	pgPolicy("event_hosts_select_member", { as: "permissive", for: "select", to: ["authenticated"] }),
	pgPolicy("event_hosts_admin_all", { as: "permissive", for: "all", to: ["authenticated"] }),
	check("event_hosts_display_name_check", sql`(length(display_name) >= 1) AND (length(display_name) <= 200)`),
]);

export const eventInvites = pgTable("event_invites", {
	eventId: uuid("event_id").notNull(),
	userId: uuid("user_id").notNull(),
	invitedBy: uuid("invited_by"),
	invitedAt: timestamp("invited_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	revokedAt: timestamp("revoked_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	index("event_invites_user_idx").using("btree", table.userId.asc().nullsLast().op("uuid_ops")).where(sql`(revoked_at IS NULL)`),
	foreignKey({
			columns: [table.eventId],
			foreignColumns: [events.id],
			name: "event_invites_event_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.invitedBy],
			foreignColumns: [profiles.id],
			name: "event_invites_invited_by_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [profiles.id],
			name: "event_invites_user_id_fkey"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.eventId, table.userId], name: "event_invites_pk"}),
	pgPolicy("event_invites_select_admin", { as: "permissive", for: "select", to: ["authenticated"], using: sql`is_admin(auth.uid())` }),
	pgPolicy("event_invites_select_own", { as: "permissive", for: "select", to: ["authenticated"] }),
	pgPolicy("event_invites_admin_all", { as: "permissive", for: "all", to: ["authenticated"] }),
]);

export const eventGuestAttendances = pgTable("event_guest_attendances", {
	eventId: uuid("event_id").notNull(),
	guestRsvpId: uuid("guest_rsvp_id").notNull(),
	method: attendanceMethodT().notNull(),
	checkedInBy: uuid("checked_in_by").notNull(),
	checkedInAt: timestamp("checked_in_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	note: text(),
}, (table) => [
	// FK to auth.users.id lives in Postgres; auth schema is filtered out of introspection.
	foreignKey({
			columns: [table.eventId],
			foreignColumns: [events.id],
			name: "event_guest_attendances_event_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.guestRsvpId],
			foreignColumns: [eventGuestRsvps.id],
			name: "event_guest_attendances_guest_rsvp_id_fkey"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.eventId, table.guestRsvpId], name: "event_guest_attendances_pkey"}),
	pgPolicy("event_guest_attendances_no_client_access", { as: "permissive", for: "all", to: ["anon", "authenticated"], using: sql`false`, withCheck: sql`false`  }),
]);

export const eventAttendances = pgTable("event_attendances", {
	eventId: uuid("event_id").notNull(),
	userId: uuid("user_id").notNull(),
	checkedInAt: timestamp("checked_in_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	checkedInBy: uuid("checked_in_by"),
	method: attendanceMethodT().notNull(),
	note: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("event_attendances_event_idx").using("btree", table.eventId.asc().nullsLast().op("uuid_ops")),
	index("event_attendances_user_idx").using("btree", table.userId.asc().nullsLast().op("timestamptz_ops"), table.checkedInAt.desc().nullsFirst().op("timestamptz_ops")),
	foreignKey({
			columns: [table.checkedInBy],
			foreignColumns: [profiles.id],
			name: "event_attendances_checked_in_by_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.eventId],
			foreignColumns: [events.id],
			name: "event_attendances_event_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [profiles.id],
			name: "event_attendances_user_id_fkey"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.eventId, table.userId], name: "event_attendances_pk"}),
	pgPolicy("event_attendances_no_client_delete", { as: "permissive", for: "delete", to: ["authenticated"], using: sql`false` }),
	pgPolicy("event_attendances_select_own", { as: "permissive", for: "select", to: ["authenticated"] }),
	pgPolicy("event_attendances_select_admin", { as: "permissive", for: "select", to: ["authenticated"] }),
	pgPolicy("event_attendances_no_client_insert", { as: "permissive", for: "insert", to: ["authenticated"] }),
	pgPolicy("event_attendances_no_client_update", { as: "permissive", for: "update", to: ["authenticated"] }),
	check("event_attendances_note_check", sql`(note IS NULL) OR (length(note) <= 500)`),
]);

export const eventRsvps = pgTable("event_rsvps", {
	eventId: uuid("event_id").notNull(),
	userId: uuid("user_id").notNull(),
	status: rsvpStatusT().notNull(),
	comment: text(),
	rsvpAt: timestamp("rsvp_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	statusChangedAt: timestamp("status_changed_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	waitlistedAt: timestamp("waitlisted_at", { withTimezone: true, mode: 'string' }),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	checkinToken: uuid("checkin_token"),
}, (table) => [
	uniqueIndex("event_rsvps_checkin_token_idx").using("btree", table.checkinToken.asc().nullsLast().op("uuid_ops")).where(sql`(checkin_token IS NOT NULL)`),
	index("event_rsvps_event_status_idx").using("btree", table.eventId.asc().nullsLast().op("uuid_ops"), table.status.asc().nullsLast().op("enum_ops")),
	index("event_rsvps_event_waitlist_idx").using("btree", table.eventId.asc().nullsLast().op("timestamptz_ops"), table.waitlistedAt.asc().nullsLast().op("timestamptz_ops"), table.userId.asc().nullsLast().op("uuid_ops")).where(sql`(status = 'waitlisted'::rsvp_status_t)`),
	index("event_rsvps_user_idx").using("btree", table.userId.asc().nullsLast().op("uuid_ops"), table.statusChangedAt.desc().nullsFirst().op("timestamptz_ops")),
	foreignKey({
			columns: [table.eventId],
			foreignColumns: [events.id],
			name: "event_rsvps_event_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [profiles.id],
			name: "event_rsvps_user_id_fkey"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.eventId, table.userId], name: "event_rsvps_pk"}),
	pgPolicy("event_rsvps_select_own", { as: "permissive", for: "select", to: ["authenticated"], using: sql`(auth.uid() = user_id)` }),
	pgPolicy("event_rsvps_select_admin", { as: "permissive", for: "select", to: ["authenticated"] }),
	pgPolicy("event_rsvps_no_client_insert", { as: "permissive", for: "insert", to: ["authenticated"] }),
	pgPolicy("event_rsvps_no_client_update", { as: "permissive", for: "update", to: ["authenticated"] }),
	pgPolicy("event_rsvps_no_client_delete", { as: "permissive", for: "delete", to: ["authenticated"] }),
	check("event_rsvps_comment_check", sql`(comment IS NULL) OR (length(comment) <= 500)`),
	check("event_rsvps_waitlist_consistency", sql`((status = 'waitlisted'::rsvp_status_t) AND (waitlisted_at IS NOT NULL)) OR ((status <> 'waitlisted'::rsvp_status_t) AND (waitlisted_at IS NULL))`),
]);
export const memberVisibleEvents = pgView("member_visible_events", {	id: uuid(),
	slug: text(),
	title: text(),
	descriptionMd: text("description_md"),
	status: eventStatusT(),
	visibility: eventVisibilityT(),
	startsAt: timestamp("starts_at", { withTimezone: true, mode: 'string' }),
	endsAt: timestamp("ends_at", { withTimezone: true, mode: 'string' }),
	locationText: text("location_text"),
	locationUrl: text("location_url"),
	capacity: integer(),
	waitlistEnabled: boolean("waitlist_enabled"),
	coverImagePath: text("cover_image_path"),
	isSensitive: boolean("is_sensitive"),
	cancelledAt: timestamp("cancelled_at", { withTimezone: true, mode: 'string' }),
	cancellationReason: text("cancellation_reason"),
	hosts: jsonb(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	goingCount: bigint("going_count", { mode: "number" }),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	waitlistedCount: bigint("waitlisted_count", { mode: "number" }),
}).as(sql`SELECT id, slug, title, description_md, status, visibility, starts_at, ends_at, location_text, location_url, capacity, waitlist_enabled, cover_image_path, is_sensitive, cancelled_at, cancellation_reason, COALESCE(( SELECT jsonb_agg(jsonb_build_object('display_name', h.display_name, 'sort_order', h.sort_order) ORDER BY h.sort_order, h.display_name) AS jsonb_agg FROM event_hosts h WHERE h.event_id = e.id), '[]'::jsonb) AS hosts, ( SELECT count(*) AS count FROM event_rsvps r WHERE r.event_id = e.id AND r.status = 'going'::rsvp_status_t) AS going_count, ( SELECT count(*) AS count FROM event_rsvps r WHERE r.event_id = e.id AND r.status = 'waitlisted'::rsvp_status_t) AS waitlisted_count FROM events e WHERE status = 'published'::event_status_t AND (visibility = 'members'::event_visibility_t OR visibility = 'private_invite'::event_visibility_t AND (EXISTS ( SELECT 1 FROM event_invites ei WHERE ei.event_id = e.id AND ei.user_id = auth.uid() AND ei.revoked_at IS NULL)))`);

export const selfEventHistory = pgView("self_event_history", {	eventId: uuid("event_id"),
	slug: text(),
	title: text(),
	startsAt: timestamp("starts_at", { withTimezone: true, mode: 'string' }),
	endsAt: timestamp("ends_at", { withTimezone: true, mode: 'string' }),
	status: eventStatusT(),
	visibility: eventVisibilityT(),
	locationText: text("location_text"),
	rsvpStatus: rsvpStatusT("rsvp_status"),
	rsvpChangedAt: timestamp("rsvp_changed_at", { withTimezone: true, mode: 'string' }),
	waitlistedAt: timestamp("waitlisted_at", { withTimezone: true, mode: 'string' }),
	checkedInAt: timestamp("checked_in_at", { withTimezone: true, mode: 'string' }),
	attendanceMethod: attendanceMethodT("attendance_method"),
	attended: boolean(),
	coverImagePath: text("cover_image_path"),
}).as(sql`SELECT e.id AS event_id, e.slug, e.title, e.starts_at, e.ends_at, e.status, e.visibility, e.location_text, r.status AS rsvp_status, r.status_changed_at AS rsvp_changed_at, r.waitlisted_at, a.checked_in_at, a.method AS attendance_method, a.checked_in_at IS NOT NULL AS attended, e.cover_image_path FROM events e LEFT JOIN event_rsvps r ON r.event_id = e.id AND r.user_id = auth.uid() LEFT JOIN event_attendances a ON a.event_id = e.id AND a.user_id = auth.uid() WHERE r.user_id IS NOT NULL OR a.user_id IS NOT NULL`);

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
}).as(sql`WITH latest_consent AS ( SELECT c.user_id, c.consent_type, (array_agg(c.accepted ORDER BY c.accepted_at DESC, c.id DESC))[1] AS latest_accepted, (array_agg(c.version ORDER BY c.accepted_at DESC, c.id DESC))[1] AS latest_version FROM consents c WHERE c.consent_type = 'recruiter_resume_sharing'::consent_type_t GROUP BY c.user_id, c.consent_type ) SELECT p.id, p.first_name, p.last_name, p.preferred_name, p.google_email, p.student_email, p.phone_number, p.school, p.major, p.minor, p.class_standing, p.grad_year, p.grad_term, p.interested_roles, p.linkedin_url, p.github_url, p.portfolio_url, r.id AS current_resume_id, r.file_name AS resume_file_name, r.storage_path AS resume_storage_path, r.uploaded_at AS resume_uploaded_at FROM profiles p JOIN resumes r ON r.user_id = p.id AND r.is_current = true AND r.status = 'active'::resume_status_t JOIN latest_consent lc ON lc.user_id = p.id JOIN consent_versions cv ON cv.consent_type = 'recruiter_resume_sharing'::consent_type_t WHERE p.student_email_verified = true AND p.open_to_recruiters = true AND p.is_archived = false AND p.is_admin = false AND lc.latest_accepted = true AND lc.latest_version = cv.version AND p.grad_year IS NOT NULL AND p.class_standing IS NOT NULL AND p.grad_term IS NOT NULL AND cardinality(p.interested_roles) > 0`);

export const memberCards = pgView("member_cards", {	userId: uuid("user_id"),
	profileSlug: text("profile_slug"),
	displayName: text("display_name"),
	avatarUrl: text("avatar_url"),
	school: text(),
	classStanding: classStandingT("class_standing"),
	gradTerm: text("grad_term"),
	gradYear: integer("grad_year"),
	interestedRoles: interestedRoleT("interested_roles"),
	shareAttendedEvents: boolean("share_attended_events"),
	visibleSince: timestamp("visible_since", { withTimezone: true, mode: 'string' }),
	discordUsername: text("discord_username"),
	discordUserId: text("discord_user_id"),
	linkedinUrl: text("linkedin_url"),
	githubUrl: text("github_url"),
	portfolioUrl: text("portfolio_url"),
	bio: text(),
	note: text(),
	bannerUrl: text("banner_url"),
	major: text(),
	majorOtherText: text("major_other_text"),
	minor: text(),
	hasStudentEmail: boolean("has_student_email"),
	studentEmailVerified: boolean("student_email_verified"),
	pendingDomainName: text("pending_domain_name"),
}).with({"securityInvoker":true}).as(sql`SELECT p.id AS user_id, pvs.profile_slug, COALESCE(NULLIF(TRIM(BOTH FROM p.preferred_name), ''::text), p.first_name) AS display_name, p.avatar_url, p.school, p.class_standing, p.grad_term, p.grad_year, p.interested_roles, pvs.share_attended_events, pvs.last_discoverability_change_at AS visible_since, p.discord_username, p.discord_user_id, p.linkedin_url, p.github_url, p.portfolio_url, p.bio, p.note, p.banner_url, p.major, p.major_other_text, p.minor, p.student_email IS NOT NULL AS has_student_email, p.student_email_verified, p.pending_domain_name FROM profile_visibility_settings pvs JOIN profiles p ON p.id = pvs.user_id WHERE pvs.discoverable = true AND p.is_archived = false`);