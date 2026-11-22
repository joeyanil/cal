import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import type { Database } from '@/types/database.types'
import { AppError } from '../errors/AppError'
import { can } from '../permissions/engine'
import type { AuthContext } from '../auth/withAuth'
import { isoDateSchema } from './validators'
import {
  GRADES, SPECIAL_DAY_SITUATIONS, TEACHER_AUDIENCES, defaultTeacherAudience, validateSpecialDay,
} from '../calendar'
import type { Grade, SpecialDay, SpecialDaySituation, ISODate } from '../calendar'

type Row = Database['public']['Tables']['special_days']['Row']

export function rowToSpecialDay(r: Row): SpecialDay {
  return {
    id: r.id,
    academicYearId: r.academic_year_id,
    situation: r.situation as SpecialDaySituation,
    name: r.name,
    startDate: r.start_date as ISODate,
    endDate: r.end_date as ISODate,
    studentsCome: r.students_come,
    grades: r.grades === null ? null : ([...r.grades].sort((a, b) => a - b) as Grade[]),
    customMessage: r.custom_message && r.custom_message.trim() !== '' ? r.custom_message : null,
    teacherAudience: r.teacher_audience,
  }
}

export const specialDaySchema = z.object({
  situation: z.enum(SPECIAL_DAY_SITUATIONS),
  name: z.string(),
  startDate: isoDateSchema,
  /** Leave out for a one-day event. */
  endDate: isoDateSchema.optional(),
  /** Required on purpose: the admin must say whether students come. */
  studentsCome: z.boolean(),
  /** null or missing = the whole school. */
  grades: z.array(z.number().int()).nullable().optional(),
  customMessage: z.string().nullable().optional(),
  teacherAudience: z.enum(TEACHER_AUDIENCES).optional(),
})
export type SpecialDayInput = z.input<typeof specialDaySchema>

export async function listSpecialDays(
  supabase: SupabaseClient<Database>,
  ctx: AuthContext,
  academicYearId: string,
): Promise<SpecialDay[]> {
  if (!can(ctx, 'calendar.view')) throw new AppError('FORBIDDEN', 403)
  // Both questions at once (a year that does not exist is a 404, not an empty list).
  const [, days] = await Promise.all([yearBounds(supabase, academicYearId), fetchSpecialDays(supabase, academicYearId)])
  return days
}

/** No permission check: for services that already checked one. */
export async function fetchSpecialDays(
  supabase: SupabaseClient<Database>,
  academicYearId: string,
): Promise<SpecialDay[]> {
  const { data, error } = await supabase
    .from('special_days')
    .select()
    .eq('academic_year_id', academicYearId)
    .order('start_date')
  if (error) throw new AppError('CALENDAR_LIST_FAILED', 500, error.message)
  return (data ?? []).map(rowToSpecialDay)
}

async function yearBounds(supabase: SupabaseClient<Database>, academicYearId: string) {
  const { data, error } = await supabase
    .from('academic_years')
    .select('start_date, end_date, status')
    .eq('id', academicYearId)
    .single()
  if (error || !data) throw new AppError('CALENDAR_YEAR_NOT_FOUND', 404)
  return { startDate: data.start_date as ISODate, endDate: data.end_date as ISODate, status: data.status }
}

function toDraftAndCheck(input: z.output<typeof specialDaySchema>, year: { startDate: ISODate; endDate: ISODate }) {
  const draft = {
    situation: input.situation,
    name: input.name,
    startDate: input.startDate as ISODate,
    endDate: (input.endDate ?? input.startDate) as ISODate,
    studentsCome: input.studentsCome,
    grades: input.grades ?? null,
    customMessage: input.customMessage ?? null,
  }
  const issues = validateSpecialDay(draft, year)
  const errors = issues.filter((i) => i.severity === 'ERROR')
  if (errors.length > 0) {
    throw new AppError('CALENDAR_SPECIAL_DAY_INVALID', 422, errors.map((e) => e.message).join(' '), { issues })
  }
  // The whole school is stored as null, even if all four grades were ticked.
  const gradeSet = draft.grades === null ? null : [...new Set(draft.grades)].sort((a, b) => a - b)
  const grades = gradeSet && GRADES.every((g) => gradeSet.includes(g)) ? null : gradeSet
  return { draft, grades, warnings: issues.filter((i) => i.severity !== 'ERROR') }
}

