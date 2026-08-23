import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Tailwind,
  Text,
} from "@react-email/components";
import * as React from "react";

export interface EventRsvpConfirmationEmailProps {
  memberName: string;
  eventTitle: string;
  startsAt: Date;
  location: string | null;
  eventUrl: string;
  siteUrl: string;
  siteName?: string;
}

// Transactional: triggered by a member RSVPing to a Progsu event. Keep copy
// sober — no marketing tone. Links back to the event detail page where the
// member can manage or cancel the RSVP.
function formatStartsAt(startsAt: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(startsAt);
}

export default function EventRsvpConfirmationEmail({
  memberName,
  eventTitle,
  startsAt,
  location,
  eventUrl,
  siteUrl,
  siteName = "Progsu",
}: EventRsvpConfirmationEmailProps) {
  const when = formatStartsAt(startsAt);
  const where = location ?? "To be announced";
  return (
    <Html>
      <Head />
      <Preview>You&apos;re going: {eventTitle}</Preview>
      <Tailwind>
        <Body className="bg-white font-sans">
          <Container className="mx-auto max-w-[480px] p-6">
            <Heading className="text-2xl font-semibold text-slate-900">
              {siteName}
            </Heading>

            <Text className="text-slate-700">Hi {memberName},</Text>
            <Text className="text-slate-700">
              You&apos;re on the list for <strong>{eventTitle}</strong> on{" "}
              {when}.
            </Text>
            <Text className="text-slate-700">Location: {where}.</Text>
            <Text className="text-sm text-slate-600">
              Your personal check-in QR is on your profile, staff can scan
              it at any event, no ticket needed.
            </Text>

            <Button
              href={eventUrl}
              className="mt-2 inline-block rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white"
            >
              View event details
            </Button>

            <Text className="text-sm text-slate-600">
              If you can&apos;t make it, cancel your RSVP from the event page so
              someone on the waitlist can take your spot.
            </Text>

            <Hr className="my-5 border-slate-200" />

            <Text className="text-xs text-slate-500">
              This is a transactional email sent because you RSVP&apos;d to a{" "}
              {siteName} event.
            </Text>
            <Text className="text-xs text-slate-400">
              You received this because you participated in a {siteName} event.
              Learn more in our privacy policy: {siteUrl}/privacy.
            </Text>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
}

export function eventRsvpConfirmationPlainText({
  memberName,
  eventTitle,
  startsAt,
  location,
  eventUrl,
  siteUrl,
  siteName = "Progsu",
}: EventRsvpConfirmationEmailProps): string {
  const when = formatStartsAt(startsAt);
  const where = location ?? "To be announced";
  return [
    `${siteName} — RSVP confirmation`,
    ``,
    `Hi ${memberName},`,
    ``,
    `You're on the list for ${eventTitle} on ${when}.`,
    `Location: ${where}.`,
    ``,
    `See details and manage your RSVP: ${eventUrl}`,
    ``,
    `If you can't make it, cancel your RSVP from the event page so someone on the waitlist can take your spot.`,
    ``,
    `This is a transactional email sent because you RSVP'd to a ${siteName} event.`,
    ``,
    `You received this because you participated in a ${siteName} event. Learn more in our privacy policy: ${siteUrl}/privacy.`,
    ``,
    `— ${siteName}`,
  ].join("\n");
}
