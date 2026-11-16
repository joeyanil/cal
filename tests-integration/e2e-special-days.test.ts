/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Over real HTTP against the running app and the real database: special days,
 * day status, countdown, export, reminder settings, the daily job's secret,
 * the new screens, and the simplified correction in a closed year.
 * Needs the app on 127.0.0.1:3100 (see scripts/local-db/setup.sh).
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'fs'
import { execSync } from 'child_process'
import { ethiopianDate as E } from '@/lib/calendar/ethiopian-date'

const Y = 2019
const JWT = readFileSync('/tmp/jwt.txt', 'utf8').trim()
const UID = '11111111-1111-4111-8111-111111111111'
const session = { access_token: JWT, token_type: 'bearer', expires_in: 3600, expires_at: 4102444800, refresh_token: 'x', user: { id: UID, aud: 'authenticated', role: 'authenticated' } }
const cookie = 'sb-127-auth-token=base64-' + Buffer.from(JSON.stringify(session)).toString('base64url')
const B = 'http://127.0.0.1:3100'
const sql = (q: string) => execSync(`su postgres -c "psql -q -tA -d k2 -c \\"${q}\\""`).toString().trim()

async function api(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const r = await fetch(B + path, { method, headers: { 'content-type': 'application/json', cookie, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) })
  const t = await r.text()
  let j: any
  try { j = JSON.parse(t) } catch { j = { raw: t } }
  return { status: r.status, text: t, ...j }
}
const must = async (label: string, p: Promise<any>) => {
  const r = await p
  if (!r.success) throw new Error(`${label}: ${r.status} ${JSON.stringify(r.error ?? r).slice(0, 300)}`)
  return r
}

let id = ''
let base = ''
let target = ''

beforeAll(async () => {
  sql('delete from academic_years')
  const created = await must('create', api('POST', '/api/v1/academic-years', { yearEc: Y }))
  id = created.data.id
  base = `/api/v1/academic-years/${id}`
  await must('year', api('PATCH', base, { startDate: E(Y, 1, 4), endDate: E(Y, 10, 30) }))
  await must('s1', api('PATCH', `${base}/semesters/1`, { startDate: E(Y, 1, 5), endDate: E(Y, 5, 23) }))
  await must('s2', api('PATCH', `${base}/semesters/2`, { startDate: E(Y, 6, 1), endDate: E(Y, 10, 30) }))
  await must('exam', api('PUT', `${base}/exams`, { examTypeKey: 'S1_FINAL', startDate: E(Y, 5, 17), endDate: E(Y, 5, 21) }))
  await must('return', api('PUT', `${base}/student-return`, { date: E(Y, 1, 4) }))
  const built = await must('build', api('POST', `${base}/timeline/build`))
  await must('publish', api('POST', `${base}/timeline/publish`, { buildId: built.data.buildId ?? built.data.id }))
  const cur = await must('current', api('GET', `${base}/timeline/current`))
  const entries = Array.isArray(cur.data) ? cur.data : cur.data.entries
  target = entries.filter((e: any) => e.teachingDay)[30].date
})

