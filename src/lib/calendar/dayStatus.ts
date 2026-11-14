/**
 * dayStatus.ts - "what is today?" for the rest of the platform.
 *
 * One function answers: is this a school day, is attendance available (for
 * the whole school or for one grade), and why. It combines three sources:
 *
 *   1. the published timeline for the date, when there is one;
 *   2. the partial-set-up rule: before any timeline exists, an ordinary
 *      weekday inside the school year counts as a school day (so Attendance
 *      can start working as soon as the year exists);
 *   3. special days, which can switch attendance off for the grades they
 *      affect when students do not come.
 */
import { isAfter, isBefore, isWeekend } from './date-utils'
import type { ISODate } from './date-utils'
import { affectsGrade, affectsWholeSchool, specialDaysOn } from './specialDays'
import type { Grade, SpecialDay } from './specialDays'
import type { DailyTimelineEntry } from './types'

export type DayStatusSource = 'TIMELINE' | 'PARTIAL_RULE' | 'OUTSIDE_YEAR'

export interface DayStatus {
  date: ISODate
  /** Where the answer came from. */
  source: DayStatusSource
  insideYear: boolean
  /** The grade the question was asked for; null = whole school. */
  grade: Grade | null
  schoolOpen: boolean
  /** Ordinary teaching happens (for this grade, if one was given). */
  teachingDay: boolean
  /** Attendance can be taken (for this grade, if one was given). */
  attendanceAvailable: boolean
  specialDays: SpecialDay[]
  reasons: string[]
}

export interface DayStatusInput {
  date: ISODate
  year: { startDate: ISODate; endDate: ISODate } | null
  timelineDay: DailyTimelineEntry | null
  specialDays: SpecialDay[]
  grade?: Grade | null
}

export function dayStatus(input: DayStatusInput): DayStatus {
  const { date, year, timelineDay } = input
  const grade = input.grade ?? null
  const active = specialDaysOn(input.specialDays, date)

  const insideYear = !!year && !isBefore(date, year.startDate) && !isAfter(date, year.endDate)

  let source: DayStatusSource
  let schoolOpen: boolean
  let teachingDay: boolean
  let attendance: boolean
  const reasons: string[] = []

  if (!insideYear) {
    source = 'OUTSIDE_YEAR'
    schoolOpen = false
    teachingDay = false
    attendance = false
    reasons.push('OUTSIDE_YEAR')
  } else if (timelineDay) {
    source = 'TIMELINE'
    schoolOpen = timelineDay.schoolOpen
    teachingDay = timelineDay.teachingDay
    attendance = grade === 12 ? timelineDay.grade12AttendanceAvailable : timelineDay.attendanceAvailable
    reasons.push(...timelineDay.reasons)
    // Grade 12 is excused from teaching and attendance during the national
    // test, even though the rest of the school carries on.
    if (grade === 12 && teachingDay && !timelineDay.grade12AttendanceAvailable) teachingDay = false
  } else {
    source = 'PARTIAL_RULE'
    const open = !isWeekend(date)
    schoolOpen = open
    teachingDay = open
    attendance = open
    reasons.push(open ? 'NO_TIMELINE_YET' : 'WEEKEND')
  }

  // Special days: students not coming switches attendance and teaching off
  // for the grades affected. A day that affects only some grades never
  // changes the whole-school answer.
  for (const day of active) {
    if (day.studentsCome) {
      reasons.push(`SPECIAL_DAY_STUDENTS_COME:${day.situation}`)
      continue
    }
    const applies = grade === null ? affectsWholeSchool(day) : affectsGrade(day, grade)
    if (applies && attendance) {
      attendance = false
      teachingDay = false
      reasons.push(`SPECIAL_DAY_NO_STUDENTS:${day.situation}`)
    } else if (applies) {
      reasons.push(`SPECIAL_DAY_NO_STUDENTS:${day.situation}`)
    }
  }

  return {
    date,
    source,
    insideYear,
    grade,
    schoolOpen,
    teachingDay,
    attendanceAvailable: attendance,
    specialDays: active,
    reasons,
  }
}

/** Convenience for Attendance: the single yes/no. */
export function isSchoolDay(input: DayStatusInput): boolean {
  return dayStatus(input).attendanceAvailable
}
