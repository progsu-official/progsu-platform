// The plate over the middle of a ticket QR, shared by the member pass on
// /events/[slug] and the guest pass on /tickets/[token]. Both codes are
// generated at ECC level H, which survives ~30% of the symbol being covered;
// this mark covers ~5% (a 19%-wide square plus its white ring), so the
// event's cover art can sit in the center Luma-style without risking a scan
// at the door. Events without a cover keep the brand glyph.
//
// Decorative: the QR <img> underneath already carries the alt text.
export function QrCenterMark({ coverUrl }: { coverUrl: string | null }) {
  return (
    <span
      aria-hidden
      className="absolute left-1/2 top-1/2 flex h-[19%] w-[19%] -translate-x-1/2 -translate-y-1/2 items-center justify-center overflow-hidden rounded-xl bg-white shadow-[0_0_0_4px_white]"
    >
      {coverUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={coverUrl} alt="" className="h-full w-full object-cover" />
      ) : (
        <span className="font-serif text-2xl font-black italic text-zinc-800">
          P
        </span>
      )}
    </span>
  );
}
