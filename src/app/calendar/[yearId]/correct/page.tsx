import Link from 'next/link'
import { withAuth } from '@/lib/auth/withAuth'
import { createServerClient } from '@/lib/supabase/server'
import { getAcademicYear } from '@/lib/services/academicYear.service'
import { loadCalendarSource } from '@/lib/services/calendarSource.service'
import { can } from '@/lib/permissions/engine'
import { EXAM_TYPES, HOLIDAY_TYPES } from '@/lib/calendar'
import { CorrectionForm } from '@/components/calendar/CorrectionForm'
import type { CorrectableFact } from '@/components/calendar/CorrectionForm'
import { ErrorState } from '@/components/calendar/ErrorState'
import { Panel } from '@/components/ui/panel'
export const dynamic = 'force-dynamic'
export const metadata = { title: 'Correct a date — K2 Calendar' }

interface Props {
  params: Promise<{ yearId: string }>
}

export default async function CorrectPage({ params }: Props) {
  const { yearId } = await params
  try {
    const ctx = await withAuth()
    const supabase = await createServerClient()
    const sourcePromise = loadCalendarSource(supabase, yearId)
    sourcePromise.catch(() => undefined) // handled below if it is needed
    const year = await getAcademicYear(supabase, ctx, yearId)
    const header = (
      <div>
        <h1 className="text-2xl font-bold text-foreground">{year.name} — correct a date</h1>
        <Link href={`/calendar/${yearId}`} className="text-sm text-primary underline underline-offset-4">← Back to year overview</Link>
      </div>
    )
    if (!can(ctx, 'calendar.correct_history')) {
      return <div className="space-y-6">{header}<Panel><p className="text-sm text-muted-foreground">Only the main admin can correct a date in a closed year.</p></Panel></div>
    }
    if (year.status !== 'CLOSED') {
      return <div className="space-y-6">{header}<Panel><p className="text-sm text-muted-foreground">This year is not closed, so its dates can be changed in the ordinary setup.</p></Panel></div>
    }

    const source = await sourcePromise
    const facts: CorrectableFact[] = []
    const add = (f: Omit<CorrectableFact, 'id'>) => facts.push({ ...f, id: `${f.factKind}|${f.factSemesterOrder ?? ''}|${f.factHolidayTypeKey ?? ''}|${f.factExamTypeKey ?? ''}` })
    const none = { factSemesterOrder: null, factHolidayTypeKey: null, factExamTypeKey: null } as const
    add({ ...none, label: 'First day of the school year', factKind: 'ACADEMIC_YEAR_START', current: source.year.startDate })
    add({ ...none, label: 'Last day of the school year', factKind: 'ACADEMIC_YEAR_END', current: source.year.endDate })
    for (const s of source.semesters) {
      if (s.startDate) add({ ...none, label: `Semester ${s.order} start`, factKind: 'SEMESTER_START', factSemesterOrder: s.order, current: s.startDate })
      if (s.endDate) add({ ...none, label: `Semester ${s.order} end`, factKind: 'SEMESTER_END', factSemesterOrder: s.order, current: s.endDate })
    }
    if (source.studentReturn) add({ ...none, label: "Students' return day", factKind: 'STUDENT_RETURN', current: source.studentReturn })
    for (const h of source.holidays) add({ ...none, label: HOLIDAY_TYPES[h.holidayTypeKey].name, factKind: 'HOLIDAY_OCCURRENCE', factHolidayTypeKey: h.holidayTypeKey, current: h.date })
    for (const e of source.exams) {
      add({ ...none, label: `${EXAM_TYPES[e.examTypeKey].name} start`, factKind: 'EXAM_START', factExamTypeKey: e.examTypeKey, current: e.startDate })
      add({ ...none, label: `${EXAM_TYPES[e.examTypeKey].name} end`, factKind: 'EXAM_END', factExamTypeKey: e.examTypeKey, current: e.endDate })
    }

    return (
      <div className="space-y-6">
        {header}
        <Panel title="Change a date in this closed year">
          <p className="mb-3 text-sm text-muted-foreground">
            The date is simply changed, and the calendar is rebuilt straight away. No reason is asked for and no record of the old date is kept.
          </p>
          <CorrectionForm yearId={yearId} ethiopianYear={year.yearEc} facts={facts} />
        </Panel>
      </div>
    )
  } catch (error) {
    return <ErrorState error={error} />
  }
}
