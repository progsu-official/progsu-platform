import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";

// Schema type isn't re-exported from rehype-sanitize; inline via the plugin's
// option type to avoid taking a direct dep on hast-util-sanitize.
type Schema = NonNullable<Parameters<typeof rehypeSanitize>[0]>;

// Server-rendered markdown for event descriptions. Strict allow-list — images,
// iframes, script, style are not permitted, and anchors get rel=noopener +
// target=_blank. No client JS (no hydration cost beyond what react-markdown
// emits as static HTML).
//
// GFM is on: descriptions are pasted from Notion and Google Docs, where bare
// URLs and the occasional schedule table are routine. Without it those URLs
// render as inert text and the table collapses into pipe soup. The sanitize
// pass still runs after, so the wider tag set below is the whole surface GFM
// can reach.

const schema: Schema = {
  ...defaultSchema,
  tagNames: [
    "p",
    "br",
    "strong",
    "em",
    "del",
    "a",
    "ul",
    "ol",
    "li",
    "h2",
    "h3",
    "h4",
    "blockquote",
    "code",
    "pre",
    "hr",
    "table",
    "thead",
    "tbody",
    "tr",
    "th",
    "td",
  ],
  attributes: {
    ...defaultSchema.attributes,
    a: [
      ["href"],
      ["title"],
      // Do NOT allow target/rel through user markdown — we enforce them in
      // the component override below so users can't set target=_self or drop
      // noopener.
    ],
    // GFM emits alignment on table cells; nothing else is permitted through.
    th: [["align"]],
    td: [["align"]],
  },
  protocols: {
    ...defaultSchema.protocols,
    // Only http(s) and mailto for anchors.
    href: ["http", "https", "mailto"],
  },
};

type AnchorProps = {
  href?: string;
  title?: string;
  children?: React.ReactNode;
};

function ExternalLink({ href, title, children }: AnchorProps) {
  return (
    <a
      href={href}
      title={title}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary underline underline-offset-4"
    >
      {children}
    </a>
  );
}

export function EventDescription({ md }: { md: string }) {
  return (
    // Body copy, not fine print. This block used to render at text-sm with
    // tight leading, which made a two-paragraph description look like a
    // disclaimer sitting under the RSVP button. 15px/relaxed is the same
    // register Luma reads at, and it is the one place on this page where
    // long-form text has to carry itself.
    <div
      className={[
        "text-[15px] leading-relaxed text-foreground",
        "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
        "[&_p]:my-3.5",
        "[&_h2]:mb-2 [&_h2]:mt-7 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:tracking-tight",
        "[&_h3]:mb-1.5 [&_h3]:mt-6 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:tracking-tight",
        "[&_h4]:mb-1.5 [&_h4]:mt-5 [&_h4]:text-[15px] [&_h4]:font-semibold",
        "[&_ul]:my-3.5 [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5",
        "[&_ol]:my-3.5 [&_ol]:list-decimal [&_ol]:space-y-1.5 [&_ol]:pl-5",
        "[&_li]:pl-0.5 [&_li_p]:my-0",
        "[&_strong]:font-semibold [&_strong]:text-foreground",
        "[&_del]:text-muted-foreground",
        "[&_hr]:my-7 [&_hr]:border-border/60",
        "[&_blockquote]:my-4 [&_blockquote]:border-l-2 [&_blockquote]:border-primary/40 [&_blockquote]:pl-4 [&_blockquote]:text-muted-foreground",
        "[&_code]:rounded [&_code]:bg-muted/60 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-[13px]",
        "[&_pre]:my-4 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-muted/60 [&_pre]:p-4",
        "[&_pre_code]:bg-transparent [&_pre_code]:p-0",
        // Tables scroll inside their own box rather than widening the column.
        "[&_table]:my-4 [&_table]:block [&_table]:w-full [&_table]:overflow-x-auto [&_table]:text-sm",
        "[&_th]:border-b [&_th]:border-border [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-semibold",
        "[&_td]:border-b [&_td]:border-border/50 [&_td]:px-3 [&_td]:py-2",
      ].join(" ")}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeSanitize, schema]]}
        components={{ a: ExternalLink }}
      >
        {md}
      </ReactMarkdown>
    </div>
  );
}
