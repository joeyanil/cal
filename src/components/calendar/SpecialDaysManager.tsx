'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { EthiopianDateField } from './EthiopianDateField'
import {
  SPECIAL_DAY_INFO, SPECIAL_DAY_SITUATIONS, GRADES, defaultTeacherAudience, buildReminderMessage, formatEthiopian,
} from '@/lib/calendar'
import type { Grade, ISODate, SpecialDay, SpecialDaySituation, TeacherAudience } from '@/lib/calendar'

interface Props {
  yearId: string
  ethiopianYear: number
  initial: SpecialDay[]
  canManage: boolean
}

async function call(url: string, method: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const json = await res.json()
  if (!json.success) throw new Error(json.error?.message ?? 'Something went wrong.')
  return json.data
}

const inputCls =
  'rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

interface FormState {
  id: string | null
  situation: SpecialDaySituation
  name: string
  startDate: ISODate | ''
  endDate: ISODate | ''
  severalDays: boolean
  studentsCome: boolean | null
  wholeSchool: boolean
  grades: Grade[]
  teacherAudience: TeacherAudience
  customMessage: string
  nonce: number
}

function blank(nonce: number): FormState {
  return {
    id: null, situation: 'SPORTS_DAY', name: SPECIAL_DAY_INFO.SPORTS_DAY.label, startDate: '', endDate: '', severalDays: false,
    studentsCome: SPECIAL_DAY_INFO.SPORTS_DAY.defaultStudentsCome, wholeSchool: true, grades: [],
    teacherAudience: defaultTeacherAudience('SPORTS_DAY'), customMessage: '', nonce,
  }
}

function describeGrades(d: SpecialDay) {
  return d.grades === null ? 'Whole school' : `Grade ${d.grades.join(', ')}`
}

