/**
 * specialDays.ts - days the school adds itself (sports day, parents' meeting,
 * teachers' training, a trip, a ceremony ...).
 *
 * A special day says whether students come to school and which grades it
 * touches. It sits BESIDE the published timeline as an overlay: adding or
 * changing one never needs a timeline rebuild. `dayStatus.ts` combines the
 * two when someone asks "is attendance available on this day for this grade".
 */
import { isAfter, isBefore, isWeekend, eachDayInclusive } from './date-utils'
import type { ISODate } from './date-utils'
import { SPECIAL_DAY_INFO, SPECIAL_DAY_SITUATIONS } from './reminderMessages'
import type { SpecialDaySituation } from './reminderMessages'
import type { ValidationIssue } from './types'

export const GRADES = [9, 10, 11, 12] as const
export type Grade = (typeof GRADES)[number]

export const TEACHER_AUDIENCES = ['AFFECTED_GRADES', 'ALL_TEACHERS'] as const
export type TeacherAudience = (typeof TEACHER_AUDIENCES)[number]

export interface SpecialDay {
  id: string
  academicYearId: string
  situation: SpecialDaySituation
  name: string
  startDate: ISODate
  /** Same as startDate for a one-day event. */
  endDate: ISODate
  studentsCome: boolean
  /** null = the whole school. */
  grades: Grade[] | null
  /** The admin's own reminder wording; null or empty = the ready-made one. */
  customMessage: string | null
  teacherAudience: TeacherAudience
}

export const CUSTOM_MESSAGE_PLACEHOLDERS = ['name', 'days', 'date', 'endDate'] as const
export const CUSTOM_MESSAGE_MAX = 500

/** Teachers' training day is for every teacher; everything else starts with
 *  the teachers of the affected grades. The admin can change it per day. */
export function defaultTeacherAudience(situation: SpecialDaySituation): TeacherAudience {
  return situation === 'TEACHERS_TRAINING' ? 'ALL_TEACHERS' : 'AFFECTED_GRADES'
}

export function specialDayCovers(day: Pick<SpecialDay, 'startDate' | 'endDate'>, date: ISODate): boolean {
  return !isBefore(date, day.startDate) && !isAfter(date, day.endDate)
}

export function specialDaysOn<T extends Pick<SpecialDay, 'startDate' | 'endDate'>>(days: T[], date: ISODate): T[] {
  return days.filter((d) => specialDayCovers(d, date))
}

export function affectedGrades(day: Pick<SpecialDay, 'grades'>): Grade[] {
  return day.grades === null ? [...GRADES] : day.grades
}

export function affectsGrade(day: Pick<SpecialDay, 'grades'>, grade: Grade): boolean {
  return day.grades === null || day.grades.includes(grade)
}

export function affectsWholeSchool(day: Pick<SpecialDay, 'grades'>): boolean {
  return day.grades === null || GRADES.every((g) => day.grades!.includes(g))
}

export interface SpecialDayDraft {
  situation: SpecialDaySituation
  name: string
  startDate: ISODate
  endDate: ISODate
  studentsCome: boolean
  grades: number[] | null
  customMessage?: string | null
}

/**
 * Checks a special day before it is saved. ERROR stops the save; WARNING is
 * shown but allowed.
 */
export function validateSpecialDay(
  draft: SpecialDayDraft,
  year: { startDate: ISODate; endDate: ISODate },
): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const err = (code: string, message: string, date?: ISODate) =>
    issues.push({ severity: 'ERROR', code, message, ...(date ? { date } : {}) })
  const warn = (code: string, message: string, date?: ISODate) =>
    issues.push({ severity: 'WARNING', code, message, ...(date ? { date } : {}) })

  if (!(SPECIAL_DAY_SITUATIONS as readonly string[]).includes(draft.situation)) {
    err('SPECIAL_DAY_UNKNOWN_SITUATION', 'Pick one of the ready-made situations, or "My own".')
  }
  // Hidden control characters (such as a null byte) break storage and make
  // text look different from what it is: refuse them.
  const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/
  if (CONTROL.test(draft.name) || CONTROL.test(draft.customMessage ?? '')) {
    err('SPECIAL_DAY_BAD_CHARACTERS', 'The name and wording can only contain normal letters, numbers and punctuation.')
  }
  const name = draft.name.trim()
  if (name.length === 0) err('SPECIAL_DAY_NAME_MISSING', 'Give this day a name.')
  if (name.length > 120) err('SPECIAL_DAY_NAME_TOO_LONG', 'The name is too long (120 letters at most).')

  if (isAfter(draft.startDate, draft.endDate)) {
    err('SPECIAL_DAY_END_BEFORE_START', 'The last day cannot be before the first day.', draft.endDate)
  } else {
    if (isBefore(draft.startDate, year.startDate) || isAfter(draft.endDate, year.endDate)) {
      err(
        'SPECIAL_DAY_OUTSIDE_YEAR',
        `This day must be inside the school year (${year.startDate} to ${year.endDate}).`,
        draft.startDate,
      )
    }
    let allWeekend = true
    for (const d of eachDayInclusive(draft.startDate, draft.endDate)) {
      if (!isWeekend(d)) {
        allWeekend = false
        break
      }
    }
    if (allWeekend) warn('SPECIAL_DAY_ONLY_WEEKEND', 'This day falls only on a Saturday or Sunday.', draft.startDate)
  }

  if (draft.grades !== null) {
    const valid = draft.grades.length >= 1 && draft.grades.every((g) => (GRADES as readonly number[]).includes(g))
    if (!valid || new Set(draft.grades).size !== draft.grades.length) {
      err('SPECIAL_DAY_BAD_GRADES', 'Choose the whole school, or one or more of grades 9, 10, 11 and 12.')
    }
  }

  const custom = draft.customMessage?.trim() ?? ''
  if (custom.length > CUSTOM_MESSAGE_MAX) {
    err('SPECIAL_DAY_MESSAGE_TOO_LONG', `Your reminder wording is too long (${CUSTOM_MESSAGE_MAX} letters at most).`)
  }
  if (custom.length > 0) {
    for (const m of custom.matchAll(/\{(\w+)\}/g)) {
      if (!(CUSTOM_MESSAGE_PLACEHOLDERS as readonly string[]).includes(m[1]!)) {
        warn('SPECIAL_DAY_UNKNOWN_PLACEHOLDER', `{${m[1]}} is not one of the fill-in words and will be shown as typed.`)
      }
    }
  }
  if (draft.situation === 'CUSTOM' && custom.length === 0) {
    warn('SPECIAL_DAY_DEFAULT_WORDING', 'No wording written: the plain default reminder will be sent.')
  }
  return issues
}

/** Handy for screens: the starting values when a situation is picked. */
export function situationDefaults(situation: SpecialDaySituation) {
  const info = SPECIAL_DAY_INFO[situation]
  return {
    label: info.label,
    studentsCome: info.defaultStudentsCome,
    teacherAudience: defaultTeacherAudience(situation),
  }
}
