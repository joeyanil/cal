/**
 * Runs the app's real service code against a real PostgreSQL + PostgREST built from
 * the repo's SQL (scripts/local-db/setup.sh). Checks, for every one of the ten holidays,
 * that its on/off switch reaches the saved calendar, and that the security rules from
 * migration 0022 hold.
 */
import { describe, it, expect } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { execSync } from 'child_process'
import { readFileSync } from 'fs'
import { createHmac } from 'crypto'
import { createAcademicYear, updateAcademicYearBoundary } from '@/lib/services/academicYear.service'
import { setSemesterDates } from '@/lib/services/semester.service'
import { setExamInstance } from '@/lib/services/exam.service'
import { setStudentReturn } from '@/lib/services/studentReturn.service'
import { enterMovableHoliday, toggleHolidayClosure } from '@/lib/services/holiday.service'
import { rebuildAndPublishTimeline } from '@/lib/services/calendarTimeline.service'
import { ethiopianDate as E } from '@/lib/calendar/ethiopian-date'

const Y = 2019
const URL = 'http://127.0.0.1:3000'
const SECRET = 'super-secret-jwt-key-at-least-32-characters-long'
const UID = '11111111-1111-4111-8111-111111111111'
const JWT = readFileSync('/tmp/jwt.txt', 'utf8').trim()
const anonJwt = (() => {
  const b = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const h = b({ alg: 'HS256', typ: 'JWT' }), p = b({ role: 'anon', aud: 'anon', exp: 4102444800 })
  return `${h}.${p}.${createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url')}`
})()
const supabase: any = createClient(URL, JWT, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${JWT}` } } })
const sql = (q: string) => execSync(`su postgres -c "psql -q -tA -d k2 -c \\"${q}\\""`).toString().trim()

async function makeCtx() {
  const { data } = await supabase.from('users').select('id,user_type,status').eq('supabase_uid', UID).single()
  return {
    user: { id: data.id, user_type: data.user_type, status: data.status, email: null },
    permissions: new Set(['calendar.view', 'calendar.manage', 'calendar.manage_exams', 'calendar.manage_holidays', 'calendar.build_timeline', 'calendar.manage_dependencies', 'calendar.correct_history']),
    supabaseUid: UID,
  } as any
}

// +1 learning day when the holiday falls on a school day inside the year; 0 when it is on a
// weekend (Fasika and Eid al-Adha are Sundays) or before the year starts (New Year).
const EFFECT: Record<string, number> = { NEW_YEAR: 0, GENNA: 1, TIMKAT: 1, ADWA: 1, PATRIOTS: 1, DERG_DOWNFALL: 1, SIKLET: 1, FASIKA: 0, EID_FITR: 1, EID_ADHA: 0 }
const MOVABLE: Record<string, [number, number]> = { SIKLET: [8, 22], FASIKA: [8, 24], EID_FITR: [6, 30], EID_ADHA: [9, 8] }

describe('every holiday switch reaches the saved calendar (real database)', () => {
  it('off and back on, one at a time, then everything off', async () => {
    sql('delete from academic_years')
    const c = await makeCtx()
    const y = await createAcademicYear(supabase, c, { yearEc: Y })
    await updateAcademicYearBoundary(supabase, c, y.id, { startDate: E(Y, 1, 4) as any, endDate: E(Y, 10, 30) as any })
    await setSemesterDates(supabase, c, y.id, 1, { startDate: E(Y, 1, 5) as any, endDate: E(Y, 5, 23) as any })
    await setSemesterDates(supabase, c, y.id, 2, { startDate: E(Y, 6, 1) as any, endDate: E(Y, 10, 30) as any })
    for (const [k, [m, d]] of Object.entries(MOVABLE)) await enterMovableHoliday(supabase, c, y.id, { holidayTypeKey: k as any, date: E(Y, m, d) as any, closesSchool: true }, Y)
    for (const [k, a, b] of [['S1_REGIONAL_MODEL', [2, 30], [3, 4]], ['S1_FINAL', [5, 17], [5, 21]], ['S2_REGIONAL_MODEL', [10, 7], [10, 11]], ['S2_FINAL', [10, 14], [10, 18]], ['GRADE12_NATIONAL', [10, 21], [10, 25]]] as any)
      await setExamInstance(supabase, c, y.id, { examTypeKey: k, startDate: E(Y, a[0], a[1]) as any, endDate: E(Y, b[0], b[1]) as any })
    await setStudentReturn(supabase, c, y.id, { date: E(Y, 1, 4) as any })
    const count = async () => (await rebuildAndPublishTimeline(supabase, c, y.id)).teachingDays
    const base = await count()
    expect(base).toBe(179)
    for (const k of ['NEW_YEAR', 'GENNA', 'TIMKAT', 'ADWA', 'PATRIOTS', 'DERG_DOWNFALL']) {
      await toggleHolidayClosure(supabase, c, y.id, k as any, { closesSchool: false })
      expect((await count()) - base, `${k} off`).toBe(EFFECT[k])
      await toggleHolidayClosure(supabase, c, y.id, k as any, { closesSchool: true })
      expect((await count()) - base, `${k} back on`).toBe(0)
    }
    for (const [k, [m, d]] of Object.entries(MOVABLE)) {
      await enterMovableHoliday(supabase, c, y.id, { holidayTypeKey: k as any, date: null, closesSchool: false }, Y)
      expect((await count()) - base, `${k} off`).toBe(EFFECT[k])
      await enterMovableHoliday(supabase, c, y.id, { holidayTypeKey: k as any, date: E(Y, m, d) as any, closesSchool: true }, Y)
      expect((await count()) - base, `${k} back on`).toBe(0)
    }
    for (const k of ['NEW_YEAR', 'GENNA', 'TIMKAT', 'ADWA', 'PATRIOTS', 'DERG_DOWNFALL']) await toggleHolidayClosure(supabase, c, y.id, k as any, { closesSchool: false })
    for (const k of Object.keys(MOVABLE)) await enterMovableHoliday(supabase, c, y.id, { holidayTypeKey: k as any, date: null, closesSchool: false }, Y)
    expect(await count()).toBe(186) // all ten off: the most learning days this plan can have
  })
})

describe('security rules from migration 0022', () => {
  const rpc = (token: string, fn: string, body: object) =>
    fetch(`${URL}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { 'content-type': 'application/json', apikey: token, authorization: `Bearer ${token}` }, body: JSON.stringify(body) })
  const zero = '00000000-0000-0000-0000-000000000000'

  it('a visitor who is not signed in cannot call the internal functions', async () => {
    for (const [fn, body] of [['fn_bump_calendar_config_revision', { p_academic_year_id: zero }], ['fn_load_calendar_config_snapshot', { p_academic_year_id: zero }]] as const) {
      const r = await rpc(anonJwt, fn, body)
      expect([401, 403], `${fn} as anonymous`).toContain(r.status)
    }
  })
  it('a signed-in user still can', async () => {
    expect((await rpc(JWT, 'fn_bump_calendar_config_revision', { p_academic_year_id: zero })).status).toBe(204)
  })
  it('all five functions have a pinned search path', () => {
    const out = sql("select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('fn_load_calendar_config_snapshot','fn_validate_exam_placement','fn_validate_fact_ref','fn_validate_holiday_occurrence','fn_validate_semester_ordering') and coalesce(array_to_string(p.proconfig,','),'') like '%search_path%'")
    expect(out).toBe('5')
  })
})
