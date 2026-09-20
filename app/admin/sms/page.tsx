import { getSmsOverview } from "@/lib/actions/sms";

import { SmsConsole } from "./sms-console";

export const dynamic = "force-dynamic";
// The send actions run their first worker pass in after(), inside this
// route's function. The worker budgets its time against this ceiling.
export const maxDuration = 60;

export const metadata = { title: "Texts · Progsu Admin" };

export default async function AdminSmsPage() {
  const result = await getSmsOverview();

  return (
    <SmsConsole
      data={result.ok ? result.data : null}
      error={result.ok ? null : result.error.message}
    />
  );
}
