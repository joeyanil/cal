import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import type { Database } from '@/types/database.types'
import { AppError } from '../errors/AppError'
import { can } from '../permissions/engine'
import type { AuthContext } from '../auth/withAuth'
import { isoDateSchema } from './validators'
import { ethiopianDate, type AcademicYear, type Semester } from '../calendar'
import { validateCalendarConfiguration } from '../calendar/validation'
import { loadConfiguration } from './calendarTimeline.service'
import { rowToSemester } from './semester.service'
import { ensureFixedHolidays } from './holiday.service'

export const createAcademicYearSchema = z.object({
  yearEc: z.number().int().min(1900).max(2500),
})
export type CreateAcademicYearInput = z.infer<typeof createAcademicYearSchema>

function rowToAcademicYear(row: Database['public']['Tables']['academic_years']['Row']): AcademicYear {
  return {
    id: row.id,
    yearEc: row.year_ec,
    name: row.name,
    startDate: row.start_date as AcademicYear['startDate'],
    endDate: row.end_date as AcademicYear['endDate'],
    isDefaultBoundary: row.is_default_boundary,
    status: row.status,
    ministryTargetDays: row.ministry_target_days ?? null,
  }
}

/**
 * Creates a new academic year with the usable default boundary — Meskerem 5
 * through Sene 30 (mission §5). The admin can replace these later; nothing
 * here waits for the "real" Ministry dates before the year becomes usable.
 *
 * Migration 0016's `fn_create_default_semesters` trigger atomically creates
 * Semester 1 and Semester 2 (UPCOMING, dates NULL) as part of this same
 * INSERT — if that trigger fails for any reason, the whole statement
 * (including the year itself) rolls back with it, so there is no code path
 * that can leave a year with zero or one semester. This function fetches
 * and returns them so a caller sees the true, complete state immediately
 * rather than having to guess they exist and fetch them separately.
 */
export async function createAcademicYear(
  supabase: SupabaseClient<Database>,
  ctx: AuthContext,
  input: CreateAcademicYearInput,
): Promise<AcademicYear & { semesters: Semester[] }> {
  if (!can(ctx, 'calendar.manage')) throw new AppError('FORBIDDEN', 403)
  const { yearEc } = createAcademicYearSchema.parse(input)

  const startDate = ethiopianDate(yearEc, 1, 5) // Meskerem 5
  const endDate = ethiopianDate(yearEc, 10, 30) // Sene 30

  const { data, error } = await supabase
    .from('academic_years')
    .insert({
      year_ec: yearEc,
      name: `${yearEc} E.C.`,
      start_date: startDate,
      end_date: endDate,
      is_default_boundary: true,
      status: 'PREPARING',
      created_by: ctx.user.id,
    })
    .select()
    .single()

  if (error) {
    if (error.code === '23505') {
      // Point at the year that is already there so the screen can open it.
      const { data: existing } = await supabase.from('academic_years').select('id').eq('year_ec', yearEc).maybeSingle()
      throw new AppError('CALENDAR_YEAR_ALREADY_EXISTS', 409, `${yearEc} E.C. already exists.`, { existingYearId: existing?.id ?? null })
    }
    throw new AppError('CALENDAR_CREATE_FAILED', 500, error.message)
  }

  const { data: semesterRows, error: semesterError } = await supabase
    .from('semesters')
    .select()
    .eq('academic_year_id', data.id)
    .order('sem_order')
  if (semesterError || !semesterRows || semesterRows.length !== 2) {
    // Should be unreachable — the trigger is what guarantees this — but
    // never silently return a year without confirming its semesters are
    // really there, exactly the class of gap this fix exists to close.
    throw new AppError('CALENDAR_CREATE_FAILED', 500, 'Year was created but its semesters could not be confirmed.')
  }
  await ensureFixedHolidays(supabase, data.id, yearEc, ctx.user.id)

  return { ...rowToAcademicYear(data), semesters: semesterRows.map(rowToSemester) }
}

export const updateAcademicYearBoundarySchema = z.object({
  startDate: isoDateSchema,
  endDate: isoDateSchema,
  /** Optional reminder total from the Ministry plan, for comparison only. */
  ministryTargetDays: z.number().int().min(1).max(366).nullable().optional(),
})

/** Replaces the default boundary with the real Ministry-plan dates
 *  (mission §5, §41 step 3). Blocked once the year is CLOSED — see the
 *  RLS policy on `academic_years`; a formal correction is the only path
 *  past that (calendarCorrection.service.ts). */
