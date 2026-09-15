"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { MessageSquare, Send, Smartphone, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Panel } from "@/app/admin/_components/charts";
import {
  cancelSmsBroadcast,
  createSmsBroadcast,
  sendSmsTest,
} from "@/lib/actions/sms";
import {
  SMS_BODY_MAX,
  smsBodySchema,
  type SmsAudience,
  type SmsBroadcastRow,
  type SmsDeliveryStatus,
  type SmsOverview,
} from "@/lib/actions/sms-schemas";
import { smsSegments } from "@/lib/sms/segments";

// One composer, one history. Who can be texted is decided in the database
// (sms_is_sendable); this page only ever shows the resulting counts, so there
// is no list of numbers here to leak or to hand-edit.

const DEFAULT_BODY = "Progsu: \n\nReply STOP to opt out.";

const AUDIENCES: { value: SmsAudience; label: string; hint: string }[] = [
  {
    value: "gsu",
    label: "Georgia State",
    hint: "Opted-in students and staff with a GSU email",
  },
  {
    value: "all_consented",
    label: "Everyone opted in",
    hint: "Every school, including GSU",
  },
];

const AUDIENCE_LABEL: Record<SmsBroadcastRow["audience"], string> = {
  gsu: "Georgia State",
  all_consented: "Everyone opted in",
  self_test: "Test to self",
};

// Display order for the per-broadcast tally, most useful first.
const STATUS_ORDER: { key: SmsDeliveryStatus; label: string; tone: string }[] = [
  { key: "delivered", label: "delivered", tone: "text-emerald-400" },
  { key: "sent", label: "sent", tone: "text-foreground" },
  { key: "queued", label: "queued", tone: "text-muted-foreground" },
  { key: "sending", label: "sending", tone: "text-muted-foreground" },
  { key: "undelivered", label: "undelivered", tone: "text-amber-300" },
  { key: "failed", label: "failed", tone: "text-destructive" },
  { key: "skipped", label: "skipped", tone: "text-muted-foreground" },
  { key: "suppressed", label: "opted out", tone: "text-muted-foreground" },
  { key: "cancelled", label: "cancelled", tone: "text-muted-foreground" },
];

const dateTimeFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export function SmsConsole({
  data,
  error,
}: {
  data: SmsOverview | null;
  error: string | null;
}) {
  const router = useRouter();

  // Refresh while anything is still going out, so the tally moves without
  // the officer reloading. Stops on its own once every broadcast settles.
  const anySending = data?.broadcasts.some((b) => b.status === "sending") ?? false;
  useEffect(() => {
    if (!anySending) return;
    const id = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(id);
  }, [anySending, router]);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          Texts
        </h1>
        <p className="text-sm text-muted-foreground">
          Text members who opted in. Anyone who replied STOP, or whose latest
          choice was no, is left out automatically and checked again right
          before their text goes out.
        </p>
      </header>

      {error || !data ? (
        <div
          role="alert"
          className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {error ?? "Couldn't load texts."}
        </div>
      ) : (
        <>
          {!data.config.canSend ? (
            <div
              role="status"
              className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-200"
            >
              Twilio isn&apos;t configured on this deployment, so sending is
              off. Set the <code className="font-mono text-xs">TWILIO_*</code>{" "}
              variables and redeploy.
            </div>
          ) : !data.config.receipts ? (
            <p className="text-xs text-muted-foreground">
              Delivery receipts are off until{" "}
              <code className="font-mono">TWILIO_AUTH_TOKEN</code> is set. Texts
              will show as sent, never delivered.
            </p>
          ) : null}

          <Composer data={data} />
          <History broadcasts={data.broadcasts} suppressed={data.suppressed} />
        </>
      )}
    </div>
  );
}

