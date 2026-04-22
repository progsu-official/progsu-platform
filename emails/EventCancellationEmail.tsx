import {
  Body,
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

export interface EventCancellationEmailProps {
  memberName: string;
  eventTitle: string;
  originalStartsAt: Date;
  cancellationReason: string | null;
  siteUrl: string;
  siteName?: string;
}

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

export default function EventCancellationEmail({
  memberName,
  eventTitle,
  originalStartsAt,
  cancellationReason,
  siteUrl,
  siteName = "Progsu",
}: EventCancellationEmailProps) {
  const when = formatStartsAt(originalStartsAt);
  return (
    <Html>
      <Head />
      <Preview>Cancelled: {eventTitle}</Preview>
      <Tailwind>
        <Body className="bg-white font-sans">
          <Container className="mx-auto max-w-[480px] p-6">
            <Heading className="text-2xl font-semibold text-slate-900">
              {siteName}
            </Heading>

            <Text className="text-slate-700">Hi {memberName},</Text>
            <Text className="text-slate-700">
              <strong>{eventTitle}</strong> scheduled for {when} has been
              cancelled.
            </Text>
            {cancellationReason ? (
              <Text className="text-slate-700">
                Reason: {cancellationReason}
              </Text>
            ) : null}
            <Text className="text-slate-700">
              We&apos;re sorry for the inconvenience.
            </Text>

            <Hr className="my-5 border-slate-200" />

            <Text className="text-xs text-slate-500">
              This is a transactional email sent because you participated in a{" "}
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

export function eventCancellationPlainText({
  memberName,
  eventTitle,
  originalStartsAt,
  cancellationReason,
  siteUrl,
  siteName = "Progsu",
}: EventCancellationEmailProps): string {
  const when = formatStartsAt(originalStartsAt);
  const reasonLine = cancellationReason
    ? `Reason: ${cancellationReason}`
    : null;
  return [
    `${siteName} — event cancelled`,
    ``,
    `Hi ${memberName},`,
    ``,
    `${eventTitle} scheduled for ${when} has been cancelled.`,
    reasonLine,
    `We're sorry for the inconvenience.`,
    ``,
    `This is a transactional email sent because you participated in a ${siteName} event.`,
    ``,
    `You received this because you participated in a ${siteName} event. Learn more in our privacy policy: ${siteUrl}/privacy.`,
    ``,
    `— ${siteName}`,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}
