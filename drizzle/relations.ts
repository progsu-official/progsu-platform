import { relations } from "drizzle-orm/relations";
import { profiles, emailVerificationCodes, resumes, consents, auditLog, accountDeletionRequests, domainRequests, events, eventNotificationJobs, profileVisibilitySettings, historicalEventAttendances, legacyMembers, eventGuestRsvps, smsBroadcasts, smsDeliveries, pointRules, pointLedger, eventStaffAssignments, eventPassTokens, hacklantaEditions, hacklantaFloors, hacklantaRooms, hacklantaSessions, hacklantaLinks, hacklantaLinkCodes, announcements, appleProviderTokens, deviceTokens, pushOutbox, referralLinks, referralLinkHits, sessionBookmarks, announcementReads, eventHosts, eventInvites, eventGuestAttendances, eventAttendances, eventRsvps, eventAttendanceAffiliations } from "./schema";

// auth.users relation intentionally omitted — auth schema is filtered out of
// introspection. FKs to auth.users.id still live in Postgres.

export const emailVerificationCodesRelations = relations(emailVerificationCodes, ({one}) => ({
	profile: one(profiles, {
		fields: [emailVerificationCodes.userId],
		references: [profiles.id]
	}),
}));

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
	eventNotificationJobs: many(eventNotificationJobs),
	profileVisibilitySettings: many(profileVisibilitySettings),
	legacyMembers: many(legacyMembers),
	smsBroadcasts: many(smsBroadcasts),
	pointRules: many(pointRules),
	pointLedgers_actor: many(pointLedger, {
		relationName: "pointLedger_actor_profiles_id"
	}),
	pointLedgers_userId: many(pointLedger, {
		relationName: "pointLedger_userId_profiles_id"
	}),
	eventStaffAssignments_grantedBy: many(eventStaffAssignments, {
		relationName: "eventStaffAssignments_grantedBy_profiles_id"
	}),
	eventStaffAssignments_revokedBy: many(eventStaffAssignments, {
		relationName: "eventStaffAssignments_revokedBy_profiles_id"
	}),
	eventStaffAssignments_userId: many(eventStaffAssignments, {
		relationName: "eventStaffAssignments_userId_profiles_id"
	}),
	eventPassTokens: many(eventPassTokens),
	hacklantaLinks: many(hacklantaLinks),
	hacklantaLinkCodes: many(hacklantaLinkCodes),
	announcements: many(announcements),
	appleProviderTokens: many(appleProviderTokens),
	deviceTokens: many(deviceTokens),
	pushOutboxes: many(pushOutbox),
	events_createdBy: many(events, {
		relationName: "events_createdBy_profiles_id"
	}),
	events_updatedBy: many(events, {
		relationName: "events_updatedBy_profiles_id"
	}),
	referralLinks: many(referralLinks),
	sessionBookmarks: many(sessionBookmarks),
	announcementReads: many(announcementReads),
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
	eventAttendanceAffiliations: many(eventAttendanceAffiliations),
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

export const eventsRelations = relations(events, ({one, many}) => ({
	eventNotificationJobs: many(eventNotificationJobs),
	historicalEventAttendances: many(historicalEventAttendances),
	eventGuestRsvps: many(eventGuestRsvps),
	smsBroadcasts: many(smsBroadcasts),
	pointRules: many(pointRules),
	pointLedgers: many(pointLedger),
	eventStaffAssignments: many(eventStaffAssignments),
	eventPassTokens: many(eventPassTokens),
	hacklantaEditions: many(hacklantaEditions),
	announcements: many(announcements),
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
	referralLinks: many(referralLinks),
	eventHosts: many(eventHosts),
	eventInvites: many(eventInvites),
	eventGuestAttendances: many(eventGuestAttendances),
	eventAttendances: many(eventAttendances),
	eventRsvps: many(eventRsvps),
}));

export const profileVisibilitySettingsRelations = relations(profileVisibilitySettings, ({one}) => ({
	profile: one(profiles, {
		fields: [profileVisibilitySettings.userId],
		references: [profiles.id]
	}),
}));

export const historicalEventAttendancesRelations = relations(historicalEventAttendances, ({one}) => ({
	event: one(events, {
		fields: [historicalEventAttendances.eventId],
		references: [events.id]
	}),
	legacyMember: one(legacyMembers, {
		fields: [historicalEventAttendances.legacyMemberId],
		references: [legacyMembers.id]
	}),
}));

