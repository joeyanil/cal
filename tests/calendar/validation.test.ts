import { describe, expect, it } from 'vitest'
import { isoDate } from '@/lib/calendar/date-utils'
import { proposeFixedHolidayOccurrences, createHolidayOccurrence } from '@/lib/calendar/holidays'
import { summarizeValidation, validateCalendarConfiguration } from '@/lib/calendar/validation'
import type {
  AcademicYear,
  DependencyRule,
  ExamInstance,
  HolidayOccurrence,
  Semester,
  StudentReturnDay,
} from '@/lib/calendar/types'

const YEAR: AcademicYear = {
  id: 'y2019',
  yearEc: 2019,
  name: '2019 E.C.',
  startDate: isoDate('2026-09-11'),
  endDate: isoDate('2027-07-08'),
  isDefaultBoundary: true,
  status: 'PREPARING',
}

const SEMESTERS: Semester[] = [
  { id: 's1', academicYearId: 'y2019', order: 1, startDate: isoDate('2026-09-14'), endDate: isoDate('2027-01-15'), status: 'ACTIVE' },
  { id: 's2', academicYearId: 'y2019', order: 2, startDate: isoDate('2027-02-01'), endDate: isoDate('2027-07-01'), status: 'UPCOMING' },
]

function completeExamInstances(): ExamInstance[] {
  return [
    { id: 'e1', academicYearId: 'y2019', examTypeKey: 'S1_REGIONAL_MODEL', startDate: isoDate('2026-11-02'), endDate: isoDate('2026-11-04') },
    { id: 'e2', academicYearId: 'y2019', examTypeKey: 'S1_FINAL', startDate: isoDate('2026-12-07'), endDate: isoDate('2026-12-11') },
    { id: 'e3', academicYearId: 'y2019', examTypeKey: 'S2_REGIONAL_MODEL', startDate: isoDate('2027-04-05'), endDate: isoDate('2027-04-07') },
    { id: 'e4', academicYearId: 'y2019', examTypeKey: 'S2_FINAL', startDate: isoDate('2027-06-21'), endDate: isoDate('2027-06-25') },
    { id: 'e5', academicYearId: 'y2019', examTypeKey: 'GRADE12_NATIONAL', startDate: isoDate('2027-05-10'), endDate: isoDate('2027-05-12') },
  ]
}

function completeHolidays(): HolidayOccurrence[] {
  const fixed = proposeFixedHolidayOccurrences('y2019', 2019).map((h, i) => ({ ...h, id: `f${i}` }))
  const movable = [
    createHolidayOccurrence({ academicYearId: 'y2019', holidayTypeKey: 'SIKLET', ethiopianYear: 2019, manualDate: isoDate('2027-05-01') }),
    createHolidayOccurrence({ academicYearId: 'y2019', holidayTypeKey: 'FASIKA', ethiopianYear: 2019, manualDate: isoDate('2027-05-03') }),
    createHolidayOccurrence({ academicYearId: 'y2019', holidayTypeKey: 'EID_FITR', ethiopianYear: 2019, manualDate: isoDate('2027-03-20') }),
    createHolidayOccurrence({ academicYearId: 'y2019', holidayTypeKey: 'EID_ADHA', ethiopianYear: 2019, manualDate: isoDate('2027-05-27') }),
  ].map((h, i) => ({ ...h, id: `m${i}` }))
  return [...fixed, ...movable]
}

const STUDENT_RETURN: StudentReturnDay = { id: 'sr1', academicYearId: 'y2019', date: isoDate('2026-09-14') }

describe('validation: a fully-configured, valid calendar', () => {
  it('has zero MISSING and zero ERROR issues', () => {
    const issues = validateCalendarConfiguration({
      academicYear: { ...YEAR, isDefaultBoundary: false },
      semesters: SEMESTERS,
      holidayOccurrences: completeHolidays(),
      examInstances: completeExamInstances(),
      studentReturn: STUDENT_RETURN,
      dependencyRules: [],
    })
    const summary = summarizeValidation(issues)
    expect(summary.MISSING).toBe(0)
    expect(summary.ERROR).toBe(0)
  })
})

