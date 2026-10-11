/**
 * The setup wizard's brain, kept free of React so it can be tested like the
 * rest of the engine. The wizard holds ONE draft of everything the admin has
 * typed; this module turns that draft into the same inputs the real engine
 * uses, so what the wizard shows while the admin is typing is exactly what
 * validation and the timeline will say afterwards.
 */
import { validateCalendarConfiguration } from './validation'
import { buildFullYearTimeline } from './timelineBuilder'
import { teachingDayBreakdown, type TeachingDayBreakdown } from './teachingDays'
import { proposeFixedHolidayOccurrences } from './holidays'
import { isoDate, type ISODate } from './date-utils'
import {
  FIXED_HOLIDAY_KEYS,
  MOVABLE_HOLIDAY_KEYS,
  STANDARD_EXAM_KEYS,
  GRADE12_EXAM_KEY,
} from './types'
import type {
  AcademicYear,
  ExamInstance,
  ExamTypeKey,
  HolidayOccurrence,
  HolidayTypeKey,
  MovableHolidayKey,
  Semester,
  StudentReturnDay,
  ValidationIssue,
} from './types'

export const STEP_KEYS = ['year', 'semesters', 'holidays', 'exams', 'return', 'review'] as const
export type StepKey = (typeof STEP_KEYS)[number]

export const ALL_EXAM_KEYS: ExamTypeKey[] = [...STANDARD_EXAM_KEYS, GRADE12_EXAM_KEY]

export interface DateRange {
  start: string
  end: string
}

export interface SetupDraft {
  year: DateRange
  /** Optional reminder total from the Ministry plan, as typed ('' = none). */
  ministryTarget: string
  sem1: DateRange
  sem2: DateRange
  /** Does the school close for this holiday? Off = the school teaches that
   *  day (and, for a movable holiday, no date needs entering). */
  closes: Record<HolidayTypeKey, boolean>
  movable: Record<MovableHolidayKey, string>
  exams: Record<ExamTypeKey, DateRange>
  studentReturn: string
}

export function draftFromData(data: {
  year: AcademicYear
  semesters: Semester[]
  holidays: HolidayOccurrence[]
  /** Movable holidays the school switched off (no date stored). */
  notObserved?: HolidayTypeKey[]
  exams: ExamInstance[]
  studentReturn: StudentReturnDay | null
}): SetupDraft {
  const sem = (order: 1 | 2): DateRange => {
    const s = data.semesters.find((x) => x.order === order)
    return { start: s?.startDate ?? '', end: s?.endDate ?? '' }
  }
  const off = new Set(data.notObserved ?? [])
  const closes = Object.fromEntries(
    [...FIXED_HOLIDAY_KEYS, ...MOVABLE_HOLIDAY_KEYS].map((k) => {
      const row = data.holidays.find((h) => h.holidayTypeKey === k)
      return [k, off.has(k) ? false : (row?.closesSchool ?? true)]
    }),
  ) as Record<HolidayTypeKey, boolean>
  return {
    year: { start: data.year.startDate, end: data.year.endDate },
    ministryTarget: data.year.ministryTargetDays ? String(data.year.ministryTargetDays) : '',
    closes,
    sem1: sem(1),
    sem2: sem(2),
    movable: Object.fromEntries(
      MOVABLE_HOLIDAY_KEYS.map((k) => [k, data.holidays.find((h) => h.holidayTypeKey === k)?.date ?? '']),
    ) as Record<MovableHolidayKey, string>,
    exams: Object.fromEntries(
      ALL_EXAM_KEYS.map((k) => {
        const e = data.exams.find((x) => x.examTypeKey === k)
        return [k, { start: e?.startDate ?? '', end: e?.endDate ?? '' }]
      }),
    ) as Record<ExamTypeKey, DateRange>,
    studentReturn: data.studentReturn?.date ?? '',
  }
}

/** The five permanent holidays for the year — the stored ones if present,
 *  otherwise the same dates computed on the spot. Either way they count;
 *  the admin never has to do anything for them. */
export function fixedHolidaysFor(yearId: string, yearEc: number, stored: HolidayOccurrence[]): HolidayOccurrence[] {
  const proposed = proposeFixedHolidayOccurrences(yearId, yearEc)
  return FIXED_HOLIDAY_KEYS.map((key, i) => {
    const existing = stored.find((h) => h.holidayTypeKey === key)
    return existing ?? ({ ...proposed[i]!, id: `fixed-${key}`, confirmedAt: new Date(0).toISOString() } as HolidayOccurrence)
  })
}

function range(r: DateRange): { startDate: ISODate; endDate: ISODate } | null {
  return r.start && r.end ? { startDate: isoDate(r.start), endDate: isoDate(r.end) } : null
}

