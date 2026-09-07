import { notFound } from "next/navigation";
import { GridPreview } from "./grid-preview";

/**
 * A harness for the time grid while it replaces FullCalendar.
 *
 * Development only — it 404s in production, so it costs nothing in the shipped
 * app. It exists so the grid can be looked at against awkward event shapes
 * (stacks, back-to-back, overnight, all-day) without going through sign-in and
 * without disturbing the real calendar.
 */
export default function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  return <GridPreview />;
}
