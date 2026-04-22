import ReactMarkdown from "react-markdown";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";

// Schema type isn't re-exported from rehype-sanitize; inline via the plugin's
// option type to avoid taking a direct dep on hast-util-sanitize.
type Schema = NonNullable<Parameters<typeof rehypeSanitize>[0]>;

// Server-rendered markdown for event descriptions. Strict allow-list — images,
// iframes, script, style are not permitted, and anchors get rel=noopener +
// target=_blank. No client JS (no hydration cost beyond what react-markdown
// emits as static HTML).

const schema: Schema = {
  ...defaultSchema,
  tagNames: [
    "p",
    "br",
    "strong",
    "em",
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
    <div
      className={[
        "text-sm text-foreground",
        "[&>p]:my-2",
        "[&>h2]:mt-4 [&>h2]:text-base [&>h2]:font-semibold",
        "[&>h3]:mt-3 [&>h3]:text-sm [&>h3]:font-semibold",
        "[&>ul]:my-2 [&>ul]:list-disc [&>ul]:pl-5",
        "[&>ol]:my-2 [&>ol]:list-decimal [&>ol]:pl-5",
        "[&>blockquote]:my-2 [&>blockquote]:border-l-2 [&>blockquote]:border-muted [&>blockquote]:pl-3 [&>blockquote]:text-muted-foreground",
        "[&_code]:rounded [&_code]:bg-muted/50 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs",
        "[&>pre]:my-2 [&>pre]:overflow-x-auto [&>pre]:rounded [&>pre]:bg-muted/50 [&>pre]:p-3",
      ].join(" ")}
    >
      <ReactMarkdown
        rehypePlugins={[[rehypeSanitize, schema]]}
        components={{ a: ExternalLink }}
      >
        {md}
      </ReactMarkdown>
    </div>
  );
}
