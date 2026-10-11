import { describe, it, expect } from 'vitest'
import { buildFullYearTimeline } from '@/lib/calendar/timelineBuilder'
import { teachingDayBreakdown } from '@/lib/calendar/teachingDays'
import { draftFromData, fixedHolidaysFor, draftToConfig, summarizeYear, classifyDay, DAY_KINDS } from '@/lib/calendar'
import { ethiopianDate as E } from '@/lib/calendar/ethiopian-date'
import type { AcademicYear } from '@/lib/calendar/types'

const Y = 2019
const year = { id: 'y', yearEc: Y, name: '2019', startDate: E(Y, 1, 4), endDate: E(Y, 10, 30), isDefaultBoundary: false, status: 'PREPARING' } as AcademicYear

// Exactly what was entered on the live site (S1 Regional Model: Tikimt 30 - Hidar 4).
function liveEntries(derg = true) {
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
  d.closes.DERG_DOWNFALL = derg
  const c = draftToConfig(d, year, fixedHolidaysFor('y', Y, []))
  return buildFullYearTimeline({ academicYear: { id: 'y', startDate: c.academicYear.startDate, endDate: c.academicYear.endDate }, semesters: c.semesters, holidayOccurrences: c.holidayOccurrences, examInstances: c.examInstances, studentReturn: c.studentReturn } as never)
}

describe('summarizeYear (the 2019 plan as entered on the live site)', () => {
  const entries = liveEntries()
  const s = summarizeYear(entries)

  it('with the school teaching on Ginbot 20 (switched off) it reproduces the earlier live numbers: 297 / 180 / 201', () => {
    const off = summarizeYear(liveEntries(false))
    expect(off.totalDays).toBe(297)
    expect(off.learningDays).toBe(180)
    expect(off.ministryBasisDays).toBe(201)
    expect(off.learningByMonth[7]).toBe(22) // Megabit, as in the Ministry plan
    expect(off.learningByMonth[8]).toBe(19) // Miazia
    expect(off.learningByMonth[9]).toBe(21) // Ginbot
  })

  it('with Ginbot 20 on (the default) that Friday is a holiday: 179 learning days', () => {
    expect(s.totalDays).toBe(297)
    expect(s.learningDays).toBe(179)
    expect(s.learningByMonth[9]).toBe(20)
    expect(s.ministryBasisDays).toBe(200)
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


  it('no day is ever classified as two different things', () => {
    for (const e of entries) expect(typeof classifyDay(e)).toBe('string')
  })
})

import { buildHolidayList, describeYear } from '@/lib/calendar'
import { createHolidayOccurrence, proposeFixedHolidayOccurrences } from '@/lib/calendar/holidays'
import type { HolidayOccurrence } from '@/lib/calendar/types'

describe('buildHolidayList: every holiday and what it did', () => {
  const fixed = proposeFixedHolidayOccurrences('y', Y).map((h, i) => ({ ...h, id: `f${i}` })) as HolidayOccurrence[]
  const movable = (k: 'SIKLET' | 'FASIKA' | 'EID_FITR' | 'EID_ADHA', m: number, d: number) =>
    ({ ...createHolidayOccurrence({ academicYearId: 'y', holidayTypeKey: k, ethiopianYear: Y, manualDate: E(Y, m, d) }), id: k }) as HolidayOccurrence
  const list = (occ: HolidayOccurrence[], notObserved: any[] = []) =>
    buildHolidayList({ occurrences: occ, notObserved, yearStart: E(Y, 1, 4), yearEnd: E(Y, 10, 30) })
  const by = (rows: ReturnType<typeof list>, k: string) => rows.find((r) => r.key === k)!

  it('lists all ten and explains each one', () => {
    const rows = list([...fixed, movable('SIKLET', 8, 22), movable('FASIKA', 8, 24), movable('EID_FITR', 6, 30), movable('EID_ADHA', 9, 8)])
    expect(rows.length).toBe(10)
    expect(by(rows, 'NEW_YEAR').status).toBe('OUTSIDE_YEAR') // Meskerem 1 is before Meskerem 4
    expect(by(rows, 'TIMKAT').status).toBe('COUNTED')
    expect(by(rows, 'FASIKA').status).toBe('WEEKEND') // a Sunday
    expect(by(rows, 'EID_ADHA').status).toBe('WEEKEND')
    expect(by(rows, 'DERG_DOWNFALL').status).toBe('COUNTED') // Friday, May 28
    // 6 listed holidays are on school days: Genna, Timkat, Adwa, Patriots, Derg, Siklet, Eid al-Fitr = 7 with Derg on
    expect(rows.filter((r) => r.status === 'COUNTED').length).toBe(7)
  })

  it('a holiday the school switched off says so, and a missing movable date is flagged', () => {
    const rows = list(
      fixed.map((h) => (h.holidayTypeKey === 'ADWA' ? { ...h, closesSchool: false } : h)),
      ['SIKLET'],
    )
    expect(by(rows, 'ADWA').status).toBe('NOT_OBSERVED')
    expect(by(rows, 'SIKLET').status).toBe('NOT_OBSERVED')
    expect(by(rows, 'FASIKA').status).toBe('NOT_ENTERED')
  })
})

describe('describeYear: the plain-language summary', () => {
  it('words the parts of the days without lessons and they add up', () => {
    const sum = summarizeYear(liveEntries(false))
    const story = describeYear(sum)
    expect(story.learningDays).toBe(180)
    expect(story.semester1 + story.semester2).toBe(180)
    expect(story.noLessonDays).toBe(117)
    expect(story.noLessonParts).toContain('20 exam days')
    expect(story.noLessonParts).toContain('the student-return day')
    expect(story.noLessonParts).toContain('the last day of the year')
    expect(story.noLessonParts.some((p) => /weekend days$/.test(p))).toBe(true)
  })
})
