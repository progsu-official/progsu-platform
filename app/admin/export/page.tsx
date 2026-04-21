import { ExportWizard } from "./export-wizard";

export const dynamic = "force-dynamic";

export default function AdminExportPage() {
  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Recruiter export</h1>
        <p className="text-sm text-muted-foreground">
          Generates a CSV of members who opted in to recruiter sharing, signed the
          current consent, verified their school email, and uploaded a resume.
        </p>
      </header>

      <div className="rounded-md border border-muted-foreground/20 bg-muted/20 p-4 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">Included fields</p>
        <p className="mt-1">
          name, preferred name, google email, student email, phone, school, major,
          minor, class, grad year/term, interested roles, LinkedIn, GitHub,
          portfolio, resume filename, resume uploaded-at, 15-minute signed resume
          URL, export ID.
        </p>
      </div>

      <ExportWizard />
    </div>
  );
}
