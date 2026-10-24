/**
 * validation.ts — mission section 27, Deep Domain File 3 §G.
 *
 * Four severities, precisely defined:
 *   MISSING     required information hasn't been entered yet — not itself
 *               an error, and must never block ordinary preparation
 *               elsewhere in K2 (mission section 14/39).
 *   ERROR       an objectively invalid/impossible condition — blocks
 *               activation.
 *   WARNING     worth a human's attention, not proven invalid — never
 *               blocks, never auto-resolved.
 *   INFORMATION useful context, e.g. "you're still on the default
 *               boundary."
 *
 * This module only *aggregates* checks that already live next to the
 * domain concept they check (exams.ts, semesterBreak.ts, studentReturn.ts,
 * dependencyGraph.ts) — it deliberately does not reimplement any of them,
 * so there is exactly one place each rule is expressed.
 */
import { isAfter, isSameOrAfter, isSameOrBefore } from './date-utils'
import { detectAnyCycle } from './dependencyGraph'
import { findConflictingIncomingRules } from './dependencyResolution'
import { checkExamCrossesSemesterBoundary, checkExamHardStops, checkExamOverlap } from './exams'
import { indexHolidaysByDate } from './holidays'
import { checkSemesterOrdering, deriveSemesterBreak } from './semesterBreak'
import { checkStudentReturnPlacement } from './studentReturn'
import { FIXED_HOLIDAY_KEYS, GRADE12_EXAM_KEY, MOVABLE_HOLIDAY_KEYS, STANDARD_EXAM_KEYS } from './types'
import type {
  AcademicYear,
  DependencyRule,
  ExamInstance,
  HolidayOccurrence,
  HolidayTypeKey,
  Semester,
  StudentReturnDay,
  ValidationIssue,
} from './types'

export interface ValidationInput {
  academicYear: AcademicYear
  semesters: Semester[]
  holidayOccurrences: HolidayOccurrence[]
  examInstances: ExamInstance[]
  studentReturn: StudentReturnDay | null
  dependencyRules: DependencyRule[]
  /** Movable holidays this school has switched off (it teaches that day), so
   *  there is no date to enter and nothing is "missing". */
  notObservedHolidays?: HolidayTypeKey[]
}

