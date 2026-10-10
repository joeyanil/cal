import { describe, it, expect } from 'vitest'
import { buildFullYearTimeline } from '@/lib/calendar/timelineBuilder'
import { teachingDayBreakdown } from '@/lib/calendar/teachingDays'
import { draftFromData, fixedHolidaysFor, draftToConfig, summarizeYear, classifyDay, DAY_KINDS } from '@/lib/calendar'
import { ethiopianDate as E } from '@/lib/calendar/ethiopian-date'
import type { AcademicYear } from '@/lib/calendar/types'

const Y = 2019
const year = { id: 'y', yearEc: Y, name: '2019', startDate: E(Y, 1, 4), endDate: E(Y, 10, 30), isDefaultBoundary: false, status: 'PREPARING' } as AcademicYear

// Exactly what was entered on the live site (S1 Regional Model: Tikimt 30 - Hidar 4).
function liveEntries() {
  const d = draftFromData({ year, semesters: [], holidays: [], exams: [], studentReturn: null })
  d.sem1 = { start: E(Y, 1, 5), end: E(Y, 5, 23) }
  d.sem2 = { start: E(Y, 6, 1), end: E(Y, 10, 30) }
  d.movable = { SIKLET: E(Y, 8, 22), FASIKA: E(Y, 8, 24), EID_FITR: E(Y, 6, 30), EID_ADHA: E(Y, 9, 8) }
  d.exams.S1_REGIONAL_MODEL = { start: E(Y, 2, 30), end: E(Y, 3, 4) }
  d.exams.S1_FINAL = { start: E(Y, 5, 17), end: E(Y, 5, 21) }
  d.exams.S2_REGIONAL_MODEL = { start: E(Y, 10, 7), end: E(Y, 10, 11) }
  d.exams.S2_FINAL = { start: E(Y, 10, 14), end: E(Y, 10, 18) }
  d.exams.GRADE12_NATIONAL = { start: E(Y, 10, 21), end: E(Y, 10, 25) }
  d.studentReturn = E(Y, 1, 4)
  const c = draftToConfig(d, year, fixedHolidaysFor('y', Y, []))
  return buildFullYearTimeline({ academicYear: { id: 'y', startDate: c.academicYear.startDate, endDate: c.academicYear.endDate }, semesters: c.semesters, holidayOccurrences: c.holidayOccurrences, examInstances: c.examInstances, studentReturn: c.studentReturn } as never)
}

describe('summarizeYear (the 2019 plan as entered on the live site)', () => {
  const entries = liveEntries()
  const s = summarizeYear(entries)

  it('reproduces the numbers seen on screen: 297 / 180 / 201', () => {
    expect(s.totalDays).toBe(297)
    expect(s.learningDays).toBe(180)
    expect(s.ministryBasisDays).toBe(201)
  })

  it('every day has exactly one kind, and the kinds add up to the total', () => {
    const sum = Object.values(s.counts).reduce((a, b) => a + b, 0)
    expect(sum).toBe(s.totalDays)
    expect(s.counts.OTHER).toBe(0)
    expect(s.learningDays + s.noLessonDays).toBe(s.totalDays)
    expect(DAY_KINDS.every((k) => s.counts[k] >= 0)).toBe(true)
  })

  it('learning days match the engine\'s own teaching-day count', () => {
    expect(s.learningDays).toBe(teachingDayBreakdown(entries).teachingDays)
  })

  it('exam, return and year-end days are what the plan says', () => {
    expect(s.counts.EXAM_CLOSED).toBe(20)
    expect(s.counts.RETURN).toBe(1)
    expect(s.counts.YEAR_END).toBe(1)
    expect(s.g12Days).toBe(5)
  })

  it('weekend holidays (Fasika, Eid al-Adha) are counted as weekend days, not lost school days', () => {
    expect(s.weekendHolidayDays).toBe(2)
    expect(s.counts.HOLIDAY).toBe(s.holidays.filter((h) => !h.onWeekend).length)
  })

  it('semester and month learning days add up to the total', () => {
    expect(s.learningBySemester[1] + s.learningBySemester[2]).toBe(s.learningDays)
    expect(Object.values(s.learningByMonth).reduce((a, b) => a + b, 0)).toBe(s.learningDays)
  })

  it('the Ministry monthly figures that K2 can compare (Megabit 22, Miazia 19) match', () => {
    expect(s.learningByMonth[7]).toBe(22)
    expect(s.learningByMonth[8]).toBe(19)
  })

  it('no day is ever classified as two different things', () => {
    for (const e of entries) expect(typeof classifyDay(e)).toBe('string')
  })
})
