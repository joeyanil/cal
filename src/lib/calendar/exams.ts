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
        date,
        message: `Exam window includes ${date}, which is a weekend day. Exams cannot run on Saturday or Sunday.`,
      })
      continue
    }
    const closingHoliday = (holidaysByDate.get(date) ?? []).find((h) => h.closesSchool)
    if (closingHoliday) {
      issues.push({
        severity: 'ERROR',
        code: 'CALENDAR_EXAM_ON_CLOSING_HOLIDAY',
        date,
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
          date: day,
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
 * Smart placement help for whoever is typing an exam date.
 *
 * `analyzeExamWindow` looks at the window the admin entered and answers, in
 * one call: what is wrong with it (hard stops), what is merely worth a
 * second look (warnings), and — if anything is wrong — the nearest windows
 * that fix it. The same function runs live in the form and on the server, so
 * what the admin sees before pressing Save is exactly what Save enforces.
 *
 * A suggested window is only ever offered if it passes every hard stop,
 * stays inside the exam's own semester (or the academic year when the exam
 * has no semester), and does not collide with another school-closing exam.
 * It is never applied automatically: a human clicks to accept it.
 */
export interface ExamWindowContext {
  holidaysByDate: Map<ISODate, HolidayOccurrence[]>
  semesters?: Semester[]
  academicYear?: { startDate: ISODate; endDate: ISODate } | null
  /** Every OTHER exam in the year (exclude the one being edited). */
  otherExams?: Pick<ExamInstance, 'examTypeKey' | 'startDate' | 'endDate'>[]
  /** How far to search each way. Default 60 days. */
  maxSearchDays?: number
}

export interface ExamShiftSuggestion {
  direction: 'EARLIER' | 'LATER'
  offsetDays: number // always positive; magnitude of the shift
  startDate: ISODate
  endDate: ISODate
}

export interface ExamWindowAnalysis {
  /** Hard stops — Save would be rejected. */
  problems: ValidationIssue[]
  /** Allowed but worth attention (crosses semester, overlaps another exam). */
  warnings: ValidationIssue[]
  /** Set when start is after end: the same two dates the right way round. */
  swapped: { startDate: ISODate; endDate: ISODate } | null
  /** Nearest clean windows, nearest first. Empty when none exists. */
  suggestions: ExamShiftSuggestion[]
  /** True when something needs fixing but no clean window was found within
   *  the search range — the UI should say so instead of showing nothing. */
  noWindowFound: boolean
}

function boundsFor(
  examTypeKey: ExamTypeKey | undefined,
  ctx: ExamWindowContext,
): { startDate: ISODate; endDate: ISODate } | null {
  const order = examTypeKey ? EXAM_TYPES[examTypeKey].semesterOrder : null
  if (order !== null) {
    const sem = ctx.semesters?.find((x) => x.order === order)
    if (sem?.startDate && sem?.endDate) return { startDate: sem.startDate, endDate: sem.endDate }
  }
  return ctx.academicYear ?? null
}

function overlapWarnings(
  instance: Pick<ExamInstance, 'startDate' | 'endDate'> & { examTypeKey?: ExamTypeKey },
  ctx: ExamWindowContext,
): ValidationIssue[] {
  if (!instance.examTypeKey || !EXAM_TYPES[instance.examTypeKey].closesSchool) return []
  const out: ValidationIssue[] = []
  for (const other of ctx.otherExams ?? []) {
    if (other.examTypeKey === instance.examTypeKey || !EXAM_TYPES[other.examTypeKey].closesSchool) continue
    if (isSameOrBefore(instance.startDate, other.endDate) && isSameOrBefore(other.startDate, instance.endDate)) {
      out.push({
        severity: 'WARNING',
        code: 'CALENDAR_EXAM_OVERLAPS_OTHER_EXAM',
        message: `This window overlaps ${EXAM_TYPES[other.examTypeKey].name} (${other.startDate} \u2013 ${other.endDate}).`,
        date: other.startDate,
        ref: { kind: 'EXAM_START', examTypeKey: other.examTypeKey },
      })
    }
  }
  return out
}

function insideBounds(
  start: ISODate,
  end: ISODate,
  bounds: { startDate: ISODate; endDate: ISODate } | null,
): boolean {
  return !bounds || (isSameOrBefore(bounds.startDate, start) && isSameOrBefore(end, bounds.endDate))
}

export function analyzeExamWindow(
  instance: Pick<ExamInstance, 'startDate' | 'endDate'> & { examTypeKey?: ExamTypeKey },
  ctx: ExamWindowContext,
): ExamWindowAnalysis {
  const maxSearchDays = ctx.maxSearchDays ?? 60
  const bounds = boundsFor(instance.examTypeKey, ctx)

  // Start after end: offer the swap, then analyse the corrected window so
  // shift suggestions are built from what the admin most likely meant.
  const reversed = isBefore(instance.endDate, instance.startDate)
  const swapped = reversed ? { startDate: instance.endDate, endDate: instance.startDate } : null
  const window = swapped ?? { startDate: instance.startDate, endDate: instance.endDate }

  const problems: ValidationIssue[] = reversed
    ? checkExamHardStops(instance, ctx.holidaysByDate)
    : checkExamHardStops(window, ctx.holidaysByDate)

  const warnings: ValidationIssue[] = []
  if (!reversed) {
    if (instance.examTypeKey) {
      warnings.push(...checkExamCrossesSemesterBoundary({ ...window, examTypeKey: instance.examTypeKey }, ctx.semesters ?? []))
    }
    if (bounds && !insideBounds(window.startDate, window.endDate, bounds) && warnings.length === 0) {
      warnings.push({
        severity: 'WARNING',
        code: 'CALENDAR_EXAM_OUTSIDE_YEAR',
        message: `This window (${window.startDate} \u2013 ${window.endDate}) is outside the academic year.`,
      })
    }
    warnings.push(...overlapWarnings({ ...window, examTypeKey: instance.examTypeKey }, ctx))
  }

  const needsHelp = problems.length > 0 || warnings.length > 0 || reversed
  if (!needsHelp) {
    return { problems, warnings, swapped: null, suggestions: [], noWindowFound: false }
  }

  const closing = instance.examTypeKey ? EXAM_TYPES[instance.examTypeKey].closesSchool : true
  function isClean(start: ISODate, end: ISODate): boolean {
    if (checkExamHardStops({ startDate: start, endDate: end }, ctx.holidaysByDate).length > 0) return false
    if (!insideBounds(start, end, bounds)) return false
    if (closing && overlapWarnings({ startDate: start, endDate: end, examTypeKey: instance.examTypeKey }, ctx).length > 0) {
      return false
    }
    return true
  }

  const suggestions: ExamShiftSuggestion[] = []
  for (const dir of [-1, 1] as const) {
    for (let offset = 1; offset <= maxSearchDays; offset++) {
      const start = addDays(window.startDate, dir * offset)
      const end = addDays(window.endDate, dir * offset)
      if (isClean(start, end)) {
        suggestions.push({ direction: dir === -1 ? 'EARLIER' : 'LATER', offsetDays: offset, startDate: start, endDate: end })
        break
      }
    }
  }
  suggestions.sort((a, b) => a.offsetDays - b.offsetDays)

  // A swap that is itself clean is the simplest fix; don't also bury it.
  const swapIsClean = swapped ? isClean(swapped.startDate, swapped.endDate) : false
  return {
    problems,
    warnings,
    swapped,
    suggestions: swapIsClean ? [] : suggestions,
    noWindowFound: !swapIsClean && suggestions.length === 0,
  }
}

/** Thin wrapper kept for callers that only want the shift suggestions. */
export function suggestExamShift(
  instance: Pick<ExamInstance, 'startDate' | 'endDate'> & { examTypeKey?: ExamTypeKey },
  holidaysByDate: Map<ISODate, HolidayOccurrence[]>,
  options: Omit<ExamWindowContext, 'holidaysByDate'> = {},
): ExamShiftSuggestion[] {
  return analyzeExamWindow(instance, { holidaysByDate, ...options }).suggestions
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
