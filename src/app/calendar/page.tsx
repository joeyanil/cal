import Link from 'next/link'
import { withAuth } from '@/lib/auth/withAuth'
import { createServerClient } from '@/lib/supabase/server'
import { listAcademicYears } from '@/lib/services/academicYear.service'
import { Panel } from '@/components/ui/panel'
import { LifecycleBadge } from '@/components/ui/badge'
import { CreateYearForm } from '@/components/calendar/CreateYearForm'
import { ErrorState } from '@/components/calendar/ErrorState'
import { formatEthiopian } from '@/lib/calendar'
export const dynamic = 'force-dynamic'

export default async function CalendarDashboardPage() {
  try {
    const ctx = await withAuth()
    const supabase = await createServerClient()
    const years = await listAcademicYears(supabase, ctx)

    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Academic years</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every school year K2 knows about. Start a new one, or open an existing year to configure it.
          </p>
        </div>

        <Panel title="Start a new academic year">
          <CreateYearForm />
        </Panel>

        <Panel title="All years">
          {years.length === 0 ? (
            <p className="text-sm text-muted-foreground">No academic years yet — create one above.</p>
          ) : (
            <ul className="divide-y divide-border">
              {years.map((year) => (
                <li key={year.id} className="py-3">
                  <div className="flex items-start justify-between gap-3">
                    <Link href={`/calendar/${year.id}`} className="text-base font-semibold text-foreground hover:underline">
                      {year.name}
                    </Link>
                    <LifecycleBadge status={year.status} />
                  </div>
                  <p className="tabular-dates mt-0.5 text-xs text-muted-foreground">
                    {formatEthiopian(year.startDate)} – {formatEthiopian(year.endDate)}
                    {year.isDefaultBoundary && ' · default dates, not confirmed yet'}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm font-medium text-primary">
                    <Link href={`/calendar/${year.id}`} className="underline underline-offset-4">Overview</Link>
                    <Link href={`/calendar/${year.id}/setup`} className="underline underline-offset-4">Set up</Link>
                    <Link href={`/calendar/${year.id}/year`} className="underline underline-offset-4">View year</Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    )
} catch (error) {
    console.error('[CalendarDashboardPage] failed:', error)
    return <ErrorState error={error} />
  }
}
