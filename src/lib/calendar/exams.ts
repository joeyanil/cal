/**
 * exams.ts — mission section 9 / Deep Domain File 2, Domain Inventory
 * items 6-7, 12.
 *
 * Five exam structures total: four standard (whole-school-closing) exams
 * plus the Grade 12 National Exam (never whole-school-closing — K2 doesn't
 * host it). Hard placement rules (weekend, closing-holiday overlap) are
 * rejected outright at creation time; a semester-boundary crossing is
 * surfaced as a conflict for a human to resolve, never auto-corrected.
 */
import { AppError } from '../errors/AppError'
import { addDays, eachDayInclusive, isWeekend, differenceInCalendarDays, isBefore, isSameOrBefore } from './date-utils'
import type { ISODate } from './date-utils'
import type {
  ExamInstance,
  ExamType,
  ExamTypeKey,
  HolidayOccurrence,
  Semester,
  StandardExamKey,
  ValidationIssue,
} from './types'
import { GRADE12_EXAM_KEY, STANDARD_EXAM_KEYS } from './types'

export const EXAM_TYPES: Record<ExamTypeKey, ExamType> = {
  S1_REGIONAL_MODEL: {
    key: 'S1_REGIONAL_MODEL',
    name: 'Semester 1 Regional Model Exam',
    semesterOrder: 1,
    closesSchool: true,
    gradeScope: 'ALL',
  },
  S1_FINAL: {
    key: 'S1_FINAL',
    name: 'Semester 1 Final Exam',
    semesterOrder: 1,
    closesSchool: true,
    gradeScope: 'ALL',
  },
  S2_REGIONAL_MODEL: {
    key: 'S2_REGIONAL_MODEL',
    name: 'Semester 2 Regional Model Exam',
    semesterOrder: 2,
    closesSchool: true,
    gradeScope: 'ALL',
  },
  S2_FINAL: {
    key: 'S2_FINAL',
    name: 'Semester 2 Final Exam',
    semesterOrder: 2,
    closesSchool: true,
    gradeScope: 'ALL',
  },
  GRADE12_NATIONAL: {
    key: GRADE12_EXAM_KEY,
    name: 'Grade 12 National Exam',
    semesterOrder: null,
    closesSchool: false,
    gradeScope: 'GRADE_12',
  },
}

export function isStandardExam(key: ExamTypeKey): key is StandardExamKey {
  return (STANDARD_EXAM_KEYS as readonly string[]).includes(key)
}

/** DERIVED (mission item 9: "exam day numbering is derived, countdown is
 *  derived"). Never stored — always computed from start/end. */
export function examTotalDays(instance: Pick<ExamInstance, 'startDate' | 'endDate'>): number {
  return differenceInCalendarDays(instance.endDate, instance.startDate) + 1
}

/** 1-based day number of `date` within the exam window, or null if `date`
 *  falls outside it. */
export function examDayNumber(
  instance: Pick<ExamInstance, 'startDate' | 'endDate'>,
  date: ISODate,
): number | null {
  const offset = differenceInCalendarDays(date, instance.startDate)
  const total = examTotalDays(instance)
  if (offset < 0 || offset >= total) return null
  return offset + 1
}

/**
 * The two hard placement stops (mission item 9): an exam window must
 * contain no Saturday, no Sunday, and no date on which a holiday closes the
 * school. Returns every violating date found — not just the first — so the
 * admin sees the whole problem at once.
 */
export function checkExamHardStops(
  instance: Pick<ExamInstance, 'startDate' | 'endDate'>,
  holidaysByDate: Map<ISODate, HolidayOccurrence[]>,
): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  if (isBefore(instance.endDate, instance.startDate)) {
    return [
      {
        severity: 'ERROR',
        code: 'CALENDAR_EXAM_INVALID_RANGE',
        message: `Exam end date (${instance.endDate}) is before its start date (${instance.startDate}).`,
      },
    ]
  }

  for (const date of eachDayInclusive(instance.startDate, instance.endDate)) {
    if (isWeekend(date)) {
      issues.push({
        severity: 'ERROR',
        code: 'CALENDAR_EXAM_ON_WEEKEND',
        message: `Exam window includes ${date}, which is a weekend day. Exams cannot run on Saturday or Sunday.`,
      })
      continue
    }
    const closingHoliday = (holidaysByDate.get(date) ?? []).find((h) => h.closesSchool)
    if (closingHoliday) {
      issues.push({
        severity: 'ERROR',
        code: 'CALENDAR_EXAM_ON_CLOSING_HOLIDAY',
        message: `Exam window includes ${date}, which is a school-closing holiday.`,
        ref: { kind: 'HOLIDAY_OCCURRENCE', holidayTypeKey: closingHoliday.holidayTypeKey },
      })
    }
  }

  // Ministry rule: no exam in a week (Mon-Fri) that contains a school-closing
  // holiday. The holiday day itself is already reported above, so this only
  // reports the OTHER exam days sharing that week. One issue per week.
  const reportedWeeks = new Set<ISODate>()
  for (const date of eachDayInclusive(instance.startDate, instance.endDate)) {
    if (isWeekend(date)) continue
    const monday = addDays(date, -((new Date(date + 'T00:00:00Z').getUTCDay() + 6) % 7))
    if (reportedWeeks.has(monday)) continue
    for (let i = 0; i < 5; i++) {
      const day = addDays(monday, i)
      const holiday = (holidaysByDate.get(day) ?? []).find((h) => h.closesSchool)
      if (holiday && day !== date && !isHolidayInWindow(day, instance)) {
        reportedWeeks.add(monday)
        issues.push({
          severity: 'ERROR',
          code: 'CALENDAR_EXAM_IN_HOLIDAY_WEEK',
          message: `Exam week of ${monday} contains a school-closing holiday on ${day}. No exams are allowed in a holiday week.`,
          ref: { kind: 'HOLIDAY_OCCURRENCE', holidayTypeKey: holiday.holidayTypeKey },
        })
        break
      }
    }
  }
  return issues
}

