/**
 * Runs the real save + rebuild code (toggleHolidayClosure, enterMovableHoliday,
 * buildCandidateTimeline) against a small in-memory stand-in for the database,
 * once per holiday. Guards the promise that EVERY holiday's on/off switch
 * reaches the saved calendar — not just one of them.
 */
import { describe, it, expect } from 'vitest'
import { toggleHolidayClosure, enterMovableHoliday } from '@/lib/services/holiday.service'
import { buildCandidateTimeline } from '@/lib/services/calendarTimeline.service'
import { proposeFixedHolidayOccurrences } from '@/lib/calendar/holidays'
import { ethiopianDate as E } from '@/lib/calendar/ethiopian-date'

const Y = 2019
let n = 0

function makeDb() {
  const db: Record<string, any[]> = {
    academic_years: [{ id: 'y', year_ec: Y, start_date: E(Y, 1, 4), end_date: E(Y, 10, 30), calendar_config_revision: 1 }],
    semesters: [
      { id: 's1', academic_year_id: 'y', sem_order: 1, start_date: E(Y, 1, 5), end_date: E(Y, 5, 23), status: 'ACTIVE' },
      { id: 's2', academic_year_id: 'y', sem_order: 2, start_date: E(Y, 6, 1), end_date: E(Y, 10, 30), status: 'UPCOMING' },
    ],
    holiday_occurrences: [
      ...proposeFixedHolidayOccurrences('y', Y).map((p) => ({ id: 'h' + ++n, academic_year_id: 'y', holiday_type_key: p.holidayTypeKey, date: p.date, closes_school: true, source: 'AUTO_PROPOSED', confirmed_by: null, confirmed_at: null })),
      ...(
        [['SIKLET', 8, 22], ['FASIKA', 8, 24], ['EID_FITR', 6, 30], ['EID_ADHA', 9, 8]] as const
      ).map(([k, m, d]) => ({ id: 'h' + ++n, academic_year_id: 'y', holiday_type_key: k, date: E(Y, m, d), closes_school: true, source: 'ADMIN_ENTERED', confirmed_by: 'u', confirmed_at: 'x' })),
    ],
    exam_instances: (
      [['S1_REGIONAL_MODEL', [2, 30], [3, 4]], ['S1_FINAL', [5, 17], [5, 21]], ['S2_REGIONAL_MODEL', [10, 7], [10, 11]], ['S2_FINAL', [10, 14], [10, 18]], ['GRADE12_NATIONAL', [10, 21], [10, 25]]] as const
    ).map(([k, a, b]) => ({ id: k, academic_year_id: 'y', exam_type_key: k, start_date: E(Y, a[0], a[1]), end_date: E(Y, b[0], b[1]) })),
    student_return_days: [{ id: 'sr', academic_year_id: 'y', date: E(Y, 1, 4) }],
    calendar_dependencies: [],
    calendar_timeline_builds: [],
    calendar_timeline_days: [],
  }
  const from = (table: string) => {
    db[table] ??= []
    let op = 'select'
    let payload: any
    let opts: any
    const filters: ((r: any) => boolean)[] = []
    const run = (single: boolean) => {
      const rows = db[table]!
      let out: any[] = []
      if (op === 'select') out = rows.filter((r) => filters.every((f) => f(r)))
      if (op === 'update') {
        out = rows.filter((r) => filters.every((f) => f(r)))
        out.forEach((r) => Object.assign(r, payload))
      }
      if (op === 'insert') {
        const arr = Array.isArray(payload) ? payload : [payload]
        out = arr.map((p) => {
          const r = { id: 'n' + ++n, ...p }
          rows.push(r)
          return r
        })
      }
      if (op === 'upsert') {
        const existing = rows.find((r) => r.academic_year_id === payload.academic_year_id && r.holiday_type_key === payload.holiday_type_key)
        if (existing) {
          if (!opts?.ignoreDuplicates) Object.assign(existing, payload)
          out = opts?.ignoreDuplicates ? [] : [existing]
        } else {
          const r = { id: 'n' + ++n, ...payload }
          rows.push(r)
          out = [r]
        }
      }
      if (single) return { data: out[0] ?? null, error: out[0] ? null : { message: 'no rows', code: 'PGRST116' } }
      return { data: out, error: null }
    }
    const api: any = {
      select: () => api,
      eq: (c: string, v: any) => (filters.push((r) => r[c] === v), api),
      is: (c: string, v: any) => (filters.push((r) => r[c] === v), api),
      update: (p: any) => ((op = 'update'), (payload = p), api),
      insert: (p: any) => ((op = 'insert'), (payload = p), api),
      upsert: (p: any, o: any) => ((op = 'upsert'), (payload = p), (opts = o), api),
      single: async () => run(true),
      maybeSingle: async () => ({ data: (run(false) as any).data[0] ?? null, error: null }),
      then: (res: any, rej: any) => Promise.resolve(run(false)).then(res, rej),
    }
    return api
  }
  const rpc = async (name: string) =>
    name === 'fn_load_calendar_config_snapshot'
      ? { data: { academicYear: db.academic_years![0], semesters: db.semesters, holidayOccurrences: db.holiday_occurrences, examInstances: db.exam_instances, studentReturn: db.student_return_days![0], dependencies: [], configRevision: 1 }, error: null }
      : { data: null, error: null }
  return { from, rpc } as any
}