export function draftToConfig(draft: SetupDraft, year: AcademicYear, fixedHolidays: HolidayOccurrence[]) {
  const yr = range(draft.year) ?? { startDate: year.startDate, endDate: year.endDate }
  const academicYear: AcademicYear = { ...year, startDate: yr.startDate, endDate: yr.endDate, isDefaultBoundary: false }
  const semester = (order: 1 | 2, r: DateRange): Semester =>
    ({
      id: `draft-s${order}`,
      academicYearId: year.id,
      order,
      startDate: r.start ? isoDate(r.start) : null,
      endDate: r.end ? isoDate(r.end) : null,
      status: 'UPCOMING',
    }) as Semester
  const holidayOccurrences: HolidayOccurrence[] = [
    ...fixedHolidays.map((h) => ({ ...h, closesSchool: draft.closes[h.holidayTypeKey] ?? true })),
    ...MOVABLE_HOLIDAY_KEYS.filter((k) => draft.closes[k] && draft.movable[k]).map(
      (k) =>
        ({
          id: `draft-${k}`,
          academicYearId: year.id,
          holidayTypeKey: k,
          date: isoDate(draft.movable[k]),
          closesSchool: true,
          source: 'ADMIN_ENTERED',
          confirmedByUserId: null,
          confirmedAt: null,
        }) as HolidayOccurrence,
    ),
  ]
  const examInstances: ExamInstance[] = ALL_EXAM_KEYS.flatMap((k) => {
    const r = range(draft.exams[k])
    return r ? [{ id: `draft-${k}`, academicYearId: year.id, examTypeKey: k, ...r } as ExamInstance] : []
  })
  const studentReturn: StudentReturnDay | null = draft.studentReturn
    ? ({ id: 'draft-return', academicYearId: year.id, date: isoDate(draft.studentReturn) } as StudentReturnDay)
    : null
  const notObservedHolidays = MOVABLE_HOLIDAY_KEYS.filter((k) => !draft.closes[k])
  return {
    academicYear,
    semesters: [semester(1, draft.sem1), semester(2, draft.sem2)],
    holidayOccurrences,
    notObservedHolidays,
    examInstances,
    studentReturn,
  }
}

export function stepForIssue(issue: ValidationIssue): StepKey {
  switch (issue.ref?.kind) {
    case 'ACADEMIC_YEAR_START':
    case 'ACADEMIC_YEAR_END':
      return 'year'
    case 'SEMESTER_START':
    case 'SEMESTER_END':
      return 'semesters'
    case 'HOLIDAY_OCCURRENCE':
      return 'holidays'
    case 'EXAM_START':
    case 'EXAM_END':
      return 'exams'
    case 'STUDENT_RETURN':
      return 'return'
    default:
      // Rules without a single fact (semester overlap, no break) concern the semesters.
      return issue.code.includes('SEMESTER') ? 'semesters' : 'review'
  }
}

export interface DraftReview {
  issues: ValidationIssue[]
  byStep: Record<StepKey, ValidationIssue[]>
  errors: ValidationIssue[]
  missing: ValidationIssue[]
  counts: TeachingDayBreakdown | null
}

export function reviewDraft(draft: SetupDraft, year: AcademicYear, fixedHolidays: HolidayOccurrence[]): DraftReview {
  const config = draftToConfig(draft, year, fixedHolidays)
  const issues = validateCalendarConfiguration({ ...config, dependencyRules: [] }).filter(
    // The default-boundary note is about the stored year, not the draft.
    (i) => i.code !== 'CALENDAR_USING_DEFAULT_BOUNDARY',
  )
  const byStep = Object.fromEntries(STEP_KEYS.map((k) => [k, [] as ValidationIssue[]])) as Record<StepKey, ValidationIssue[]>
  for (const i of issues) byStep[stepForIssue(i)].push(i)

  let counts: TeachingDayBreakdown | null = null
  const semestersReady = config.semesters.every((s) => s.startDate && s.endDate)
  if (semestersReady && !issues.some((i) => i.severity === 'ERROR' && ['year', 'semesters'].includes(stepForIssue(i)))) {
    try {
      counts = teachingDayBreakdown(
        buildFullYearTimeline({
          academicYear: { id: year.id, startDate: config.academicYear.startDate, endDate: config.academicYear.endDate },
          semesters: config.semesters,
          holidayOccurrences: config.holidayOccurrences,
          examInstances: config.examInstances,
          studentReturn: config.studentReturn,
        } as never),
      )
    } catch {
      counts = null
    }
  }
  return {
    issues,
    byStep,
    errors: issues.filter((i) => i.severity === 'ERROR'),
    missing: issues.filter((i) => i.severity === 'MISSING'),
    counts,
  }
}

/** Steps 1 and 2 must be filled in before anything after them makes sense
 *  (exams are checked against the semesters, holidays against the year). */
export function requiredFilled(step: StepKey, draft: SetupDraft): boolean {
  switch (step) {
    case 'year':
      return !!draft.year.start && !!draft.year.end
    case 'semesters':
      return !!draft.sem1.start && !!draft.sem1.end && !!draft.sem2.start && !!draft.sem2.end
    default:
      return true
  }
}

export function canContinue(step: StepKey, draft: SetupDraft, review: DraftReview): boolean {
  const blocking = review.byStep[step].some((i) => i.severity === 'ERROR')
  return requiredFilled(step, draft) && !blocking
}