describe('the new API over HTTP', () => {
  it('special days: add, list, bad input gets a clear 422, delete', async () => {
    const bad = await api('POST', `${base}/special-days`, { situation: 'CEREMONY', name: '', startDate: target, studentsCome: true })
    expect(bad.status).toBe(422)
    expect(bad.error.code).toBe('CALENDAR_SPECIAL_DAY_INVALID')
    const add = await api('POST', `${base}/special-days`, { situation: 'TEACHERS_TRAINING', name: "Teachers' training day", startDate: target, studentsCome: false })
    expect(add.status).toBe(201)
    const list = await api('GET', `${base}/special-days`)
    expect(list.data).toHaveLength(1)
    const del = await api('DELETE', `${base}/special-days/${add.data.specialDay.id}`)
    expect(del.success).toBe(true)
    expect((await api('GET', `${base}/special-days`)).data).toHaveLength(0)
  })

  it('day status, position, events, export and the reminder preview answer', async () => {
    const add = await must('add', api('POST', `${base}/special-days`, { situation: 'SCHOOL_TRIP', name: 'Grade 9 trip', startDate: target, studentsCome: false, grades: [9] }))
    const g9 = await api('GET', `${base}/day-status?date=${target}&grade=9`)
    expect(g9.data.attendanceAvailable).toBe(false)
    const g12 = await api('GET', `${base}/day-status?date=${target}&grade=12`)
    expect(g12.data.attendanceAvailable).toBe(true)
    expect((await api('GET', `${base}/day-status?date=${target}&grade=7`)).status).toBe(422)
    expect((await api('GET', `${base}/day-status?date=not-a-date`)).status).toBe(422)
    const pos = await api('GET', `${base}/position?date=${E(Y, 4, 1)}`)
    expect(pos.data.phase).toBe('SEMESTER_1')
    expect(pos.data.nextTest.name).toBe('Semester 1 Final Exam')
    expect((await api('GET', `${base}/events`)).data.length).toBeGreaterThan(5)
    const csv = await fetch(`${B}${base}/export?format=csv`, { headers: { cookie } })
    expect(csv.headers.get('content-type')).toContain('text/csv')
    const bytes = new Uint8Array(await csv.arrayBuffer())
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]) // the mark Excel needs
    const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes)
    expect(text.slice(1).startsWith('Date,Ethiopian date,Weekday')).toBe(true)
    expect(text).toContain('Grade 9 trip (Grade 9) - students stay home')
    expect((await api('GET', `${base}/export`)).data.rows.length).toBeGreaterThan(200)
    const prev = await api('GET', `${base}/reminders/preview?date=${E(Y, 5, 2)}`)
    expect(prev.data.schedule.length).toBeGreaterThan(10)
    await api('DELETE', `${base}/special-days/${add.data.specialDay.id}`)
  })

  it('reminder settings can be read and changed', async () => {
    const s = await api('GET', '/api/v1/calendar/reminder-settings')
    expect(s.data).toHaveLength(9)
    const put = await api('PUT', '/api/v1/calendar/reminder-settings', { groups: [{ key: 'BREAK', send5: false }] })
    expect(put.data.find((g: any) => g.key === 'BREAK').send5).toBe(false)
    await api('PUT', '/api/v1/calendar/reminder-settings', { groups: [{ key: 'BREAK', send5: true }] })
    expect((await api('PUT', '/api/v1/calendar/reminder-settings', { groups: [{ key: 'NOPE' }] })).status).toBe(422)
  })

  it('the daily job refuses anyone without the secret and runs with it', async () => {
    expect((await api('POST', '/api/v1/calendar/reminders/run')).status).toBe(403)
    expect((await api('POST', '/api/v1/calendar/reminders/run', undefined, { 'x-calendar-job-secret': 'wrong' })).status).toBe(403)
    const ok = await api('POST', '/api/v1/calendar/reminders/run', undefined, { 'x-calendar-job-secret': 'test-secret', cookie: '' })
    expect(ok.status).toBe(200)
    expect(ok.data.skipped).toBe('NO_RECIPIENTS')
  })

  it('the new screens open and show their content', async () => {
    const page = async (p: string) => {
      const r = await fetch(B + p, { headers: { cookie } })
      return { status: r.status, html: await r.text() }
    }
    const sd = await page(`/calendar/${id}/special-days`)
    expect(sd.status).toBe(200)
    expect(sd.html).toContain('Add a special day')
    const rm = await page(`/calendar/${id}/reminders`)
    expect(rm.status).toBe(200)
    expect(rm.html).toContain('What the school sends')
    const yr = await page(`/calendar/${id}/year`)
    expect(yr.status).toBe(200)
    expect(yr.html).toContain('Where we are today')
    expect(yr.html).toContain('spreadsheet')
    const ov = await page(`/calendar/${id}`)
    expect(ov.html).toContain('Special days')
    expect(ov.html).toContain('Reminders')
  })

  it('a correction in a closed year just updates the date, with no reason and no record', async () => {
    const before = sql(`select date from holiday_occurrences where academic_year_id='${id}' and holiday_type_key='ADWA'`)
    sql(`update academic_years set status='CLOSED' where id='${id}'`)
    try {
      const r = await api('POST', `${base}/corrections`, { factKind: 'HOLIDAY_OCCURRENCE', factHolidayTypeKey: 'ADWA', correctedValue: E(Y, 6, 24) })
      expect(r.status).toBeLessThan(300)
      expect(r.data.timelineRebuilt).toBe(true)
      const day = await api('GET', `${base}/timeline/day?date=${E(Y, 6, 24)}`)
      expect(day.data.holidays.map((h: any) => h.typeKey)).toContain('ADWA') // the calendar already shows the new date
      const screen = await fetch(`${B}/calendar/${id}/correct`, { headers: { cookie } })
      expect(await screen.text()).toContain('Change a date in this closed year')
      expect(sql(`select date from holiday_occurrences where academic_year_id='${id}' and holiday_type_key='ADWA'`)).toBe(E(Y, 6, 24))
      expect(before).not.toBe(E(Y, 6, 24))
      expect(sql("select to_regclass('public.calendar_corrections') is null")).toBe('t')
      expect((await api('GET', `${base}/corrections`)).status).toBe(405)
    } finally {
      sql(`update academic_years set status='PREPARING' where id='${id}'`)
    }
  })
})