const ctx: any = {
  user: { id: 'u', user_type: 'ADMIN', status: 'ACTIVE', email: null },
  permissions: new Set(['calendar.view', 'calendar.manage_holidays', 'calendar.build_timeline']),
  supabaseUid: 's',
}

// +1 learning day when the holiday falls on a school day in the year; 0 when it
// is on a weekend (Fasika, Eid al-Adha are Sundays) or before the year starts
// (New Year is Meskerem 1, three days before the year opens on Meskerem 4).
const EFFECT: Record<string, number> = {
  NEW_YEAR: 0, GENNA: 1, TIMKAT: 1, ADWA: 1, PATRIOTS: 1, DERG_DOWNFALL: 1,
  SIKLET: 1, FASIKA: 0, EID_FITR: 1, EID_ADHA: 0,
}

describe('every holiday switch reaches the saved calendar', () => {
  it('baseline: 179 learning days with every holiday on', async () => {
    expect((await buildCandidateTimeline(makeDb(), ctx, 'y')).teachingDays).toBe(179)
  })

  for (const key of ['NEW_YEAR', 'GENNA', 'TIMKAT', 'ADWA', 'PATRIOTS', 'DERG_DOWNFALL'] as const) {
    it(`permanent: switching off ${key} changes the saved calendar by ${EFFECT[key]}`, async () => {
      const db = makeDb()
      await toggleHolidayClosure(db, ctx, 'y', key, { closesSchool: false })
      expect((await buildCandidateTimeline(db, ctx, 'y')).teachingDays).toBe(179 + EFFECT[key]!)
    })
  }

  for (const key of ['SIKLET', 'FASIKA', 'EID_FITR', 'EID_ADHA'] as const) {
    it(`moving: switching off ${key} (no date) changes the saved calendar by ${EFFECT[key]}`, async () => {
      const db = makeDb()
      await enterMovableHoliday(db, ctx, 'y', { holidayTypeKey: key, date: null, closesSchool: false }, Y)
      expect((await buildCandidateTimeline(db, ctx, 'y')).teachingDays).toBe(179 + EFFECT[key]!)
    })
  }

  it('switching several off at once adds up (all seven that fall on school days)', async () => {
    const db = makeDb()
    for (const k of ['GENNA', 'TIMKAT', 'ADWA', 'PATRIOTS', 'DERG_DOWNFALL'] as const) await toggleHolidayClosure(db, ctx, 'y', k, { closesSchool: false })
    for (const k of ['SIKLET', 'EID_FITR'] as const) await enterMovableHoliday(db, ctx, 'y', { holidayTypeKey: k, date: null, closesSchool: false }, Y)
    expect((await buildCandidateTimeline(db, ctx, 'y')).teachingDays).toBe(179 + 7)
  })
})
