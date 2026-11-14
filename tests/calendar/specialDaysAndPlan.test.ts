import { describe, expect, it } from 'vitest'
import {
  isoDate, dayStatus, validateSpecialDay, collectCalendarEvents, calendarPosition, reminderForRecipient,
  dueRemindersOn, detectMovedItems, movedTopic, DEFAULT_REMINDER_SETTINGS, defaultTeacherAudience,
} from '../../src/lib/calendar'
import type { CalendarSource, SpecialDay, DailyTimelineEntry, ReminderSettings } from '../../src/lib/calendar'

const d = (s: string) => isoDate(s)
const year = { id: 'y1', startDate: d('2026-09-14'), endDate: d('2027-07-07') }

function sd(over: Partial<SpecialDay> = {}): SpecialDay {
  return {
    id: 's1', academicYearId: 'y1', situation: 'SPORTS_DAY', name: 'Sports Day',
    startDate: d('2027-03-05'), endDate: d('2027-03-05'), studentsCome: true, grades: null,
    customMessage: null, teacherAudience: 'AFFECTED_GRADES', ...over,
  }
}
const source = (over: Partial<CalendarSource> = {}): CalendarSource => ({
  year,
  semesters: [
    { id: 'a', academicYearId: 'y1', order: 1, startDate: d('2026-09-14'), endDate: d('2027-01-29'), status: 'UPCOMING' },
    { id: 'b', academicYearId: 'y1', order: 2, startDate: d('2027-02-08'), endDate: d('2027-07-07'), status: 'UPCOMING' },
  ],
  holidays: [], exams: [], studentReturn: null, specialDays: [], ...over,
})

describe('special day validation', () => {
  it('accepts a normal day and flags the usual mistakes', () => {
    expect(validateSpecialDay({ situation: 'SPORTS_DAY', name: 'Sports Day', startDate: d('2027-03-05'), endDate: d('2027-03-05'), studentsCome: true, grades: null }, year)).toEqual([])
    const bad = validateSpecialDay({ situation: 'SPORTS_DAY', name: ' ', startDate: d('2028-01-05'), endDate: d('2028-01-01'), studentsCome: true, grades: [8] }, year)
    expect(bad.map((i) => i.code)).toEqual(expect.arrayContaining(['SPECIAL_DAY_NAME_MISSING', 'SPECIAL_DAY_END_BEFORE_START', 'SPECIAL_DAY_BAD_GRADES']))
  })
  it('flags days outside the year, weekend-only days and unknown fill-in words', () => {
    const codes = (x: Parameters<typeof validateSpecialDay>[0]) => validateSpecialDay(x, year).map((i) => i.code)
    expect(codes({ situation: 'CEREMONY', name: 'X', startDate: d('2026-08-01'), endDate: d('2026-08-01'), studentsCome: true, grades: null })).toContain('SPECIAL_DAY_OUTSIDE_YEAR')
    expect(codes({ situation: 'CEREMONY', name: 'X', startDate: d('2027-03-06'), endDate: d('2027-03-07'), studentsCome: true, grades: null })).toContain('SPECIAL_DAY_ONLY_WEEKEND')
    expect(codes({ situation: 'CUSTOM', name: 'X', startDate: d('2027-03-05'), endDate: d('2027-03-05'), studentsCome: true, grades: null, customMessage: 'Hi {who}' })).toContain('SPECIAL_DAY_UNKNOWN_PLACEHOLDER')
  })
  it('teachers training goes to all teachers by default; the rest to affected grades', () => {
    expect(defaultTeacherAudience('TEACHERS_TRAINING')).toBe('ALL_TEACHERS')
    expect(defaultTeacherAudience('SPORTS_DAY')).toBe('AFFECTED_GRADES')
  })
})

