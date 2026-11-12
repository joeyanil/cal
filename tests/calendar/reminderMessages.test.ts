import { describe, expect, it } from 'vitest'
import { buildReminderMessage, isoDate, whenText, SPECIAL_DAY_SITUATIONS } from '../../src/lib/calendar'
import type { ReminderAudience, ReminderTopic } from '../../src/lib/calendar'

const d = (s: string) => isoDate(s)
const ALL: ReminderAudience[] = ['STUDENT', 'GRADE_12_STUDENT', 'TEACHER', 'HOMEROOM_TEACHER', 'GRADE_12_HOMEROOM_TEACHER', 'OFFICE']
const BANNED = /attendance|roll-call|roll call|no lessons/i

const topics: ReminderTopic[] = [
  { topic: 'TEST', name: 'First half final test', startDate: d('2026-01-12'), endDate: d('2026-01-16') },
  { topic: 'NATIONAL_TEST', startDate: d('2027-06-29'), endDate: d('2027-07-03') },
  { topic: 'HALF_START', halfName: 'Second half', date: d('2027-02-01') },
  { topic: 'HALF_END', halfName: 'First half', date: d('2027-01-30') },
  { topic: 'BREAK_START', date: d('2027-01-31'), resumeDate: d('2027-02-01') },
  { topic: 'SCHOOL_RESUMES', date: d('2027-02-01') },
  { topic: 'STUDENTS_RETURN', date: d('2026-09-10') },
  { topic: 'YEAR_START', date: d('2026-09-14') },
  { topic: 'YEAR_END', date: d('2027-07-07') },
  { topic: 'HOLIDAY', holidayKey: 'TIMKAT', name: 'Timkat (Epiphany)', date: d('2027-01-19'), closesSchoolDay: true },
  { topic: 'DATE_MOVED', itemName: 'First half final test', oldDate: d('2027-01-12'), newDate: d('2027-01-19') },
]

describe('reminder messages', () => {
  it('shows the weekday with the Ethiopian date', () => {
    expect(whenText(d('2027-01-19'))).toMatch(/^Tuesday, Tir 11, 2019$/)
  })

  it('never talks about attendance, roll-call or lessons in any ready-made message', () => {
    for (const t of topics) for (const a of ALL) for (const days of [30, 15, 5] as const) {
      const m = buildReminderMessage(a, t, days)
      if (m) expect(`${m.title} ${m.body}`).not.toMatch(BANNED)
    }
  })

  it('test wording changes tone with the countdown', () => {
    const t = topics[0]!
    const bodies = ([30, 15, 5] as const).map((n) => buildReminderMessage('STUDENT', t, n)!.body)
    expect(new Set(bodies).size).toBe(3)
    expect(bodies[0]).toContain('plenty of time')
    expect(bodies[2]).toContain('Rest well')
  })

  it('national test goes only to Grade 12 students, never to other students', () => {
    const t = topics[1]!
    expect(buildReminderMessage('STUDENT', t, 15)).toBeNull()
    expect(buildReminderMessage('GRADE_12_STUDENT', t, 15)).not.toBeNull()
    expect(buildReminderMessage('GRADE_12_STUDENT', t, 5)!.body).toContain('very best')
    expect(buildReminderMessage('GRADE_12_STUDENT', t, 15)!.body).not.toContain('very best')
  })

  it('holiday says school is closed only when it is a school day, and ends with its greeting', () => {
    const open = buildReminderMessage('STUDENT', topics[9]!, 15)!.body
    expect(open).toContain('School will be closed.')
    expect(open).toContain('Happy Timkat to everyone.')
    const ny = buildReminderMessage('STUDENT', { topic: 'HOLIDAY', holidayKey: 'NEW_YEAR', name: 'Ethiopian New Year', date: d('2026-09-11'), closesSchoolDay: false }, 30)!.body
    expect(ny).not.toContain('closed')
    expect(ny).toContain('Happy New Year to everyone.')
  })

  it('each role reads a different message for the same event', () => {
    const bodies = ALL.filter((a) => a !== 'GRADE_12_STUDENT' && a !== 'GRADE_12_HOMEROOM_TEACHER')
      .map((a) => buildReminderMessage(a, topics[2]!, 15)!.body)
    expect(new Set(bodies).size).toBe(4)
  })

  it('special days: students-come ending, custom wording, default wording', () => {
    const base = { topic: 'SPECIAL_DAY', situation: 'SPORTS_DAY', name: 'Sports Day', startDate: d('2027-03-05'), endDate: null } as const
    expect(buildReminderMessage('STUDENT', { ...base, studentsCome: true }, 15)!.body).toContain('See you at school.')
    expect(buildReminderMessage('STUDENT', { ...base, studentsCome: false }, 15)!.body).toContain('no school for students')
    expect(buildReminderMessage('TEACHER', { ...base, studentsCome: true }, 15)!.body).toContain('Students will be at school.')
    const own = buildReminderMessage('STUDENT', { ...base, situation: 'CUSTOM', studentsCome: true, customMessage: '{name} is on {date}. Bring lunch.' }, 5)!.body
    expect(own).toMatch(/^Sports Day is on Friday, .*Bring lunch\.$/)
    expect(SPECIAL_DAY_SITUATIONS).toHaveLength(11)
  })

  it('teachers training day tells teachers they are expected', () => {
    const m = buildReminderMessage('TEACHER', { topic: 'SPECIAL_DAY', situation: 'TEACHERS_TRAINING', name: "Teachers' training day", startDate: d('2027-03-05'), endDate: null, studentsCome: false }, 15)!
    expect(m.body).toContain('You are expected to attend.')
  })
})