function isHolidayInWindow(day: ISODate, w: { startDate: ISODate; endDate: ISODate }): boolean {
  return isSameOrBefore(w.startDate, day) && isSameOrBefore(day, w.endDate)
}

/** Throws on the first hard-stop violation. Services call this at
 *  create/update time — hard stops are rejected outright, not merely
 *  flagged (mission item 9). */
export function assertExamPlacementAllowed(
  instance: Pick<ExamInstance, 'startDate' | 'endDate'>,
  holidaysByDate: Map<ISODate, HolidayOccurrence[]>,
): void {
  const issues = checkExamHardStops(instance, holidaysByDate)
  const first = issues[0]
  if (first) {
    throw new AppError(first.code, 422, first.message, { allIssues: issues })
  }
}

/**
 * Semester-boundary crossing is surfaced as a WARNING (a conflict for a
 * human to resolve), never blocked and never auto-corrected (mission item 9:
 * "Calendar must not silently move the semester boundary. Calendar must not
 * silently move the exam to resolve a conflict.").
 */
export function checkExamCrossesSemesterBoundary(
  instance: Pick<ExamInstance, 'examTypeKey' | 'startDate' | 'endDate'>,
  semesters: Semester[],
): ValidationIssue[] {
  const type = EXAM_TYPES[instance.examTypeKey]
  if (type.semesterOrder === null) return [] // Grade 12 National Exam isn't semester-scoped

  const semester = semesters.find((s) => s.order === type.semesterOrder)
  if (!semester || !semester.startDate || !semester.endDate) return [] // nothing to compare against yet (Missing, handled elsewhere)

  const startsBefore = isBefore(instance.startDate, semester.startDate)
  const endsAfter = isBefore(semester.endDate, instance.endDate)
  if (!startsBefore && !endsAfter) return []

  return [
    {
      severity: 'WARNING',
      code: 'CALENDAR_EXAM_CROSSES_SEMESTER_BOUNDARY',
      message: `${type.name} (${instance.startDate} – ${instance.endDate}) extends outside Semester ${type.semesterOrder}'s boundary (${semester.startDate} – ${semester.endDate}). Move the exam or adjust the semester boundary explicitly — neither happens automatically.`,
      ref: { kind: 'EXAM_START', examTypeKey: instance.examTypeKey },
      relatedRefs: [{ kind: 'SEMESTER_START', order: type.semesterOrder }],
    },
  ]
}

/**
 * UX improvement — "shift suggestion" for a hard-stop violation (mission
 * item 9's weekend/closing-holiday rejection still applies unchanged; this
 * only adds a *suggestion* layer on top of it). Today an admin who enters
 * a window that lands on a weekend or a closing holiday gets a rejection
 * and has to manually count days back or forward in their head. This
 * computes, in both directions, the nearest same-length window that clears
 * every hard stop, so the UI can offer "move 2 days earlier" / "move 5 days
 * later" as one-click choices instead of trial-and-error retyping.
 *
 * Never applied automatically — mirrors the engine's existing rule that
 * Calendar "must not silently move... to resolve a conflict" (exams.ts
 * checkExamCrossesSemesterBoundary comment, same principle applied here to
 * hard stops instead of a WARNING-level conflict). This function only
 * proposes; a human still clicks to accept.
 */
export interface ExamShiftSuggestion {
  direction: 'EARLIER' | 'LATER'
  offsetDays: number // always positive; magnitude of the shift
  startDate: ISODate
  endDate: ISODate
}

