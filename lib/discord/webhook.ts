// Minimal Discord webhook executor.
//
// Same shape as the one in hacklanta-ii: a single POST of a JSON message, no
// SDK, no queue. What is different here is that this one is never allowed to
// take the caller down with it — every entry point in this directory wraps it
// so a Discord outage costs us an announcement, not an RSVP.
//
// No "server-only" guard here, unlike its caller: this is a bare fetch with
// no secrets and no database, and scripts/preview-discord-rsvp.ts imports it
// directly from Node, where "server-only" resolves to a module that throws.
// notify-rsvp.ts carries the guard, and it is the file that touches the
// service-role client.
//
// The timeout matters more than it looks. These calls run inside a server
// action on a serverless function; without an abort signal a hung Discord
// holds the invocation open until the platform kills it, and the member
// watching the RSVP button gets nothing back.

// Generous enough for a multipart post carrying a ~100KB chart PNG.
const REQUEST_TIMEOUT_MS = 10_000;

export type WebhookMessage = Record<string, unknown>;

/** A rendered chart, referenced from an embed as `attachment://<name>`. */
export type WebhookFile = {
  name: string;
  contentType: string;
  data: Uint8Array;
};

export type ExecuteWebhookInput = {
  webhookUrl: string;
  message: WebhookMessage;
  files?: WebhookFile[];
  fetchImplementation?: typeof fetch;
};

export type WebhookExecutor = (input: ExecuteWebhookInput) => Promise<void>;

export const executeWebhook: WebhookExecutor = async ({
  webhookUrl,
  message,
  files = [],
  fetchImplementation = fetch,
}) => {
  // JSON for a plain message; multipart the moment an embed needs to point at
  // an uploaded PNG. Discord resolves attachment:// URLs only against files in
  // the same request, so the chart cannot be posted separately.
  let body: BodyInit;
  let headers: Record<string, string> | undefined;
  if (files.length === 0) {
    body = JSON.stringify(message);
    headers = { "Content-Type": "application/json" };
  } else {
    const form = new FormData();
    form.set("payload_json", JSON.stringify(message));
    files.forEach((file, index) => {
      form.set(
        `files[${index}]`,
        new Blob([file.data as BlobPart], { type: file.contentType }),
        file.name
      );
    });
    body = form;
  }

  const response = await fetchImplementation(webhookUrl, {
    method: "POST",
    headers,
    body,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    // Discord answers a rejected embed with a JSON body naming the offending
    // field, which is the only thing that makes a 400 here debuggable.
    const detail = await response.text().catch(() => "");
    throw new Error(
      `discord_webhook_failed ${response.status}${detail ? `: ${detail.slice(0, 500)}` : ""}`
    );
  }
};
