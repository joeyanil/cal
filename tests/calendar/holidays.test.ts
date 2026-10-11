import { describe, expect, it } from 'vitest'
import { isoDate } from '@/lib/calendar/date-utils'
import {
  createHolidayOccurrence,
  HOLIDAY_TYPES,
  indexHolidaysByDate,
  isFixedHoliday,
  isMovableHoliday,
  proposeFixedHolidayDate,
  proposeFixedHolidayOccurrences,
} from '@/lib/calendar/holidays'
import { AppError } from '@/lib/errors/AppError'

describe('holidays: fixed vs movable classification', () => {
  it('classifies the five fixed holidays correctly', () => {
    expect(isFixedHoliday('NEW_YEAR')).toBe(true)
    expect(isFixedHoliday('GENNA')).toBe(true)
    expect(isFixedHoliday('TIMKAT')).toBe(true)
    expect(isFixedHoliday('ADWA')).toBe(true)
    expect(isFixedHoliday('PATRIOTS')).toBe(true)
  })

  it('classifies the four movable holidays correctly', () => {
    expect(isMovableHoliday('SIKLET')).toBe(true)
    expect(isMovableHoliday('FASIKA')).toBe(true)
    expect(isMovableHoliday('EID_FITR')).toBe(true)
    expect(isMovableHoliday('EID_ADHA')).toBe(true)
  })

  it('a holiday is either fixed or movable, never both, never neither', () => {
    for (const key of Object.keys(HOLIDAY_TYPES) as (keyof typeof HOLIDAY_TYPES)[]) {
      expect(isFixedHoliday(key) !== isMovableHoliday(key)).toBe(true)
    }
  })
})

describe('holidays: fixed-date auto-proposal for 2019 E.C.', () => {
  // Ministry evidence given in the mission spec: fixed holiday Ethiopian dates.
  it('proposes New Year at Meskerem 1', () => {
    const date = proposeFixedHolidayDate('NEW_YEAR', 2019)
    expect(date).toBe('2026-09-11') // Meskerem 1, 2019 -> verified via ethiopian-date round trip
  })

  it('proposes all six fixed holidays with distinct dates, in academic-year order', () => {
    const occurrences = proposeFixedHolidayOccurrences('year-2019', 2019)
    expect(occurrences).toHaveLength(6)
    const dates = occurrences.map((o) => o.date)
    expect(new Set(dates).size).toBe(6) // all distinct
    // every one is source AUTO_PROPOSED, unconfirmed until admin reviews
    for (const o of occurrences) {
      expect(o.source).toBe('AUTO_PROPOSED')
      expect(o.confirmedAt).toBeNull()
      expect(o.closesSchool).toBe(true) // defaults to closed
    }
  })

  it('throws if asked to auto-propose a movable holiday', () => {
    expect(() => proposeFixedHolidayDate('SIKLET' as never, 2019)).toThrow()
  })
})

describe('holidays: movable holidays require manual entry, always', () => {
  it('rejects creating a movable holiday occurrence with no date', () => {
    expect(() =>
      createHolidayOccurrence({
        academicYearId: 'year-2019',
        holidayTypeKey: 'FASIKA',
        ethiopianYear: 2019,
      }),
    ).toThrow(AppError)
  })

  it('accepts a movable holiday occurrence with an explicit Ministry-evidence date (2019 E.C. Fasika: Miazia 24)', () => {
    const occurrence = createHolidayOccurrence({
      academicYearId: 'year-2019',
      holidayTypeKey: 'FASIKA',
      ethiopianYear: 2019,
      manualDate: isoDate('2027-05-01'), // Miazia 24, 2019 — placeholder Gregorian anchor for the test
    })
    expect(occurrence.source).toBe('ADMIN_ENTERED')
    expect(occurrence.date).toBe('2027-05-01')
  })

  it('never calculates Siklet, Fasika, Eid al-Fitr, or Eid al-Adha from any Ethiopian-date rule', () => {
    // There is no code path in holidays.ts that can produce a movable date
    // without an explicit manualDate — this test simply documents/enforces
    // that createHolidayOccurrence has no fallback branch that succeeds
    // without one.
    for (const key of ['SIKLET', 'FASIKA', 'EID_FITR', 'EID_ADHA'] as const) {
      expect(() =>
        createHolidayOccurrence({ academicYearId: 'year-2019', holidayTypeKey: key, ethiopianYear: 2019 }),
      ).toThrow(AppError)
    }
  })
})

describe('holidays: indexHolidaysByDate', () => {
  it('indexes occurrences for O(1) date lookup', () => {
    const occurrences = proposeFixedHolidayOccurrences('year-2019', 2019).map((o, i) => ({ ...o, id: `f${i}` }))
    const index = indexHolidaysByDate(occurrences)
    const newYear = occurrences.find((o) => o.holidayTypeKey === 'NEW_YEAR')
    expect(newYear).toBeDefined()
    expect(index.get(newYear!.date)?.[0]?.holidayTypeKey).toBe('NEW_YEAR')
  })

  it('fix #9: preserves BOTH occurrences if two land on the same date, never drops one', () => {
    const a = createHolidayOccurrence({
      academicYearId: 'y',
      holidayTypeKey: 'NEW_YEAR',
      ethiopianYear: 2019,
    })
    const b = { ...a, holidayTypeKey: 'GENNA' as const } // contrived collision
    const index = indexHolidaysByDate([{ ...a, id: '1' }, { ...b, id: '2' }])
    const onDate = index.get(a.date) ?? []
    expect(onDate).toHaveLength(2)
    expect(onDate.map((h) => h.holidayTypeKey).sort()).toEqual(['GENNA', 'NEW_YEAR'])
  })
})
