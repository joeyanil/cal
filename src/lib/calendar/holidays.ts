/**
 * holidays.ts — mission section 8 / Deep Domain File 2, Domain Inventory
 * items 4-5.
 *
 * Two-tier model:
 *   - FIXED:    five permanent holidays with a fixed Ethiopian month/day.
 *               Each year's occurrence date is auto-PROPOSED from that
 *               permanent rule; the admin reviews/confirms it, they never
 *               hand-type it.
 *   - MOVABLE:  four holidays (Siklet, Fasika, Eid al-Fitr, Eid al-Adha)
 *               with NO calculable date. Every single year, every single
 *               one, the admin enters the real date from the Ministry plan.
 *               This module will not calculate one under any circumstance —
 *               there is deliberately no code path that can.
 */
import { AppError } from '../errors/AppError'
import { ethiopianDate } from './ethiopian-date'
import type { ISODate } from './date-utils'
import type {
  FixedHolidayKey,
  HolidayOccurrence,
  HolidayType,
  HolidayTypeKey,
  MovableHolidayKey,
} from './types'
import { FIXED_HOLIDAY_KEYS, MOVABLE_HOLIDAY_KEYS } from './types'

/** The permanent holiday catalog (mission item 8). This is system-wide,
 *  global data — not per-year configuration. */
export const HOLIDAY_TYPES: Record<HolidayTypeKey, HolidayType> = {
  NEW_YEAR: {
    key: 'NEW_YEAR',
    name: 'Ethiopian New Year',
    movable: false,
    fixedEthiopian: { month: 1, day: 1 }, // Meskerem 1
  },
  GENNA: {
    key: 'GENNA',
    name: 'Genna (Christmas)',
    movable: false,
    fixedEthiopian: { month: 4, day: 29 }, // Tahsas 29
  },
  TIMKAT: {
    key: 'TIMKAT',
    name: 'Timkat (Epiphany)',
    movable: false,
    fixedEthiopian: { month: 5, day: 11 }, // Tir 11
  },
  ADWA: {
    key: 'ADWA',
    name: 'Adwa Victory Day',
    movable: false,
    fixedEthiopian: { month: 6, day: 23 }, // Yekatit 23
  },
  PATRIOTS: {
    key: 'PATRIOTS',
    name: "Patriots' Day",
    movable: false,
    fixedEthiopian: { month: 8, day: 27 }, // Miazia 27
  },
  DERG_DOWNFALL: {
    key: 'DERG_DOWNFALL',
    name: 'Downfall of the Derg',
    movable: false,
    fixedEthiopian: { month: 9, day: 20 }, // Ginbot 20
  },
  SIKLET: { key: 'SIKLET', name: 'Siklet (Good Friday)', movable: true },
  FASIKA: { key: 'FASIKA', name: 'Fasika (Easter)', movable: true },
  EID_FITR: { key: 'EID_FITR', name: 'Eid al-Fitr', movable: true },
  EID_ADHA: { key: 'EID_ADHA', name: 'Eid al-Adha (Arefa)', movable: true },
}

export function isFixedHoliday(key: HolidayTypeKey): key is FixedHolidayKey {
  return (FIXED_HOLIDAY_KEYS as readonly string[]).includes(key)
}

export function isMovableHoliday(key: HolidayTypeKey): key is MovableHolidayKey {
  return (MOVABLE_HOLIDAY_KEYS as readonly string[]).includes(key)
}

/**
 * Auto-proposes this year's occurrence date for a FIXED holiday, from its
 * permanent Ethiopian month/day and the academic year's Ethiopian year
 * number. Throws if called on a movable holiday — that is a programming
 * error, not a user-triggerable one, since callers must branch on
 * `isMovableHoliday` first.
 */
