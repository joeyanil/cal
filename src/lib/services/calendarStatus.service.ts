import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'
import { AppError } from '../errors/AppError'
import { can } from '../permissions/engine'
import type { AuthContext } from '../auth/withAuth'
import { loadCalendarSource } from './calendarSource.service'
import { getDay, getCurrentTimeline } from './calendarTimeline.service'
import { dayStatus, calendarPosition, buildYearExportRows, collectCalendarEvents } from '../calendar'
import type { DayStatus, CalendarPosition, Grade, ISODate, YearExportRow, CalendarEvent, DailyTimelineEntry } from '../calendar'

/**
 * "Is this a school day, and is attendance available (for this grade)?"
 * The one question the Attendance part of the platform asks.
 */
export async function getDayStatus(
  supabase: SupabaseClient<Database>,
  ctx: AuthContext,
  academicYearId: string,
  date: ISODate,
  grade: Grade | null,
): Promise<DayStatus> {
  if (!can(ctx, 'calendar.view')) throw new AppError('FORBIDDEN', 403)
  const source = await loadCalendarSource(supabase, academicYearId)
  // Before any timeline is published, the weekday rule answers instead.
  let timelineDay: Awaited<ReturnType<typeof getDay>> = null
  try {
    timelineDay = await getDay(supabase, ctx, academicYearId, date)
  } catch (err) {
    if (!(err instanceof AppError) || err.code !== 'CALENDAR_NO_CURRENT_TIMELINE') throw err
  }
  return dayStatus({ date, year: source.year, timelineDay, specialDays: source.specialDays, grade })
}

/** "Where are we today, and what is coming?"
 *  `timeline` may be passed in when the caller has already asked for it. */
export async function getPosition(
  supabase: SupabaseClient<Database>,
  ctx: AuthContext,
  academicYearId: string,
  today: ISODate,
  timeline?: Promise<DailyTimelineEntry[]>,
): Promise<CalendarPosition & { teachingDaysLeftInYear: number | null }> {
  if (!can(ctx, 'calendar.view')) throw new AppError('FORBIDDEN', 403)
  // Both questions at once; a missing timeline just means no teaching-day count.
  const entriesPromise = (timeline ?? getCurrentTimeline(supabase, ctx, academicYearId)).catch(() => [] as DailyTimelineEntry[])
  const [source, entries] = await Promise.all([loadCalendarSource(supabase, academicYearId), entriesPromise])
  const position = calendarPosition(source, today)
  const teachingDaysLeftInYear =
    entries.length > 0 && position.daysLeftInYear !== null
      ? entries.filter((e) => e.date >= today && e.teachingDay).length
      : null
  return { ...position, teachingDaysLeftInYear }
}

/** Every dated item of the year, in order. */
export async function getCalendarEvents(
  supabase: SupabaseClient<Database>,
  ctx: AuthContext,
  academicYearId: string,
): Promise<CalendarEvent[]> {
  if (!can(ctx, 'calendar.view')) throw new AppError('FORBIDDEN', 403)
  return collectCalendarEvents(await loadCalendarSource(supabase, academicYearId))
}

/** The whole year as rows for the platform's PDF and Excel export. */
export async function getYearExportRows(
  supabase: SupabaseClient<Database>,
  ctx: AuthContext,
  academicYearId: string,
): Promise<YearExportRow[]> {
  if (!can(ctx, 'calendar.view')) throw new AppError('FORBIDDEN', 403)
  const entries = await getCurrentTimeline(supabase, ctx, academicYearId)
  const source = await loadCalendarSource(supabase, academicYearId)
  return buildYearExportRows(entries, source.specialDays)
}

/**
 * How many school days fall between `from` and `to` (both included), for the
 * whole school or one grade. `enrolledFrom` is for a student who joined late:
 * counting starts on that day if it is later than `from`. Special days where
 * students stay home are not counted.
 */
export async function getSchoolDaysInPeriod(
  supabase: SupabaseClient<Database>,
  ctx: AuthContext,
  academicYearId: string,
  from: ISODate,
  to: ISODate,
  grade: Grade | null = null,
  enrolledFrom: ISODate | null = null,
): Promise<{ count: number; from: ISODate; to: ISODate }> {
  if (!can(ctx, 'calendar.view')) throw new AppError('FORBIDDEN', 403)
  const start = enrolledFrom && enrolledFrom > from ? enrolledFrom : from
  const source = await loadCalendarSource(supabase, academicYearId)
  const entries = await getCurrentTimeline(supabase, ctx, academicYearId)
  let count = 0
  for (const e of entries) {
    if (e.date < start || e.date > to) continue
    if (dayStatus({ date: e.date, year: source.year, timelineDay: e, specialDays: source.specialDays, grade }).attendanceAvailable) count++
  }
  return { count, from: start, to }
}
