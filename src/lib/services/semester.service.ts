import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import type { Database } from '@/types/database.types'
import { AppError } from '../errors/AppError'
import { can } from '../permissions/engine'
import type { AuthContext } from '../auth/withAuth'
import { isoDateSchema } from './validators'
import type { Semester, SemesterOrder } from '../calendar'
import { assertFactNotGovernedByDependency } from './calendarDependency.service'

export function rowToSemester(row: Database['public']['Tables']['semesters']['Row']): Semester {
  return {
    id: row.id,
    academicYearId: row.academic_year_id,
    order: row.sem_order,
    startDate: row.start_date as Semester['startDate'],
    endDate: row.end_date as Semester['endDate'],
    status: row.status,
  }
}

export const setSemesterDatesSchema = z.object({
  startDate: isoDateSchema.nullable(),
  endDate: isoDateSchema.nullable(),
})

export async function listSemesters(
  supabase: SupabaseClient<Database>,
  ctx: AuthContext,
  academicYearId: string,
): Promise<Semester[]> {
  if (!can(ctx, 'calendar.view')) throw new AppError('FORBIDDEN', 403)
  const { data, error } = await supabase
    .from('semesters')
    .select()
    .eq('academic_year_id', academicYearId)
    .order('sem_order')
  if (error) throw new AppError('CALENDAR_LIST_FAILED', 500, error.message)
  return (data ?? []).map(rowToSemester)
}

/** Sets a semester's boundary. The two semesters remain independent facts
 *  (mission §6) — this never touches the other semester or recomputes the
 *  break; that happens purely at read time via semesterBreak.ts. */
export async function setSemesterDates(
  supabase: SupabaseClient<Database>,
  ctx: AuthContext,
  academicYearId: string,
  order: SemesterOrder,
  input: z.infer<typeof setSemesterDatesSchema>,
): Promise<Semester> {
  if (!can(ctx, 'calendar.manage')) throw new AppError('FORBIDDEN', 403)
  const { startDate, endDate } = setSemesterDatesSchema.parse(input)
  if (startDate && endDate && startDate > endDate) {
    throw new AppError('CALENDAR_DATE_RANGE_INVALID', 422, `Semester ${order} cannot end before it starts.`)
  }

  await assertFactNotGovernedByDependency(supabase, academicYearId, { kind: 'SEMESTER_START', order })
  await assertFactNotGovernedByDependency(supabase, academicYearId, { kind: 'SEMESTER_END', order })

  const { data, error } = await supabase
    .from('semesters')
    .update({ start_date: startDate, end_date: endDate })
    .eq('academic_year_id', academicYearId)
    .eq('sem_order', order)
    .select()
    .single()

  if (error) {
    if (error.hint === 'CALENDAR_SEMESTERS_OVERLAP') throw new AppError('CALENDAR_SEMESTERS_OVERLAP', 422, error.message)
    throw new AppError('CALENDAR_UPDATE_FAILED', 500, error.message)
  }
  if (!data) throw new AppError('CALENDAR_SEMESTER_CLOSED', 423, 'Semester is CLOSED; use a formal correction instead.')
  return rowToSemester(data)
}

const transitionSemesterStatusSchema = z.object({ to: z.enum(['ACTIVE', 'CLOSED']) })

export async function transitionSemesterStatus(
  supabase: SupabaseClient<Database>,
  ctx: AuthContext,
  semesterId: string,
  input: unknown,
): Promise<Semester> {
  if (!can(ctx, 'calendar.manage')) throw new AppError('FORBIDDEN', 403)
  const { to } = transitionSemesterStatusSchema.parse(input)
  const { data, error } = await supabase.rpc('fn_transition_semester_status', {
    p_semester_id: semesterId,
    p_to: to,
  })
  if (error) {
    if (error.hint === 'CALENDAR_INVALID_LIFECYCLE_TRANSITION') {
      throw new AppError('CALENDAR_INVALID_LIFECYCLE_TRANSITION', 422, error.message)
    }
    if (error.hint === 'CALENDAR_YEAR_NOT_READY') {
      throw new AppError('CALENDAR_YEAR_NOT_READY', 422, error.message)
    }
    throw new AppError('CALENDAR_TRANSITION_FAILED', 500, error.message)
  }
  // No unlockSemester() exists anywhere in this codebase — mission §36,
  // Deep Domain File 2 §F. CLOSED is a one-way door.
  return rowToSemester(data)
}
