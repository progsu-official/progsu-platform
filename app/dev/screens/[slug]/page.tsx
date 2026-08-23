import { notFound } from "next/navigation";

import {
  OnbActionBar,
  OnbIntro,
  OnbPrimaryButton,
  OnbSection,
  OnbSurface,
} from "@/app/onboarding/_components/shell";
import { StepIndicator } from "@/app/onboarding/_components/step-indicator";
import { VerifyEmailForm } from "@/app/onboarding/verify-email/verify-email-form";
import { ProfileForm } from "@/app/onboarding/profile/profile-form";
import { LinksForm } from "@/app/onboarding/links/links-form";
import { ResumeUploader } from "@/app/onboarding/resume/resume-uploader";
import { ConsentForm } from "@/app/onboarding/consent/consent-form";
import { WelcomeFlow } from "@/app/joined/[token]/welcome-flow";

import { screenAt } from "../screens";
import { ModalStage } from "./modal-stage";

export const dynamic = "force-dynamic";

// Fabricated props, mirroring the shapes the real pages build from their
// queries. Kept in one place so a prop-type change breaks the build here too
// rather than letting this gallery drift into showing a screen that no longer
// exists.
const MAJORS = [
  { slug: "computer_science", label: "Computer Science" },
  { slug: "computer_information_systems", label: "Computer Information Systems" },
  { slug: "software_engineering", label: "Software Engineering" },
  { slug: "data_science", label: "Data Science" },
  { slug: "mathematics", label: "Mathematics" },
  { slug: "finance", label: "Finance" },
  { slug: "marketing", label: "Marketing" },
  { slug: "psychology", label: "Psychology" },
  { slug: "mechanical_engineering", label: "Mechanical Engineering" },
  { slug: "electrical_engineering", label: "Electrical Engineering" },
  { slug: "biology", label: "Biology" },
  { slug: "economics", label: "Economics" },
  { slug: "other", label: "Other" },
];

const SCHOOLS = [
  "Georgia State University",
  "Georgia Institute of Technology",
  "Emory University",
  "Kennesaw State University",
];

const EMPTY_PROFILE = {
  firstName: "",
  lastName: "",
  preferredName: "",
  school: "",
  schoolOtherText: "",
  phoneNumber: "",
  major: "",
  majorOtherText: "",
  minor: "",
};

const FILLED_PROFILE = {
  ...EMPTY_PROFILE,
  firstName: "Joey",
  lastName: "Zhang",
  school: "Georgia State University",
  phoneNumber: "(404) 555-0142",
  major: "computer_science",
};

const EMPTY_LINKS = {
  classStanding: "",
  gradYear: null as number | null,
  gradTerm: "",
  interestedRoles: [] as string[],
  linkedinUrl: "",
  githubUrl: "",
  portfolioUrl: "",
  bio: "",
};

const CLAIM_CONTEXT = {
  firstName: "Joey",
  email: "joey@student.gsu.edu",
  eventTitle: "Build Night · Unity Plaza",
  eventSlug: "build-night",
  startsAt: new Date().toISOString(),
  rsvpStatus: "going" as const,
  answered: false,
  smsOptedIn: false,
};

export default async function DevScreenPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const at = screenAt(slug);
  if (!at) notFound();

  // The onboarding chrome lives in that route's layout, which we are not
  // inside. Screens in that group get it drawn here so they look like they do
  // in the funnel rather than floating on a bare page.
  const chrome =
    at.screen.group === "Onboarding" ? (
      <div className="absolute right-5 top-5 z-20 flex h-12 items-center sm:right-6">
        <StepIndicator nextStep={stepFor(slug)} />
      </div>
    ) : null;

  return (
    <>
      {chrome}
      {render(slug)}
    </>
  );
}

function stepFor(slug: string) {
  if (slug.startsWith("profile")) return "profile" as const;
  if (slug === "links") return "links" as const;
  if (slug.startsWith("resume")) return "consent" as const;
  if (slug.startsWith("consent")) return "consent" as const;
  if (slug === "done") return null;
  return "profile" as const;
}