export function SpecialDaysManager({ yearId, ethiopianYear, initial, canManage }: Props) {
  const router = useRouter()
  const [days, setDays] = useState<SpecialDay[]>(initial)
  const [form, setForm] = useState<FormState>(() => blank(0))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }))

  function pickSituation(s: SpecialDaySituation) {
    const info = SPECIAL_DAY_INFO[s]
    set({
      situation: s,
      name: s === 'CUSTOM' ? '' : info.label,
      studentsCome: info.defaultStudentsCome,
      teacherAudience: defaultTeacherAudience(s),
    })
  }

  const preview = useMemo(() => {
    if (!form.startDate) return null
    const end = form.severalDays && form.endDate ? form.endDate : null
    return buildReminderMessage(
      'STUDENT',
      {
        topic: 'SPECIAL_DAY', situation: form.situation, name: form.name || 'This day', startDate: form.startDate,
        endDate: end, studentsCome: form.studentsCome ?? true, customMessage: form.customMessage,
      },
      15,
    )
  }, [form])

  async function save() {
    setError(null)
    setNote(null)
    if (form.studentsCome === null) return setError('Please say whether students come to school on this day.')
    if (!form.startDate) return setError('Please enter the date.')
    if (form.severalDays && !form.endDate) return setError('Please enter the last day, or untick "runs for several days".')
    if (!form.wholeSchool && form.grades.length === 0) return setError('Choose the whole school, or at least one grade.')
    setBusy(true)
    try {
      const body = {
        situation: form.situation, name: form.name, startDate: form.startDate,
        endDate: form.severalDays ? form.endDate : form.startDate, studentsCome: form.studentsCome,
        grades: form.wholeSchool ? null : form.grades, customMessage: form.customMessage.trim() || null,
        teacherAudience: form.teacherAudience,
      }
      const data = form.id
        ? await call(`/api/v1/academic-years/${yearId}/special-days/${form.id}`, 'PUT', body)
        : await call(`/api/v1/academic-years/${yearId}/special-days`, 'POST', body)
      const saved: SpecialDay = data.specialDay
      setDays((cur) => (form.id ? cur.map((d) => (d.id === saved.id ? saved : d)) : [...cur, saved]).sort((a, b) => (a.startDate < b.startDate ? -1 : 1)))
      setForm(blank(form.nonce + 1))
      if (data.warnings?.length) setNote(data.warnings.map((w: { message: string }) => w.message).join(' '))
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  function edit(d: SpecialDay) {
    setError(null)
    setNote(null)
    setForm({
      id: d.id, situation: d.situation, name: d.name, startDate: d.startDate, endDate: d.endDate,
      severalDays: d.endDate !== d.startDate, studentsCome: d.studentsCome, wholeSchool: d.grades === null,
      grades: d.grades ?? [], teacherAudience: d.teacherAudience, customMessage: d.customMessage ?? '', nonce: form.nonce + 1,
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function remove(d: SpecialDay) {
    if (!window.confirm(`Delete "${d.name}"?`)) return
    setError(null)
    try {
      await call(`/api/v1/academic-years/${yearId}/special-days/${d.id}`, 'DELETE')
      setDays((cur) => cur.filter((x) => x.id !== d.id))
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.')
    }
  }

  return (
    <div className="space-y-6">
      {canManage && (
        <div className="space-y-4 rounded-lg border border-border p-4">
          <h2 className="text-base font-semibold text-foreground">{form.id ? 'Change this day' : 'Add a special day'}</h2>

          <label className="flex flex-col gap-1 text-sm text-muted-foreground">
            What kind of day is it?
            <select className={inputCls} value={form.situation} onChange={(e) => pickSituation(e.target.value as SpecialDaySituation)}>
              {SPECIAL_DAY_SITUATIONS.map((s) => (
                <option key={s} value={s}>{SPECIAL_DAY_INFO[s].label}</option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm text-muted-foreground">
            Name
            <input className={inputCls} value={form.name} maxLength={120} onChange={(e) => set({ name: e.target.value })} />
          </label>

          <div key={form.nonce} className="flex flex-wrap gap-4">
            <EthiopianDateField label="Date" name="start" ethiopianYear={ethiopianYear} defaultValue={form.startDate || undefined} onValueChange={(v) => set({ startDate: v })} />
            {form.severalDays && (
              <EthiopianDateField label="Last day" name="end" ethiopianYear={ethiopianYear} defaultValue={form.endDate || undefined} onValueChange={(v) => set({ endDate: v })} />
            )}
          </div>
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input type="checkbox" checked={form.severalDays} onChange={(e) => set({ severalDays: e.target.checked })} />
            Runs for several days
          </label>

          <fieldset className="space-y-1 text-sm">
            <legend className="text-muted-foreground">Do students come to school?</legend>
            <label className="mr-4 inline-flex items-center gap-2 text-foreground">
              <input type="radio" name="come" checked={form.studentsCome === true} onChange={() => set({ studentsCome: true })} /> Yes, students come
            </label>
            <label className="inline-flex items-center gap-2 text-foreground">
              <input type="radio" name="come" checked={form.studentsCome === false} onChange={() => set({ studentsCome: false })} /> No, students stay home
            </label>
            {form.studentsCome === null && <p className="text-xs text-muted-foreground">This one depends on the day, so please choose.</p>}
          </fieldset>

          <fieldset className="space-y-1 text-sm">
            <legend className="text-muted-foreground">Who does it affect?</legend>
            <label className="mr-4 inline-flex items-center gap-2 text-foreground">
              <input type="checkbox" checked={form.wholeSchool} onChange={(e) => set({ wholeSchool: e.target.checked })} /> Whole school
            </label>
            {!form.wholeSchool &&
              GRADES.map((g) => (
                <label key={g} className="mr-3 inline-flex items-center gap-1 text-foreground">
                  <input
                    type="checkbox"
                    checked={form.grades.includes(g)}
                    onChange={(e) => set({ grades: e.target.checked ? [...form.grades, g].sort() : form.grades.filter((x) => x !== g) })}
                  />
                  Grade {g}
                </label>
              ))}
          </fieldset>

          <label className="flex flex-col gap-1 text-sm text-muted-foreground">
            Which teachers get the reminder?
            <select className={inputCls} value={form.teacherAudience} onChange={(e) => set({ teacherAudience: e.target.value as TeacherAudience })}>
              <option value="AFFECTED_GRADES">Teachers of the grades affected</option>
              <option value="ALL_TEACHERS">All teachers</option>
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm text-muted-foreground">
            Your own reminder wording (optional)
            <textarea className={inputCls} rows={3} maxLength={500} value={form.customMessage} onChange={(e) => set({ customMessage: e.target.value })} />
            <span className="text-xs">
              You can use {'{name}'}, {'{days}'}, {'{date}'} and {'{endDate}'}; they are filled in for you. Leave it empty to use the ready-made wording.
            </span>
          </label>

          {preview && (
            <div className="rounded-md bg-muted p-3 text-sm">
              <p className="text-xs font-medium text-muted-foreground">What a student sees 15 days before</p>
              <p className="mt-1 text-foreground">{preview.body}</p>
            </div>
          )}

          {error && <p className="text-sm text-error-text">{error}</p>}
          {note && <p className="text-sm text-muted-foreground">{note}</p>}
          <div className="flex gap-3">
            <button type="button" disabled={busy} onClick={save} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
              {busy ? 'Saving…' : form.id ? 'Save changes' : 'Add this day'}
            </button>
            {form.id && (
              <button type="button" onClick={() => setForm(blank(form.nonce + 1))} className="text-sm text-primary underline underline-offset-4">
                Cancel
              </button>
            )}
          </div>
        </div>
      )}

      <div className="space-y-2">
        <h2 className="text-base font-semibold text-foreground">Special days of this year</h2>
        {days.length === 0 && <p className="text-sm text-muted-foreground">None yet.</p>}
        {days.map((d) => (
          <div key={d.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3 text-sm">
            <div>
              <p className="font-medium text-foreground">{d.name}</p>
              <p className="tabular-dates text-muted-foreground">
                {formatEthiopian(d.startDate)}
                {d.endDate !== d.startDate && ` – ${formatEthiopian(d.endDate)}`} · {describeGrades(d)} ·{' '}
                {d.studentsCome ? 'Students come' : 'Students stay home'}
              </p>
            </div>
            {canManage && (
              <div className="flex gap-3">
                <button type="button" onClick={() => edit(d)} className="text-primary underline underline-offset-4">Change</button>
                <button type="button" onClick={() => remove(d)} className="text-error-text underline underline-offset-4">Delete</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