describe('validation: MISSING (not itself an error)', () => {
  it('flags every unconfigured fact as MISSING when nothing has been entered', () => {
    const issues = validateCalendarConfiguration({
      academicYear: YEAR,
      semesters: [
        { id: 's1', academicYearId: 'y2019', order: 1, startDate: null, endDate: null, status: 'UPCOMING' },
        { id: 's2', academicYearId: 'y2019', order: 2, startDate: null, endDate: null, status: 'UPCOMING' },
      ],
      holidayOccurrences: [],
      examInstances: [],
      studentReturn: null,
      dependencyRules: [],
    })
    const summary = summarizeValidation(issues)
    // 4 semester dates + 9 holidays + 5 exams + 1 student return = 19 Missing
    expect(summary.MISSING).toBe(19)
    expect(summary.ERROR).toBe(0) // Missing must never itself be an Error
  })

  it('an incomplete calendar still validates without blocking (Missing does not equal Error)', () => {
    const issues = validateCalendarConfiguration({
      academicYear: YEAR,
      semesters: SEMESTERS,
      holidayOccurrences: [],
      examInstances: [],
      studentReturn: null,
      dependencyRules: [],
    })
    expect(issues.some((i) => i.severity === 'ERROR')).toBe(false)
  })
})

describe('validation: ERROR conditions', () => {
  it('flags an impossible academic-year boundary', () => {
    const issues = validateCalendarConfiguration({
      academicYear: { ...YEAR, startDate: isoDate('2027-07-08'), endDate: isoDate('2026-09-11') },
      semesters: [],
      holidayOccurrences: [],
      examInstances: [],
      studentReturn: null,
      dependencyRules: [],
    })
    expect(issues.some((i) => i.code === 'CALENDAR_INVALID_BOUNDARY' && i.severity === 'ERROR')).toBe(true)
  })

  it('flags an exam on a weekend as an ERROR', () => {
    const issues = validateCalendarConfiguration({
      academicYear: YEAR,
      semesters: SEMESTERS,
      holidayOccurrences: [],
      examInstances: [
        { id: 'e1', academicYearId: 'y2019', examTypeKey: 'S1_FINAL', startDate: isoDate('2026-09-19'), endDate: isoDate('2026-09-19') }, // Saturday
      ],
      studentReturn: null,
      dependencyRules: [],
    })
    expect(issues.some((i) => i.code === 'CALENDAR_EXAM_ON_WEEKEND' && i.severity === 'ERROR')).toBe(true)
  })

  it('flags overlapping semesters as an ERROR', () => {
    const issues = validateCalendarConfiguration({
      academicYear: YEAR,
      semesters: [
        { id: 's1', academicYearId: 'y2019', order: 1, startDate: isoDate('2026-09-14'), endDate: isoDate('2027-02-15'), status: 'ACTIVE' },
        { id: 's2', academicYearId: 'y2019', order: 2, startDate: isoDate('2027-02-01'), endDate: isoDate('2027-07-01'), status: 'UPCOMING' },
      ],
      holidayOccurrences: [],
      examInstances: [],
      studentReturn: null,
      dependencyRules: [],
    })
    expect(issues.some((i) => i.code === 'CALENDAR_SEMESTERS_OVERLAP' && i.severity === 'ERROR')).toBe(true)
  })

  it('flags a persisted circular dependency as an ERROR (aggregate safety net)', () => {
    const cyclicalRules: DependencyRule[] = [
      {
        id: 'r1',
        academicYearId: 'y2019',
        anchor: { kind: 'SEMESTER_START', order: 1 },
        dependent: { kind: 'STUDENT_RETURN' },
        offsetDays: 1,
        active: true,
        createdByUserId: 'u',
        createdAt: '2026-01-01T00:00:00Z',
      },
      {
        id: 'r2',
        academicYearId: 'y2019',
        anchor: { kind: 'STUDENT_RETURN' },
        dependent: { kind: 'SEMESTER_START', order: 1 },
        offsetDays: -1,
        active: true,
        createdByUserId: 'u',
        createdAt: '2026-01-01T00:00:00Z',
      },
    ]
    const issues = validateCalendarConfiguration({
      academicYear: YEAR,
      semesters: SEMESTERS,
      holidayOccurrences: [],
      examInstances: [],
      studentReturn: null,
      dependencyRules: cyclicalRules,
    })
    expect(issues.some((i) => i.code === 'CALENDAR_CIRCULAR_DEPENDENCY' && i.severity === 'ERROR')).toBe(true)
  })
})

