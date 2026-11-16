import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'
import { loadConfiguration } from './calendarTimeline.service'
import { fetchSpecialDays } from './specialDay.service'
import type { CalendarSource } from '../calendar'

/** All the year's dates in one place, ready for events, countdowns and
 *  reminders. No permission check: callers check their own. */
export async function loadCalendarSource(
  supabase: SupabaseClient<Database>,
  academicYearId: string,
): Promise<CalendarSource> {
  const { config } = await loadConfiguration(supabase, academicYearId)
  const specialDays = await fetchSpecialDays(supabase, academicYearId)
  return {
    year: { id: config.academicYear.id, startDate: config.academicYear.startDate, endDate: config.academicYear.endDate },
    semesters: config.semesters,
    holidays: config.holidayOccurrences,
    exams: config.examInstances,
    studentReturn: config.studentReturn?.date ?? null,
    specialDays,
  }
}