/**
 * Searches outward from the originally-requested window, one day at a time
 * in each direction, for the nearest window of the same length that is
 * entirely free of weekends and closing holidays. Caps the search (default
 * 60 days each way) so a pathological all-holidays stretch can't loop
 * forever — if nothing is found within the cap, that direction is simply
 * omitted rather than guessed at.
 */
export function suggestExamShift(
  instance: Pick<ExamInstance, 'startDate' | 'endDate'>,
  holidaysByDate: Map<ISODate, HolidayOccurrence[]>,
  maxSearchDays = 60,
): ExamShiftSuggestion[] {
  const suggestions: ExamShiftSuggestion[] = []

  // Same rules the save enforces (weekend, closing holiday, holiday week),
  // so a suggestion is never rejected when the admin accepts it.
  function windowIsClean(start: ISODate, end: ISODate): boolean {
    return checkExamHardStops({ startDate: start, endDate: end }, holidaysByDate).length === 0
  }

  // No suggestion needed — the requested window already clears both hard
  // stops, so there is nothing to shift.
  if (windowIsClean(instance.startDate, instance.endDate)) return []

  // direction: -1 = earlier, +1 = later
  for (const dir of [-1, 1] as const) {
    for (let offset = 1; offset <= maxSearchDays; offset++) {
      const candidateStart = addDays(instance.startDate, dir * offset)
      const candidateEnd = addDays(instance.endDate, dir * offset)
      if (windowIsClean(candidateStart, candidateEnd)) {
        suggestions.push({
          direction: dir === -1 ? 'EARLIER' : 'LATER',
          offsetDays: offset,
          startDate: candidateStart,
          endDate: candidateEnd,
        })
        break
      }
    }
  }

  // Nearest side first regardless of direction, so the UI's default/first
  // suggestion is always "the smallest change that fixes it."
  return suggestions.sort((a, b) => a.offsetDays - b.offsetDays)
}

export interface TimelineExamHit {
  examTypeKey: ExamTypeKey
  dayNumber: number
  totalDays: number
}

/** Builds an O(1)-lookup map of date -> every exam whose window includes
 *  it, for the timeline builder. The Grade 12 National Exam legitimately
 *  overlapping a standard exam is the ordinary case this exists for (Deep
 *  Domain File 5 §M — K2 doesn't host it, so it never competes with a
 *  closing exam for the same date); two *closing* exams overlapping is a
 *  genuine data problem instead, caught separately as a WARNING by
 *  validation.ts's checkExamOverlap, not resolved by picking one here. */
export function indexExamsByDate(instances: ExamInstance[]): Map<ISODate, TimelineExamHit[]> {
  const map = new Map<ISODate, TimelineExamHit[]>()
  for (const instance of instances) {
    const totalDays = examTotalDays(instance)
    for (const date of eachDayInclusive(instance.startDate, instance.endDate)) {
      const dayNumber = examDayNumber(instance, date)
      if (dayNumber === null) continue // unreachable given the loop bounds; defensive
      const hit: TimelineExamHit = { examTypeKey: instance.examTypeKey, dayNumber, totalDays }
      const existing = map.get(date)
      if (existing) existing.push(hit)
      else map.set(date, [hit])
    }
  }
  return map
}

/**
 * Fix #16: two *school-closing* exams overlapping is a genuine conflict —
 * you cannot have two different whole-school final-exam periods active at
 * once — surfaced as a WARNING (Deep Domain File 3 §G's pattern for
 * benign-but-flagged co-occurrence), not silently resolved by keeping
 * whichever was indexed first. The Grade 12 National Exam never closes
 * school, so it can never be one side of this conflict — its overlap with
 * anything is the normal, unflagged case.
 */
export function checkExamOverlap(instances: ExamInstance[]): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const closing = instances.filter((i) => EXAM_TYPES[i.examTypeKey].closesSchool)
  for (let i = 0; i < closing.length; i++) {
    for (let j = i + 1; j < closing.length; j++) {
      const a = closing[i]
      const b = closing[j]
      if (!a || !b) continue
      const overlaps = isSameOrBefore(a.startDate, b.endDate) && isSameOrBefore(b.startDate, a.endDate)
      if (overlaps) {
        issues.push({
          severity: 'WARNING',
          code: 'CALENDAR_EXAM_OVERLAPS_EXAM',
          message: `${EXAM_TYPES[a.examTypeKey].name} (${a.startDate} – ${a.endDate}) overlaps ${EXAM_TYPES[b.examTypeKey].name} (${b.startDate} – ${b.endDate}) — two school-closing exam periods cannot both be in effect.`,
          ref: { kind: 'EXAM_START', examTypeKey: a.examTypeKey },
          relatedRefs: [{ kind: 'EXAM_START', examTypeKey: b.examTypeKey }],
        })
      }
    }
  }
  return issues
}
