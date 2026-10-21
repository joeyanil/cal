/**
 * Everything the full-year screen shows, computed in one place so the colours,
 * the totals and the explanations can never disagree with each other.
 *
 * Every calendar day gets exactly ONE kind (the cell colour). The kinds add
 * up to the total number of calendar days, so "297 = 180 + 117" is always
 * literally true, and the 117 is broken down into named parts.
 *
 * Two things are overlays rather than kinds, because they do not change what
 * the day is: a holiday that falls on a weekend (no school day is lost) and
 * the Grade 12 national exam (K2 stays open and teaching).
 */
import { isWeekend, type ISODate } from './date-utils'
import { HOLIDAY_TYPES } from './holidays'
import { FIXED_HOLIDAY_KEYS, MOVABLE_HOLIDAY_KEYS } from './types'
import type { DailyTimelineEntry, HolidayOccurrence, HolidayTypeKey } from './types'

export const DAY_KINDS = ['LEARNING', 'EXAM_CLOSED', 'HOLIDAY', 'BREAK', 'RETURN', 'YEAR_END', 'WEEKEND'] as const
export type DayKind = (typeof DAY_KINDS)[number] | 'OTHER'

export type Overlay = 'G12' | 'HOLIDAY_ON_WEEKEND'

export function classifyDay(e: DailyTimelineEntry): DayKind {
  if (e.exams.some((x) => x.closesSchool)) return 'EXAM_CLOSED'
  if (e.isWeekend) return 'WEEKEND'
  if (e.holidayClosure) return 'HOLIDAY'
  if (e.isSemesterBreak) return 'BREAK'
  if (e.reasons.includes('YEAR_END')) return 'YEAR_END'
  if (e.isStudentReturn) return 'RETURN'
  if (e.teachingDay) return 'LEARNING'
  return 'OTHER'
}

export function overlayOf(e: DailyTimelineEntry): Overlay | null {
  if (e.exams.some((x) => !x.closesSchool)) return 'G12'
  if (e.isWeekend && e.holidayClosure) return 'HOLIDAY_ON_WEEKEND'
  return null
}

export interface YearSummary {
  totalDays: number
  counts: Record<DayKind, number>
  learningDays: number
  /** Everything that is not a learning day: totalDays - learningDays. */
  noLessonDays: number
  /** Exam days + student-return day are counted by the Ministry as working
   *  days even though no lessons or attendance happen. */
  ministryBasisDays: number
  g12Days: number
  weekendHolidayDays: number
  holidays: { name: string; date: string; onWeekend: boolean }[]
  learningBySemester: { 1: number; 2: number }
  learningByMonth: Record<number, number>
}

export function summarizeYear(entries: DailyTimelineEntry[]): YearSummary {
  const counts: Record<DayKind, number> = {
    LEARNING: 0, EXAM_CLOSED: 0, HOLIDAY: 0, BREAK: 0, RETURN: 0, YEAR_END: 0, WEEKEND: 0, OTHER: 0,
  }
  const learningBySemester = { 1: 0, 2: 0 }
  const learningByMonth: Record<number, number> = {}
  const holidays: YearSummary['holidays'] = []
  let g12Days = 0
  let weekendHolidayDays = 0

  for (const e of entries) {
    const kind = classifyDay(e)
    counts[kind]++
    if (kind === 'LEARNING') {
      learningByMonth[e.ethiopian.month] = (learningByMonth[e.ethiopian.month] ?? 0) + 1
      if (e.semesterOrder) learningBySemester[e.semesterOrder]++
    }
    const overlay = overlayOf(e)
    if (overlay === 'G12') g12Days++
    if (overlay === 'HOLIDAY_ON_WEEKEND') weekendHolidayDays++
    for (const h of e.holidays) {
      if (h.closesSchool) holidays.push({ name: h.name, date: e.date, onWeekend: e.isWeekend })
    }
  }

  return {
    totalDays: entries.length,
    counts,
    learningDays: counts.LEARNING,
    noLessonDays: entries.length - counts.LEARNING,
    ministryBasisDays: counts.LEARNING + counts.EXAM_CLOSED + counts.RETURN,
    g12Days,
    weekendHolidayDays,
    holidays,
    learningBySemester,
    learningByMonth,
  }
}

// ---------------------------------------------------------------------------
// Holidays: every one the school has, and what it actually did to the year.
// ---------------------------------------------------------------------------

