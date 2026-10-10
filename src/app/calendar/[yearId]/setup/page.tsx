import Link from 'next/link'
import { withAuth } from '@/lib/auth/withAuth'
import { createServerClient } from '@/lib/supabase/server'
import { getAcademicYear, listAcademicYears } from '@/lib/services/academicYear.service'
import { listSemesters } from '@/lib/services/semester.service'
import { ensureFixedHolidays, listHolidayOccurrences } from '@/lib/services/holiday.service'
import { listExamInstances } from '@/lib/services/exam.service'
import { getStudentReturn } from '@/lib/services/studentReturn.service'
import { SetupWizard } from '@/components/calendar/SetupWizard'
import { YearSwitcher } from '@/components/calendar/YearSwitcher'
import { ErrorState } from '@/components/calendar/ErrorState'
export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ yearId: string }>
}

export default async function SetupPage({ params }: Props) {
  const { yearId } = await params
  try {
    const ctx = await withAuth()
    const supabase = await createServerClient()
    // Permanent holidays count from the moment the year exists — no admin step.
    const yearForSeed = await getAcademicYear(supabase, ctx, yearId)
    await ensureFixedHolidays(supabase, yearId, yearForSeed.yearEc, ctx.user.id)
    const [year, years, semesters, holidays, exams, studentReturn] = await Promise.all([
      getAcademicYear(supabase, ctx, yearId),
      listAcademicYears(supabase, ctx),
      listSemesters(supabase, ctx, yearId),
      listHolidayOccurrences(supabase, ctx, yearId),
      listExamInstances(supabase, ctx, yearId),
      getStudentReturn(supabase, ctx, yearId),
    ])

    return (
      <div className="mx-auto max-w-3xl space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Set up {year.name}</h1>
            <Link href={`/calendar/${yearId}`} className="text-sm text-primary underline underline-offset-4">
              ← Back to year overview
            </Link>
          </div>
          {years.length > 1 && <YearSwitcher years={years} currentYearId={yearId} />}
        </div>
        <SetupWizard
          yearId={yearId}
          year={year}
          semesters={semesters}
          holidays={holidays}
          exams={exams}
          studentReturn={studentReturn}
        />
      </div>
    )
  } catch (error) {
    return <ErrorState error={error} />
  }
}
