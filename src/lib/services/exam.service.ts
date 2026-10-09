import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import type { Database } from '@/types/database.types'
import { AppError } from '../errors/AppError'
import { can } from '../permissions/engine'
import type { AuthContext } from '../auth/withAuth'
import { isoDateSchema } from './validators'
import { analyzeExamWindow, indexHolidaysByDate, type ExamInstance, type ExamTypeKey } from '../calendar'
import { rowToSemester } from './semester.service'
import { assertFactNotGovernedByDependency } from './calendarDependency.service'

function rowToInstance(row: Database['public']['Tables']['exam_instances']['Row']): ExamInstance {
  return {
    id: row.id,
    academicYearId: row.academic_year_id,
    examTypeKey: row.exam_type_key,
    startDate: row.start_date as ExamInstance['startDate'],
    endDate: row.end_date as ExamInstance['endDate'],
  }
}

export async function listExamInstances(
  supabase: SupabaseClient<Database>,
  ctx: AuthContext,
  academicYearId: string,
): Promise<ExamInstance[]> {
  if (!can(ctx, 'calendar.view')) throw new AppError('FORBIDDEN', 403)
  const { data, error } = await supabase.from('exam_instances').select().eq('academic_year_id', academicYearId)
  if (error) throw new AppError('CALENDAR_LIST_FAILED', 500, error.message)
  return (data ?? []).map(rowToInstance)
}

export const setExamInstanceSchema = z.object({
  examTypeKey: z.enum(['S1_REGIONAL_MODEL', 'S1_FINAL', 'S2_REGIONAL_MODEL', 'S2_FINAL', 'GRADE12_NATIONAL']),
  startDate: isoDateSchema,
  endDate: isoDateSchema,
})

/**
 * Creates or updates one exam's dates for a year. Pre-validates the two
 * hard stops (weekend, closing-holiday overlap) against the domain layer
 * BEFORE hitting the database, so the caller gets a clean AppError instead
 * of a raw trigger exception — `fn_validate_exam_placement` (Migration
 * 0005) still enforces the same rule again underneath, in case this
 * function is ever bypassed.
 */
export async function setExamInstance(
  supabase: SupabaseClient<Database>,
  ctx: AuthContext,
  academicYearId: string,
  input: z.infer<typeof setExamInstanceSchema>,
): Promise<ExamInstance> {
  if (!can(ctx, 'calendar.manage_exams')) throw new AppError('FORBIDDEN', 403)
  const { examTypeKey, startDate, endDate } = setExamInstanceSchema.parse(input)

  await assertFactNotGovernedByDependency(supabase, academicYearId, { kind: 'EXAM_START', examTypeKey })
  await assertFactNotGovernedByDependency(supabase, academicYearId, { kind: 'EXAM_END', examTypeKey })

  const { data: holidayRows, error: holidayError } = await supabase
    .from('holiday_occurrences')
    .select()
    .eq('academic_year_id', academicYearId)
  if (holidayError) throw new AppError('CALENDAR_LIST_FAILED', 500, holidayError.message)

  const holidaysByDate = indexHolidaysByDate(
    (holidayRows ?? []).map((r) => ({
      id: r.id,
      academicYearId: r.academic_year_id,
      holidayTypeKey: r.holiday_type_key,
      date: r.date as never,
      closesSchool: r.closes_school,
      source: r.source,
      confirmedByUserId: r.confirmed_by,
      confirmedAt: r.confirmed_at,
    })),
  )

  // Rejects hard-stop violations (weekend, closing holiday, holiday week,
  // start after end) with a clean AppError — and, instead of a bare "no",
  // attaches the nearest clean windows so any client can offer them.
  const [{ data: semesterRows }, { data: examRows }, { data: yearRow }] = await Promise.all([
    supabase.from('semesters').select().eq('academic_year_id', academicYearId),
    supabase.from('exam_instances').select().eq('academic_year_id', academicYearId),
    supabase.from('academic_years').select().eq('id', academicYearId).single(),
  ])
  const analysis = analyzeExamWindow(
    { examTypeKey, startDate: startDate as never, endDate: endDate as never },
    {
      holidaysByDate,
      semesters: (semesterRows ?? []).map(rowToSemester),
      academicYear: yearRow ? { startDate: yearRow.start_date as never, endDate: yearRow.end_date as never } : null,
      otherExams: (examRows ?? []).filter((r) => r.exam_type_key !== examTypeKey).map(rowToInstance),
    },
  )
  const firstProblem = analysis.problems[0]
  if (firstProblem) {
    throw new AppError(firstProblem.code, 422, firstProblem.message, {
      allIssues: analysis.problems,
      suggestions: analysis.suggestions,
      swapped: analysis.swapped,
    })
  }

  const { data, error } = await supabase
    .from('exam_instances')
    .upsert(
      { academic_year_id: academicYearId, exam_type_key: examTypeKey, start_date: startDate, end_date: endDate },
      { onConflict: 'academic_year_id,exam_type_key' },
    )
    .select()
    .single()

  if (error) {
    if (error.hint === 'CALENDAR_EXAM_ON_WEEKEND') throw new AppError('CALENDAR_EXAM_ON_WEEKEND', 422, error.message)
    if (error.hint === 'CALENDAR_EXAM_ON_CLOSING_HOLIDAY') {
      throw new AppError('CALENDAR_EXAM_ON_CLOSING_HOLIDAY', 422, error.message)
    }
    throw new AppError('CALENDAR_CREATE_FAILED', 500, error.message)
  }
  return rowToInstance(data)
}

export async function deleteExamInstance(
  supabase: SupabaseClient<Database>,
  ctx: AuthContext,
  academicYearId: string,
  examTypeKey: ExamTypeKey,
): Promise<void> {
  if (!can(ctx, 'calendar.manage_exams')) throw new AppError('FORBIDDEN', 403)
  const { error } = await supabase
    .from('exam_instances')
    .delete()
    .eq('academic_year_id', academicYearId)
    .eq('exam_type_key', examTypeKey)
  if (error) throw new AppError('CALENDAR_DELETE_FAILED', 500, error.message)
}