/**
 * What a holiday's date does to the school year, worked out from the date
 * itself — never from the holiday's name or a particular year. Holidays move
 * across the week from year to year (Genna is a Thursday one year and a
 * Saturday another), and the school year's own first and last day decide
 * whether a date is inside it at all.
 */
export type HolidayImpact = 'SCHOOL_DAY' | 'WEEKEND' | 'BEFORE_YEAR' | 'AFTER_YEAR'

export function holidayImpact(date: ISODate | string, yearStart: ISODate | string, yearEnd: ISODate | string): HolidayImpact {
  if (date < yearStart) return 'BEFORE_YEAR'
  if (date > yearEnd) return 'AFTER_YEAR'
  return isWeekend(date as ISODate) ? 'WEEKEND' : 'SCHOOL_DAY'
}

export type HolidayStatus = 'COUNTED' | 'WEEKEND' | 'OUTSIDE_YEAR' | 'NOT_OBSERVED' | 'NOT_ENTERED'

export interface HolidayRow {
  key: HolidayTypeKey
  name: string
  date: ISODate | null
  status: HolidayStatus
  /** One plain sentence saying what this holiday did (or did not do). */
  note: string
}

export function buildHolidayList(args: {
  occurrences: HolidayOccurrence[]
  notObserved: HolidayTypeKey[]
  yearStart: ISODate
  yearEnd: ISODate
}): HolidayRow[] {
  const rows: HolidayRow[] = []
  for (const key of [...FIXED_HOLIDAY_KEYS, ...MOVABLE_HOLIDAY_KEYS]) {
    const name = HOLIDAY_TYPES[key].name
    const occ = args.occurrences.find((h) => h.holidayTypeKey === key)
    if (args.notObserved.includes(key) || (occ && !occ.closesSchool)) {
      rows.push({ key, name, date: occ?.date ?? null, status: 'NOT_OBSERVED', note: 'This school teaches on this day, so nothing is lost.' })
    } else if (!occ) {
      // A year created before this holiday existed simply does not have it.
      if (key === 'DERG_DOWNFALL') continue
      rows.push({ key, name, date: null, status: 'NOT_ENTERED', note: 'The date has not been entered yet.' })
    } else {
      const impact = holidayImpact(occ.date, args.yearStart, args.yearEnd)
      if (impact === 'BEFORE_YEAR') rows.push({ key, name, date: occ.date, status: 'OUTSIDE_YEAR', note: 'Falls before the school year starts, so it does not count.' })
      else if (impact === 'AFTER_YEAR') rows.push({ key, name, date: occ.date, status: 'OUTSIDE_YEAR', note: 'Falls after the school year ends, so it does not count.' })
      else if (impact === 'WEEKEND') rows.push({ key, name, date: occ.date, status: 'WEEKEND', note: 'Falls on a weekend, so no school day is lost.' })
      else rows.push({ key, name, date: occ.date, status: 'COUNTED', note: 'No school this day.' })
    }
  }
  return rows
}

// ---------------------------------------------------------------------------
// The plain-language summary of the year.
// ---------------------------------------------------------------------------

export interface YearStory {
  learningDays: number
  semester1: number
  semester2: number
  noLessonDays: number
  /** The pieces of "the other N days", in reading order, already worded. */
  noLessonParts: string[]
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

export function describeYear(s: YearSummary): YearStory {
  const parts: string[] = []
  if (s.counts.WEEKEND) parts.push(plural(s.counts.WEEKEND, 'weekend day', 'weekend days'))
  if (s.counts.EXAM_CLOSED) parts.push(plural(s.counts.EXAM_CLOSED, 'exam day', 'exam days'))
  if (s.counts.HOLIDAY) parts.push(plural(s.counts.HOLIDAY, 'holiday', 'holidays'))
  if (s.counts.BREAK) parts.push(plural(s.counts.BREAK, 'break day', 'break days'))
  if (s.counts.RETURN) parts.push('the student-return day')
  if (s.counts.YEAR_END) parts.push('the last day of the year')
  if (s.counts.OTHER) parts.push(plural(s.counts.OTHER, 'other day', 'other days'))
  return {
    learningDays: s.learningDays,
    semester1: s.learningBySemester[1],
    semester2: s.learningBySemester[2],
    noLessonDays: s.noLessonDays,
    noLessonParts: parts,
  }
}
