import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import type { Database } from '@/types/database.types'
import { AppError } from '../errors/AppError'
import { can } from '../permissions/engine'
import type { AuthContext } from '../auth/withAuth'
import { isoDateSchema } from './validators'
import {
  createHolidayOccurrence,
  isFixedHoliday,
  proposeFixedHolidayOccurrences,
  type HolidayOccurrence,
  type HolidayTypeKey,
} from '../calendar'
import { assertFactNotGovernedByDependency } from './calendarDependency.service'

function rowToOccurrence(row: Database['public']['Tables']['holiday_occurrences']['Row']): HolidayOccurrence {
  return {
    id: row.id,
    academicYearId: row.academic_year_id,
    holidayTypeKey: row.holiday_type_key,
    date: row.date as HolidayOccurrence['date'],
    closesSchool: row.closes_school,
    source: row.source,
    confirmedByUserId: row.confirmed_by,
    confirmedAt: row.confirmed_at,
  }
}

export async function listHolidayOccurrences(
  supabase: SupabaseClient<Database>,
  ctx: AuthContext,
  academicYearId: string,
): Promise<HolidayOccurrence[]> {
  if (!can(ctx, 'calendar.view')) throw new AppError('FORBIDDEN', 403)
  const { data, error } = await supabase
    .from('holiday_occurrences')
    .select()
    .eq('academic_year_id', academicYearId)
  if (error) throw new AppError('CALENDAR_LIST_FAILED', 500, error.message)
  return (data ?? []).filter((r) => r.date !== null).map(rowToOccurrence)
}

/** Dated holidays plus the movable ones this school has switched off (a row
 *  with no date and closes_school = false: it teaches that day, so there is
 *  nothing to enter). */
export async function listHolidayState(
  supabase: SupabaseClient<Database>,
  ctx: AuthContext,
  academicYearId: string,
): Promise<{ occurrences: HolidayOccurrence[]; notObserved: HolidayTypeKey[] }> {
  if (!can(ctx, 'calendar.view')) throw new AppError('FORBIDDEN', 403)
  const { data, error } = await supabase.from('holiday_occurrences').select().eq('academic_year_id', academicYearId)
  if (error) throw new AppError('CALENDAR_LIST_FAILED', 500, error.message)
  const rows = data ?? []
  return {
    occurrences: rows.filter((r) => r.date !== null).map(rowToOccurrence),
    notObserved: rows.filter((r) => r.date === null).map((r) => r.holiday_type_key as HolidayTypeKey),
  }
}

/** Seeds the five fixed holidays' auto-proposed occurrences for a new year
 *  (mission §8). Called once, typically right after `createAcademicYear`;
 *  safe to call again — `ON CONFLICT DO NOTHING`-style upsert on the unique
 *  (academic_year_id, holiday_type_key) constraint via .upsert(). */
export async function seedFixedHolidays(
  supabase: SupabaseClient<Database>,
  ctx: AuthContext,
  academicYearId: string,
  yearEc: number,
): Promise<HolidayOccurrence[]> {
  if (!can(ctx, 'calendar.manage_holidays')) throw new AppError('FORBIDDEN', 403)

  const proposals = proposeFixedHolidayOccurrences(academicYearId, yearEc)
  const { data, error } = await supabase
    .from('holiday_occurrences')
    .upsert(
      proposals.map((p) => ({
        academic_year_id: p.academicYearId,
        holiday_type_key: p.holidayTypeKey,
        date: p.date,
        closes_school: p.closesSchool,
        source: p.source,
        // Permanent holidays need no admin sign-off: they count from the start.
        confirmed_at: new Date().toISOString(),
        confirmed_by: ctx.user.id,
      })),
      { onConflict: 'academic_year_id,holiday_type_key', ignoreDuplicates: true },
    )
    .select()

  if (error) throw new AppError('CALENDAR_CREATE_FAILED', 500, error.message)
  return (data ?? []).map(rowToOccurrence)
}

