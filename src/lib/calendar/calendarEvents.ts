/**
 * calendarEvents.ts - every date in the year that people may be reminded of,
 * gathered into one list, plus "where are we today" and the rule for who
 * gets which reminder.
 *
 * Pure: give it the year's facts, get events back. It sends nothing.
 */
import { addDays, differenceInCalendarDays, isAfter, isBefore, isSameOrAfter, isSameOrBefore, isWeekend } from './date-utils'
import type { ISODate } from './date-utils'
import { EXAM_TYPES } from './exams'
import { HOLIDAY_TYPES } from './holidays'
import { buildReminderMessage } from './reminderMessages'
import type { ReminderAudience, ReminderDays, ReminderMessage, ReminderTopic } from './reminderMessages'
import { deriveSemesterBreak } from './semesterBreak'
import { GRADES, affectedGrades, affectsGrade } from './specialDays'
import type { Grade, SpecialDay, TeacherAudience } from './specialDays'
import type { ExamInstance, HolidayOccurrence, Semester } from './types'
import { GRADE12_EXAM_KEY } from './types'

// ---------------------------------------------------------------------------
// The nine groups the school can switch on and off
// ---------------------------------------------------------------------------

export const REMINDER_GROUP_KEYS = [
  'TESTS',
  'HALF_START',
  'HALF_END',
  'BREAK',
  'STUDENTS_RETURN',
  'YEAR_START',
  'YEAR_END',
  'HOLIDAYS',
  'SPECIAL_DAYS',
] as const
export type ReminderGroupKey = (typeof REMINDER_GROUP_KEYS)[number]

export const REMINDER_GROUP_LABELS: Record<ReminderGroupKey, string> = {
  TESTS: 'Tests, including the Grade 12 national test',
  HALF_START: 'Start of each half of the year',
  HALF_END: 'End of each half of the year',
  BREAK: 'The break between the two halves, and when school resumes',
  STUDENTS_RETURN: "Students' return day",
  YEAR_START: 'First day of the school year',
  YEAR_END: 'Last day of the school year',
  HOLIDAYS: 'Holidays that are switched on',
  SPECIAL_DAYS: 'Special days the school creates',
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export interface CalendarSource {
  year: { id: string; startDate: ISODate; endDate: ISODate }
  semesters: Semester[]
  holidays: HolidayOccurrence[]
  exams: ExamInstance[]
  studentReturn: ISODate | null
  specialDays: SpecialDay[]
}

export interface CalendarEvent {
  /** Stable across date changes, so a moved date can be recognised. */
  key: string
  group: ReminderGroupKey
  /** How the item is named in a "this has moved" message. */
  name: string
  /** The day we count down to (the first day for a range). */
  date: ISODate
  endDate: ISODate | null
  topic: ReminderTopic
  /** Another event on the same day that says the same thing. When that event
   *  is going out, this one stays quiet so nobody gets two messages. */
  duplicateOf: string | null
  /** Only for special days: how teachers and grades are chosen. */
  special: { grades: Grade[] | null; teacherAudience: TeacherAudience } | null
}

export function collectCalendarEvents(source: CalendarSource): CalendarEvent[] {
  const { year } = source
  const events: CalendarEvent[] = []
  const semName = (o: 1 | 2) => `Semester ${o}`

  events.push({
    key: 'YEAR_START', group: 'YEAR_START', name: 'The first day of the school year',
    date: year.startDate, endDate: null, topic: { topic: 'YEAR_START', date: year.startDate },
    duplicateOf: null, special: null,
  })
  events.push({
    key: 'YEAR_END', group: 'YEAR_END', name: 'The last day of the school year',
    date: year.endDate, endDate: null, topic: { topic: 'YEAR_END', date: year.endDate },
    duplicateOf: null, special: null,
  })

  for (const s of source.semesters) {
    if (s.startDate) {
      events.push({
        key: `HALF_START:${s.order}`, group: 'HALF_START', name: `The start of ${semName(s.order)}`,
        date: s.startDate, endDate: null,
        topic: { topic: 'HALF_START', halfName: semName(s.order), date: s.startDate },
        duplicateOf: s.order === 1 && s.startDate === year.startDate ? 'YEAR_START' : null, special: null,
      })
    }
    if (s.endDate) {
      events.push({
        key: `HALF_END:${s.order}`, group: 'HALF_END', name: `The end of ${semName(s.order)}`,
        date: s.endDate, endDate: null,
        topic: { topic: 'HALF_END', halfName: semName(s.order), date: s.endDate },
        duplicateOf: s.order === 2 && s.endDate === year.endDate ? 'YEAR_END' : null, special: null,
      })
    }
  }

  const brk = deriveSemesterBreak(source.semesters)
  if (brk) {
    const resume = addDays(brk.endDate, 1)
    events.push({
      key: 'BREAK_START', group: 'BREAK', name: 'The school break',
      date: brk.startDate, endDate: brk.endDate,
      topic: { topic: 'BREAK_START', date: brk.startDate, resumeDate: resume },
      duplicateOf: null, special: null,
    })
    events.push({
      key: 'SCHOOL_RESUMES', group: 'BREAK', name: 'The day school resumes',
      date: resume, endDate: null, topic: { topic: 'SCHOOL_RESUMES', date: resume },
      duplicateOf: 'HALF_START:2', special: null,
    })
  }

  if (source.studentReturn) {
    events.push({
      key: 'STUDENTS_RETURN', group: 'STUDENTS_RETURN', name: "Students' return day",
      date: source.studentReturn, endDate: null,
      topic: { topic: 'STUDENTS_RETURN', date: source.studentReturn },
      duplicateOf: null, special: null,
    })
  }

  for (const e of source.exams) {
    const type = EXAM_TYPES[e.examTypeKey]
    if (e.examTypeKey === GRADE12_EXAM_KEY) {
      events.push({
        key: `TEST:${e.examTypeKey}`, group: 'TESTS', name: 'The Grade 12 national test',
        date: e.startDate, endDate: e.endDate,
        topic: { topic: 'NATIONAL_TEST', startDate: e.startDate, endDate: e.endDate },
        duplicateOf: null, special: null,
      })
    } else {
      events.push({
        key: `TEST:${e.examTypeKey}`, group: 'TESTS', name: type.name,
        date: e.startDate, endDate: e.endDate,
        topic: { topic: 'TEST', name: type.name, startDate: e.startDate, endDate: e.endDate },
        duplicateOf: null, special: null,
      })
    }
  }

  for (const h of source.holidays) {
    // Only holidays that are switched on, and never ones on a weekend.
    if (!h.closesSchool || isWeekend(h.date)) continue
    const type = HOLIDAY_TYPES[h.holidayTypeKey]
    const insideYear = isSameOrAfter(h.date, year.startDate) && isSameOrBefore(h.date, year.endDate)
    events.push({
      key: `HOLIDAY:${h.holidayTypeKey}`, group: 'HOLIDAYS', name: type.name,
      date: h.date, endDate: null,
      topic: { topic: 'HOLIDAY', holidayKey: h.holidayTypeKey, name: type.name, date: h.date, closesSchoolDay: insideYear },
      duplicateOf: null, special: null,
    })
  }

  for (const d of source.specialDays) {
    events.push({
      key: `SPECIAL:${d.id}`, group: 'SPECIAL_DAYS', name: d.name,
      date: d.startDate, endDate: d.endDate === d.startDate ? null : d.endDate,
      topic: {
        topic: 'SPECIAL_DAY', situation: d.situation, name: d.name,
        startDate: d.startDate, endDate: d.endDate === d.startDate ? null : d.endDate,
        studentsCome: d.studentsCome, customMessage: d.customMessage,
      },
      duplicateOf: null, special: { grades: d.grades, teacherAudience: d.teacherAudience },
    })
  }

  return events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.key < b.key ? -1 : 1))
}