describe('day status', () => {
  const entry = (over: Partial<DailyTimelineEntry> = {}) => ({
    date: d('2027-03-05'), schoolOpen: true, teachingDay: true, attendanceAvailable: true,
    grade12AttendanceAvailable: true, reasons: [], ...over,
  }) as unknown as DailyTimelineEntry

  it('uses the weekday rule before any timeline exists', () => {
    const s = dayStatus({ date: d('2027-03-05'), year, timelineDay: null, specialDays: [] })
    expect(s.source).toBe('PARTIAL_RULE')
    expect(s.attendanceAvailable).toBe(true)
    expect(dayStatus({ date: d('2027-03-06'), year, timelineDay: null, specialDays: [] }).attendanceAvailable).toBe(false)
  })
  it('is never a school day outside the year', () => {
    const s = dayStatus({ date: d('2026-09-01'), year, timelineDay: entry(), specialDays: [] })
    expect(s.source).toBe('OUTSIDE_YEAR')
    expect(s.attendanceAvailable).toBe(false)
  })
  it('Grade 12 has no attendance during the national test; other grades do', () => {
    const t = entry({ grade12AttendanceAvailable: false })
    expect(dayStatus({ date: d('2027-03-05'), year, timelineDay: t, specialDays: [], grade: 12 }).attendanceAvailable).toBe(false)
    expect(dayStatus({ date: d('2027-03-05'), year, timelineDay: t, specialDays: [], grade: 12 }).teachingDay).toBe(false)
    expect(dayStatus({ date: d('2027-03-05'), year, timelineDay: t, specialDays: [], grade: 10 }).attendanceAvailable).toBe(true)
    expect(dayStatus({ date: d('2027-03-05'), year, timelineDay: t, specialDays: [] }).attendanceAvailable).toBe(true)
  })
  it('a whole-school day with no students switches attendance off for everyone', () => {
    const day = sd({ situation: 'TEACHERS_TRAINING', studentsCome: false })
    const s = dayStatus({ date: d('2027-03-05'), year, timelineDay: entry(), specialDays: [day], grade: 11 })
    expect(s.attendanceAvailable).toBe(false)
    expect(s.schoolOpen).toBe(true)
    expect(dayStatus({ date: d('2027-03-05'), year, timelineDay: entry(), specialDays: [day] }).attendanceAvailable).toBe(false)
  })
  it('a grade-only day with no students only affects those grades', () => {
    const day = sd({ studentsCome: false, grades: [9, 10] })
    const args = { date: d('2027-03-05'), year, timelineDay: entry(), specialDays: [day] }
    expect(dayStatus({ ...args, grade: 9 }).attendanceAvailable).toBe(false)
    expect(dayStatus({ ...args, grade: 11 }).attendanceAvailable).toBe(true)
    expect(dayStatus(args).attendanceAvailable).toBe(true)
  })
  it('a day where students come changes nothing', () => {
    expect(dayStatus({ date: d('2027-03-05'), year, timelineDay: entry(), specialDays: [sd()], grade: 9 }).attendanceAvailable).toBe(true)
  })
})