export const legacyMembersRelations = relations(legacyMembers, ({one, many}) => ({
	historicalEventAttendances: many(historicalEventAttendances),
	profile: one(profiles, {
		fields: [legacyMembers.claimedProfileId],
		references: [profiles.id]
	}),
}));

export const eventGuestRsvpsRelations = relations(eventGuestRsvps, ({one, many}) => ({
	event: one(events, {
		fields: [eventGuestRsvps.eventId],
		references: [events.id]
	}),
	eventGuestAttendances: many(eventGuestAttendances),
}));

export const smsBroadcastsRelations = relations(smsBroadcasts, ({one, many}) => ({
	profile: one(profiles, {
		fields: [smsBroadcasts.createdBy],
		references: [profiles.id]
	}),
	event: one(events, {
		fields: [smsBroadcasts.eventId],
		references: [events.id]
	}),
	smsDeliveries: many(smsDeliveries),
}));

export const smsDeliveriesRelations = relations(smsDeliveries, ({one}) => ({
	smsBroadcast: one(smsBroadcasts, {
		fields: [smsDeliveries.broadcastId],
		references: [smsBroadcasts.id]
	}),
}));

export const pointRulesRelations = relations(pointRules, ({one}) => ({
	event: one(events, {
		fields: [pointRules.eventId],
		references: [events.id]
	}),
	profile: one(profiles, {
		fields: [pointRules.updatedBy],
		references: [profiles.id]
	}),
}));

export const pointLedgerRelations = relations(pointLedger, ({one}) => ({
	profile_actor: one(profiles, {
		fields: [pointLedger.actor],
		references: [profiles.id],
		relationName: "pointLedger_actor_profiles_id"
	}),
	event: one(events, {
		fields: [pointLedger.eventId],
		references: [events.id]
	}),
	profile_userId: one(profiles, {
		fields: [pointLedger.userId],
		references: [profiles.id],
		relationName: "pointLedger_userId_profiles_id"
	}),
}));

export const eventStaffAssignmentsRelations = relations(eventStaffAssignments, ({one}) => ({
	event: one(events, {
		fields: [eventStaffAssignments.eventId],
		references: [events.id]
	}),
	profile_grantedBy: one(profiles, {
		fields: [eventStaffAssignments.grantedBy],
		references: [profiles.id],
		relationName: "eventStaffAssignments_grantedBy_profiles_id"
	}),
	profile_revokedBy: one(profiles, {
		fields: [eventStaffAssignments.revokedBy],
		references: [profiles.id],
		relationName: "eventStaffAssignments_revokedBy_profiles_id"
	}),
	profile_userId: one(profiles, {
		fields: [eventStaffAssignments.userId],
		references: [profiles.id],
		relationName: "eventStaffAssignments_userId_profiles_id"
	}),
}));

export const eventPassTokensRelations = relations(eventPassTokens, ({one}) => ({
	event: one(events, {
		fields: [eventPassTokens.eventId],
		references: [events.id]
	}),
	profile: one(profiles, {
		fields: [eventPassTokens.userId],
		references: [profiles.id]
	}),
}));

export const hacklantaEditionsRelations = relations(hacklantaEditions, ({one, many}) => ({
	event: one(events, {
		fields: [hacklantaEditions.eventId],
		references: [events.id]
	}),
	hacklantaFloors: many(hacklantaFloors),
	hacklantaRooms: many(hacklantaRooms),
	hacklantaSessions: many(hacklantaSessions),
}));

export const hacklantaFloorsRelations = relations(hacklantaFloors, ({one, many}) => ({
	hacklantaEdition: one(hacklantaEditions, {
		fields: [hacklantaFloors.editionId],
		references: [hacklantaEditions.id]
	}),
	hacklantaRooms: many(hacklantaRooms),
}));

export const hacklantaRoomsRelations = relations(hacklantaRooms, ({one, many}) => ({
	hacklantaEdition: one(hacklantaEditions, {
		fields: [hacklantaRooms.editionId],
		references: [hacklantaEditions.id]
	}),
	hacklantaFloor: one(hacklantaFloors, {
		fields: [hacklantaRooms.floorId],
		references: [hacklantaFloors.id]
	}),
	hacklantaSessions: many(hacklantaSessions),
}));