function render(slug: string) {
  switch (slug) {
    case "guest-modal":
      return <ModalStage variant="form" />;
    case "guest-modal-collision":
      return <ModalStage variant="collision" />;

    case "joined-landed":
      // The live page auto-advances after ~1.5s. `freeze` holds the first beat
      // so it can actually be looked at.
      return <WelcomeFlow token={FAKE_TOKEN} context={CLAIM_CONTEXT} devBypass freeze="landed" />;
    case "joined-ask":
      return <WelcomeFlow token={FAKE_TOKEN} context={CLAIM_CONTEXT} devBypass freeze="ask" />;
    case "joined-waitlisted":
      return (
        <WelcomeFlow
          token={FAKE_TOKEN}
          context={{ ...CLAIM_CONTEXT, rsvpStatus: "waitlisted" }}
          devBypass
          freeze="ask"
        />
      );

    case "verify-email":
      return (
        <OnbSection>
          <VerifyEmailForm
            initialEmail=""
            fullyOnboarded={false}
            intro={
              <OnbIntro title="Let’s confirm you’re a student">
                A verified school email is what puts you in front of recruiters.
              </OnbIntro>
            }
          />
        </OnbSection>
      );
    case "verify-email-verified":
      return (
        <OnbSection>
          <VerifyEmailForm
            initialEmail=""
            fullyOnboarded
            intro={
              <OnbIntro title="Your school email is verified">
                joey@student.gsu.edu is on file. Verify a different one below to
                swap it.
              </OnbIntro>
            }
          />
        </OnbSection>
      );

    case "profile":
      return (
        <OnbSection>
          <ProfileForm
            intro={
              <OnbIntro title="The basics">
                Just trying to get to know you. Five fields, everything else can wait.
              </OnbIntro>
            }
            notice={null}
            initial={EMPTY_PROFILE}
            majorOptions={MAJORS}
            schoolOptions={SCHOOLS}
          />
        </OnbSection>
      );
    case "profile-returning":
      return (
        <OnbSection>
          <ProfileForm
            intro={
              <OnbIntro title="The basics">
                Just trying to get to know you. Five fields, everything else can wait.
              </OnbIntro>
            }
            notice={
              <div className="rounded-[14px] border border-primary/25 bg-primary/[0.06] px-4 py-3 text-center text-sm text-primary">
                You’ve been to a Progsu event before, so we filled in what we
                already had. Worth a quick look.
              </div>
            }
            initial={FILLED_PROFILE}
            majorOptions={MAJORS}
            schoolOptions={SCHOOLS}
          />
        </OnbSection>
      );

    case "links":
      return (
        <OnbSection>
          <LinksForm initial={EMPTY_LINKS} />
        </OnbSection>
      );

    case "resume":
      return (
        <OnbSection>
          <ResumeUploader currentFileName={null} currentUploadedAt={null} />
        </OnbSection>
      );
    case "resume-existing":
      return (
        <OnbSection>
          <ResumeUploader
            currentFileName="joey-zhang-resume.pdf"
            currentUploadedAt={new Date(Date.now() - 86_400_000).toISOString()}
          />
        </OnbSection>
      );

    case "consent":
      return (
        <OnbSection>
          <ConsentForm hasPhone />
        </OnbSection>
      );
    case "consent-no-phone":
      return (
        <OnbSection>
          <ConsentForm hasPhone={false} />
        </OnbSection>
      );

    case "done":
      return (
        <OnbSection>
          <OnbSurface>
            <div className="flex flex-col items-center gap-5 text-center">
              <span aria-hidden className="text-[56px] leading-none">
                🥳
              </span>
              <OnbIntro title="Let’s gooo">Bringing you to your profile…</OnbIntro>
            </div>
          </OnbSurface>
          <OnbActionBar>
            <OnbPrimaryButton href="/dev/screens">
              Go to my profile
            </OnbPrimaryButton>
          </OnbActionBar>
        </OnbSection>
      );

    default:
      notFound();
  }
}

const FAKE_TOKEN = "00000000-0000-0000-0000-000000000000";
