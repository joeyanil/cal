/**
 * Turns engine messages into something an admin can read: ISO dates become
 * Ethiopian dates ("2026-11-14" -> "Hidar 5, 2019") and internal keys become
 * names ("S1_FINAL" -> "Semester 1 Final Exam"). Works on any message, so
 * every screen that shows validation text can use it without each rule
 * having to know about presentation.
 */
import { formatEthiopian } from './ethiopian-date'
import { HOLIDAY_TYPES } from './holidays'
import { EXAM_TYPES } from './exams'
import type { ISODate } from './date-utils'

const ISO_DATE = /\b(\d{4}-\d{2}-\d{2})\b/g
const KEYS: Record<string, string> = {
  ...Object.fromEntries(Object.values(HOLIDAY_TYPES).map((h) => [h.key, h.name])),
  ...Object.fromEntries(Object.values(EXAM_TYPES).map((e) => [e.key, e.name])),
}
const KEY_PATTERN = new RegExp(`\\b(${Object.keys(KEYS).join('|')})\\b`, 'g')

export function localizeMessage(message: string): string {
  return message
    .replace(ISO_DATE, (iso) => {
      try {
        return formatEthiopian(iso as ISODate)
      } catch {
        return iso
      }
    })
    .replace(KEY_PATTERN, (key) => KEYS[key] ?? key)
}

import { toEthiopian, ETHIOPIAN_MONTH_NAMES_EN } from './ethiopian-date'
import { weekdayName } from './date-utils'

/** "Hidar 5" — month and day only, for screens that already state the year. */
export function formatShortEthiopian(date: ISODate): string {
  const ec = toEthiopian(date)
  return `${ETHIOPIAN_MONTH_NAMES_EN[ec.month - 1]} ${ec.day}`
}

/** "Saturday" */
export function formatWeekday(date: ISODate): string {
  const w = weekdayName(date).toLowerCase()
  return w.charAt(0).toUpperCase() + w.slice(1)
}

/** "Hidar 5 (Saturday)" */
export function formatShortWithWeekday(date: ISODate): string {
  return `${formatShortEthiopian(date)} (${formatWeekday(date)})`
}

import type { ValidationIssue, ValidationSeverity } from './types'

export interface FriendlyLine {
  text: string
  severity: ValidationSeverity
}

function holidayNameOf(issue: ValidationIssue): string | null {
  const refs = [issue.ref, ...(issue.relatedRefs ?? [])]
  for (const r of refs) {
    if (r && r.kind === 'HOLIDAY_OCCURRENCE') return HOLIDAY_TYPES[r.holidayTypeKey]?.name ?? null
  }
  return null
}

/**
 * One plain-English line per problem. A Saturday and a Sunday inside the same
 * exam window become one "includes a weekend" line rather than two, and exam
 * placement codes get wording an admin can act on. Everything else falls back
 * to the engine's message with dates and names made readable.
 */
export function friendlyLines(issues: ValidationIssue[]): FriendlyLine[] {
  const lines: FriendlyLine[] = []
  const weekend = issues.filter((i) => i.code === 'CALENDAR_EXAM_ON_WEEKEND' && i.date).map((i) => i.date!)
  if (weekend.length === 1) {
    lines.push({ severity: 'ERROR', text: `${formatShortWithWeekday(weekend[0]!)} is a weekend \u2014 no exams on Saturday or Sunday.` })
  } else if (weekend.length === 2) {
    lines.push({
      severity: 'ERROR',
      text: `${formatShortEthiopian(weekend[0]!)} \u2013 ${formatShortEthiopian(weekend[1]!)} is a weekend (${formatWeekday(weekend[0]!)}\u2013${formatWeekday(weekend[1]!)}) \u2014 no exams on Saturday or Sunday.`,
    })
  } else if (weekend.length > 2) {
    lines.push({
      severity: 'ERROR',
      text: `This window includes ${weekend.length} weekend days (${formatShortEthiopian(weekend[0]!)} \u2013 ${formatShortEthiopian(weekend[weekend.length - 1]!)}) \u2014 no exams on Saturday or Sunday.`,
    })
  }
  for (const i of issues) {
    if (i.code === 'CALENDAR_EXAM_ON_WEEKEND') continue
    const name = holidayNameOf(i)
    const when = i.date ? formatShortWithWeekday(i.date) : ''
    let text: string
    switch (i.code) {
      case 'CALENDAR_EXAM_ON_CLOSING_HOLIDAY':
        text = `${when} is a school holiday${name ? ` (${name})` : ''}.`
        break
      case 'CALENDAR_EXAM_IN_HOLIDAY_WEEK':
        text = `That week has a holiday on ${when}${name ? ` (${name})` : ''} \u2014 no exams in a holiday week.`
        break
      case 'CALENDAR_EXAM_INVALID_RANGE':
        text = 'The end date is before the start date.'
        break
      default:
        text = localizeMessage(i.message)
    }
    lines.push({ severity: i.severity, text })
  }
  return lines
}