export const hacklantaSessionsRelations = relations(hacklantaSessions, ({one, many}) => ({
	hacklantaEdition: one(hacklantaEditions, {
		fields: [hacklantaSessions.editionId],
		references: [hacklantaEditions.id]
	}),
	hacklantaRoom: one(hacklantaRooms, {
		fields: [hacklantaSessions.roomId],
		references: [hacklantaRooms.id]
	}),
	sessionBookmarks: many(sessionBookmarks),
}));

export const hacklantaLinksRelations = relations(hacklantaLinks, ({one}) => ({
	profile: one(profiles, {
		fields: [hacklantaLinks.userId],
		references: [profiles.id]
	}),
}));

export const hacklantaLinkCodesRelations = relations(hacklantaLinkCodes, ({one}) => ({
	profile: one(profiles, {
		fields: [hacklantaLinkCodes.userId],
		references: [profiles.id]
	}),
}));

export const announcementsRelations = relations(announcements, ({one, many}) => ({
	profile: one(profiles, {
		fields: [announcements.createdBy],
		references: [profiles.id]
	}),
	event: one(events, {
		fields: [announcements.eventId],
		references: [events.id]
	}),
	pushOutboxes: many(pushOutbox),
	announcementReads: many(announcementReads),
}));

export const appleProviderTokensRelations = relations(appleProviderTokens, ({one}) => ({
	profile: one(profiles, {
		fields: [appleProviderTokens.userId],
		references: [profiles.id]
	}),
}));

export const deviceTokensRelations = relations(deviceTokens, ({one}) => ({
	profile: one(profiles, {
		fields: [deviceTokens.userId],
		references: [profiles.id]
	}),
}));

export const pushOutboxRelations = relations(pushOutbox, ({one}) => ({
	announcement: one(announcements, {
		fields: [pushOutbox.announcementId],
		references: [announcements.id]
	}),
	profile: one(profiles, {
		fields: [pushOutbox.userId],
		references: [profiles.id]
	}),
}));

export const referralLinksRelations = relations(referralLinks, ({one, many}) => ({
	profile: one(profiles, {
		fields: [referralLinks.createdBy],
		references: [profiles.id]
	}),
	event: one(events, {
		fields: [referralLinks.eventId],
		references: [events.id]
	}),
	referralLinkHits: many(referralLinkHits),
}));

export const referralLinkHitsRelations = relations(referralLinkHits, ({one}) => ({
	referralLink: one(referralLinks, {
		fields: [referralLinkHits.linkId],
		references: [referralLinks.id]
	}),
}));

export const sessionBookmarksRelations = relations(sessionBookmarks, ({one}) => ({
	hacklantaSession: one(hacklantaSessions, {
		fields: [sessionBookmarks.sessionId],
		references: [hacklantaSessions.id]
	}),
	profile: one(profiles, {
		fields: [sessionBookmarks.userId],
		references: [profiles.id]
	}),
}));

export const announcementReadsRelations = relations(announcementReads, ({one}) => ({
	announcement: one(announcements, {
		fields: [announcementReads.announcementId],
		references: [announcements.id]
	}),
	profile: one(profiles, {
		fields: [announcementReads.userId],
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

export const eventGuestAttendancesRelations = relations(eventGuestAttendances, ({one}) => ({
	event: one(events, {
		fields: [eventGuestAttendances.eventId],
		references: [events.id]
	}),
	eventGuestRsvp: one(eventGuestRsvps, {
		fields: [eventGuestAttendances.guestRsvpId],
		references: [eventGuestRsvps.id]
	}),
}));

export const eventAttendancesRelations = relations(eventAttendances, ({one, many}) => ({
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
	eventAttendanceAffiliations: many(eventAttendanceAffiliations),
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

export const eventAttendanceAffiliationsRelations = relations(eventAttendanceAffiliations, ({one}) => ({
	eventAttendance: one(eventAttendances, {
		fields: [eventAttendanceAffiliations.eventId],
		references: [eventAttendances.eventId]
	}),
	profile: one(profiles, {
		fields: [eventAttendanceAffiliations.correctedBy],
		references: [profiles.id]
	}),
}));