import Link from 'next/link'
import { withAuth } from '@/lib/auth/withAuth'
import { createServerClient } from '@/lib/supabase/server'
import { getAcademicYear } from '@/lib/services/academicYear.service'
import { getReminderSettings, previewReminders } from '@/lib/services/calendarReminder.service'
import { schoolToday } from '@/lib/services/today'
import { can } from '@/lib/permissions/engine'
import { collectCalendarEvents, dispatchKeyFor, previewDue, formatEthiopian } from '@/lib/calendar'
import { loadCalendarSource } from '@/lib/services/calendarSource.service'
import { ReminderSettingsPanel } from '@/components/calendar/ReminderSettingsPanel'
import { ErrorState } from '@/components/calendar/ErrorState'
import { Panel } from '@/components/ui/panel'
export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ yearId: string }>
}

const AUDIENCE_LABEL: Record<string, string> = {
  STUDENT: 'Student',
  GRADE_12_STUDENT: 'Grade 12 student',
  TEACHER: 'Teacher',
  HOMEROOM_TEACHER: 'Homeroom teacher',
  GRADE_12_HOMEROOM_TEACHER: 'Grade 12 homeroom teacher',
  OFFICE: 'Office team',
}

export default async function RemindersPage({ params }: Props) {
  const { yearId } = await params
  try {
    const ctx = await withAuth()
    const supabase = await createServerClient()
    const year = await getAcademicYear(supabase, ctx, yearId)
    const settings = await getReminderSettings(supabase, ctx)
    const today = schoolToday()
    const { schedule } = await previewReminders(supabase, ctx, yearId, today)
    const events = collectCalendarEvents(await loadCalendarSource(supabase, yearId))
    const byKey = new Map(events.flatMap((e) => ([30, 15, 5] as const).map((d) => [dispatchKeyFor(e, d), { e, d }] as const)))
    const coming = schedule.filter((s) => s.willSend && s.sendOn >= today).slice(0, 25)

    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{year.name} — reminders</h1>
          <Link href={`/calendar/${yearId}`} className="text-sm text-primary underline underline-offset-4">← Back to year overview</Link>
        </div>
        <Panel title="What the school sends">
          <p className="mb-3 text-sm text-muted-foreground">
            Switch a group off, or choose which of the three countdowns (30, 15 and 5 days before) are sent.
          </p>
          <ReminderSettingsPanel initial={settings} canManage={can(ctx, 'calendar.manage')} />
        </Panel>
        <Panel title="Coming up">
          {coming.length === 0 && <p className="text-sm text-muted-foreground">No reminders are waiting.</p>}
          <div className="space-y-2">
            {coming.map((s) => {
              const hit = byKey.get(s.key)
              return (
                <details key={s.key} className="rounded-md border border-border p-3 text-sm">
                  <summary className="cursor-pointer font-medium text-foreground">
                    {formatEthiopian(s.sendOn)} — {s.name}, {s.days} days before
                  </summary>
                  <div className="mt-2 space-y-2">
                    {hit &&
                      previewDue({ dispatchKey: s.key, event: hit.e, days: hit.d }).map(
                        (p) =>
                          p.message && (
                            <div key={p.audience}>
                              <p className="text-xs font-medium text-muted-foreground">{AUDIENCE_LABEL[p.audience]}</p>
                              <p className="text-foreground">{p.message.body}</p>
                            </div>
                          ),
                      )}
                  </div>
                </details>
              )
            })}
          </div>
        </Panel>
      </div>
    )
  } catch (error) {
    return <ErrorState error={error} />
  }
}
