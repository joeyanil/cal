import { isValidISODate } from '../calendar'
import type { ISODate } from '../calendar'
import { AppError } from '../errors/AppError'

/** Today's date at the school (Ethiopia is UTC+3 all year). */
export function schoolToday(now: Date = new Date()): ISODate {
  return new Date(now.getTime() + 3 * 3600 * 1000).toISOString().slice(0, 10) as ISODate
}

/** Reads an optional ?date=YYYY-MM-DD, defaulting to today at the school. */
export function dateParam(raw: string | null): ISODate {
  if (raw === null || raw === '') return schoolToday()
  if (!isValidISODate(raw)) throw new AppError('VALIDATION_ERROR', 422, `Query parameter "date" is not a valid calendar date: "${raw}".`)
  return raw as ISODate
}
