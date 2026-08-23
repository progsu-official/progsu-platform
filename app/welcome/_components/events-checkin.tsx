import { TiltImageCard } from "@/components/ui/tilt-image-card";

export function EventsCheckin() {
  return (
    <section className="section" id="events-checkin">
      <div className="wrap">
        <div className="events-grid">
          <TiltImageCard
            imageUrl="/welcome/progsu-2.png"
            alt="Progsu"
            className="events-image"
          />
          <div>
            <div className="sec-label">
              <b>02</b> · events, made for showing up
            </div>
            <div className="sec-head">
              <h2>register in the app. scan your way in.</h2>
              <p>
                get a unique QR code to check in at every event. add it to your apple wallet, and
                your attendance tracks automatically to your profile.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
