// Maps the canonical interested_role_t enum values (from docs/02 §3) to human-
// readable labels. The enum is the source of truth; if you need to add a value,
// it goes into a DB migration first, then here.

export const INTERESTED_ROLES = [
  "software_engineering",
  "data_science",
  "data_engineering",
  "machine_learning",
  "product_management",
  "ui_ux_design",
  "devops_sre",
  "cybersecurity",
  "research",
  "consulting",
  "quant_finance",
  "other",
] as const;

export type InterestedRole = (typeof INTERESTED_ROLES)[number];

export const INTERESTED_ROLE_LABELS: Record<InterestedRole, string> = {
  software_engineering: "Software Engineering",
  data_science: "Data Science",
  data_engineering: "Data Engineering",
  machine_learning: "Machine Learning",
  product_management: "Product Management",
  ui_ux_design: "UI/UX Design",
  devops_sre: "DevOps / SRE",
  cybersecurity: "Cybersecurity",
  research: "Research",
  consulting: "Consulting",
  quant_finance: "Quant / Finance",
  other: "Other",
};

export const CLASS_STANDINGS = [
  "freshman",
  "sophomore",
  "junior",
  "senior",
  "graduate",
  "phd",
  "alumni",
] as const;

export type ClassStanding = (typeof CLASS_STANDINGS)[number];

export const CLASS_STANDING_LABELS: Record<ClassStanding, string> = {
  freshman: "Freshman",
  sophomore: "Sophomore",
  junior: "Junior",
  senior: "Senior",
  graduate: "Graduate",
  phd: "PhD",
  alumni: "Alumni",
};

export const GRAD_TERMS = ["Spring", "Summer", "Fall", "Winter"] as const;
export type GradTerm = (typeof GRAD_TERMS)[number];