/**
 * Makes sure the five permanent holidays are part of the year, with no admin
 * action. Safe to call on every page load and before every calculation: it
 * only inserts what is missing, marks them confirmed (a permanent date needs
 * no sign-off), and never throws — if the caller lacks permission or the
 * year is closed, the calculation simply uses what is already there.
 */
export async function ensureFixedHolidays(
  supabase: SupabaseClient<Database>,
  academicYearId: string,
  yearEc: number,
  userId: string | null,
): Promise<void> {
  const now = new Date().toISOString()
  // One holiday at a time: if the database does not know a newer holiday yet
  // (its migration has not been run), that one is skipped and the rest still
  // go in.
  for (const p of proposeFixedHolidayOccurrences(academicYearId, yearEc)) {
    try {
      await supabase.from('holiday_occurrences').upsert(
        {
          academic_year_id: p.academicYearId,
          holiday_type_key: p.holidayTypeKey,
          date: p.date,
          closes_school: p.closesSchool,
          source: p.source,
          confirmed_at: now,
          confirmed_by: userId,
        },
        { onConflict: 'academic_year_id,holiday_type_key', ignoreDuplicates: true },
      )
    } catch {
      // Best effort by design.
    }
  }
  try {
    // Older rows that were proposed but never clicked "Confirm".
    await supabase
      .from('holiday_occurrences')
      .update({ confirmed_at: now, confirmed_by: userId })
      .eq('academic_year_id', academicYearId)
      .eq('source', 'AUTO_PROPOSED')
      .is('confirmed_at', null)
  } catch {
    // Best effort by design.
  }
}

export const confirmFixedHolidaySchema = z.object({
  /** Optional — an admin can adjust closure state as part of confirming,
   *  or just confirm the proposed default (`closesSchool: true`) as-is. */
  closesSchool: z.boolean().optional(),
})

/**
 * Fix #17: the actual confirmation half of "fixed date -> automatically
 * proposed -> admin confirmation" (mission §8). `confirmedByUserId`/
 * `confirmedAt` existed on the type from the start, but nothing ever set
 * them for a fixed holiday — `seedFixedHolidays` above only ever inserts
 * with both null, forever, since there was no confirm path at all.
 *
 * Deliberately rejects being called on a movable holiday: those already
 * get a real confirmation the moment they're entered
 * (`enterMovableHoliday` sets confirmedByUserId/confirmedAt at entry time,
 * since manual entry by an admin already *is* the confirmation for that
 * type) — this function exists specifically for the fixed-holiday
 * propose/confirm split, not as a second, redundant path for movable ones.
 */
export async function confirmFixedHoliday(
  supabase: SupabaseClient<Database>,
  ctx: AuthContext,
  academicYearId: string,
  holidayTypeKey: HolidayTypeKey,
  input: z.infer<typeof confirmFixedHolidaySchema>,
): Promise<HolidayOccurrence> {
  if (!can(ctx, 'calendar.manage_holidays')) throw new AppError('FORBIDDEN', 403)
  if (!isFixedHoliday(holidayTypeKey)) {
    throw new AppError(
      'CALENDAR_HOLIDAY_NOT_FIXED',
      422,
      `${holidayTypeKey} is not a fixed holiday — movable holidays are confirmed by entering their date, not through this endpoint.`,
    )
  }
  const { closesSchool } = confirmFixedHolidaySchema.parse(input)

  const update: Database['public']['Tables']['holiday_occurrences']['Update'] = {
    confirmed_by: ctx.user.id,
    confirmed_at: new Date().toISOString(),
  }
  if (closesSchool !== undefined) update.closes_school = closesSchool

  const { data, error } = await supabase
    .from('holiday_occurrences')
    .update(update)
    .eq('academic_year_id', academicYearId)
    .eq('holiday_type_key', holidayTypeKey)
    .select()
    .single()

  if (error) throw new AppError('CALENDAR_UPDATE_FAILED', 500, error.message)
  if (!data) {
    throw new AppError(
      'CALENDAR_HOLIDAY_NOT_PROPOSED',
      404,
      `${holidayTypeKey} has not been proposed for this year yet — call seedFixedHolidays first.`,
    )
  }
  return rowToOccurrence(data)
}

