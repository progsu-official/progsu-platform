const STEPS = [
  {
    n: "join",
    title: "sign in and set up",
    body: "log in with google, verify your school email with a one-time code, and add your resume. that's the whole setup.",
  },
  {
    n: "show up",
    title: "attend what you want",
    body: "hack nights, workshops, demo nights, coffee chats. every event you attend logs to your profile on its own.",
  },
  {
    n: "get seen",
    title: "land in front of recruiters",
    body: "sponsors and recruiters browse member profiles and pull a shortlist. the more you show up, the more you stand out.",
  },
];

export function HowItWorks() {
  return (
    <section className="section" id="how">
      <div className="wrap">
        <div className="sec-label">
          <b>01</b> · how it works
        </div>
        <div className="sec-head">
          <h2>one login. a profile that grows itself.</h2>
          <p>
            no forms to keep updating. you join once, then just show up. the profile takes care
            of the rest.
          </p>
        </div>
        <div className="steps">
          {STEPS.map((s) => (
            <div className="step" key={s.n}>
              <div className="step-n">{s.n}</div>
              <h3>{s.title}</h3>
              <p>{s.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
