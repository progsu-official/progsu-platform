import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Section,
  Tailwind,
  Text,
} from "@react-email/components";
import * as React from "react";

export interface OtpEmailProps {
  firstName?: string | null;
  code: string;
  expiresInMinutes: number;
  siteName?: string;
}

export default function OtpEmail({
  firstName,
  code,
  expiresInMinutes,
  siteName = "Progsu",
}: OtpEmailProps) {
  const greeting = firstName ? `Hi ${firstName},` : "Hi,";
  return (
    <Html>
      <Head />
      <Preview>Your {siteName} verification code is {code}</Preview>
      <Tailwind>
        <Body className="bg-white font-sans">
          <Container className="mx-auto max-w-[480px] p-6">
            <Heading className="text-2xl font-semibold text-slate-900">
              {siteName}
            </Heading>

            <Text className="text-slate-700">{greeting}</Text>
            <Text className="text-slate-700">
              Use the code below to verify your student email. It expires in{" "}
              {expiresInMinutes} minutes.
            </Text>

            <Section className="my-6 rounded-md border border-slate-200 bg-slate-50 py-5 text-center">
              <Text className="m-0 font-mono text-3xl font-bold tracking-[0.4em] text-slate-900">
                {code}
              </Text>
            </Section>

            <Text className="text-sm text-slate-500">
              If you didn&apos;t request this code, you can ignore this email.
            </Text>
            <Text className="text-xs text-slate-400">
              {siteName} — the member platform for builders at GSU.
            </Text>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
}

export function otpPlainText({
  firstName,
  code,
  expiresInMinutes,
  siteName = "Progsu",
}: OtpEmailProps): string {
  const greeting = firstName ? `Hi ${firstName},` : "Hi,";
  return [
    `${siteName} — student email verification`,
    ``,
    greeting,
    ``,
    `Your verification code is:`,
    ``,
    `    ${code}`,
    ``,
    `This code expires in ${expiresInMinutes} minutes.`,
    ``,
    `If you didn't request this code, you can ignore this email.`,
    ``,
    `— ${siteName}`,
  ].join("\n");
}