export async function createSpecialDay(
  supabase: SupabaseClient<Database>,
  ctx: AuthContext,
  academicYearId: string,
  input: SpecialDayInput,
): Promise<{ specialDay: SpecialDay; warnings: ReturnType<typeof validateSpecialDay> }> {
  if (!can(ctx, 'calendar.manage')) throw new AppError('FORBIDDEN', 403)
  const parsed = specialDaySchema.parse(input)
  const year = await yearBounds(supabase, academicYearId)
  if (year.status === 'CLOSED') throw new AppError('CALENDAR_YEAR_CLOSED', 423)
  const { draft, grades, warnings } = toDraftAndCheck(parsed, year)

  const { data, error } = await supabase
    .from('special_days')
    .insert({
      academic_year_id: academicYearId,
      situation: draft.situation,
      name: draft.name.trim(),
      start_date: draft.startDate,
      end_date: draft.endDate,
      students_come: draft.studentsCome,
      grades,
      custom_message: draft.customMessage?.trim() ? draft.customMessage.trim() : null,
      teacher_audience: parsed.teacherAudience ?? defaultTeacherAudience(draft.situation),
    })
    .select()
    .single()
  if (error) throw new AppError('CALENDAR_CREATE_FAILED', 500, error.message)
  return { specialDay: rowToSpecialDay(data), warnings }
}

export async function updateSpecialDay(
  supabase: SupabaseClient<Database>,
  ctx: AuthContext,
  academicYearId: string,
  specialDayId: string,
  input: SpecialDayInput,
): Promise<{ specialDay: SpecialDay; warnings: ReturnType<typeof validateSpecialDay> }> {
  if (!can(ctx, 'calendar.manage')) throw new AppError('FORBIDDEN', 403)
  const parsed = specialDaySchema.parse(input)
  const year = await yearBounds(supabase, academicYearId)
  if (year.status === 'CLOSED') throw new AppError('CALENDAR_YEAR_CLOSED', 423)
  const { draft, grades, warnings } = toDraftAndCheck(parsed, year)

  const { data, error } = await supabase
    .from('special_days')
    .update({
      situation: draft.situation,
      name: draft.name.trim(),
      start_date: draft.startDate,
      end_date: draft.endDate,
      students_come: draft.studentsCome,
      grades,
      custom_message: draft.customMessage?.trim() ? draft.customMessage.trim() : null,
      teacher_audience: parsed.teacherAudience ?? defaultTeacherAudience(draft.situation),
    })
    .eq('id', specialDayId)
    .eq('academic_year_id', academicYearId)
    .select()
    .maybeSingle()
  if (error) throw new AppError('CALENDAR_UPDATE_FAILED', 500, error.message)
  if (!data) throw new AppError('CALENDAR_SPECIAL_DAY_NOT_FOUND', 404)
  return { specialDay: rowToSpecialDay(data), warnings }
}

export async function deleteSpecialDay(
  supabase: SupabaseClient<Database>,
  ctx: AuthContext,
  academicYearId: string,
  specialDayId: string,
): Promise<void> {
  if (!can(ctx, 'calendar.manage')) throw new AppError('FORBIDDEN', 403)
  const year = await yearBounds(supabase, academicYearId)
  if (year.status === 'CLOSED') throw new AppError('CALENDAR_YEAR_CLOSED', 423)
  const { data, error } = await supabase
    .from('special_days')
    .delete()
    .eq('id', specialDayId)
    .eq('academic_year_id', academicYearId)
    .select('id')
  if (error) throw new AppError('CALENDAR_DELETE_FAILED', 500, error.message)
  if (!data || data.length === 0) throw new AppError('CALENDAR_SPECIAL_DAY_NOT_FOUND', 404)
}
