import { describe, expect, it } from 'vitest'
import { isoDate } from '@/lib/calendar/date-utils'
import {
  assertExamPlacementAllowed,
  checkExamCrossesSemesterBoundary,
  checkExamHardStops,
  checkExamOverlap,
  examDayNumber,
  examTotalDays,
  EXAM_TYPES,
  indexExamsByDate,
} from '@/lib/calendar/exams'
import { createHolidayOccurrence, indexHolidaysByDate } from '@/lib/calendar/holidays'
import type { ExamInstance, HolidayOccurrence, Semester } from '@/lib/calendar/types'
import { AppError } from '@/lib/errors/AppError'

// A representative Monday-Friday window for exam placement tests.
const MON = isoDate('2026-09-14')
const FRI = isoDate('2026-09-18')
const SAT = isoDate('2026-09-19')

describe('exams: catalog', () => {
  it('marks the four standard exams as whole-school closing, ALL scope', () => {
    for (const key of ['S1_REGIONAL_MODEL', 'S1_FINAL', 'S2_REGIONAL_MODEL', 'S2_FINAL'] as const) {
      expect(EXAM_TYPES[key].closesSchool).toBe(true)
      expect(EXAM_TYPES[key].gradeScope).toBe('ALL')
    }
  })

  it('marks the Grade 12 National Exam as non-closing, GRADE_12 scope', () => {
    expect(EXAM_TYPES.GRADE12_NATIONAL.closesSchool).toBe(false)
    expect(EXAM_TYPES.GRADE12_NATIONAL.gradeScope).toBe('GRADE_12')
    expect(EXAM_TYPES.GRADE12_NATIONAL.semesterOrder).toBeNull()
  })
})

describe('exams: day numbering (derived)', () => {
  const instance = { startDate: MON, endDate: FRI }

  it('computes total days inclusive', () => {
    expect(examTotalDays(instance)).toBe(5)
  })

  it('numbers each day within the window starting at 1', () => {
    expect(examDayNumber(instance, MON)).toBe(1)
    expect(examDayNumber(instance, isoDate('2026-09-16'))).toBe(3)
    expect(examDayNumber(instance, FRI)).toBe(5)
  })

  it('returns null outside the window', () => {
    expect(examDayNumber(instance, isoDate('2026-09-13'))).toBeNull()
    expect(examDayNumber(instance, SAT)).toBeNull()
  })
})

describe('exams: hard stops — weekend', () => {
  it('flags an exam window that includes a Saturday', () => {
    const issues = checkExamHardStops({ startDate: MON, endDate: SAT }, new Map())
    expect(issues.some((i) => i.code === 'CALENDAR_EXAM_ON_WEEKEND')).toBe(true)
  })

  it('accepts a pure weekday window', () => {
    const issues = checkExamHardStops({ startDate: MON, endDate: FRI }, new Map())
    expect(issues).toHaveLength(0)
  })

  it('throws (does not merely warn) when asserted', () => {
    expect(() => assertExamPlacementAllowed({ startDate: MON, endDate: SAT }, new Map())).toThrow(AppError)
  })
})

describe('exams: hard stops — closing holiday overlap', () => {
  it('flags an exam window that overlaps a school-closing holiday', () => {
    const holiday: HolidayOccurrence = {
      ...createHolidayOccurrence({ academicYearId: 'y', holidayTypeKey: 'NEW_YEAR', ethiopianYear: 2019 }),
      id: 'h1',
      date: isoDate('2026-09-16'), // falls inside MON..FRI window
    }
    const byDate = indexHolidaysByDate([holiday])
    const issues = checkExamHardStops({ startDate: MON, endDate: FRI }, byDate)
    expect(issues.some((i) => i.code === 'CALENDAR_EXAM_ON_CLOSING_HOLIDAY')).toBe(true)
  })

  it('does NOT flag overlap with a holiday whose closure has been turned off', () => {
    const holiday: HolidayOccurrence = {
      ...createHolidayOccurrence({ academicYearId: 'y', holidayTypeKey: 'NEW_YEAR', ethiopianYear: 2019 }),
      id: 'h1',
      date: isoDate('2026-09-16'),
      closesSchool: false,
    }
    const byDate = indexHolidaysByDate([holiday])
    const issues = checkExamHardStops({ startDate: MON, endDate: FRI }, byDate)
    expect(issues.some((i) => i.code === 'CALENDAR_EXAM_ON_CLOSING_HOLIDAY')).toBe(false)
  })

  it('flags an invalid range (end before start) as an ERROR, not a crash', () => {
    const issues = checkExamHardStops({ startDate: FRI, endDate: MON }, new Map())
    expect(issues).toHaveLength(1)
    expect(issues[0]?.code).toBe('CALENDAR_EXAM_INVALID_RANGE')
  })
})