describe('events, position and who gets what', () => {
  it('collects tests, holidays (only those switched on and on weekdays), special days', () => {
    const ev = collectCalendarEvents(source({
      exams: [
        { id: 'e1', academicYearId: 'y1', examTypeKey: 'S1_FINAL', startDate: d('2027-01-18'), endDate: d('2027-01-22') },
        { id: 'e2', academicYearId: 'y1', examTypeKey: 'GRADE12_NATIONAL', startDate: d('2027-06-29'), endDate: d('2027-07-03') },
      ],
      holidays: [
        { id: 'h1', academicYearId: 'y1', holidayTypeKey: 'TIMKAT', date: d('2027-01-19'), closesSchool: true, source: 'AUTO_PROPOSED', confirmedByUserId: null, confirmedAt: null },
        { id: 'h2', academicYearId: 'y1', holidayTypeKey: 'GENNA', date: d('2027-01-07'), closesSchool: false, source: 'AUTO_PROPOSED', confirmedByUserId: null, confirmedAt: null },
        { id: 'h3', academicYearId: 'y1', holidayTypeKey: 'SIKLET', date: d('2027-05-01'), closesSchool: true, source: 'ADMIN_ENTERED', confirmedByUserId: null, confirmedAt: null },
      ],
      specialDays: [sd()],
    }))
    const keys = ev.map((e) => e.key)
    expect(keys).toContain('HOLIDAY:TIMKAT')
    expect(keys).not.toContain('HOLIDAY:GENNA') // switched off
    expect(keys).not.toContain('HOLIDAY:SIKLET') // falls on a Saturday
    expect(keys).toEqual(expect.arrayContaining(['TEST:S1_FINAL', 'TEST:GRADE12_NATIONAL', 'SPECIAL:s1', 'BREAK_START', 'YEAR_START', 'YEAR_END']))
  })

  it('New Year before school starts reminds without saying school is closed', () => {
    const ev = collectCalendarEvents(source({
      holidays: [{ id: 'h', academicYearId: 'y1', holidayTypeKey: 'NEW_YEAR', date: d('2026-09-11'), closesSchool: true, source: 'AUTO_PROPOSED', confirmedByUserId: null, confirmedAt: null }],
    })).find((e) => e.key === 'HOLIDAY:NEW_YEAR')!
    const m = reminderForRecipient({ role: 'STUDENT', grade: 9 }, ev, 30)!
    expect(m.body).not.toContain('closed')
    expect(m.body).toContain('Happy New Year')
  })

  it('recipient rules: national test, grade-only special day, teacher audience', () => {
    const ev = collectCalendarEvents(source({
      exams: [{ id: 'e2', academicYearId: 'y1', examTypeKey: 'GRADE12_NATIONAL', startDate: d('2027-06-29'), endDate: d('2027-07-03') }],
      specialDays: [sd({ grades: [9], teacherAudience: 'AFFECTED_GRADES' }), sd({ id: 's2', situation: 'TEACHERS_TRAINING', studentsCome: false, teacherAudience: 'ALL_TEACHERS' })],
    }))
    const nat = ev.find((e) => e.key === 'TEST:GRADE12_NATIONAL')!
    expect(reminderForRecipient({ role: 'STUDENT', grade: 10 }, nat, 15)).toBeNull()
    expect(reminderForRecipient({ role: 'STUDENT', grade: 12 }, nat, 15)).not.toBeNull()
    expect(reminderForRecipient({ role: 'TEACHER', teachesGrades: [9] }, nat, 15)).not.toBeNull()
    const g9 = ev.find((e) => e.key === 'SPECIAL:s1')!
    expect(reminderForRecipient({ role: 'STUDENT', grade: 9 }, g9, 15)).not.toBeNull()
    expect(reminderForRecipient({ role: 'STUDENT', grade: 12 }, g9, 15)).toBeNull()
    expect(reminderForRecipient({ role: 'TEACHER', teachesGrades: [12] }, g9, 15)).toBeNull()
    expect(reminderForRecipient({ role: 'TEACHER', teachesGrades: [9, 12] }, g9, 15)).not.toBeNull()
    expect(reminderForRecipient({ role: 'HOMEROOM_TEACHER', grade: 9 }, g9, 15)).not.toBeNull()
    expect(reminderForRecipient({ role: 'OFFICE' }, g9, 15)).not.toBeNull()
    const training = ev.find((e) => e.key === 'SPECIAL:s2')!
    expect(reminderForRecipient({ role: 'TEACHER', teachesGrades: [12] }, training, 15)!.body).toContain('expected to attend')
  })

  it('position: phase, countdown and next items', () => {
    const src = source({ exams: [{ id: 'e1', academicYearId: 'y1', examTypeKey: 'S1_FINAL', startDate: d('2027-01-18'), endDate: d('2027-01-22') }], specialDays: [sd()] })
    expect(calendarPosition(src, d('2026-09-01')).phase).toBe('BEFORE_YEAR')
    expect(calendarPosition(src, d('2026-09-01')).daysUntilYearStarts).toBe(13)
    const p = calendarPosition(src, d('2027-01-10'))
    expect(p.phase).toBe('SEMESTER_1')
    expect(p.currentSemester!.daysLeft).toBe(19)
    expect(p.nextTest!.daysUntil).toBe(8)
    expect(p.nextSpecialDay!.name).toBe('Sports Day')
    expect(calendarPosition(src, d('2027-02-02')).phase).toBe('BREAK')
    expect(calendarPosition(src, d('2027-01-20')).today_items.map((i) => i.key)).toContain('TEST:S1_FINAL')
    expect(calendarPosition(src, d('2027-08-01')).phase).toBe('AFTER_YEAR')
  })
})

