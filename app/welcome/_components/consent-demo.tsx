"use client";

import { useState } from "react";
import { EyeOff } from "lucide-react";

// Illustrative demo with sample data. Matches the real model: one coarse
// `recruiter_resume_sharing` consent (lib/actions/recruiter.ts), not a
// per-field switch. The toggle controls whether the whole card is visible
// to recruiters at all, not which fields show.

type FieldKey = "resume" | "email" | "github" | "linkedin";

const FIELDS: { key: FieldKey; label: string; value: string; desc: string }[] = [
  { key: "resume", label: "resume", value: "resume.pdf", desc: "the file recruiters download" },
  { key: "email", label: "email", value: "member@student.gsu.edu", desc: "how they reach out to you" },
  { key: "github", label: "github", value: "github.com/username", desc: "your code and projects" },
  { key: "linkedin", label: "linkedin", value: "in/username", desc: "your professional profile" },
];

export function ConsentDemo() {
  const [visible, setVisible] = useState(true);

  return (
    <section className="section">
      <div className="wrap">
        <div className="consent-split">
          <div>
            <div className="sec-label">
              <b>03</b> · consent, not fine print
            </div>
            <div className="sec-head">
              <h2>
                you decide if recruiters
                <br />
                see you.
              </h2>
              <p>
                we don&apos;t share any information with recruiters without your permission. choose
                whether or not you want your credentials visible to others.
              </p>
            </div>
          </div>
          <div className="rv-card">
            <div className="rv-top">
              <div className="rv-ava">PM</div>
              <div>
                <div className="n">progsu member</div>
                <div className="m">computer science · gsu</div>
              </div>
              <button
                type="button"
                className="rv-toggle"
                role="switch"
                aria-checked={visible}
                aria-label="Visible to recruiters"
                onClick={() => setVisible((v) => !v)}
              >
                <span className="switch" aria-hidden />
              </button>
            </div>
            {visible ? (
              FIELDS.map((f) => (
                <div className="rv-field" key={f.key}>
                  <div className="rv-field-row">
                    <span className="k">{f.label}</span>
                    <span className="v">{f.value}</span>
                  </div>
                  <span className="d">{f.desc}</span>
                </div>
              ))
            ) : (
              <div className="rv-empty">
                <EyeOff size={18} strokeWidth={1.75} aria-hidden />
                not visible to recruiters
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