describe('exams: semester-boundary crossing is a WARNING, never a block, never auto-corrected', () => {
  const semesters: Semester[] = [
    { id: 's1', academicYearId: 'y', order: 1, startDate: isoDate('2026-09-20'), endDate: isoDate('2027-01-15'), status: 'ACTIVE' },
    { id: 's2', academicYearId: 'y', order: 2, startDate: isoDate('2027-02-01'), endDate: isoDate('2027-07-01'), status: 'UPCOMING' },
  ]

  it('warns when a Semester 1 exam extends past the Semester 1 end date', () => {
    const instance: Pick<ExamInstance, 'examTypeKey' | 'startDate' | 'endDate'> = {
      examTypeKey: 'S1_FINAL',
      startDate: isoDate('2027-01-12'),
      endDate: isoDate('2027-01-18'), // 3 days past semester 1's end
    }
    const issues = checkExamCrossesSemesterBoundary(instance, semesters)
    expect(issues).toHaveLength(1)
    expect(issues[0]?.severity).toBe('WARNING')
    expect(issues[0]?.code).toBe('CALENDAR_EXAM_CROSSES_SEMESTER_BOUNDARY')
  })

  it('does not warn when the exam sits entirely within its semester', () => {
    const instance: Pick<ExamInstance, 'examTypeKey' | 'startDate' | 'endDate'> = {
      examTypeKey: 'S1_FINAL',
      startDate: isoDate('2027-01-05'),
      endDate: isoDate('2027-01-10'),
    }
    expect(checkExamCrossesSemesterBoundary(instance, semesters)).toHaveLength(0)
  })

  it('never checks boundary crossing for the Grade 12 National Exam (not semester-scoped)', () => {
    const instance: Pick<ExamInstance, 'examTypeKey' | 'startDate' | 'endDate'> = {
      examTypeKey: 'GRADE12_NATIONAL',
      startDate: isoDate('2027-05-10'),
      endDate: isoDate('2027-05-20'),
    }
    expect(checkExamCrossesSemesterBoundary(instance, semesters)).toHaveLength(0)
  })
})

describe('exams: indexExamsByDate', () => {
  it('produces per-date hits with correct day numbers across multiple non-overlapping exams', () => {
    const instances: ExamInstance[] = [
      { id: 'e1', academicYearId: 'y', examTypeKey: 'S1_REGIONAL_MODEL', startDate: MON, endDate: FRI },
      {
        id: 'e2',
        academicYearId: 'y',
        examTypeKey: 'GRADE12_NATIONAL',
        startDate: isoDate('2026-09-21'),
        endDate: isoDate('2026-09-22'),
      },
    ]
    const index = indexExamsByDate(instances)
    expect(index.get(MON)).toEqual([{ examTypeKey: 'S1_REGIONAL_MODEL', dayNumber: 1, totalDays: 5 }])
    expect(index.get(FRI)).toEqual([{ examTypeKey: 'S1_REGIONAL_MODEL', dayNumber: 5, totalDays: 5 }])
    expect(index.get(isoDate('2026-09-22'))).toEqual([
      { examTypeKey: 'GRADE12_NATIONAL', dayNumber: 2, totalDays: 2 },
    ])
  })

  it('fix #16: a standard exam and the Grade 12 National Exam legitimately overlapping BOTH survive on the same date', () => {
    const overlapDate = isoDate('2026-09-22')
    const instances: ExamInstance[] = [
      { id: 'e1', academicYearId: 'y', examTypeKey: 'S1_REGIONAL_MODEL', startDate: MON, endDate: isoDate('2026-09-25') },
      { id: 'e2', academicYearId: 'y', examTypeKey: 'GRADE12_NATIONAL', startDate: overlapDate, endDate: overlapDate },
    ]
    const index = indexExamsByDate(instances)
    const hits = index.get(overlapDate) ?? []
    expect(hits).toHaveLength(2)
    expect(hits.map((h) => h.examTypeKey).sort()).toEqual(['GRADE12_NATIONAL', 'S1_REGIONAL_MODEL'])
  })
})

