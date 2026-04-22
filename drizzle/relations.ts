import { relations } from "drizzle-orm/relations";
import { profiles, emailVerificationCodes, resumes, consents, auditLog, accountDeletionRequests, domainRequests } from "./schema";

// auth.users relation intentionally omitted — auth schema is filtered out of
// introspection. profiles.id still FK's to auth.users in Postgres.

export const profilesRelations = relations(profiles, ({many}) => ({
	emailVerificationCodes: many(emailVerificationCodes),
	resumes: many(resumes),
	consents: many(consents),
	auditLogs_actorUserId: many(auditLog, {
		relationName: "auditLog_actorUserId_profiles_id"
	}),
	auditLogs_targetUserId: many(auditLog, {
		relationName: "auditLog_targetUserId_profiles_id"
	}),
	accountDeletionRequests_userId: many(accountDeletionRequests, {
		relationName: "accountDeletionRequests_userId_profiles_id"
	}),
	accountDeletionRequests_processedBy: many(accountDeletionRequests, {
		relationName: "accountDeletionRequests_processedBy_profiles_id"
	}),
	domainRequests: many(domainRequests),
}));

export const emailVerificationCodesRelations = relations(emailVerificationCodes, ({one}) => ({
	profile: one(profiles, {
		fields: [emailVerificationCodes.userId],
		references: [profiles.id]
	}),
}));

export const resumesRelations = relations(resumes, ({one}) => ({
	profile: one(profiles, {
		fields: [resumes.userId],
		references: [profiles.id]
	}),
}));

export const consentsRelations = relations(consents, ({one}) => ({
	profile: one(profiles, {
		fields: [consents.userId],
		references: [profiles.id]
	}),
}));

export const auditLogRelations = relations(auditLog, ({one}) => ({
	profile_actorUserId: one(profiles, {
		fields: [auditLog.actorUserId],
		references: [profiles.id],
		relationName: "auditLog_actorUserId_profiles_id"
	}),
	profile_targetUserId: one(profiles, {
		fields: [auditLog.targetUserId],
		references: [profiles.id],
		relationName: "auditLog_targetUserId_profiles_id"
	}),
}));

export const accountDeletionRequestsRelations = relations(accountDeletionRequests, ({one}) => ({
	profile_userId: one(profiles, {
		fields: [accountDeletionRequests.userId],
		references: [profiles.id],
		relationName: "accountDeletionRequests_userId_profiles_id"
	}),
	profile_processedBy: one(profiles, {
		fields: [accountDeletionRequests.processedBy],
		references: [profiles.id],
		relationName: "accountDeletionRequests_processedBy_profiles_id"
	}),
}));

export const domainRequestsRelations = relations(domainRequests, ({one}) => ({
	profile: one(profiles, {
		fields: [domainRequests.userId],
		references: [profiles.id]
	}),
}));