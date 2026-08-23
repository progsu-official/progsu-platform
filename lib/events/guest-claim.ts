// Name of the cookie that carries a guest's claim token across the Google
// OAuth round trip. Plain module, no "use server": both the route handler in
// app/auth/callback and the server action that sets it need this constant, and
// a "use server" file may only export async functions.
//
// The guest form collects a school email; Google supplies a personal one, so
// the two addresses no longer match and the email-based claim in
// handle_new_user() cannot connect them. This cookie is the explicit link:
// set just before the redirect to Google, read once in /auth/callback, deleted
// immediately after.
export const GUEST_CLAIM_COOKIE = "progsu_guest_claim";

// Long enough to sit on Google's account chooser, short enough that an
// abandoned attempt on a shared library machine is not still armed later.
export const GUEST_CLAIM_TTL_SECONDS = 15 * 60;
