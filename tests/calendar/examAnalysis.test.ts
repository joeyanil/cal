import { describe, it, expect } from 'vitest'
import { analyzeExamWindow, checkExamHardStops, suggestExamShift } from '@/lib/calendar/exams'
import { ethiopianDate as E } from '@/lib/calendar/ethiopian-date'
import { createHolidayOccurrence, proposeFixedHolidayOccurrences, indexHolidaysByDate } from '@/lib/calendar/holidays'
import { eachDayInclusive, addDays } from '@/lib/calendar/date-utils'
import type { ExamTypeKey, HolidayOccurrence, Semester } from '@/lib/calendar/types'

const Y = 2019
const id = 'y'
const semesters: Semester[] = [
  { id: 's1', academicYearId: id, order: 1, startDate: E(Y, 1, 5), endDate: E(Y, 5, 23), status: 'ACTIVE' },
  { id: 's2', academicYearId: id, order: 2, startDate: E(Y, 6, 1), endDate: E(Y, 10, 30), status: 'UPCOMING' },
] as Semester[]
const academicYear = { startDate: E(Y, 1, 4), endDate: E(Y, 10, 30) }

// The real 2019 holidays from the Ministry plan.
const holidays: HolidayOccurrence[] = [
  ...proposeFixedHolidayOccurrences(id, Y),
  ...(
    [
      ['SIKLET', 8, 22],
      ['FASIKA', 8, 24],
      ['EID_FITR', 6, 30],
      ['EID_ADHA', 9, 8],
    ] as const
  ).map(([k, m, d]) => createHolidayOccurrence({ academicYearId: id, holidayTypeKey: k, ethiopianYear: Y, manualDate: E(Y, m, d) })),
].map((h, i) => ({ ...h, id: 'h' + i })) as HolidayOccurrence[]
const holidaysByDate = indexHolidaysByDate(holidays)
const ctx = { holidaysByDate, semesters, academicYear }

