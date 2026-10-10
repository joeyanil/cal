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
import type { DailyTimelineEntry } from './types'

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
