// Config for the /welcome landing page. No public/anon-safe endpoint exists
// for real member counts or avatars (list_member_cards requires auth, and
// there's no anon-granted equivalent) -- these are placeholder monograms and
// hand-set stats, kept here so they're easy to find and update.

export const DOT_COUNT = 60;

export const DOT_PALETTE = [
  "#7C4DE0",
  "#FF8A6B",
  "#F2B33C",
  "#34B39A",
  "#4F86E8",
  "#2E9E6B",
  "#E85D9B",
  "#8A93A8",
  "#9B7A63",
  "#9B5CC7",
  "#5AB0D6",
  "#D98247",
];

export const DOT_LETTERS = "JMSNAKBFERCLTDOPHGjradWiV".split("");

export const COMMUNITY_STATS = {
  memberCount: "1,800+",
  hacklantaBuilders: "400+",
  internshipsLanded: "~30",
  campuses: "4",
};