describe('analyzeExamWindow', () => {
  it('real Ministry case: Hidar 3-7 is blocked and gets earlier + later fixes', () => {
    const a = analyzeExamWindow({ examTypeKey: 'S1_REGIONAL_MODEL', startDate: E(Y, 3, 3), endDate: E(Y, 3, 7) }, ctx)
    expect(a.problems.map((p) => p.code)).toContain('CALENDAR_EXAM_ON_WEEKEND')
    expect(a.problems[0]!.date).toBeDefined()
    expect(a.suggestions.map((s) => [s.direction, s.offsetDays])).toEqual([
      ['EARLIER', 3],
      ['LATER', 4],
    ])
  })

  it('a clean window needs no help', () => {
    const a = analyzeExamWindow({ examTypeKey: 'S1_FINAL', startDate: E(Y, 5, 17), endDate: E(Y, 5, 21) }, ctx)
    expect(a.problems).toEqual([])
    expect(a.warnings).toEqual([])
    expect(a.suggestions).toEqual([])
    expect(a.noWindowFound).toBe(false)
  })

  it('start after end: offers the swap, and a clean swap is the only fix shown', () => {
    const a = analyzeExamWindow({ examTypeKey: 'S1_FINAL', startDate: E(Y, 5, 21), endDate: E(Y, 5, 17) }, ctx)
    expect(a.problems.map((p) => p.code)).toEqual(['CALENDAR_EXAM_INVALID_RANGE'])
    expect(a.swapped).toEqual({ startDate: E(Y, 5, 17), endDate: E(Y, 5, 21) })
    expect(a.suggestions).toEqual([])
    expect(a.noWindowFound).toBe(false)
  })

  it('start after end AND the swapped window is bad: shifts are built from the swapped window', () => {
    const a = analyzeExamWindow({ examTypeKey: 'S1_REGIONAL_MODEL', startDate: E(Y, 3, 7), endDate: E(Y, 3, 3) }, ctx)
    expect(a.swapped).not.toBeNull()
    expect(a.suggestions.length).toBe(2)
    for (const s of a.suggestions) expect(checkExamHardStops(s, holidaysByDate)).toEqual([])
  })

  it('suggestions never leave the exam\'s own semester', () => {
    // A 5-day window ending on the last day of Semester 1, shifted onto a weekend.
    const a = analyzeExamWindow({ examTypeKey: 'S1_FINAL', startDate: E(Y, 5, 19), endDate: E(Y, 5, 25) }, ctx)
    for (const s of a.suggestions) {
      expect(s.endDate <= semesters[0]!.endDate!).toBe(true)
      expect(s.startDate >= semesters[0]!.startDate!).toBe(true)
    }
  })

  it('a window crossing the semester edge (warning only) still gets an in-semester suggestion', () => {
    // Semester 1 made to end mid-week (Tir 19, Wed); the S1 Final Tir 17-21
    // is Mon-Fri with no holiday, so the ONLY issue is leaving the semester.
    const shortS1 = [{ ...semesters[0]!, endDate: E(Y, 5, 19) }, semesters[1]!] as Semester[]
    const a = analyzeExamWindow(
      { examTypeKey: 'S1_FINAL', startDate: E(Y, 5, 17), endDate: E(Y, 5, 21) },
      { ...ctx, semesters: shortS1 },
    )
    expect(a.problems).toEqual([])
    expect(a.warnings.map((w) => w.code)).toContain('CALENDAR_EXAM_CROSSES_SEMESTER_BOUNDARY')
    expect(a.suggestions.length).toBeGreaterThan(0)
    expect(a.suggestions.every((s) => s.endDate <= E(Y, 5, 19))).toBe(true)
  })

  it('suggestions avoid another school-closing exam', () => {
    const other = [{ examTypeKey: 'S1_FINAL' as ExamTypeKey, startDate: E(Y, 5, 17), endDate: E(Y, 5, 21) }]
    // Weekend-spanning window right next to the S1 Final.
    const a = analyzeExamWindow(
      { examTypeKey: 'S1_REGIONAL_MODEL', startDate: E(Y, 5, 14), endDate: E(Y, 5, 18) },
      { ...ctx, otherExams: other },
    )
    expect(a.warnings.map((w) => w.code)).toContain('CALENDAR_EXAM_OVERLAPS_OTHER_EXAM')
    for (const s of a.suggestions) {
      const overlaps = s.startDate <= other[0]!.endDate && other[0]!.startDate <= s.endDate
      expect(overlaps).toBe(false)
    }
  })

  it('Grade 12 national exam may overlap a school-closing exam (K2 does not host it)', () => {
    const other = [{ examTypeKey: 'S2_FINAL' as ExamTypeKey, startDate: E(Y, 10, 14), endDate: E(Y, 10, 18) }]
    const a = analyzeExamWindow(
      { examTypeKey: 'GRADE12_NATIONAL', startDate: E(Y, 10, 14), endDate: E(Y, 10, 18) },
      { ...ctx, otherExams: other },
    )
    expect(a.warnings.map((w) => w.code)).not.toContain('CALENDAR_EXAM_OVERLAPS_OTHER_EXAM')
  })

  it('says so when no clean window exists nearby (never silently empty)', () => {
    const a = analyzeExamWindow(
      { examTypeKey: 'S1_FINAL', startDate: E(Y, 5, 17), endDate: E(Y, 5, 25) }, // 9 days: always spans a weekend
      ctx,
    )
    expect(a.problems.length).toBeGreaterThan(0)
    expect(a.suggestions).toEqual([])
    expect(a.noWindowFound).toBe(true)
  })

  it('single-day exam on a holiday is moved to the nearest ordinary day', () => {
    const timkat = holidays.find((h) => h.holidayTypeKey === 'TIMKAT')!
    const a = analyzeExamWindow({ examTypeKey: 'S1_FINAL', startDate: timkat.date, endDate: timkat.date }, ctx)
    expect(a.problems.length).toBeGreaterThan(0)
    for (const s of a.suggestions) expect(checkExamHardStops(s, holidaysByDate)).toEqual([])
  })

  it('suggestExamShift wrapper still works with just a holiday map', () => {
    const s = suggestExamShift({ startDate: E(Y, 3, 3), endDate: E(Y, 3, 7) }, holidaysByDate)
    expect(s.length).toBe(2)
  })
})

describe('brute force: every window in the 2019 school year', () => {
  it('every suggestion ever offered is itself valid, inside bounds, and the same length', () => {
    const keys: ExamTypeKey[] = ['S1_REGIONAL_MODEL', 'S1_FINAL', 'S2_REGIONAL_MODEL', 'S2_FINAL']
    let windows = 0
    let suggested = 0
    for (const key of keys) {
      const sem = semesters[key.startsWith('S1') ? 0 : 1]!
      for (const start of eachDayInclusive(sem.startDate!, sem.endDate!)) {
        for (const len of [1, 2, 3, 5, 6]) {
          const end = addDays(start, len - 1)
          windows++
          const a = analyzeExamWindow({ examTypeKey: key, startDate: start, endDate: end }, ctx)
          for (const s of a.suggestions) {
            suggested++
            expect(checkExamHardStops(s, holidaysByDate), `${key} ${start}..${end} -> ${s.startDate}..${s.endDate}`).toEqual([])
            expect(s.startDate >= sem.startDate! && s.endDate <= sem.endDate!).toBe(true)
            expect(addDays(s.startDate, len - 1)).toBe(s.endDate)
          }
          // If it has a hard problem, the user must always get either a fix or an explicit "none found".
          if (a.problems.length > 0) expect(a.suggestions.length > 0 || a.noWindowFound).toBe(true)
        }
      }
    }
    expect(windows).toBeGreaterThan(1000)
    expect(suggested).toBeGreaterThan(500)
  })
})
