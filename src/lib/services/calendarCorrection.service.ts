import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import type { Database } from '@/types/database.types'
import { AppError } from '../errors/AppError'
import { can } from '../permissions/engine'
import type { AuthContext } from '../auth/withAuth'
import { isoDateSchema } from './validators'

export const applyCorrectionSchema = z.object({
  factKind: z.enum([
    'ACADEMIC_YEAR_START',
    'ACADEMIC_YEAR_END',
    'SEMESTER_START',
    'SEMESTER_END',
    'HOLIDAY_OCCURRENCE',
    'EXAM_START',
    'EXAM_END',
    'STUDENT_RETURN',
  ]),
  factSemesterOrder: z.union([z.literal(1), z.literal(2)]).nullable().default(null),
  factHolidayTypeKey: z.string().nullable().default(null),
  factExamTypeKey: z.string().nullable().default(null),
  correctedValue: isoDateSchema,
})

/**
 * The ONLY path that can change a date belonging to a CLOSED year or half of
 * the year. Requires `calendar.correct_history`, which is meant to be given
 * to the main admin role only. By the owner's decision the date is simply
 * updated: no reason is asked for and no correction record is kept.
 *
 * Deliberately does NOT rebuild the timeline itself - call
 * `rebuildAndPublishTimeline` afterward so the new date reaches the calendar.
 * Returns the new date.
 */
export async function applyCalendarCorrection(
  supabase: SupabaseClient<Database>,
  ctx: AuthContext,
  academicYearId: string,
  input: z.input<typeof applyCorrectionSchema>,
) {
  if (!can(ctx, 'calendar.correct_history')) throw new AppError('FORBIDDEN', 403)
  const parsed = applyCorrectionSchema.parse(input)

  const { data, error } = await supabase.rpc('fn_apply_calendar_correction', {
    p_academic_year_id: academicYearId,
    p_fact_kind: parsed.factKind,
    p_fact_semester_order: parsed.factSemesterOrder,
    p_fact_holiday_type_key: parsed.factHolidayTypeKey as never,
    p_fact_exam_type_key: parsed.factExamTypeKey as never,
    p_corrected_value: parsed.correctedValue,
  })

  if (error) {
    if (error.hint === 'CALENDAR_CORRECTION_REQUIRES_CLOSED_SCOPE') {
      throw new AppError('CALENDAR_CORRECTION_REQUIRES_CLOSED_SCOPE', 422, error.message)
    }
    throw new AppError('CALENDAR_CORRECTION_FAILED', 500, error.message)
  }
  return { correctedValue: data }
}