export function proposeFixedHolidayDate(key: FixedHolidayKey, ethiopianYear: number): ISODate {
  const type = HOLIDAY_TYPES[key]
  if (!type.fixedEthiopian) {
    throw new Error(`proposeFixedHolidayDate called on non-fixed holiday: ${key}`)
  }
  return ethiopianDate(ethiopianYear, type.fixedEthiopian.month, type.fixedEthiopian.day)
}

/**
 * Builds the auto-proposed set of occurrences for all five fixed holidays
 * for a given academic year — the starting point the admin reviews/confirms
 * rather than hand-entering (mission item 8). `closesSchool` defaults to
 * true per the design's stated default.
 */
export function proposeFixedHolidayOccurrences(
  academicYearId: string,
  ethiopianYear: number,
): Array<Omit<HolidayOccurrence, 'id'>> {
  return FIXED_HOLIDAY_KEYS.map((key) => ({
    academicYearId,
    holidayTypeKey: key,
    date: proposeFixedHolidayDate(key, ethiopianYear),
    closesSchool: true,
    source: 'AUTO_PROPOSED' as const,
    confirmedByUserId: null,
    confirmedAt: null,
  }))
}

/**
 * Validates a movable-holiday occurrence payload before it is persisted.
 * This is the enforcement point for mission item 8's hard rule: the date
 * must come from the admin, always, for every one of the four. There is no
 * "calculate it for me" branch to accidentally take.
 */
export function assertMovableHolidayManuallyEntered(
  key: MovableHolidayKey,
  date: ISODate | null | undefined,
): asserts date is ISODate {
  if (!date) {
    throw new AppError(
      'CALENDAR_MOVABLE_HOLIDAY_REQUIRES_MANUAL_DATE',
      422,
      `${HOLIDAY_TYPES[key].name} has no calculable date — enter the confirmed Ministry-plan date.`,
    )
  }
}

/** Builds a new holiday-occurrence record, routing fixed vs. movable
 *  holidays through their correct (and only correct) path. This is the one
 *  function services should call rather than constructing occurrences by
 *  hand, so the fixed/movable split can never be bypassed accidentally. */
export function createHolidayOccurrence(params: {
  academicYearId: string
  holidayTypeKey: HolidayTypeKey
  ethiopianYear: number
  /** Required for movable holidays; ignored (recomputed) for fixed ones. */
  manualDate?: ISODate
  closesSchool?: boolean
}): Omit<HolidayOccurrence, 'id'> {
  const { academicYearId, holidayTypeKey, ethiopianYear, manualDate, closesSchool } = params

  if (isFixedHoliday(holidayTypeKey)) {
    return {
      academicYearId,
      holidayTypeKey,
      date: proposeFixedHolidayDate(holidayTypeKey, ethiopianYear),
      closesSchool: closesSchool ?? true,
      source: 'AUTO_PROPOSED',
      confirmedByUserId: null,
      confirmedAt: null,
    }
  }

  const key = holidayTypeKey as MovableHolidayKey
  assertMovableHolidayManuallyEntered(key, manualDate)
  return {
    academicYearId,
    holidayTypeKey: key,
    date: manualDate,
    closesSchool: closesSchool ?? true,
    source: 'ADMIN_ENTERED',
    confirmedByUserId: null,
    confirmedAt: null,
  }
}

/** Builds an O(1)-lookup map of date -> every holiday occurrence landing on
 *  it, for the timeline builder and for the exam/student-return hard-stop
 *  checks. Two occurrences landing on the same date is unusual (Deep Domain
 *  File 3 §F/§G) but must never be silently collapsed to one — a caller
 *  checking "is there a closing holiday here" that only saw the first
 *  (non-closing) of two occurrences would miss a real closure. */
export function indexHolidaysByDate(
  occurrences: HolidayOccurrence[],
): Map<ISODate, HolidayOccurrence[]> {
  const map = new Map<ISODate, HolidayOccurrence[]>()
  for (const occurrence of occurrences) {
    const existing = map.get(occurrence.date)
    if (existing) existing.push(occurrence)
    else map.set(occurrence.date, [occurrence])
  }
  return map
}
