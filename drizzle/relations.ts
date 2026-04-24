import { relations } from "drizzle-orm/relations";
import { profiles, emailVerificationCodes, resumes, consents, auditLog, accountDeletionRequests, domainRequests, events, eventNotificationJobs, profileVisibilitySettings, eventHosts, eventInvites, eventAttendances, eventRsvps } from "./schema";

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
	accountDeletionRequests_processedBy: many(accountDeletionRequests, {
		relationName: "accountDeletionRequests_processedBy_profiles_id"
	}),
	accountDeletionRequests_userId: many(accountDeletionRequests, {
		relationName: "accountDeletionRequests_userId_profiles_id"
	}),
	domainRequests: many(domainRequests),
	events_createdBy: many(events, {
		relationName: "events_createdBy_profiles_id"
	}),
	events_updatedBy: many(events, {
		relationName: "events_updatedBy_profiles_id"
	}),
	eventNotificationJobs: many(eventNotificationJobs),
	profileVisibilitySettings: many(profileVisibilitySettings),
	eventHosts: many(eventHosts),
	eventInvites_invitedBy: many(eventInvites, {
		relationName: "eventInvites_invitedBy_profiles_id"
	}),
	eventInvites_userId: many(eventInvites, {
		relationName: "eventInvites_userId_profiles_id"
	}),
	eventAttendances_checkedInBy: many(eventAttendances, {
		relationName: "eventAttendances_checkedInBy_profiles_id"
	}),
	eventAttendances_userId: many(eventAttendances, {
		relationName: "eventAttendances_userId_profiles_id"
	}),
	eventRsvps: many(eventRsvps),
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
	profile_processedBy: one(profiles, {
		fields: [accountDeletionRequests.processedBy],
		references: [profiles.id],
		relationName: "accountDeletionRequests_processedBy_profiles_id"
	}),
	profile_userId: one(profiles, {
		fields: [accountDeletionRequests.userId],
		references: [profiles.id],
		relationName: "accountDeletionRequests_userId_profiles_id"
	}),
}));

export const domainRequestsRelations = relations(domainRequests, ({one}) => ({
	profile: one(profiles, {
		fields: [domainRequests.userId],
		references: [profiles.id]
	}),
}));

export const eventsRelations = relations(events, ({one, many}) => ({
	profile_createdBy: one(profiles, {
		fields: [events.createdBy],
		references: [profiles.id],
		relationName: "events_createdBy_profiles_id"
	}),
	profile_updatedBy: one(profiles, {
		fields: [events.updatedBy],
		references: [profiles.id],
		relationName: "events_updatedBy_profiles_id"
	}),
	eventNotificationJobs: many(eventNotificationJobs),
	eventHosts: many(eventHosts),
	eventInvites: many(eventInvites),
	eventAttendances: many(eventAttendances),
	eventRsvps: many(eventRsvps),
}));

export const eventNotificationJobsRelations = relations(eventNotificationJobs, ({one}) => ({
	event: one(events, {
		fields: [eventNotificationJobs.eventId],
		references: [events.id]
	}),
	profile: one(profiles, {
		fields: [eventNotificationJobs.userId],
		references: [profiles.id]
	}),
}));

export const profileVisibilitySettingsRelations = relations(profileVisibilitySettings, ({one}) => ({
	profile: one(profiles, {
		fields: [profileVisibilitySettings.userId],
		references: [profiles.id]
	}),
}));

export const eventHostsRelations = relations(eventHosts, ({one}) => ({
	event: one(events, {
		fields: [eventHosts.eventId],
		references: [events.id]
	}),
	profile: one(profiles, {
		fields: [eventHosts.profileId],
		references: [profiles.id]
	}),
}));

export const eventInvitesRelations = relations(eventInvites, ({one}) => ({
	event: one(events, {
		fields: [eventInvites.eventId],
		references: [events.id]
	}),
	profile_invitedBy: one(profiles, {
		fields: [eventInvites.invitedBy],
		references: [profiles.id],
		relationName: "eventInvites_invitedBy_profiles_id"
	}),
	profile_userId: one(profiles, {
		fields: [eventInvites.userId],
		references: [profiles.id],
		relationName: "eventInvites_userId_profiles_id"
	}),
}));

export const eventAttendancesRelations = relations(eventAttendances, ({one}) => ({
	profile_checkedInBy: one(profiles, {
		fields: [eventAttendances.checkedInBy],
		references: [profiles.id],
		relationName: "eventAttendances_checkedInBy_profiles_id"
	}),
	event: one(events, {
		fields: [eventAttendances.eventId],
		references: [events.id]
	}),
	profile_userId: one(profiles, {
		fields: [eventAttendances.userId],
		references: [profiles.id],
		relationName: "eventAttendances_userId_profiles_id"
	}),
}));

export const eventRsvpsRelations = relations(eventRsvps, ({one}) => ({
	event: one(events, {
		fields: [eventRsvps.eventId],
		references: [events.id]
	}),
	profile: one(profiles, {
		fields: [eventRsvps.userId],
		references: [profiles.id]
	}),
}));