describe('reminder plan', () => {
  const src = source({
    exams: [{ id: 'e1', academicYearId: 'y1', examTypeKey: 'S1_FINAL', startDate: d('2027-01-18'), endDate: d('2027-01-22') }],
  })
  const events = collectCalendarEvents(src)

  it('fires exactly 30, 15 and 5 days before, never any other day', () => {
    expect(dueRemindersOn(events, DEFAULT_REMINDER_SETTINGS, d('2026-12-19')).map((r) => r.event.key + r.days)).toContain('TEST:S1_FINAL30')
    expect(dueRemindersOn(events, DEFAULT_REMINDER_SETTINGS, d('2027-01-03')).map((r) => r.event.key + r.days)).toContain('TEST:S1_FINAL15')
    expect(dueRemindersOn(events, DEFAULT_REMINDER_SETTINGS, d('2027-01-13')).map((r) => r.event.key + r.days)).toContain('TEST:S1_FINAL5')
    expect(dueRemindersOn(events, DEFAULT_REMINDER_SETTINGS, d('2027-01-04')).filter((r) => r.event.key === 'TEST:S1_FINAL')).toEqual([])
  })
  it('a date entered late does not fire the countdowns it missed', () => {
    const late = collectCalendarEvents(source({ exams: [{ id: 'e1', academicYearId: 'y1', examTypeKey: 'S1_FINAL', startDate: d('2027-01-18'), endDate: d('2027-01-22') }] }))
    expect(dueRemindersOn(late, DEFAULT_REMINDER_SETTINGS, d('2027-01-10')).filter((r) => r.event.key === 'TEST:S1_FINAL')).toEqual([])
  })
  it('respects the school settings: group off, one countdown off', () => {
    const off: ReminderSettings = { ...DEFAULT_REMINDER_SETTINGS, TESTS: { enabled: false, send30: true, send15: true, send5: true } }
    expect(dueRemindersOn(events, off, d('2027-01-03')).filter((r) => r.event.group === 'TESTS')).toEqual([])
    const no15: ReminderSettings = { ...DEFAULT_REMINDER_SETTINGS, TESTS: { enabled: true, send30: true, send15: false, send5: true } }
    expect(dueRemindersOn(events, no15, d('2027-01-03')).filter((r) => r.event.group === 'TESTS')).toEqual([])
    expect(dueRemindersOn(events, no15, d('2027-01-13')).filter((r) => r.event.group === 'TESTS')).toHaveLength(1)
  })
  it('never sends the same reminder twice', () => {
    const first = dueRemindersOn(events, DEFAULT_REMINDER_SETTINGS, d('2027-01-03')).filter((r) => r.event.group === 'TESTS')
    const sent = new Set(first.map((r) => r.dispatchKey))
    expect(dueRemindersOn(events, DEFAULT_REMINDER_SETTINGS, d('2027-01-03'), sent).filter((r) => r.event.group === 'TESTS')).toEqual([])
  })
  it('stays quiet on a duplicate: semester 2 start and school resumes are the same day', () => {
    const resumeDay = d('2027-02-08')
    const at15 = dueRemindersOn(events, DEFAULT_REMINDER_SETTINGS, d('2027-01-24')).filter((r) => r.event.date === resumeDay)
    expect(at15.map((r) => r.event.key)).toEqual(['HALF_START:2'])
    const halfOff: ReminderSettings = { ...DEFAULT_REMINDER_SETTINGS, HALF_START: { enabled: false, send30: true, send15: true, send5: true } }
    expect(dueRemindersOn(events, halfOff, d('2027-01-24')).filter((r) => r.event.date === resumeDay).map((r) => r.event.key)).toEqual(['SCHOOL_RESUMES'])
  })
  it('year start and semester 1 start on the same day send one reminder', () => {
    const r = dueRemindersOn(events, DEFAULT_REMINDER_SETTINGS, d('2026-08-15')).map((x) => x.event.key)
    expect(r).toContain('YEAR_START')
    expect(r).not.toContain('HALF_START:1')
  })
  it('notices a moved date, only when it still matters, and never for a first sighting', () => {
    const known = new Map([['TEST:S1_FINAL', { dueDate: d('2027-01-11'), name: 'x', group: 'TESTS' as const }]])
    const moved = detectMovedItems(events, known, DEFAULT_REMINDER_SETTINGS, d('2027-01-02'))
    expect(moved).toHaveLength(1)
    expect(movedTopic(moved[0]!)).toMatchObject({ oldDate: '2027-01-11', newDate: '2027-01-18' })
    expect(detectMovedItems(events, new Map(), DEFAULT_REMINDER_SETTINGS, d('2027-01-02'))).toEqual([])
    expect(detectMovedItems(events, known, DEFAULT_REMINDER_SETTINGS, d('2027-03-01'))).toEqual([])
    const off: ReminderSettings = { ...DEFAULT_REMINDER_SETTINGS, TESTS: { enabled: false, send30: true, send15: true, send5: true } }
    expect(detectMovedItems(events, known, off, d('2027-01-02'))).toEqual([])
  })
})
