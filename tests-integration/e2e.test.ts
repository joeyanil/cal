import { it } from 'vitest'
import { readFileSync } from 'fs'
import { execSync } from 'child_process'
import { ethiopianDate as E } from '@/lib/calendar/ethiopian-date'
const Y = 2019
const JWT = readFileSync('/tmp/jwt.txt', 'utf8').trim()
const session = { access_token: JWT, token_type: 'bearer', expires_in: 3600, expires_at: 4102444800, refresh_token: 'x', user: { id: '11111111-1111-4111-8111-111111111111', aud: 'authenticated', role: 'authenticated', email: 'admin@test.local' } }
const cookie = 'sb-127-auth-token=base64-' + Buffer.from(JSON.stringify(session)).toString('base64url')
const B = 'http://127.0.0.1:3100'
const api = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(B + path, { method, headers: { 'content-type': 'application/json', cookie }, body: body === undefined ? undefined : JSON.stringify(body) })
  const t = await r.text(); let j: any; try { j = JSON.parse(t) } catch { j = { raw: t.slice(0, 300) } }
  return { status: r.status, ...j }
}
const sql = (q: string) => execSync(`su postgres -c "psql -q -tA -d k2 -c \\"${q}\\""`).toString().trim()

it('wizard replay over HTTP against the real server and database', async () => {
  sql('delete from academic_years')
  const created = await api('POST', '/api/v1/academic-years', { yearEc: Y })
  if (!created.success) throw new Error('create failed ' + JSON.stringify(created))
  const id = created.data.id, base = `/api/v1/academic-years/${id}`
  const step = async (label: string, p: Promise<any>) => { const r = await p; if (!r.success) throw new Error(`${label}: ${r.status} ${JSON.stringify(r.error ?? r)}`); return r }
  await step('year', api('PATCH', base, { startDate: E(Y,1,4), endDate: E(Y,10,30), ministryTargetDays: 210 }))
  await step('sem1', api('PATCH', `${base}/semesters/1`, { startDate: E(Y,1,5), endDate: E(Y,5,23) }))
  await step('sem2', api('PATCH', `${base}/semesters/2`, { startDate: E(Y,6,1), endDate: E(Y,10,30) }))
  const mov: Record<string, [number, number]> = { SIKLET: [8,22], FASIKA: [8,24], EID_FITR: [6,30], EID_ADHA: [9,8] }
  for (const [k,[m,d]] of Object.entries(mov)) await step('movable '+k, api('POST', `${base}/holidays`, { action: 'enter_movable', holidayTypeKey: k, date: E(Y,m,d), closesSchool: true }))
  for (const [k,a,b] of [['S1_REGIONAL_MODEL',[2,30],[3,4]],['S1_FINAL',[5,17],[5,21]],['S2_REGIONAL_MODEL',[10,7],[10,11]],['S2_FINAL',[10,14],[10,18]],['GRADE12_NATIONAL',[10,21],[10,25]]] as any)
    await step('exam '+k, api('PUT', `${base}/exams`, { examTypeKey: k, startDate: E(Y, ...(a as [number, number])), endDate: E(Y, ...(b as [number, number])) }))
  await step('return', api('PUT', `${base}/student-return`, { date: E(Y,1,4) }))
  const setupPage = await fetch(`${B}/calendar/${id}/setup`, { headers: { cookie } })
  console.log('SETUP PAGE', setupPage.status)

  const count = async () => (await step('build', api('POST', `${base}/timeline/build`))).data.teachingDays as number
  const base0 = await count()
  console.log('BASELINE', base0)
  const fixed = ['NEW_YEAR','GENNA','TIMKAT','ADWA','PATRIOTS','DERG_DOWNFALL']
  const lines: string[] = []
  for (const k of fixed) {
    await step('off '+k, api('PATCH', `${base}/holidays/${k}`, { closesSchool: false })); const off = (await count()) - base0
    await step('on '+k, api('PATCH', `${base}/holidays/${k}`, { closesSchool: true })); const on = (await count()) - base0
    lines.push(`FIXED ${k.padEnd(14)} off:${off} backOn:${on}`)
  }
  for (const [k,[m,d]] of Object.entries(mov)) {
    await step('off '+k, api('POST', `${base}/holidays`, { action: 'enter_movable', holidayTypeKey: k, date: null, closesSchool: false })); const off = (await count()) - base0
    await step('on '+k, api('POST', `${base}/holidays`, { action: 'enter_movable', holidayTypeKey: k, date: E(Y,m,d), closesSchool: true })); const on = (await count()) - base0
    lines.push(`MOVABLE ${k.padEnd(13)} off:${off} backOn:${on}`)
  }
  console.log(lines.join('\n'))

  // The user's scenario: everything off, then turn holidays back on one at a time.
  for (const k of fixed) await step('all off '+k, api('PATCH', `${base}/holidays/${k}`, { closesSchool: false }))
  for (const [k] of Object.entries(mov)) await step('all off '+k, api('POST', `${base}/holidays`, { action: 'enter_movable', holidayTypeKey: k, date: null, closesSchool: false }))
  console.log('ALL OFF ->', await count(), '(expected', base0 + 7, ')')
  const seq: string[] = []
  for (const k of fixed) { await step('on '+k, api('PATCH', `${base}/holidays/${k}`, { closesSchool: true })); seq.push(`${k}:${await count()}`) }
  for (const [k,[m,d]] of Object.entries(mov)) { await step('on '+k, api('POST', `${base}/holidays`, { action: 'enter_movable', holidayTypeKey: k, date: E(Y,m,d), closesSchool: true })); seq.push(`${k}:${await count()}`) }
  console.log('TURNING ON ONE AT A TIME ->', seq.join('  '))
  console.log('FINAL ROWS\n' + sql("select holiday_type_key||'|'||coalesce(date::text,'NULL')||'|'||closes_school from holiday_occurrences order by 1"))
})