function Composer({ data }: { data: SmsOverview }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [body, setBody] = useState(DEFAULT_BODY);
  const [audience, setAudience] = useState<SmsAudience>("gsu");
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const count = data.audiences[audience];
  const seg = useMemo(() => smsSegments(body.trim()), [body]);
  const validation = smsBodySchema.safeParse(body);
  const bodyError = validation.success ? null : validation.error.issues[0]?.message;
  const missingName = !/progsu/i.test(body);
  const canSend = data.config.canSend && !pending;

  function reset() {
    setConfirming(false);
    setTyped("");
  }

  function onTest() {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const r = await sendSmsTest({ body });
      if (!r.ok) {
        setError(r.error.message);
        return;
      }
      setNotice(`Test on its way to your phone ending ${data.self.phone_last4}.`);
      router.refresh();
    });
  }

  function onSend() {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const r = await createSmsBroadcast({ body, audience, expectedCount: count });
      reset();
      if (!r.ok) {
        setError(r.error.message);
        // A CONFLICT means the audience moved; reload so the new count shows.
        if (r.error.code === "CONFLICT") router.refresh();
        return;
      }
      setNotice(
        `Sending to ${r.data.recipientCount.toLocaleString()} people. The tally below updates as texts go out.`
      );
      setBody(DEFAULT_BODY);
      router.refresh();
    });
  }

  const testDisabledReason = !data.self.has_phone
    ? "Add a phone number to your profile to send yourself a test."
    : data.self.is_suppressed
      ? "Your number is on the do-not-text list."
      : null;

  return (
    <Panel title="New text">
      <div className="space-y-5">
        <fieldset className="space-y-2">
          <legend className="text-xs font-medium text-muted-foreground">To</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {AUDIENCES.map((a) => {
              const selected = a.value === audience;
              return (
                <label
                  key={a.value}
                  className={
                    "flex cursor-pointer items-start justify-between gap-3 rounded-xl border px-4 py-3 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-background " +
                    (selected
                      ? "border-primary/60 bg-primary/10"
                      : "border-border/70 hover:bg-muted/40")
                  }
                >
                  <input
                    type="radio"
                    name="audience"
                    value={a.value}
                    checked={selected}
                    onChange={() => {
                      setAudience(a.value);
                      reset();
                    }}
                    disabled={pending}
                    className="sr-only"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-foreground">
                      {a.label}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {a.hint}
                    </span>
                  </span>
                  <span className="shrink-0 text-lg font-semibold tabular-nums text-foreground">
                    {data.audiences[a.value].toLocaleString()}
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>

        <div className="space-y-1.5">
          <label htmlFor="sms-body" className="text-xs font-medium text-muted-foreground">
            Message
          </label>
          <textarea
            id="sms-body"
            value={body}
            onChange={(e) => {
              setBody(e.target.value);
              reset();
            }}
            rows={5}
            maxLength={SMS_BODY_MAX}
            disabled={pending}
            className="w-full rounded-xl border border-input bg-background px-3 py-2 text-[15px] leading-relaxed"
          />
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="tabular-nums">
              {body.trim().length}/{SMS_BODY_MAX} · {seg.segments}{" "}
              {seg.segments === 1 ? "segment" : "segments"} ·{" "}
              {(seg.segments * count).toLocaleString()} total
            </span>
            {seg.encoding === "UCS-2" ? (
              <span className="text-amber-300">
                {seg.unicodeChars.slice(0, 5).join(" ")} switches this to 70
                characters per segment
              </span>
            ) : null}
          </div>
          {bodyError ? (
            <p className="text-xs text-amber-300">{bodyError}</p>
          ) : missingName ? (
            <p className="text-xs text-amber-300">
              Carriers expect the sender to be named. Start with &quot;Progsu:&quot;.
            </p>
          ) : null}
        </div>

        {confirming ? (
          <div className="space-y-3 rounded-xl border border-primary/40 bg-primary/5 p-4">
            <p className="text-sm text-foreground">
              This texts <strong>{count.toLocaleString()}</strong>{" "}
              {count === 1 ? "person" : "people"} right now and can&apos;t be
              unsent. Type {count} to confirm.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                inputMode="numeric"
                aria-label={`Type ${count} to confirm`}
                className="w-28 tabular-nums"
                disabled={pending}
                autoFocus
              />
              <Button
                type="button"
                onClick={onSend}
                disabled={!canSend || typed.trim() !== String(count)}
                className="gap-1.5"
              >
                <Send size={14} strokeWidth={1.75} aria-hidden />
                {pending ? "Sending…" : `Send to ${count.toLocaleString()}`}
              </Button>
              <Button type="button" variant="ghost" onClick={reset} disabled={pending}>
                Back
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              onClick={() => {
                setError(null);
                setNotice(null);
                setConfirming(true);
              }}
              disabled={!canSend || !!bodyError || count === 0}
              className="gap-1.5"
            >
              <MessageSquare size={14} strokeWidth={1.75} aria-hidden />
              Review and send
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={onTest}
              disabled={!canSend || !!bodyError || !!testDisabledReason}
              title={testDisabledReason ?? undefined}
              className="gap-1.5"
            >
              <Smartphone size={14} strokeWidth={1.75} aria-hidden />
              {data.self.has_phone
                ? `Test to my phone (…${data.self.phone_last4})`
                : "Test to my phone"}
            </Button>
          </div>
        )}

        {notice ? (
          <div
            role="status"
            className="rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm text-foreground"
          >
            {notice}
          </div>
        ) : null}
        {error ? (
          <div
            role="alert"
            className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          >
            {error}
          </div>
        ) : null}
      </div>
    </Panel>
  );
}

function History({
  broadcasts,
  suppressed,
}: {
  broadcasts: SmsBroadcastRow[];
  suppressed: number;
}) {
  return (
    <Panel
      title="Sent"
      hint={`${suppressed.toLocaleString()} numbers are on the do-not-text list.`}
    >
      {broadcasts.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing sent yet.</p>
      ) : (
        <ul className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/70">
          {broadcasts.map((b) => (
            <BroadcastItem key={b.id} broadcast={b} />
          ))}
        </ul>
      )}
    </Panel>
  );
}

function BroadcastItem({ broadcast: b }: { broadcast: SmsBroadcastRow }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onCancel() {
    setError(null);
    startTransition(async () => {
      const r = await cancelSmsBroadcast({ broadcastId: b.id });
      if (!r.ok) {
        setError(r.error.message);
        return;
      }
      router.refresh();
    });
  }

  const tally = STATUS_ORDER.filter((s) => (b.counts[s.key] ?? 0) > 0);
  const errorCodes = Object.entries(b.error_codes);

  return (
    <li className="space-y-2 px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <p className="text-xs text-muted-foreground">
          {dateTimeFormat.format(new Date(b.created_at))} ·{" "}
          {AUDIENCE_LABEL[b.audience]} · {b.recipient_count.toLocaleString()}{" "}
          {b.recipient_count === 1 ? "recipient" : "recipients"}
          {b.created_by_name ? ` · ${b.created_by_name}` : ""}
        </p>
        <div className="flex items-center gap-2">
          <StatusPill status={b.status} />
          {b.status === "sending" ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={onCancel}
              disabled={pending}
              className="h-7 gap-1 px-2 text-xs"
            >
              <X size={12} strokeWidth={2} aria-hidden />
              Stop
            </Button>
          ) : null}
        </div>
      </div>
      <p className="whitespace-pre-line text-sm text-foreground/90">{b.body}</p>
      {tally.length > 0 ? (
        <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs tabular-nums">
          {tally.map((s) => (
            <span key={s.key} className={s.tone}>
              {(b.counts[s.key] ?? 0).toLocaleString()} {s.label}
            </span>
          ))}
        </p>
      ) : null}
      {errorCodes.length > 0 ? (
        <p className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
          {errorCodes.map(([code, n]) => (
            <a
              key={code}
              href={`https://www.twilio.com/docs/api/errors/${encodeURIComponent(code)}`}
              target="_blank"
              rel="noreferrer"
              className="underline decoration-dotted underline-offset-2 hover:text-foreground"
            >
              error {code} ×{n}
            </a>
          ))}
        </p>
      ) : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </li>
  );
}

function StatusPill({ status }: { status: SmsBroadcastRow["status"] }) {
  const styles = {
    sending: "bg-primary/15 text-primary",
    done: "bg-muted text-muted-foreground",
    cancelled: "bg-amber-400/15 text-amber-300",
  } as const;
  const labels = { sending: "Sending", done: "Done", cancelled: "Stopped" } as const;
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${styles[status]}`}>
      {labels[status]}
    </span>
  );
}
