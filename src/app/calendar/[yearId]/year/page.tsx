import Link from 'next/link'
import { withAuth } from '@/lib/auth/withAuth'
import { createServerClient } from '@/lib/supabase/server'
import { getAcademicYear } from '@/lib/services/academicYear.service'
import { getCurrentTimeline } from '@/lib/services/calendarTimeline.service'
import { listHolidayState } from '@/lib/services/holiday.service'
import { buildHolidayList } from '@/lib/calendar'
import { YearView } from '@/components/calendar/YearView'
import { ErrorState } from '@/components/calendar/ErrorState'
import { Panel } from '@/components/ui/panel'
export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ yearId: string }>
}

export default async function YearViewPage({ params }: Props) {
  const { yearId } = await params
  try {
    const ctx = await withAuth()
    const supabase = await createServerClient()
    const year = await getAcademicYear(supabase, ctx, yearId)
    const entries = await getCurrentTimeline(supabase, ctx, yearId)
    const holidayState = await listHolidayState(supabase, ctx, yearId)
    const holidays = buildHolidayList({
      occurrences: holidayState.occurrences,
      notObserved: holidayState.notObserved,
      yearStart: year.startDate,
      yearEnd: year.endDate,
    })

    return (
      <div className="space-y-6">
        <div className="flex items-baseline justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">{year.name} — full year</h1>
            <Link href={`/calendar/${yearId}`} className="text-sm text-primary underline underline-offset-4">
              ← Back to year overview
            </Link>
          </div>
        </div>
        <YearView entries={entries} holidays={holidays} ministryTargetDays={year.ministryTargetDays ?? null} />
      </div>
    )
  } catch (error) {
    return (
      <div className="space-y-4">
        <Panel title="No timeline to show yet">
          <p className="text-sm text-muted-foreground">
            Build and publish the timeline from the year overview first.
          </p>
          <Link href={`/calendar/${yearId}`} className="mt-2 inline-block text-sm text-primary underline underline-offset-4">
            ← Back to year overview
          </Link>
        </Panel>
        <ErrorState error={error} />
      </div>
    )
  }
}
