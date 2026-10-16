import { describe, it, expect } from 'vitest'
import { holidayImpact, buildHolidayList } from '@/lib/calendar'
import { proposeFixedHolidayOccurrences } from '@/lib/calendar/holidays'
import { ethiopianDate as E } from '@/lib/calendar/ethiopian-date'
import type { HolidayOccurrence } from '@/lib/calendar/types'

// Worked out independently of the app, straight from the calendar date.
const dow = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay() // 0 = Sunday, 6 = Saturday
const YEARS = Array.from({ length: 21 }, (_, i) => 2015 + i) // 2015 .. 2035 E.C.

describe('holidayImpact is worked out from the date, so it is right in every year', () => {
  it('matches an independent weekday check for every permanent holiday in 21 different years', () => {
    let checked = 0
    for (const y of YEARS) {
      const start = E(y, 1, 5), end = E(y, 10, 30)
      for (const h of proposeFixedHolidayOccurrences('y', y)) {
        const expected = h.date < start ? 'BEFORE_YEAR' : h.date > end ? 'AFTER_YEAR' : dow(h.date) === 0 || dow(h.date) === 6 ? 'WEEKEND' : 'SCHOOL_DAY'
        expect(holidayImpact(h.date, start, end), `${h.holidayTypeKey} ${y}`).toBe(expected)
        checked++
      }
    }
    expect(checked).toBe(21 * 6)
  })

  it('a given holiday lands on different weekdays in different years, so the answer really does change', () => {
    for (const key of ['GENNA', 'TIMKAT', 'ADWA', 'PATRIOTS', 'DERG_DOWNFALL'] as const) {
      const impacts = new Set<string>()
      const weekdays = new Set<number>()
      for (const y of YEARS) {
        const h = proposeFixedHolidayOccurrences('y', y).find((x) => x.holidayTypeKey === key)!
        impacts.add(holidayImpact(h.date, E(y, 1, 5), E(y, 10, 30)))
        weekdays.add(dow(h.date))
      }
      expect(weekdays.size, `${key} weekdays`).toBeGreaterThan(3)
      expect(impacts.has('WEEKEND'), `${key} sometimes a weekend`).toBe(true)
      expect(impacts.has('SCHOOL_DAY'), `${key} sometimes a school day`).toBe(true)
    }
  })

  it('New Year is Meskerem 1, so it depends on where the school year starts, not on the holiday', () => {
    const ny = proposeFixedHolidayOccurrences('y', 2019).find((h) => h.holidayTypeKey === 'NEW_YEAR')!
    expect(holidayImpact(ny.date, E(2019, 1, 4), E(2019, 10, 30))).toBe('BEFORE_YEAR') // year opens on Meskerem 4
    expect(holidayImpact(ny.date, E(2019, 1, 1), E(2019, 10, 30))).toBe('SCHOOL_DAY') // year opens on Meskerem 1 (a Friday)
    expect(holidayImpact(ny.date, E(2019, 1, 10), E(2019, 10, 30))).toBe('BEFORE_YEAR')
  })

  it('the year end also decides: a holiday after the last school day is outside the year', () => {
    const derg = proposeFixedHolidayOccurrences('y', 2019).find((h) => h.holidayTypeKey === 'DERG_DOWNFALL')! // Ginbot 20
    expect(holidayImpact(derg.date, E(2019, 1, 5), E(2019, 10, 30))).toBe('SCHOOL_DAY')
    expect(holidayImpact(derg.date, E(2019, 1, 5), E(2019, 9, 10))).toBe('AFTER_YEAR')
  })

  it('any moving holiday date the school enters is judged by its own weekday', () => {
    const start = E(2019, 1, 5), end = E(2019, 10, 30)
    expect(holidayImpact(E(2019, 8, 22), start, end)).toBe('SCHOOL_DAY') // a Friday
    expect(holidayImpact(E(2019, 8, 24), start, end)).toBe('WEEKEND') // a Sunday
    expect(holidayImpact(E(2019, 8, 23), start, end)).toBe('WEEKEND') // the Saturday between them
    expect(holidayImpact(E(2019, 8, 25), start, end)).toBe('SCHOOL_DAY') // Monday
  })

  it('the holiday list and the on-screen badges can never disagree, in any year', () => {
    for (const y of YEARS) {
      const start = E(y, 1, 5), end = E(y, 10, 30)
      const occ = proposeFixedHolidayOccurrences('y', y).map((h, i) => ({ ...h, id: 'f' + i })) as HolidayOccurrence[]
      const rows = buildHolidayList({ occurrences: occ, notObserved: [], yearStart: start, yearEnd: end })
      for (const o of occ) {
        const status = rows.find((r) => r.key === o.holidayTypeKey)!.status
        const impact = holidayImpact(o.date, start, end)
        expect(status, `${o.holidayTypeKey} ${y}`).toBe(impact === 'SCHOOL_DAY' ? 'COUNTED' : impact === 'WEEKEND' ? 'WEEKEND' : 'OUTSIDE_YEAR')
      }
    }
  })
})