export const enterMovableHolidaySchema = z
  .object({
    holidayTypeKey: z.enum(['SIKLET', 'FASIKA', 'EID_FITR', 'EID_ADHA']),
    /** Required when the school closes. Left out when the school teaches on
     *  this holiday — there is then no date to enter. */
    date: isoDateSchema.nullable().optional(),
    closesSchool: z.boolean().default(true),
  })
  .refine((v) => !v.closesSchool || !!v.date, { message: 'A date is required when the school closes for this holiday.', path: ['date'] })

/** The only way a movable holiday's date ever enters the system — an admin
 *  typing in the confirmed Ministry-plan date (mission §8). There is no
 *  calculate-it-for-me branch here to accidentally take; the domain layer's
 *  `createHolidayOccurrence` enforces the same rule again beneath this. */
export async function enterMovableHoliday(
  supabase: SupabaseClient<Database>,
  ctx: AuthContext,
  academicYearId: string,
  input: z.infer<typeof enterMovableHolidaySchema>,
  ethiopianYearForValidation: number,
): Promise<HolidayOccurrence> {
  if (!can(ctx, 'calendar.manage_holidays')) throw new AppError('FORBIDDEN', 403)
  const { holidayTypeKey, date, closesSchool } = enterMovableHolidaySchema.parse(input)

  await assertFactNotGovernedByDependency(supabase, academicYearId, { kind: 'HOLIDAY_OCCURRENCE', holidayTypeKey })

  // Runs the same domain-layer validation the DB trigger will also enforce
  // — fail fast with a clean AppError rather than a raw Postgres error.
  if (date) {
    createHolidayOccurrence({ academicYearId, holidayTypeKey, ethiopianYear: ethiopianYearForValidation, manualDate: date as never, closesSchool })
  }

  const { data, error } = await supabase
    .from('holiday_occurrences')
    .upsert(
      { academic_year_id: academicYearId, holiday_type_key: holidayTypeKey, date: date ?? null, closes_school: closesSchool, source: 'ADMIN_ENTERED', confirmed_by: ctx.user.id, confirmed_at: new Date().toISOString() },
      { onConflict: 'academic_year_id,holiday_type_key' },
    )
    .select()
    .single()

  if (error) throw new AppError('CALENDAR_CREATE_FAILED', 500, error.message)
  return rowToOccurrence(data)
}

export const toggleHolidayClosureSchema = z.object({ closesSchool: z.boolean() })

/** Toggles whether a holiday actually closes the school this year — the
 *  identity/date and the closure state are independently editable facts
 *  (mission §8). */
export async function toggleHolidayClosure(
  supabase: SupabaseClient<Database>,
  ctx: AuthContext,
  academicYearId: string,
  holidayTypeKey: HolidayTypeKey,
  input: z.infer<typeof toggleHolidayClosureSchema>,
): Promise<HolidayOccurrence> {
  if (!can(ctx, 'calendar.manage_holidays')) throw new AppError('FORBIDDEN', 403)
  const { closesSchool } = toggleHolidayClosureSchema.parse(input)

  const { data, error } = await supabase
    .from('holiday_occurrences')
    .update({ closes_school: closesSchool })
    .eq('academic_year_id', academicYearId)
    .eq('holiday_type_key', holidayTypeKey)
    .select()
    .single()

  if (error) throw new AppError('CALENDAR_UPDATE_FAILED', 500, error.message)
  if (!data) throw new AppError('CALENDAR_YEAR_CLOSED', 423, 'Year is CLOSED; use a formal correction instead.')
  return rowToOccurrence(data)
}
