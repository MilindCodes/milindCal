import { AuthActions } from "@/components/auth-actions";
import { BrandMark } from "@/components/brand-mark";
import { CalendarWorkspace } from "@/components/calendar-workspace";
import { getSessionOrDev } from "@/lib/dev-auth";

export default async function HomePage() {
  const session = await getSessionOrDev();

  if (!session) {
    return (
      <main className="signin-page" id="main-content" tabIndex={-1}>
        <section className="signin-card">
          <BrandMark showTagline />
          <p className="eyebrow">milindCal</p>
          <h1>Personal calendar with Google sync</h1>
          <p>
            Two-way sync, day/week/month/year views, recurrence, reminders, attendees, location support, and a local
            tasks sidebar with Gmail inbox preview.
          </p>
          <AuthActions authenticated={false} />
        </section>
      </main>
    );
  }

  return <CalendarWorkspace userName={session.user?.name ?? "You"} />;
}
