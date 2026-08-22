import {
  Body,
  Column,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Row,
  Section,
  Tailwind,
  Text,
} from "@react-email/components";
import * as React from "react";

// Account-free guest registration confirmation (2026-08-21 guest-ticket
// decision). Deliberately simpler than EventRsvpConfirmationEmail: a guest has
// no profile, no RSVP to manage from a signed-in event page, and no session to
// come back to. So this carries exactly two affordances — the public event
// page and the guest's own hosted ticket page.
//
// No QR in the email itself, matching the Luma reference: the QR lives on the
// ticket page and the email links out to it. An inline attachment is a
// Gmail-vs-Apple-Mail coin flip on rendering, and the ticket page can also
// show live check-in state, which a baked PNG can't.
//
// No icon glyphs anywhere: lucide SVG is stripped wholesale by Gmail, and a
// typed character standing in for an icon is a house anti-pattern
// (DESIGN.md §1.5). The date/where plates carry the row's meaning instead.

export interface GuestRsvpConfirmationEmailProps {
  guestName: string;
  eventTitle: string;
  startsAt: Date;
  endsAt: Date;
  location: string | null;
  eventUrl: string;
  ticketUrl: string;
  siteUrl: string;
  siteName?: string;
}

const TZ = "America/New_York";

const monthShort = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ,
  month: "short",
});
const dayNumber = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ,
  day: "numeric",
});
const longDate = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ,
  weekday: "long",
  month: "long",
  day: "numeric",
});
const clockTime = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ,
  hour: "numeric",
  minute: "2-digit",
});
const clockTimeZoned = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ,
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
});

function timeRange(startsAt: Date, endsAt: Date): string {
  return `${clockTime.format(startsAt)} - ${clockTimeZoned.format(endsAt)}`;
}

export default function GuestRsvpConfirmationEmail({
  guestName,
  eventTitle,
  startsAt,
  endsAt,
  location,
  eventUrl,
  ticketUrl,
  siteName = "Progsu",
  siteUrl,
}: GuestRsvpConfirmationEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>{`You're registered for ${eventTitle}`}</Preview>
      <Tailwind>
        <Body className="bg-white font-sans">
          <Container className="mx-auto max-w-[480px] px-6 py-8">
            <Text className="m-0 text-[13px] font-semibold text-slate-400">
              {siteName}
            </Text>

            <Text className="mb-1 mt-6 text-[15px] text-slate-500">
              You have registered for
            </Text>
            <Heading
              as="h1"
              className="m-0 text-[26px] font-bold leading-tight tracking-tight text-slate-900"
            >
              {eventTitle}
            </Heading>

            <Section className="mt-7">
              <Row>
                <Column className="w-[52px] align-top">
                  {/* Radius goes on the month band itself, not the wrapper:
                      React Email's Section renders a <table>, and
                      overflow-hidden on a table does not clip a child's
                      background, so the band's corners came out square
                      against the rounded border. */}
                  <Section className="w-[44px] rounded-[10px] border border-solid border-slate-200 text-center">
                    <Text className="m-0 rounded-t-[9px] bg-slate-100 py-[4px] text-[9px] font-bold uppercase tracking-wider text-slate-500">
                      {monthShort.format(startsAt)}
                    </Text>
                    <Text className="m-0 py-[4px] text-[15px] font-bold text-slate-900">
                      {dayNumber.format(startsAt)}
                    </Text>
                  </Section>
                </Column>
                <Column className="align-top">
                  <Text className="m-0 text-[15px] font-semibold text-slate-900">
                    {longDate.format(startsAt)}
                  </Text>
                  <Text className="m-0 text-[14px] text-slate-500">
                    {timeRange(startsAt, endsAt)}
                  </Text>
                </Column>
              </Row>
            </Section>

            {location ? (
              <Section className="mt-4">
                <Row>
                  <Column className="w-[52px] align-top">
                    <Section className="w-[44px] rounded-[10px] border border-solid border-slate-200 bg-slate-50 text-center">
                      <Text className="m-0 py-[13px] text-[9px] font-bold uppercase tracking-wider text-slate-500">
                        Where
                      </Text>
                    </Section>
                  </Column>
                  <Column className="align-top">
                    <Text className="m-0 text-[15px] font-semibold text-slate-900">
                      {location}
                    </Text>
                  </Column>
                </Row>
              </Section>
            ) : null}

            <Section className="mt-8">
              <Row>
                <Column className="pr-2">
                  <Link
                    href={eventUrl}
                    className="block rounded-[10px] bg-slate-900 py-[11px] text-center text-[14px] font-semibold text-white no-underline"
                  >
                    Event page
                  </Link>
                </Column>
                <Column className="pl-2">
                  <Link
                    href={ticketUrl}
                    className="block rounded-[10px] border border-solid border-slate-300 py-[10px] text-center text-[14px] font-semibold text-slate-900 no-underline"
                  >
                    My ticket
                  </Link>
                </Column>
              </Row>
            </Section>

            <Text className="mt-6 text-[13px] leading-relaxed text-slate-500">
              {guestName}, your ticket has a QR code on it. Open it at the door
              and staff will scan you in.
            </Text>

            <Hr className="my-6 border-slate-200" />

            <Text className="m-0 text-[11px] leading-relaxed text-slate-400">
              This is a transactional email sent because you registered for a{" "}
              {siteName} event. No account and no password were created for you.
              Privacy policy: {siteUrl}/privacy
            </Text>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
}

export function guestRsvpConfirmationPlainText({
  guestName,
  eventTitle,
  startsAt,
  endsAt,
  location,
  eventUrl,
  ticketUrl,
  siteUrl,
  siteName = "Progsu",
}: GuestRsvpConfirmationEmailProps): string {
  return [
    `${siteName}`,
    ``,
    `You have registered for ${eventTitle}.`,
    ``,
    `${longDate.format(startsAt)}`,
    `${timeRange(startsAt, endsAt)}`,
    location ? `Where: ${location}` : null,
    ``,
    `Event page: ${eventUrl}`,
    `My ticket: ${ticketUrl}`,
    ``,
    `${guestName}, your ticket has a QR code on it. Open it at the door and staff will scan you in.`,
    ``,
    `This is a transactional email sent because you registered for a ${siteName} event. No account and no password were created for you.`,
    `Privacy policy: ${siteUrl}/privacy`,
  ]
    .filter((line) => line !== null)
    .join("\n");
}