// ---------------------------------------------------------------------------
// Who gets a reminder, and in which words
// ---------------------------------------------------------------------------

export type Recipient =
  | { role: 'STUDENT'; grade: Grade }
  | { role: 'TEACHER'; teachesGrades: Grade[] }
  | { role: 'HOMEROOM_TEACHER'; grade: Grade; teachesGrades?: Grade[] }
  | { role: 'OFFICE' }

/**
 * The message this person should get for this event at this countdown, or
 * null when it is not for them (for example a Grade 9 sports day does not
 * reach Grade 12 students, and the national test never reaches other grades).
 */
export function reminderForRecipient(
  recipient: Recipient,
  event: CalendarEvent,
  days: ReminderDays,
  /** Use another wording (for example "this has moved") for the same people. */
  topicOverride?: ReminderTopic,
): ReminderMessage | null {
  // The Grade 12 national test only concerns Grade 12 students and their
  // homeroom teachers, whatever the wording being used.
  if (event.key === `TEST:${GRADE12_EXAM_KEY}`) {
    if (recipient.role === 'STUDENT' && recipient.grade !== 12) return null
    if (topicOverride && recipient.role === 'HOMEROOM_TEACHER' && recipient.grade !== 12) return null
  }
  const special = event.special
  const affected = special ? affectedGrades({ grades: special.grades }) : [...GRADES]
  const teacherSees = (grades: Grade[], extra?: Grade) =>
    !special ||
    special.teacherAudience === 'ALL_TEACHERS' ||
    grades.some((g) => affected.includes(g)) ||
    (extra !== undefined && affected.includes(extra))

  let audience: ReminderAudience
  switch (recipient.role) {
    case 'STUDENT':
      if (special && !affectsGrade({ grades: special.grades }, recipient.grade)) return null
      audience = recipient.grade === 12 ? 'GRADE_12_STUDENT' : 'STUDENT'
      break
    case 'TEACHER':
      if (!teacherSees(recipient.teachesGrades)) return null
      audience = 'TEACHER'
      break
    case 'HOMEROOM_TEACHER':
      if (!teacherSees(recipient.teachesGrades ?? [], recipient.grade)) return null
      audience = recipient.grade === 12 ? 'GRADE_12_HOMEROOM_TEACHER' : 'HOMEROOM_TEACHER'
      break
    case 'OFFICE':
      audience = 'OFFICE'
      break
  }
  return buildReminderMessage(audience, topicOverride ?? event.topic, days)
}

