import { requireUser } from "@/lib/supabase/server";
import { getConference } from "@/lib/conference";
import { groupScheduleByDay, currentDayIndex, type ScheduleItem } from "@/lib/schedule";
import ScheduleDayView from "@/components/ScheduleDayView";

export default async function BoardPage() {
  const { supabase } = await requireUser();
  const conference = await getConference(supabase);
  const timezone = conference?.timezone ?? "America/New_York";

  const announcementBody =
    conference?.announcement?.trim() || `Welcome to ${conference?.name ?? "Icebreaker"}.`;

  const { data: rows } = await supabase
    .from("schedule_items")
    .select("id, starts_at, ends_at, title, sort_order")
    .order("starts_at");
  const items = (rows ?? []) as ScheduleItem[];
  const days = groupScheduleByDay(items, timezone);

  const nowIso = new Date().toISOString();
  const todayDate = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date(nowIso));
  const initialIndex = currentDayIndex(days, todayDate);

  return (
    <section style={{ padding: "24px 20px" }}>
      <header className="page-head">
        <h1 className="page-title">Schedule</h1>
      </header>

      {/* The announcement is the organizers talking, so it is set as a line of
          speech rather than parked in a bordered box. A rule underneath is what
          separates it from the schedule, the same way 홈 separates its sections. */}
      <div className="board-note">
        <div className="board-label">Announcement</div>
        <p className="board-note__body">{announcementBody}</p>
      </div>

      {/* No "Schedule" section label here: the page is already titled Schedule,
          and the date chips make it obvious what follows. */}
      <div style={{ marginTop: 28 }}>
        <ScheduleDayView
          days={days}
          initialIndex={initialIndex}
          todayDate={days.length ? todayDate : null}
          nowIso={nowIso}
          timezone={timezone}
        />
      </div>

      <style>{`
        .board-label {
          font-size: 13px;
          font-weight: 600;
          color: var(--ink-3);
          margin-bottom: 8px;
        }
        .board-note {
          margin-top: 8px;
          padding-bottom: 22px;
          border-bottom: 1px solid var(--line);
        }
        .board-note__body {
          margin: 0;
          font-size: 17px;
          line-height: 1.5;
          color: var(--ink);
          white-space: pre-wrap;
          text-wrap: pretty;
          max-width: 60ch;
        }
      `}</style>
    </section>
  );
}