export async function updateAcademicYearBoundary(
  supabase: SupabaseClient<Database>,
  ctx: AuthContext,
  yearId: string,
  input: z.infer<typeof updateAcademicYearBoundarySchema>,
): Promise<AcademicYear> {
  if (!can(ctx, 'calendar.manage')) throw new AppError('FORBIDDEN', 403)
  const { startDate, endDate, ministryTargetDays } = updateAcademicYearBoundarySchema.parse(input)

  const { data, error } = await supabase
    .from('academic_years')
    .update({
      start_date: startDate,
      end_date: endDate,
      is_default_boundary: false,
      ...(ministryTargetDays !== undefined ? { ministry_target_days: ministryTargetDays } : {}),
    })
    .eq('id', yearId)
    .select()
    .single()

  if (error) throw new AppError('CALENDAR_UPDATE_FAILED', 500, error.message)
  if (!data) throw new AppError('CALENDAR_YEAR_CLOSED', 423, 'Year is CLOSED or you lack permission; use a formal correction instead.')
  return rowToAcademicYear(data)
}

export async function getAcademicYear(
  supabase: SupabaseClient<Database>,
  ctx: AuthContext,
  yearId: string,
): Promise<AcademicYear> {
  if (!can(ctx, 'calendar.view')) throw new AppError('FORBIDDEN', 403)
  const { data, error } = await supabase.from('academic_years').select().eq('id', yearId).single()
  if (error || !data) throw new AppError('CALENDAR_YEAR_NOT_FOUND', 404)
  return rowToAcademicYear(data)
}

export async function listAcademicYears(
  supabase: SupabaseClient<Database>,
  ctx: AuthContext,
): Promise<AcademicYear[]> {
  if (!can(ctx, 'calendar.view')) throw new AppError('FORBIDDEN', 403)
  const { data, error } = await supabase.from('academic_years').select().order('year_ec', { ascending: false })
  if (error) throw new AppError('CALENDAR_LIST_FAILED', 500, error.message)
  return (data ?? []).map(rowToAcademicYear)
}

/** Advances the year's lifecycle by exactly one legal step
 *  (PREPARING -> READY -> ACTIVE -> CLOSED). Delegates transition-validity +
 *  "exactly one ACTIVE year" enforcement to `fn_transition_academic_year_status`
 *  (Migration 0013/0016), the real atomic boundary — this function's own
 *  job is the readiness gate (fix #7): READY and ACTIVE both require the
 *  full Missing/Error/Warning/Information validation, including the real
 *  dependency graph (cycle + conflicting-incoming-rule checks — fix #12),
 *  to report zero MISSING and zero ERROR issues. WARNING and INFORMATION
 *  never block, matching validation.ts's own documented severities exactly. */
const transitionAcademicYearStatusSchema = z.object({ to: z.enum(['READY', 'ACTIVE', 'CLOSED']) })

export async function transitionAcademicYearStatus(
  supabase: SupabaseClient<Database>,
  ctx: AuthContext,
  yearId: string,
  input: unknown,
): Promise<AcademicYear> {
  if (!can(ctx, 'calendar.manage')) throw new AppError('FORBIDDEN', 403)
  const { to } = transitionAcademicYearStatusSchema.parse(input)

  if (to === 'READY' || to === 'ACTIVE') {
    const [{ config, dependencyRules, notObservedHolidays }, fullYear] = await Promise.all([
      loadConfiguration(supabase, yearId),
      getAcademicYear(supabase, ctx, yearId),
    ])
    const issues = validateCalendarConfiguration({ ...config, academicYear: fullYear, dependencyRules, notObservedHolidays })
    const blocking = issues.filter((i) => i.severity === 'ERROR' || i.severity === 'MISSING')
    if (blocking.length > 0) {
      throw new AppError(
        'CALENDAR_YEAR_NOT_READY',
        422,
        `Cannot transition to ${to}: ${blocking.length} blocking issue(s) remain (${blocking.map((b) => b.code).join(', ')}).`,
        blocking,
      )
    }
  }

  const { data, error } = await supabase.rpc('fn_transition_academic_year_status', { p_year_id: yearId, p_to: to })
  if (error) {
    if (error.code === '23505') throw new AppError('CALENDAR_SECOND_ACTIVE_YEAR', 409, error.message)
    if (error.hint === 'CALENDAR_INVALID_LIFECYCLE_TRANSITION') {
      throw new AppError('CALENDAR_INVALID_LIFECYCLE_TRANSITION', 422, error.message)
    }
    if (error.hint === 'CALENDAR_YEAR_NOT_READY') {
      // The RPC's own minimal structural backstop caught it — reachable if
      // this function is bypassed, or if a fact changed between the check
      // above and this call.
      throw new AppError('CALENDAR_YEAR_NOT_READY', 422, error.message)
    }
    throw new AppError('CALENDAR_TRANSITION_FAILED', 500, error.message)
  }
  return rowToAcademicYear(data)
}
