# Claude Code Prompt — Events Platform Planning Swarm

Use the prompt below verbatim in Claude Code.

```text
You are working inside the Progsu member platform repo. Your job is NOT to start implementing yet. Your job is to create a serious, implementation-ready planning document for the next product phase: turning this existing member CRM into an internal events platform.

Enter /loop immediately and launch a large parallel planning swarm. Use the swarm aggressively so context stays compressed and we do not bottleneck on one thread.

Workflow requirements:
- Start in `/loop`.
- Launch a massive parallel swarm across at least these lanes:
  1. current-state repo audit
  2. product scope / V1 boundaries
  3. data model + migrations
  4. auth / permissions / RLS
  5. member UX / discovery / RSVP / attendance
  6. admin UX / event operations / check-in
  7. profile visibility + social/privacy implications
  8. notifications / reminders / operational messaging
  9. testing / smoke scripts / rollout
- Do not try to hold the whole repo in one context window. Use the swarm to inspect narrow slices, return compressed findings with file references, and synthesize only decisions and constraints back into the main thread.
- Synthesize all swarm output into one canonical plan. Do not leave me with disconnected lane summaries.
- Plan only unless you discover a blocker that absolutely requires deeper repo inspection. Do not start coding the events feature.

Mission:
Design the next phase of this app as an internal Progsu events platform layered onto the current member platform. The app should support:
- admin-created events
- admin event management and editing similar in spirit to Luma
- member event discovery inside the existing app
- RSVP / registration flows
- attendance / check-in flows
- the ability for members to see events they went to
- the ability to view other people’s profiles and what events they also went to, but only if the privacy model supports it safely
- admin views for event rosters, attendance, analytics, and event operations

The plan should treat this as an additive extension to the current system, not a rewrite.

Current repo context you must respect:

1. This is an already-built Next.js 15 + Supabase member CRM, not a greenfield app.
- Auth is Google OAuth via Supabase Auth.
- Member flow today is: login -> optional student email verification -> profile -> resume upload -> required consents -> dashboard.
- Members already have profiles, resumes, recruiter/export settings, and marketing consents.
- Admins already manage members, manual verification, recruiter export, domain requests, and audit logs.
- Sensitive actions are audited.
- SQL migrations in `supabase/migrations` are the schema source of truth.
- App patterns today are Next App Router, server components for reads, server actions for most mutations, and route handlers for callback/webhook/download flows.
- Authorization is enforced through Supabase RLS, helper functions, service-role server paths, and audit functions.

2. Canonical sources:
- Treat `docs/07-implementation-plan.md` and `docs/00-plan-review.md` as canonical when docs disagree.
- Verify major assumptions against the actual implemented code and SQL migrations.
- Prefer the live codebase and migrations over older aspirational docs when they conflict.

3. Important current architecture/behavior to preserve:
- Preserve the public/login, onboarding, member, and admin route split.
- Preserve admin bypass of member onboarding.
- Preserve the derived onboarding-state model in `lib/auth/onboarding.ts`; do not invent overloaded new booleans casually.
- Preserve append-only consent history and the audit-log posture.
- Preserve recruiter export and resume-storage semantics unless a new events requirement truly needs something adjacent.
- Preserve the pattern that SQL migrations are the schema source of truth and RLS is a first-class part of design.
- Preserve smoke-test thinking: the repo already uses targeted smoke scripts and careful data integrity checks.

4. Hard constraints / guardrails:
- Do not produce a generic “events SaaS” plan.
- Do not propose a rewrite or new stack.
- Do not turn this into a public Eventbrite clone, paid ticketing platform, or marketing automation system.
- Do not expose raw `profiles` rows to other members by default.
- Do not assume attendance visibility is safe just because event metadata is safe.
- Do not reuse recruiter/export visibility as member-directory visibility.
- Do not assume “view other people’s profiles and shared events” is a trivial extension. Treat it as a privacy-model change.
- Do not assume public member directories or public attendance rosters unless you explicitly justify them and surface the risks.

Product framing:
This phase should be framed as an internal member engagement + events operations platform, not a public social network or ticketing business.

Default V1 direction:
- smallest coherent V1
- internal events platform for Progsu officers and members
- admin-first operational excellence
- member discovery, RSVP, and attendance
- private-by-default profile and attendance visibility

You must explicitly evaluate and recommend answers for these product decisions:
- Should event discovery be member-only, public, or mixed?
- Should RSVP require `fullyOnboarded`, verified student email, or both?
- Should attendance be visible only to self/admins, or can members see overlap/shared attendance?
- If members can view other members, which exact fields are member-visible?
- Are past attended events visible to peers, or only self/admins?
- Are named overlap results allowed, or only coarse signals?
- Do event organizers get a separate `event_manager` role instead of global admin?
- What event types or visibility levels are needed: public-to-members, private/invite-only, admin-only drafts?
- What messaging/reminders are V1 versus later?

Feature expectations for the planning pass:

Admin/event operations:
- event CRUD
- draft/publish/cancel/archive lifecycle
- event list/calendar management
- event detail pages
- event managers / organizers
- attendee roster
- check-in tools
- attendance correction path
- event analytics / operational reporting
- event activity / audit trail

Member-facing:
- event discovery
- event detail page
- RSVP / request invite / waitlist state machine if needed
- upcoming events
- attended events history
- event state on dashboard or a dedicated events area

Profile / social layer:
- self profile event history
- admin view of a member’s event history
- a privacy-safe design for “view other people’s profiles and events they went to”
- separate member-visible profile projection or allowlist, not raw profile exposure
- explicit visibility matrix and abuse controls

Backend / data model:
- proposed new tables, relationships, indexes, and helper functions
- RLS / permission model
- service-role versus user-context boundaries
- audit events
- migration sequencing
- query-layer / domain-layer recommendations so event logic is not scattered page by page

Notifications / operational messaging:
- event confirmations
- reminders
- follow-ups
- what should be in-product only versus email/SMS
- keep this realistic for V1; do not overdesign

Testing / rollout:
- smoke-test plan in the repo’s current style
- integration and RLS test cases
- rollout phases
- metrics and operational checks after launch

Luma inspiration:
Admins should be able to create and manage events in a way that feels similar in spirit to Luma:
- strong event pages
- approval mode / waitlist where justified
- good event management UX
- check-in flow
- analytics / event operations polish
Use Luma as product inspiration, not as a reason to overbuild the first version.

Required deliverable:
Create a planning document in the repo at:
- `docs/09-events-platform-plan.md`

That doc must include, in order:
1. current-state summary of the existing platform
2. product framing for the events phase
3. V1 scope
4. explicit non-goals / out-of-scope
5. user roles and user journeys
6. canonical route map
7. event lifecycle and state machines
8. profile visibility / attendance visibility matrix
9. proposed schema additions and relationships
10. RLS / permission model
11. server actions / route handlers / backend seams
12. admin UX plan
13. member UX plan
14. notifications / reminders plan
15. testing and smoke-script plan
16. phased implementation sequence
17. risks and mitigations
18. open product decisions with recommended defaults

Output quality bar:
- This should read like a lead engineer / product architect plan, not brainstorming.
- Use file references from the repo where helpful.
- Keep the plan concrete and sequence-aware.
- Prefer the smallest coherent V1.
- Include a clear “what stays unchanged from the current member platform” section.

Final instruction:
Do not start implementation. Use `/loop`, run the large swarm, synthesize the results, and produce the single planning document above.
```
