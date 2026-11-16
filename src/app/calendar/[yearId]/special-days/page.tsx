import Link from 'next/link'
import { withAuth } from '@/lib/auth/withAuth'
import { createServerClient } from '@/lib/supabase/server'
import { getAcademicYear } from '@/lib/services/academicYear.service'
import { listSpecialDays } from '@/lib/services/specialDay.service'
import { can } from '@/lib/permissions/engine'
import { SpecialDaysManager } from '@/components/calendar/SpecialDaysManager'
import { ErrorState } from '@/components/calendar/ErrorState'
export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ yearId: string }>
}

export default async function SpecialDaysPage({ params }: Props) {
  const { yearId } = await params
  try {
    const ctx = await withAuth()
    const supabase = await createServerClient()
    const year = await getAcademicYear(supabase, ctx, yearId)
    const days = await listSpecialDays(supabase, ctx, yearId)
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{year.name} — special days</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Sports days, parents&apos; meetings, trips and anything else the school adds. Each one says whether students come, and who it affects.
          </p>
          <Link href={`/calendar/${yearId}`} className="text-sm text-primary underline underline-offset-4">← Back to year overview</Link>
        </div>
        <SpecialDaysManager yearId={yearId} ethiopianYear={year.yearEc} initial={days} canManage={can(ctx, 'calendar.manage') && year.status !== 'CLOSED'} />
      </div>
    )
  } catch (error) {
    return <ErrorState error={error} />
  }
}