// ---------------------------------------------------------------------------
// Where are we today, and what is coming
// ---------------------------------------------------------------------------

export type YearPhase = 'BEFORE_YEAR' | 'SEMESTER_1' | 'BREAK' | 'SEMESTER_2' | 'IN_YEAR' | 'AFTER_YEAR'

export interface UpcomingItem {
  key: string
  group: ReminderGroupKey
  name: string
  date: ISODate
  endDate: ISODate | null
  /** 0 = today. */
  daysUntil: number
}

export interface CalendarPosition {
  today: ISODate
  phase: YearPhase
  /** Which day of the school year it is (1 = first day); null outside the year. */
  dayOfYear: number | null
  daysLeftInYear: number | null
  daysUntilYearStarts: number | null
  currentSemester: { order: 1 | 2; dayOfSemester: number; daysLeft: number } | null
  /** Items happening today (a test, a special day, a holiday ...). */
  today_items: UpcomingItem[]
  /** Everything still to come, soonest first. */
  upcoming: UpcomingItem[]
  nextTest: UpcomingItem | null
  nextHoliday: UpcomingItem | null
  nextSpecialDay: UpcomingItem | null
}

export function calendarPosition(source: CalendarSource, today: ISODate): CalendarPosition {
  const { year } = source
  const events = collectCalendarEvents(source)
  const toItem = (e: CalendarEvent): UpcomingItem => ({
    key: e.key, group: e.group, name: e.name, date: e.date, endDate: e.endDate,
    daysUntil: differenceInCalendarDays(e.date, today),
  })

  const s1 = source.semesters.find((s) => s.order === 1)
  const s2 = source.semesters.find((s) => s.order === 2)
  const inRange = (a: ISODate | null | undefined, b: ISODate | null | undefined) =>
    !!a && !!b && isSameOrAfter(today, a) && isSameOrBefore(today, b)

  let phase: YearPhase
  let currentSemester: CalendarPosition['currentSemester'] = null
  if (isBefore(today, year.startDate)) phase = 'BEFORE_YEAR'
  else if (isAfter(today, year.endDate)) phase = 'AFTER_YEAR'
  else if (inRange(s1?.startDate, s1?.endDate)) {
    phase = 'SEMESTER_1'
    currentSemester = { order: 1, dayOfSemester: differenceInCalendarDays(today, s1!.startDate!) + 1, daysLeft: differenceInCalendarDays(s1!.endDate!, today) }
  } else if (inRange(s2?.startDate, s2?.endDate)) {
    phase = 'SEMESTER_2'
    currentSemester = { order: 2, dayOfSemester: differenceInCalendarDays(today, s2!.startDate!) + 1, daysLeft: differenceInCalendarDays(s2!.endDate!, today) }
  } else {
    const brk = deriveSemesterBreak(source.semesters)
    phase = brk && inRange(brk.startDate, brk.endDate) ? 'BREAK' : 'IN_YEAR'
  }

  const insideYear = phase !== 'BEFORE_YEAR' && phase !== 'AFTER_YEAR'
  const todayItems = events
    .filter((e) => isSameOrBefore(e.date, today) && isSameOrAfter(e.endDate ?? e.date, today))
    .map(toItem)
  const upcoming = events.filter((e) => isAfter(e.date, today)).map(toItem)

  return {
    today,
    phase,
    dayOfYear: insideYear ? differenceInCalendarDays(today, year.startDate) + 1 : null,
    daysLeftInYear: insideYear ? differenceInCalendarDays(year.endDate, today) : null,
    daysUntilYearStarts: phase === 'BEFORE_YEAR' ? differenceInCalendarDays(year.startDate, today) : null,
    currentSemester,
    today_items: todayItems,
    upcoming,
    nextTest: upcoming.find((u) => u.group === 'TESTS') ?? null,
    nextHoliday: upcoming.find((u) => u.group === 'HOLIDAYS') ?? null,
    nextSpecialDay: upcoming.find((u) => u.group === 'SPECIAL_DAYS') ?? null,
  }
}
