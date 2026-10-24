import Link from 'next/link'
import { withAuth } from '@/lib/auth/withAuth'
import { createServerClient } from '@/lib/supabase/server'
import { getAcademicYear } from '@/lib/services/academicYear.service'
import { getCurrentTimeline } from '@/lib/services/calendarTimeline.service'
import { runCalendarValidation } from '@/lib/services/calendarValidation.service'
import { Panel } from '@/components/ui/panel'
import { LifecycleBadge } from '@/components/ui/badge'
import { ValidationPanel } from '@/components/calendar/ValidationPanel'
import { ErrorState } from '@/components/calendar/ErrorState'
import { RebuildTimelineButton } from '@/components/calendar/RebuildTimelineButton'
import { YearStatusCard } from '@/components/calendar/YearStatusCard'
import { formatEthiopian, hasBlockingErrors } from '@/lib/calendar'
export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ yearId: string }>
}

export default async function AcademicYearPage({ params }: Props) {
  const { yearId } = await params
  try {
    const ctx = await withAuth()
    const supabase = await createServerClient()
    const [year, issues, published] = await Promise.all([
      getAcademicYear(supabase, ctx, yearId),
      runCalendarValidation(supabase, ctx, yearId),
      getCurrentTimeline(supabase, ctx, yearId).catch(() => []),
    ])
    const publishedLearning = published.filter((d) => d.teachingDay).length

    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <Link href="/calendar" className="inline-block text-sm text-primary underline underline-offset-4">
          ← All academic years
        </Link>
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">{year.name}</h1>
            <p className="mt-1 tabular-dates text-sm text-muted-foreground">
              {formatEthiopian(year.startDate)} – {formatEthiopian(year.endDate)}
              {year.isDefaultBoundary && ' · default boundary'}
            </p>
          </div>
          <LifecycleBadge status={year.status} />
        </div>

        <Panel title="Set up this year's calendar">
          <p className="mb-3 text-sm text-muted-foreground">
            Configure semester boundaries, holidays, exams, and Student Return. Nothing here blocks Registration or
            Staffing from proceeding in parallel.
          </p>
          <div className="flex flex-wrap gap-3 text-sm">
            <Link href={`/calendar/${yearId}/setup`} className="font-medium text-primary underline underline-offset-4">
              Open setup →
            </Link>
            <Link href={`/calendar/${yearId}/year`} className="font-medium text-primary underline underline-offset-4">
              View full year →
            </Link>
          </div>
        </Panel>

        <Panel
          title="Timeline"
          action={hasBlockingErrors(issues) ? undefined : <RebuildTimelineButton yearId={yearId} />}
        >
          {hasBlockingErrors(issues) ? (
            <p className="text-sm text-muted-foreground">
              Resolve the errors below before building the timeline.
            </p>
          ) : (
            <div className="space-y-1 text-sm text-muted-foreground">
              <p>
                {published.length > 0 ? (
                  <>
                    Published: <strong className="text-foreground">{published.length} calendar days</strong>, of which{' '}
                    <strong className="text-foreground">{publishedLearning} are learning days</strong>.
                  </>
                ) : (
                  'No timeline has been published yet.'
                )}
              </p>
              <p>The timeline reflects every fact entered so far. Rebuild it any time a fact changes.</p>
            </div>
          )}
        </Panel>

        <YearStatusCard
          yearId={yearId}
          status={year.status}
          blockers={issues.filter((i) => i.severity === 'ERROR' || i.severity === 'MISSING').length}
        />

        <ValidationPanel issues={issues} />
      </div>
    )
  } catch (error) {
    return <ErrorState error={error} />
  }
}