export function validateCalendarConfiguration(input: ValidationInput): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const { academicYear, semesters, holidayOccurrences, examInstances, studentReturn, dependencyRules } = input
  const holidaysByDate = indexHolidaysByDate(holidayOccurrences)

  // --- INFORMATION: default boundary still in use --------------------------
  if (academicYear.isDefaultBoundary) {
    issues.push({
      severity: 'INFORMATION',
      code: 'CALENDAR_USING_DEFAULT_BOUNDARY',
      message: `Academic year is still using the default boundary (${academicYear.startDate} – ${academicYear.endDate}). Replace it with the official Ministry-plan dates when available.`,
      ref: { kind: 'ACADEMIC_YEAR_START' },
    })
  }

  // --- ERROR: academic year boundary ---------------------------------------
  if (isAfter(academicYear.startDate, academicYear.endDate)) {
    issues.push({
      severity: 'ERROR',
      code: 'CALENDAR_INVALID_BOUNDARY',
      message: `Academic year start (${academicYear.startDate}) is after its end (${academicYear.endDate}).`,
      ref: { kind: 'ACADEMIC_YEAR_START' },
    })
  }

  // --- MISSING / ERROR: semesters -------------------------------------------
  for (const order of [1, 2] as const) {
    const semester = semesters.find((s) => s.order === order)
    if (!semester?.startDate) {
      issues.push({
        severity: 'MISSING',
        code: 'CALENDAR_SEMESTER_START_MISSING',
        message: `Semester ${order} start date has not been entered.`,
        ref: { kind: 'SEMESTER_START', order },
      })
    }
    if (!semester?.endDate) {
      issues.push({
        severity: 'MISSING',
        code: 'CALENDAR_SEMESTER_END_MISSING',
        message: `Semester ${order} end date has not been entered.`,
        ref: { kind: 'SEMESTER_END', order },
      })
    }
    if (semester?.startDate && semester.endDate && isAfter(semester.startDate, semester.endDate)) {
      issues.push({
        severity: 'ERROR',
        code: 'CALENDAR_SEMESTER_INVALID_RANGE',
        message: `Semester ${order} end (${semester.endDate}) is before its start (${semester.startDate}).`,
        ref: { kind: 'SEMESTER_START', order },
      })
    }
    // Structural invariant: a semester cannot run outside the academic year
    // it belongs to.
    if (semester?.startDate && isAfter(academicYear.startDate, semester.startDate)) {
      issues.push({
        severity: 'ERROR',
        code: 'CALENDAR_SEMESTER_OUTSIDE_YEAR_BOUNDARY',
        message: `Semester ${order} starts (${semester.startDate}) before the academic year starts (${academicYear.startDate}).`,
        ref: { kind: 'SEMESTER_START', order },
      })
    }
    if (semester?.endDate && isAfter(semester.endDate, academicYear.endDate)) {
      issues.push({
        severity: 'ERROR',
        code: 'CALENDAR_SEMESTER_OUTSIDE_YEAR_BOUNDARY',
        message: `Semester ${order} ends (${semester.endDate}) after the academic year ends (${academicYear.endDate}).`,
        ref: { kind: 'SEMESTER_END', order },
      })
    }
  }
  issues.push(...checkSemesterOrdering(semesters))

  // --- MISSING: holidays -----------------------------------------------------
  const presentHolidayKeys = new Set(holidayOccurrences.map((h) => h.holidayTypeKey))
  const notObserved = new Set(input.notObservedHolidays ?? [])
  for (const key of [...FIXED_HOLIDAY_KEYS, ...MOVABLE_HOLIDAY_KEYS]) {
    // The Derg-downfall holiday is optional: a year created before it existed
    // simply doesn't have it, and that is not something to enter by hand.
    if (notObserved.has(key) || (key === 'DERG_DOWNFALL' && !presentHolidayKeys.has(key))) continue
    if (!presentHolidayKeys.has(key)) {
      issues.push({
        severity: 'MISSING',
        code: 'CALENDAR_HOLIDAY_OCCURRENCE_MISSING',
        message: `The date for ${key} has not been entered yet${(MOVABLE_HOLIDAY_KEYS as readonly string[]).includes(key) ? ' (or switch it off if the school teaches on that day)' : ''}.`,
        ref: { kind: 'HOLIDAY_OCCURRENCE', holidayTypeKey: key },
      })
    }
  }

  // --- WARNING: duplicate holiday dates ---------------------------------------
  const holidayDateCounts = new Map<string, HolidayOccurrence[]>()
  for (const h of holidayOccurrences) {
    const list = holidayDateCounts.get(h.date) ?? []
    list.push(h)
    holidayDateCounts.set(h.date, list)
  }
  for (const [date, group] of holidayDateCounts) {
    if (group.length > 1) {
      issues.push({
        severity: 'WARNING',
        code: 'CALENDAR_MULTIPLE_HOLIDAYS_SAME_DATE',
        message: `${group.length} holidays are recorded on the same date (${date}): ${group.map((g) => g.holidayTypeKey).join(', ')}.`,
        relatedRefs: group.map((g) => ({ kind: 'HOLIDAY_OCCURRENCE' as const, holidayTypeKey: g.holidayTypeKey })),
      })
    }
  }

  // --- INFORMATION: holiday closure overridden off ----------------------------
  for (const h of holidayOccurrences) {
    if (!h.closesSchool) {
      issues.push({
        severity: 'INFORMATION',
        code: 'CALENDAR_HOLIDAY_CLOSURE_OVERRIDDEN',
        message: `${h.holidayTypeKey} on ${h.date} is marked as NOT closing the school this year (overriding the default).`,
        ref: { kind: 'HOLIDAY_OCCURRENCE', holidayTypeKey: h.holidayTypeKey },
      })
    }
  }

  // --- MISSING: exams ----------------------------------------------------------
  const presentExamKeys = new Set(examInstances.map((e) => e.examTypeKey))
  for (const key of [...STANDARD_EXAM_KEYS, GRADE12_EXAM_KEY]) {
    if (!presentExamKeys.has(key)) {
      issues.push({
        severity: 'MISSING',
        code: 'CALENDAR_EXAM_INSTANCE_MISSING',
        message: `No dates entered yet for ${key}.`,
        ref: { kind: 'EXAM_START', examTypeKey: key },
      })
    }
  }

  // --- ERROR: exam hard stops + boundary; WARNING: semester crossing ----------
  for (const instance of examInstances) {
    // Tag each hard stop with the exam it belongs to (keeping any holiday it
    // mentions as a related fact), so screens can show it next to that exam.
    for (const issue of checkExamHardStops(instance, holidaysByDate)) {
      issues.push({
        ...issue,
        ref: { kind: 'EXAM_START', examTypeKey: instance.examTypeKey },
        relatedRefs: issue.ref ? [issue.ref] : undefined,
      })
    }
    issues.push(...checkExamCrossesSemesterBoundary(instance, semesters))
    if (isAfter(academicYear.startDate, instance.startDate) || isAfter(instance.endDate, academicYear.endDate)) {
      issues.push({
        severity: 'ERROR',
        code: 'CALENDAR_EXAM_OUTSIDE_YEAR_BOUNDARY',
        message: `${instance.examTypeKey} (${instance.startDate} – ${instance.endDate}) falls outside the academic year boundary (${academicYear.startDate} – ${academicYear.endDate}).`,
        ref: { kind: 'EXAM_START', examTypeKey: instance.examTypeKey },
      })
    }
  }

  // --- WARNING: two school-closing exams overlapping (fix #16) ----------------
  issues.push(...checkExamOverlap(examInstances))

  // --- MISSING: Student Return -------------------------------------------------
  if (!studentReturn) {
    issues.push({
      severity: 'MISSING',
      code: 'CALENDAR_STUDENT_RETURN_MISSING',
      message: 'Student Return / Orientation date has not been entered.',
      ref: { kind: 'STUDENT_RETURN' },
    })
  }
  issues.push(...checkStudentReturnPlacement(studentReturn, holidaysByDate))
  if (studentReturn && (isAfter(academicYear.startDate, studentReturn.date) || isAfter(studentReturn.date, academicYear.endDate))) {
    // See IMPLEMENTATION_NOTES.md, "Open question: Student Return vs. the
    // default year boundary" — the mission's own 2019 E.C. evidence places
    // Student Return (Meskerem 4) one day before the default academic-year
    // start (Meskerem 5), so this genuinely happens with the literal
    // defaults. This is deliberately a WARNING, not an ERROR: the admin may
    // simply not have replaced the default boundary with the real Ministry
    // start date yet, and blocking on it would invent a business rule the
    // domain files never state.
    issues.push({
      severity: 'WARNING',
      code: 'CALENDAR_STUDENT_RETURN_OUTSIDE_YEAR_BOUNDARY',
      message: `Student Return (${studentReturn.date}) falls outside the academic year boundary (${academicYear.startDate} – ${academicYear.endDate}) and will not appear on the full-year timeline until the boundary is adjusted to include it.`,
      ref: { kind: 'STUDENT_RETURN' },
    })
  }

  // --- INFORMATION: holiday landing inside the derived break -------------------
  const semesterBreak = deriveSemesterBreak(semesters)
  if (semesterBreak) {
    for (const h of holidayOccurrences) {
      if (isSameOrAfter(h.date, semesterBreak.startDate) && isSameOrBefore(h.date, semesterBreak.endDate)) {
        issues.push({
          severity: 'INFORMATION',
          code: 'CALENDAR_HOLIDAY_INSIDE_BREAK',
          message: `${h.holidayTypeKey} (${h.date}) falls inside the derived semester break (${semesterBreak.startDate} – ${semesterBreak.endDate}); it's already non-teaching either way.`,
          ref: { kind: 'HOLIDAY_OCCURRENCE', holidayTypeKey: h.holidayTypeKey },
        })
      }
    }
  }

  // --- ERROR: dependency graph safety net --------------------------------------
  const cycle = detectAnyCycle(dependencyRules)
  if (cycle) {
    issues.push({
      severity: 'ERROR',
      code: 'CALENDAR_CIRCULAR_DEPENDENCY',
      message: `A circular dependency exists among Calendar facts: ${cycle.join(' -> ')}.`,
    })
  }

  for (const [key, conflicting] of findConflictingIncomingRules(dependencyRules)) {
    issues.push({
      severity: 'ERROR',
      code: 'CALENDAR_CONFLICTING_DEPENDENCY',
      message: `"${key}" has ${conflicting.length} active incoming dependencies — a calendar fact must have exactly one authoritative source.`,
    })
  }

  return issues
}

export function hasBlockingErrors(issues: ValidationIssue[]): boolean {
  return issues.some((i) => i.severity === 'ERROR')
}

export function summarizeValidation(issues: ValidationIssue[]): Record<string, number> {
  return {
    MISSING: issues.filter((i) => i.severity === 'MISSING').length,
    ERROR: issues.filter((i) => i.severity === 'ERROR').length,
    WARNING: issues.filter((i) => i.severity === 'WARNING').length,
    INFORMATION: issues.filter((i) => i.severity === 'INFORMATION').length,
  }
}
