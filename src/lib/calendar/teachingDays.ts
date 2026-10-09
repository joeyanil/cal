/**
 * teachingDays.ts — mission section 22, Deep Domain File 3 §O.
 *
 * The teaching-day calculation is always a derived read over the full-year
 * timeline (section 23: "isSchoolDay()... getSchoolDaysInPeriod()... must
 * read it") — never a second, independent calculation. Every function here
 * takes a slice of `DailyTimelineEntry[]` and reduces it; none of them
 * re-derive holidays/exams/breaks from scratch.
 */
import { isSameOrAfter, isSameOrBefore } from './date-utils'
import type { ISODate } from './date-utils'
import type { DailyTimelineEntry } from './types'

/** Slices the full-year timeline down to an arbitrary inclusive date range.
 *  Works identically for a whole year, a semester, a month, or any other
 *  range (mission section 22: "must work identically for... whole academic
 *  year, semester, month, arbitrary date range, elapsed portion of a
 *  semester"). */
export function sliceRange(
  entries: DailyTimelineEntry[],
  start: ISODate,
  end: ISODate,
): DailyTimelineEntry[] {
  return entries.filter((e) => isSameOrAfter(e.date, start) && isSameOrBefore(e.date, end))
}

/** Whole-school teaching-day count over a range — a single read of the
 *  `teachingDay` flag already computed per-date by the timeline builder. */
export function countTeachingDays(entries: DailyTimelineEntry[]): number {
  return entries.filter((e) => e.teachingDay).length
}

/** Whole-school or Grade-12-scoped attendance-availability count. For
 *  `'GRADE_12'`, this additionally excludes whatever dates the timeline
 *  marks as Grade-12-attendance-suppressed (mission section 22's closing
 *  note on how a genuinely Grade-12-specific count is still built from this
 *  same calculation, just reading the narrower field) — it is NOT a
 *  separately invented Grade-12 teaching-day formula. */
export function countAvailableDays(
  entries: DailyTimelineEntry[],
  scope: 'ALL' | 'GRADE_12' = 'ALL',
): number {
  return entries.filter((e) => (scope === 'GRADE_12' ? e.grade12AttendanceAvailable : e.attendanceAvailable))
    .length
}

export interface TeachingDayBreakdown {
  totalCalendarDays: number
  weekendDays: number
  holidayLostDays: number
  examLostDays: number
  breakLostDays: number
  studentReturnLostDays: number
  /** Last day of the year: no lessons, no attendance. */
  yearEndLostDays: number
  teachingDays: number
  /** Ministry-style count: teaching days PLUS exam days and the student-return
   *  day. Those days are still non-learning days with no attendance; they are
   *  counted here only so K2's total can be compared with the Ministry's 210. */
  ministryBasisDays: number
}

/**
 * A reason-by-reason breakdown of a range, for the admin UI (mission item
 * "inspect teaching-day calculations"). Each lost day is attributed to
 * exactly one bucket using a fixed precedence — weekend, then closing
 * holiday, then semester break, then Student Return, then closing exam —
 * mirroring the same precedence the timeline builder itself applies, so a
 * day is never double-counted across buckets even when more than one
 * reason genuinely applies to it (mission section 22).
 */
export function teachingDayBreakdown(entries: DailyTimelineEntry[]): TeachingDayBreakdown {
  const breakdown: TeachingDayBreakdown = {
    totalCalendarDays: entries.length,
    weekendDays: 0,
    holidayLostDays: 0,
    examLostDays: 0,
    breakLostDays: 0,
    studentReturnLostDays: 0,
    yearEndLostDays: 0,
    teachingDays: 0,
    ministryBasisDays: 0,
  }

  for (const entry of entries) {
    if (entry.teachingDay) {
      breakdown.teachingDays++
      continue
    }
    // Not a teaching day — attribute to exactly one bucket, in the same
    // precedence order describeDate() applies its own flags in.
    if (entry.isWeekend) {
      breakdown.weekendDays++
    } else if (entry.holidayClosure) {
      breakdown.holidayLostDays++
    } else if (entry.isSemesterBreak) {
      breakdown.breakLostDays++
    } else if (entry.reasons.includes('YEAR_END')) {
      breakdown.yearEndLostDays++
    } else if (entry.isStudentReturn) {
      breakdown.studentReturnLostDays++
    } else if (entry.exams.some((e) => e.closesSchool)) {
      breakdown.examLostDays++
    }
    // Any other non-teaching day (should not occur given the rules above)
    // is simply absent from every bucket rather than silently miscounted
    // into one — the buckets are intentionally allowed not to sum to
    // totalCalendarDays - teachingDays if a future rule adds a reason this
    // function doesn't yet know about; that gap is visible, not hidden.
  }

  breakdown.ministryBasisDays =
    breakdown.teachingDays + breakdown.examLostDays + breakdown.studentReturnLostDays
  return breakdown
}
