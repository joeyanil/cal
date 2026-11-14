/**
 * Special days, day status, reminder settings and the daily reminder job,
 * run against the real database (scripts/local-db/setup.sh).
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { execSync } from 'child_process'
import { readFileSync } from 'fs'
import { createHmac } from 'crypto'
import { createAcademicYear, updateAcademicYearBoundary } from '@/lib/services/academicYear.service'
import { setSemesterDates } from '@/lib/services/semester.service'
import { setExamInstance } from '@/lib/services/exam.service'
import { setStudentReturn } from '@/lib/services/studentReturn.service'
import { enterMovableHoliday } from '@/lib/services/holiday.service'
import { rebuildAndPublishTimeline, getCurrentTimeline } from '@/lib/services/calendarTimeline.service'
import { createSpecialDay, updateSpecialDay, deleteSpecialDay, listSpecialDays } from '@/lib/services/specialDay.service'
import { getDayStatus, getPosition, getYearExportRows } from '@/lib/services/calendarStatus.service'
import { getReminderSettings, updateReminderSettings, runDailyReminders, previewReminders } from '@/lib/services/calendarReminder.service'
import { InMemoryNotificationPort } from '@/lib/services/notification.port'
import { ethiopianDate as E } from '@/lib/calendar/ethiopian-date'
import { addDays } from '@/lib/calendar'

const Y = 2019
const URL = 'http://127.0.0.1:3000'
const SECRET = 'super-secret-jwt-key-at-least-32-characters-long'
const UID = '11111111-1111-4111-8111-111111111111'
const JWT = readFileSync('/tmp/jwt.txt', 'utf8').trim()
const roleJwt = (role: string) => {
  const b = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const h = b({ alg: 'HS256', typ: 'JWT' }), p = b({ role, aud: role, exp: 4102444800 })
  return `${h}.${p}.${createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url')}`
}
const mk = (token: string): any => createClient(URL, token, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${token}` } } })
const supabase = mk(JWT)
const admin = mk(roleJwt('service_role'))
const sql = (q: string) => execSync(`su postgres -c "psql -q -tA -d k2 -c \\"${q}\\""`).toString().trim()

async function ctx() {
  const { data } = await supabase.from('users').select('id,user_type,status').eq('supabase_uid', UID).single()
  return {
    user: { id: data.id, user_type: data.user_type, status: data.status, email: null },
    permissions: new Set(['calendar.view', 'calendar.manage', 'calendar.manage_exams', 'calendar.manage_holidays', 'calendar.build_timeline', 'calendar.manage_dependencies', 'calendar.correct_history']),
    supabaseUid: UID,
  } as any
}

let c: any
let yearId: string
let target: string // a normal teaching day

beforeAll(async () => {
  sql('delete from academic_years')
  sql("update calendar_reminder_settings set enabled=true, send_30=true, send_15=true, send_5=true")
  c = await ctx()
  const y = await createAcademicYear(supabase, c, { yearEc: Y })
  yearId = y.id
  await updateAcademicYearBoundary(supabase, c, yearId, { startDate: E(Y, 1, 4) as any, endDate: E(Y, 10, 30) as any })
  await setSemesterDates(supabase, c, yearId, 1, { startDate: E(Y, 1, 5) as any, endDate: E(Y, 5, 23) as any })
  await setSemesterDates(supabase, c, yearId, 2, { startDate: E(Y, 6, 1) as any, endDate: E(Y, 10, 30) as any })
  await setExamInstance(supabase, c, yearId, { examTypeKey: 'S1_FINAL', startDate: E(Y, 5, 17) as any, endDate: E(Y, 5, 21) as any })
  await setStudentReturn(supabase, c, yearId, { date: E(Y, 1, 4) as any })
  await rebuildAndPublishTimeline(supabase, c, yearId)
  const entries = await getCurrentTimeline(supabase, c, yearId)
  target = entries.filter((e) => e.teachingDay)[40]!.date
})

describe('special days (real database)', () => {
  it('saves, lists, updates and deletes; the whole school is stored as no grades', async () => {
    const { specialDay } = await createSpecialDay(supabase, c, yearId, {
      situation: 'SPORTS_DAY', name: 'Sports Day', startDate: target as any, studentsCome: true, grades: [9, 10, 11, 12],
    })
    expect(specialDay.grades).toBeNull()
    expect(specialDay.endDate).toBe(target)
    expect(specialDay.teacherAudience).toBe('AFFECTED_GRADES')
    expect((await listSpecialDays(supabase, c, yearId)).map((d) => d.name)).toEqual(['Sports Day'])
    const { specialDay: upd } = await updateSpecialDay(supabase, c, yearId, specialDay.id, {
      situation: 'SPORTS_DAY', name: 'Sports Day 2', startDate: target as any, studentsCome: true, grades: [9],
    })
    expect(upd.grades).toEqual([9])
    await deleteSpecialDay(supabase, c, yearId, specialDay.id)
    expect(await listSpecialDays(supabase, c, yearId)).toEqual([])
  })

  it('refuses a day outside the year, bad grades and a missing name', async () => {
    const bad = (x: object) => createSpecialDay(supabase, c, yearId, { situation: 'CEREMONY', name: 'X', startDate: target as any, studentsCome: true, ...x } as any)
    await expect(bad({ startDate: '2010-01-01' })).rejects.toMatchObject({ code: 'CALENDAR_SPECIAL_DAY_INVALID' })
    await expect(bad({ grades: [8] })).rejects.toMatchObject({ code: 'CALENDAR_SPECIAL_DAY_INVALID' })
    await expect(bad({ name: '  ' })).rejects.toMatchObject({ code: 'CALENDAR_SPECIAL_DAY_INVALID' })
  })

  it('the database itself rejects bad grades and an end before the start', () => {
    const ins = (cols: string) => () =>
      sql(`insert into special_days (academic_year_id, situation, name, start_date, end_date, students_come, ${cols}`)
    expect(ins(`grades) values ('${yearId}','CEREMONY','X','${target}','${target}',true,'{8}')`)).toThrow()
    expect(ins(`grades) values ('${yearId}','CEREMONY','X','${target}','2010-01-01',true,null)`)).toThrow()
  })

  it('a closed year refuses new special days', async () => {
    sql(`update academic_years set status='CLOSED' where id='${yearId}'`)
    try {
      await expect(createSpecialDay(supabase, c, yearId, { situation: 'CEREMONY', name: 'X', startDate: target as any, studentsCome: true })).rejects.toMatchObject({ code: 'CALENDAR_YEAR_CLOSED' })
    } finally {
      sql(`update academic_years set status='PREPARING' where id='${yearId}'`)
    }
  })

  it('a day with no students switches attendance off for the grades it affects', async () => {
    const { specialDay } = await createSpecialDay(supabase, c, yearId, {
      situation: 'TEACHERS_TRAINING', name: "Teachers' training day", startDate: target as any, studentsCome: false,
    })
    expect(specialDay.teacherAudience).toBe('ALL_TEACHERS')
    const whole = await getDayStatus(supabase, c, yearId, target as any, null)
    expect(whole.attendanceAvailable).toBe(false)
    expect(whole.schoolOpen).toBe(true)
    expect((await getDayStatus(supabase, c, yearId, target as any, 12)).attendanceAvailable).toBe(false)
    await deleteSpecialDay(supabase, c, yearId, specialDay.id)
    expect((await getDayStatus(supabase, c, yearId, target as any, 12)).attendanceAvailable).toBe(true)
  })

  it('a grade-only day leaves other grades alone, and shows in the year export', async () => {
    const { specialDay } = await createSpecialDay(supabase, c, yearId, {
      situation: 'SCHOOL_TRIP', name: 'Grade 9 trip', startDate: target as any, studentsCome: false, grades: [9],
    })
    expect((await getDayStatus(supabase, c, yearId, target as any, 9)).attendanceAvailable).toBe(false)
    expect((await getDayStatus(supabase, c, yearId, target as any, 11)).attendanceAvailable).toBe(true)
    const rows = await getYearExportRows(supabase, c, yearId)
    expect(rows.find((r) => r.date === target)!.whatIsOn).toContain('Grade 9 trip (Grade 9) - students stay home')
    await deleteSpecialDay(supabase, c, yearId, specialDay.id)
  })

  it('day status before any timeline exists uses the weekday rule', async () => {
    const y2 = await createAcademicYear(supabase, c, { yearEc: Y + 1 })
    const s = await getDayStatus(supabase, c, y2.id, E(Y + 1, 2, 10) as any, null)
    expect(s.source).toBe('PARTIAL_RULE')
    sql(`delete from academic_years where id='${y2.id}'`)
  })

  it('position tells where we are and what comes next', async () => {
    const p = await getPosition(supabase, c, yearId, E(Y, 4, 1) as any)
    expect(p.phase).toBe('SEMESTER_1')
    expect(p.nextTest?.name).toBe('Semester 1 Final Exam')
    expect(p.teachingDaysLeftInYear).toBeGreaterThan(0)
  })
})

describe('reminder settings and the daily job (real database)', () => {
  it('shows nine groups, all on, and saves changes', async () => {
    const before = await getReminderSettings(supabase, c)
    expect(before).toHaveLength(9)
    expect(before.every((g) => g.enabled && g.send30 && g.send15 && g.send5)).toBe(true)
    const after = await updateReminderSettings(supabase, c, { groups: [{ key: 'HOLIDAYS', send30: false }] })
    expect(after.find((g) => g.key === 'HOLIDAYS')!.send30).toBe(false)
    await updateReminderSettings(supabase, c, { groups: [{ key: 'HOLIDAYS', send30: true }] })
  })

  const people = [
    { userId: 's12', recipient: { role: 'STUDENT', grade: 12 } },
    { userId: 's9', recipient: { role: 'STUDENT', grade: 9 } },
    { userId: 't', recipient: { role: 'TEACHER', teachesGrades: [9, 10] } },
    { userId: 'o', recipient: { role: 'OFFICE' } },
  ] as any

  it('does nothing, and remembers nothing, when there is nobody to send to', async () => {
    const out = await runDailyReminders(admin, new InMemoryNotificationPort([]), addDays(E(Y, 5, 17) as any, -15))
    expect(out.skipped).toBe('NO_RECIPIENTS')
    expect(sql('select count(*) from calendar_reminder_dispatch')).toBe('0')
  })

  it('sends a countdown once, to the right people, in their own words', async () => {
    const day = addDays(E(Y, 5, 17) as any, -15)
    const port = new InMemoryNotificationPort(people)
    const first = await runDailyReminders(admin, port, day)
    expect(first.remindersSent).toBeGreaterThanOrEqual(1)
    const finals = port.delivered.filter((n) => n.title.startsWith('Semester 1 Final Exam'))
    expect(finals.map((n) => n.userId).sort()).toEqual(['o', 's12', 's9', 't'])
    expect(finals.find((n) => n.userId === 's9')!.message).toContain('Two weeks to go. Keep your revision on track.')
    expect(finals.find((n) => n.userId === 'o')!.message).toContain('Please make sure everything is ready.')
    // Running again the same day sends nothing new.
    const before = port.delivered.length
    const second = await runDailyReminders(admin, port, day)
    expect(second.remindersSent).toBe(0)
    expect(port.delivered.length).toBe(before)
  })

  it('announces a moved date once, then the new countdown follows the new date', async () => {
    const port = new InMemoryNotificationPort(people)
    await setExamInstance(supabase, c, yearId, { examTypeKey: 'S1_FINAL', startDate: E(Y, 5, 24) as any, endDate: E(Y, 5, 28) as any })
    const today = addDays(E(Y, 5, 17) as any, -14)
    const out = await runDailyReminders(admin, port, today)
    expect(out.movedSent).toBeGreaterThanOrEqual(1)
    const moved = port.delivered.filter((n) => n.type === 'CALENDAR_CHANGE' && n.title.includes('Final Exam'))
    expect(moved.length).toBeGreaterThan(0)
    expect(moved.find((n) => n.userId === 't')!.message).toContain('Please adjust your plans.')
    const again = await runDailyReminders(admin, port, today)
    expect(again.movedSent).toBe(0)
  })

  it('the admin can preview the whole schedule and the exact words', async () => {
    const p = await previewReminders(supabase, c, yearId, addDays(E(Y, 5, 24) as any, -15))
    expect(p.schedule.length).toBeGreaterThan(10)
    expect(p.dueToday.some((d) => d.name === 'Semester 1 Final Exam')).toBe(true)
    expect(p.dueToday[0]!.messages.length).toBe(6)
  })
})