describe('exams: checkExamOverlap (fix #16)', () => {
  it('flags two overlapping CLOSING exams as a WARNING', () => {
    const instances: ExamInstance[] = [
      { id: 'e1', academicYearId: 'y', examTypeKey: 'S1_REGIONAL_MODEL', startDate: MON, endDate: FRI },
      { id: 'e2', academicYearId: 'y', examTypeKey: 'S1_FINAL', startDate: isoDate('2026-09-17'), endDate: isoDate('2026-09-21') },
    ]
    const issues = checkExamOverlap(instances)
    expect(issues).toHaveLength(1)
    expect(issues[0]?.severity).toBe('WARNING')
    expect(issues[0]?.code).toBe('CALENDAR_EXAM_OVERLAPS_EXAM')
  })

  it('does NOT flag the Grade 12 National Exam overlapping a standard exam — this is the normal case, not a conflict', () => {
    const instances: ExamInstance[] = [
      { id: 'e1', academicYearId: 'y', examTypeKey: 'S1_REGIONAL_MODEL', startDate: MON, endDate: FRI },
      { id: 'e2', academicYearId: 'y', examTypeKey: 'GRADE12_NATIONAL', startDate: MON, endDate: FRI },
    ]
    expect(checkExamOverlap(instances)).toHaveLength(0)
  })

  it('does not flag two closing exams that do not actually overlap', () => {
    const instances: ExamInstance[] = [
      { id: 'e1', academicYearId: 'y', examTypeKey: 'S1_REGIONAL_MODEL', startDate: MON, endDate: FRI },
      { id: 'e2', academicYearId: 'y', examTypeKey: 'S1_FINAL', startDate: isoDate('2026-09-21'), endDate: isoDate('2026-09-25') },
    ]
    expect(checkExamOverlap(instances)).toHaveLength(0)
  })

  it('does not flag a single exam against itself, and returns no issues for an empty/singleton list', () => {
    expect(checkExamOverlap([])).toHaveLength(0)
    expect(
      checkExamOverlap([{ id: 'e1', academicYearId: 'y', examTypeKey: 'S1_FINAL', startDate: MON, endDate: FRI }]),
    ).toHaveLength(0)
  })
})

// --- UX improvement: suggestExamShift ---------------------------------
import { suggestExamShift } from '@/lib/calendar/exams'
import { ethiopianDate } from '@/lib/calendar/ethiopian-date'

describe('suggestExamShift', () => {
  it('finds the nearest clean window in both directions around a weekend-spanning window', () => {
    // The real Ministry-stated S1 regional model window (Hidar 3-7, 2019
    // E.C.), which lands on 2026-11-12 (Thu) -> 2026-11-16 (Mon) and spans
    // a real Sat/Sun.
    const instance = { startDate: ethiopianDate(2019, 3, 3), endDate: ethiopianDate(2019, 3, 7) }
    const suggestions = suggestExamShift(instance, new Map())
    expect(suggestions.length).toBe(2)
    const earlier = suggestions.find((s) => s.direction === 'EARLIER')!
    const later = suggestions.find((s) => s.direction === 'LATER')!
    expect(earlier).toBeDefined()
    expect(later).toBeDefined()
    // Nearest clean 5-day window going later is 4 days later: 2026-11-16
    // (Mon) -> 2026-11-20 (Fri).
    expect(later.startDate).toBe('2026-11-16')
    expect(later.endDate).toBe('2026-11-20')
    expect(later.offsetDays).toBe(4)
    // Nearest clean 5-day window going earlier is 3 days earlier:
    // 2026-11-09 (Mon) -> 2026-11-13 (Fri).
    expect(earlier.startDate).toBe('2026-11-09')
    expect(earlier.endDate).toBe('2026-11-13')
    expect(earlier.offsetDays).toBe(3)
    // Sorted nearest-first (3 days < 4 days).
    expect(suggestions[0]).toBe(earlier)
  })

  it('returns an empty array for a window that already clears both hard stops', () => {
    const instance = { startDate: ethiopianDate(2019, 5, 17), endDate: ethiopianDate(2019, 5, 21) }
    expect(suggestExamShift(instance, new Map())).toEqual([])
  })

  it('skips over a closing holiday that sits immediately next to the originally-invalid date', () => {
    // 1-day exam placed directly ON a closing holiday; the very next day is
    // ALSO a closing holiday, so the nearest clean "LATER" candidate must
    // skip past both, not just the first.
    const start = ethiopianDate(2019, 6, 1)
    const nextDay = ethiopianDate(2019, 6, 2)
    const holidaysByDate = new Map([
      [start, [{ id: 'h1', academicYearId: 'y', holidayTypeKey: 'EID_FITR' as const, date: start, closesSchool: true, source: 'ADMIN_ENTERED' as const, confirmedByUserId: null, confirmedAt: null }]],
      [nextDay, [{ id: 'h2', academicYearId: 'y', holidayTypeKey: 'EID_ADHA' as const, date: nextDay, closesSchool: true, source: 'ADMIN_ENTERED' as const, confirmedByUserId: null, confirmedAt: null }]],
    ])
    const suggestions = suggestExamShift({ startDate: start, endDate: start }, holidaysByDate)
    const later = suggestions.find((s) => s.direction === 'LATER')!
    expect(later).toBeDefined()
    expect(later.startDate).not.toBe(start)
    expect(later.startDate).not.toBe(nextDay)
    expect(later.offsetDays).toBeGreaterThanOrEqual(2)
  })
})