describe('validation: WARNING conditions (never blocking)', () => {
  it('warns, but does not error, when an exam crosses its semester boundary', () => {
    // Semester 1 ends midweek (Wed 2027-01-13) here specifically so the exam
    // can extend one day past it (into Thu 2027-01-14) without also
    // crossing a weekend — isolating the boundary-crossing behavior from
    // the (separately tested) weekend hard-stop.
    const semestersEndingMidweek: Semester[] = [
      { id: 's1', academicYearId: 'y2019', order: 1, startDate: isoDate('2026-09-14'), endDate: isoDate('2027-01-13'), status: 'ACTIVE' },
      { id: 's2', academicYearId: 'y2019', order: 2, startDate: isoDate('2027-02-01'), endDate: isoDate('2027-07-01'), status: 'UPCOMING' },
    ]
    const issues = validateCalendarConfiguration({
      academicYear: YEAR,
      semesters: semestersEndingMidweek,
      holidayOccurrences: [],
      examInstances: [
        { id: 'e1', academicYearId: 'y2019', examTypeKey: 'S1_FINAL', startDate: isoDate('2027-01-11'), endDate: isoDate('2027-01-14') },
      ],
      studentReturn: null,
      dependencyRules: [],
    })
    const hit = issues.find((i) => i.code === 'CALENDAR_EXAM_CROSSES_SEMESTER_BOUNDARY')
    expect(hit?.severity).toBe('WARNING')
    expect(issues.some((i) => i.severity === 'ERROR')).toBe(false)
  })

  it('warns when two holidays land on the same date', () => {
    const sameDate = isoDate('2026-09-11')
    const issues = validateCalendarConfiguration({
      academicYear: YEAR,
      semesters: SEMESTERS,
      holidayOccurrences: [
        { ...createHolidayOccurrence({ academicYearId: 'y2019', holidayTypeKey: 'NEW_YEAR', ethiopianYear: 2019 }), id: 'h1', date: sameDate },
        { ...createHolidayOccurrence({ academicYearId: 'y2019', holidayTypeKey: 'GENNA', ethiopianYear: 2019 }), id: 'h2', date: sameDate },
      ],
      examInstances: [],
      studentReturn: null,
      dependencyRules: [],
    })
    expect(issues.some((i) => i.code === 'CALENDAR_MULTIPLE_HOLIDAYS_SAME_DATE' && i.severity === 'WARNING')).toBe(true)
  })
})

describe('validation: INFORMATION conditions', () => {
  it('notes when the year is still on the default boundary', () => {
    const issues = validateCalendarConfiguration({
      academicYear: { ...YEAR, isDefaultBoundary: true },
      semesters: SEMESTERS,
      holidayOccurrences: [],
      examInstances: [],
      studentReturn: null,
      dependencyRules: [],
    })
    expect(issues.some((i) => i.code === 'CALENDAR_USING_DEFAULT_BOUNDARY' && i.severity === 'INFORMATION')).toBe(
      true,
    )
  })

  it('does not note the default-boundary information once real dates are set', () => {
    const issues = validateCalendarConfiguration({
      academicYear: { ...YEAR, isDefaultBoundary: false },
      semesters: SEMESTERS,
      holidayOccurrences: [],
      examInstances: [],
      studentReturn: null,
      dependencyRules: [],
    })
    expect(issues.some((i) => i.code === 'CALENDAR_USING_DEFAULT_BOUNDARY')).toBe(false)
  })
})

describe('validation: students return after Semester 1 has started', () => {
  const run = (returnDate: string) =>
    validateCalendarConfiguration({
      academicYear: { ...YEAR, isDefaultBoundary: false },
      semesters: SEMESTERS,
      holidayOccurrences: completeHolidays(),
      examInstances: completeExamInstances(),
      studentReturn: { ...STUDENT_RETURN, date: isoDate(returnDate) },
      dependencyRules: [],
    })
  it('warns when the return day is after the first day of Semester 1', () => {
    expect(run('2026-11-10').map((i) => i.code)).toContain('CALENDAR_STUDENT_RETURN_AFTER_SEMESTER_START')
  })
  it('is quiet when students return on or before the first day', () => {
    expect(run('2026-09-14').map((i) => i.code)).not.toContain('CALENDAR_STUDENT_RETURN_AFTER_SEMESTER_START')
    expect(run('2026-09-11').map((i) => i.code)).not.toContain('CALENDAR_STUDENT_RETURN_AFTER_SEMESTER_START')
  })
})

describe('validation: an exam sitting fully inside the wrong semester', () => {
  it('is flagged for a Semester 1 exam placed in Semester 2', () => {
    const exams = completeExamInstances().map((e) =>
      e.examTypeKey === 'S1_FINAL' ? { ...e, startDate: isoDate('2027-03-08'), endDate: isoDate('2027-03-12') } : e,
    )
    const issues = validateCalendarConfiguration({
      academicYear: { ...YEAR, isDefaultBoundary: false },
      semesters: SEMESTERS,
      holidayOccurrences: completeHolidays(),
      examInstances: exams,
      studentReturn: STUDENT_RETURN,
      dependencyRules: [],
    })
    expect(issues.map((i) => i.code)).toContain('CALENDAR_EXAM_CROSSES_SEMESTER_BOUNDARY')
  })
})
