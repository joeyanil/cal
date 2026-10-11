'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, ChevronLeft, ChevronRight, AlertTriangle, Ban, Lock } from 'lucide-react'
import { Button } from '../ui/button'
import { EthiopianDateField } from './EthiopianDateField'
import {
  ALL_EXAM_KEYS,
  EXAM_TYPES,
  FIXED_HOLIDAY_KEYS,
  HOLIDAY_TYPES,
  MOVABLE_HOLIDAY_KEYS,
  STEP_KEYS,
  analyzeExamWindow,
  canContinue,
  deriveSemesterBreak,
  draftFromData,
  draftToConfig,
  fixedHolidaysFor,
  formatShortEthiopian,
  formatShortWithWeekday,
  friendlyLines,
  indexHolidaysByDate,
  isWeekend,
  isoDate,
  localizeMessage,
  requiredFilled,
  reviewDraft,
  stepForIssue,
} from '@/lib/calendar'
import type {
  AcademicYear,
  DateRange,
  ExamInstance,
  ExamShiftSuggestion,
  ExamTypeKey,
  HolidayOccurrence,
  HolidayTypeKey,
  ISODate,
  Semester,
  SetupDraft,
  StepKey,
  StudentReturnDay,
  ValidationIssue,
} from '@/lib/calendar'

interface Props {
  yearId: string
  year: AcademicYear
  semesters: Semester[]
  holidays: HolidayOccurrence[]
  notObserved?: HolidayTypeKey[]
  exams: ExamInstance[]
  studentReturn: StudentReturnDay | null
}

class ApiError extends Error {}

async function call(url: string, method: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const json = await res.json()
  if (!json.success) throw new ApiError(json.error?.message ?? 'Something went wrong.')
  return json.data
}

const STEP_META: Record<StepKey, { label: string; title: string; why: string }> = {
  year: {
    label: 'School year',
    title: 'When does the school year start and end?',
    why: 'Everything else sits inside these two dates, so they come first.',
  },
  semesters: {
    label: 'Semesters',
    title: 'When do the two semesters run?',
    why: 'Exams and the break between semesters are checked against these dates.',
  },
  holidays: {
    label: 'Holidays',
    title: 'Which days have no school?',
    why: 'The permanent holidays are already counted. Switch off any the school does not observe, and add the dates of the four that move every year.',
  },
  exams: {
    label: 'Exams',
    title: 'When are the exams?',
    why: 'Exams cannot be on a weekend or in a week with a holiday. We check as you pick, and suggest the nearest good dates.',
  },
  return: {
    label: 'Student return',
    title: 'When do students first come back?',
    why: 'Orientation day. Students are in, but there are no lessons and no attendance.',
  },
  review: {
    label: 'Review',
    title: 'Check everything, then finish',
    why: 'This is exactly what the calendar will use.',
  },
}

const HOLIDAY_HINT: Record<string, string> = {
  SIKLET: 'Good Friday — always a Friday.',
  FASIKA: 'Easter — always a Sunday, so it never affects school days.',
  EID_FITR: 'Moves every year, set by the moon.',
  EID_ADHA: 'Moves every year, set by the moon.',
}

// ---------------------------------------------------------------- small UI

function Notes({ issues }: { issues: ValidationIssue[] }) {
  const shown = friendlyLines(issues.filter((i) => i.severity === 'ERROR' || i.severity === 'WARNING'))
  if (shown.length === 0) return null
  return (
    <ul role="status" className="space-y-1.5">
      {shown.map((line, n) => (
        <li
          key={`${n}-${line.text}`}
          className={`flex items-start gap-2 text-sm ${line.severity === 'ERROR' ? 'font-medium text-error-text' : 'text-muted-foreground'}`}
        >
          {line.severity === 'ERROR' ? <Ban className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
          <span>{line.text}</span>
        </li>
      ))}
    </ul>
  )
}

function RangeFields({
  label,
  range,
  onChange,
  yearEc,
  resetKey = 0,
}: {
  label?: string
  range: DateRange
  onChange: (next: DateRange) => void
  yearEc: number
  resetKey?: number
}) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      {label && <span className="w-full text-sm font-medium text-foreground sm:w-44">{label}</span>}
      <EthiopianDateField
        key={`s-${resetKey}`}
        label="Start"
        name="start"
        ethiopianYear={yearEc}
        defaultValue={range.start}
        onValueChange={(v) => onChange({ ...range, start: v })}
      />
      <EthiopianDateField
        key={`e-${resetKey}`}
        label="End"
        name="end"
        ethiopianYear={yearEc}
        defaultValue={range.end}
        onValueChange={(v) => onChange({ ...range, end: v })}
      />
    </div>
  )
}

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${checked ? 'bg-primary' : 'bg-slate-300'}`}
    >
      <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : 'translate-x-0.5'}`} />
    </button>
  )
}

function Stepper({
  current,
  maxReached,
  status,
  onGo,
}: {
  current: number
  maxReached: number
  status: Record<StepKey, 'done' | 'error' | 'todo'>
  onGo: (i: number) => void
}) {
  return (
    <nav aria-label="Setup steps">
      <ol className="flex items-center gap-1 overflow-x-auto pb-1">
        {STEP_KEYS.map((key, i) => {
          const active = i === current
          const reachable = i <= maxReached
          const s = status[key]
          return (
            <li key={key} className="flex items-center gap-1">
              <button
                type="button"
                disabled={!reachable}
                aria-current={active ? 'step' : undefined}
                onClick={() => onGo(i)}
                className={`flex items-center gap-2 rounded-full px-2.5 py-1.5 text-sm transition-colors ${
                  active ? 'bg-primary text-primary-foreground' : reachable ? 'text-foreground hover:bg-card' : 'text-muted-foreground opacity-60'
                }`}
              >
                <span
                  className={`flex h-5 w-5 items-center justify-center rounded-full text-xs font-semibold ${
                    active
                      ? 'bg-primary-foreground text-primary'
                      : s === 'done'
                        ? 'bg-success-text text-white'
                        : s === 'error'
                          ? 'bg-error text-white'
                          : 'border border-border'
                  }`}
                >
                  {s === 'done' && !active ? <Check className="h-3 w-3" /> : i + 1}
                </span>
                <span className={active ? 'inline' : 'hidden md:inline'}>{STEP_META[key].label}</span>
              </button>
              {i < STEP_KEYS.length - 1 && <span className="h-px w-3 bg-border" />}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

// ------------------------------------------------------------------ wizard

export function SetupWizard({ yearId, year, semesters, holidays, notObserved = [], exams, studentReturn }: Props) {
  const router = useRouter()
  const fixed = useMemo(() => fixedHolidaysFor(yearId, year.yearEc, holidays), [yearId, year.yearEc, holidays])
  const initial = useMemo(() => draftFromData({ year, semesters, holidays, notObserved, exams, studentReturn }), [year, semesters, holidays, notObserved, exams, studentReturn])

  const [draft, setDraft] = useState<SetupDraft>(initial)
  const [saved, setSaved] = useState<SetupDraft>(initial)
  const [resetKeys, setResetKeys] = useState<Record<string, number>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const review = useMemo(() => reviewDraft(draft, year, fixed), [draft, year, fixed])

  // Open on the first step that still needs something; everything up to it is reachable.
  const startIndex = useMemo(() => {
    const first = STEP_KEYS.findIndex(
      (k) => k !== 'review' && (!requiredFilled(k, initial) || reviewDraft(initial, year, fixed).byStep[k].some((i) => i.severity === 'MISSING' || i.severity === 'ERROR')),
    )
    // A year still on the default boundary hasn't had its real dates confirmed.
    if (year.isDefaultBoundary) return 0
    return first === -1 ? STEP_KEYS.length - 1 : first
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [index, setIndex] = useState(startIndex)
  // Once the year and semesters are in and valid, every step is open to jump to.
  const coreReady =
    requiredFilled('semesters', initial) &&
    !reviewDraft(initial, year, fixed).errors.some((i) => ['year', 'semesters'].includes(stepForIssue(i)))
  const [maxReached, setMaxReached] = useState(coreReady ? STEP_KEYS.length - 1 : startIndex)
  const step = STEP_KEYS[index]!

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved)
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const status = useMemo(() => {
    const out = {} as Record<StepKey, 'done' | 'error' | 'todo'>
    for (const k of STEP_KEYS) {
      const issues = review.byStep[k]
      out[k] = issues.some((i) => i.severity === 'ERROR')
        ? 'error'
        : requiredFilled(k, draft) && !issues.some((i) => i.severity === 'MISSING')
          ? 'done'
          : 'todo'
    }
    out.review = review.errors.length === 0 && review.missing.length === 0 ? 'done' : out.review
    return out
  }, [review, draft])

  function go(i: number) {
    setError(null)
    setIndex(i)
  }

  async function saveStep(key: StepKey) {
    const y = year.id
    if (key === 'year' && (JSON.stringify(draft.year) !== JSON.stringify(saved.year) || draft.ministryTarget !== saved.ministryTarget)) {
      await call(`/api/v1/academic-years/${y}`, 'PATCH', {
        startDate: draft.year.start,
        endDate: draft.year.end,
        ministryTargetDays: draft.ministryTarget ? Number(draft.ministryTarget) : null,
      })
    }
    if (key === 'semesters') {
      for (const [order, cur, prev] of [[1, draft.sem1, saved.sem1], [2, draft.sem2, saved.sem2]] as const) {
        if (JSON.stringify(cur) !== JSON.stringify(prev)) {
          await call(`/api/v1/academic-years/${y}/semesters/${order}`, 'PATCH', { startDate: cur.start || null, endDate: cur.end || null })
        }
      }
    }
    if (key === 'holidays') {
      for (const k of FIXED_HOLIDAY_KEYS) {
        if (draft.closes[k] !== saved.closes[k]) {
          await call(`/api/v1/academic-years/${y}/holidays/${k}`, 'PATCH', { closesSchool: draft.closes[k] })
        }
      }
      for (const k of MOVABLE_HOLIDAY_KEYS) {
        const closes = draft.closes[k]
        const changed = closes !== saved.closes[k] || (closes && draft.movable[k] !== saved.movable[k])
        if (!changed) continue
        if (closes && !draft.movable[k]) continue // switched back on, date still to come
        await call(`/api/v1/academic-years/${y}/holidays`, 'POST', {
          action: 'enter_movable',
          holidayTypeKey: k,
          date: closes ? draft.movable[k] : null,
          closesSchool: closes,
        })
      }
    }
    if (key === 'exams') {
      for (const k of ALL_EXAM_KEYS) {
        const cur = draft.exams[k]
        if (cur.start && cur.end && JSON.stringify(cur) !== JSON.stringify(saved.exams[k])) {
          await call(`/api/v1/academic-years/${y}/exams`, 'PUT', { examTypeKey: k, startDate: cur.start, endDate: cur.end })
        }
      }
    }
    if (key === 'return' && draft.studentReturn && draft.studentReturn !== saved.studentReturn) {
      await call(`/api/v1/academic-years/${y}/student-return`, 'PUT', { date: draft.studentReturn })
    }
    setSaved((prev) => {
      const next = { ...prev }
      if (key === 'year') {
        next.year = draft.year
        next.ministryTarget = draft.ministryTarget
      }
      if (key === 'semesters') {
        next.sem1 = draft.sem1
        next.sem2 = draft.sem2
      }
      if (key === 'holidays') {
        next.movable = draft.movable
        next.closes = draft.closes
      }
      if (key === 'exams') next.exams = draft.exams
      if (key === 'return') next.studentReturn = draft.studentReturn
      return next
    })
  }

  async function onContinue() {
    setError(null)
    setBusy(true)
    try {
      if (step === 'review') {
        const build = await call(`/api/v1/academic-years/${yearId}/timeline/build`, 'POST')
        await call(`/api/v1/academic-years/${yearId}/timeline/publish`, 'POST', { buildId: build.buildId })
        router.push(`/calendar/${yearId}`)
        router.refresh()
        return
      }
      await saveStep(step)
      setMaxReached((m) => Math.max(m, index + 1))
      setIndex(index + 1)
    } catch (e) {
      setError(localizeMessage(e instanceof Error ? e.message : 'Could not save. Please try again.'))
    } finally {
      setBusy(false)
    }
  }

  const allowed = step === 'review' ? review.errors.length === 0 : canContinue(step, draft, review)
  const bump = (k: string) => setResetKeys((p) => ({ ...p, [k]: (p[k] ?? 0) + 1 }))

  // ---------------------------------------------------------------- bodies

  const semesterBreak = (() => {
    try {
      const cfg = draftToConfig(draft, year, fixed)
      return cfg.semesters.every((s) => s.startDate && s.endDate) ? deriveSemesterBreak(cfg.semesters) : null
    } catch {
      return null
    }
  })()

  const holidaysByDate = useMemo(() => indexHolidaysByDate(draftToConfig(draft, year, fixed).holidayOccurrences), [draft, year, fixed])

  function examCard(key: ExamTypeKey) {
    const cur = draft.exams[key]
    const cfg = draftToConfig(draft, year, fixed)
    const analysis =
      cur.start && cur.end
        ? analyzeExamWindow(
            { examTypeKey: key, startDate: isoDate(cur.start), endDate: isoDate(cur.end) },
            {
              holidaysByDate,
              semesters: cfg.semesters,
              academicYear: { startDate: cfg.academicYear.startDate, endDate: cfg.academicYear.endDate },
              otherExams: cfg.examInstances.filter((e) => e.examTypeKey !== key),
            },
          )
        : null
    const apply = (s: { startDate: string; endDate: string }) => {
      setDraft((d) => ({ ...d, exams: { ...d.exams, [key]: { start: s.startDate, end: s.endDate } } }))
      bump(key)
    }
    const bad = !!analysis && analysis.problems.length > 0
    const needsHelp = !!analysis && (bad || analysis.warnings.length > 0 || !!analysis.swapped)
    return (
      <div key={key} className={`space-y-2 rounded-lg border p-3 ${bad ? 'border-error-text/50' : 'border-border'}`}>
        <div>
          <p className="text-sm font-medium text-foreground">{EXAM_TYPES[key].name}</p>
          <p className="text-xs text-muted-foreground">
            {EXAM_TYPES[key].closesSchool ? 'Held at school. No lessons and no attendance on these days.' : 'Held nationally. Lessons and attendance carry on.'}
          </p>
        </div>
        <RangeFields range={cur} yearEc={year.yearEc} resetKey={resetKeys[key] ?? 0} onChange={(r) => setDraft((d) => ({ ...d, exams: { ...d.exams, [key]: r } }))} />
        {analysis && needsHelp && (
          <div className="space-y-2 pt-1">
            <Notes issues={[...analysis.problems, ...analysis.warnings]} />
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {analysis.swapped && (
                <button type="button" onClick={() => apply(analysis.swapped!)} className="rounded border border-input bg-background px-2 py-1 font-medium hover:bg-accent">
                  Swap: {formatShortEthiopian(analysis.swapped.startDate)} – {formatShortEthiopian(analysis.swapped.endDate)}
                </button>
              )}
              {analysis.suggestions.length > 0 && <span className="text-muted-foreground">Nearest open window:</span>}
              {analysis.suggestions.map((s: ExamShiftSuggestion) => (
                <button key={s.direction} type="button" onClick={() => apply(s)} className="rounded border border-input bg-background px-2 py-1 font-medium hover:bg-accent">
                  {s.offsetDays} day{s.offsetDays === 1 ? '' : 's'} {s.direction === 'EARLIER' ? 'earlier' : 'later'}: {formatShortEthiopian(s.startDate)} – {formatShortEthiopian(s.endDate)}
                </button>
              ))}
              {analysis.noWindowFound && (
                <span className="text-muted-foreground">No open window of this length nearby inside the semester. Shorten the exam, or check holidays and semester dates.</span>
              )}
            </div>
          </div>
        )}
      </div>
    )
  }

  function body() {
    switch (step) {
      case 'year':
        return (
          <div className="space-y-4">
            <RangeFields range={draft.year} yearEc={year.yearEc} onChange={(r) => setDraft((d) => ({ ...d, year: r }))} />
            <p className="text-xs text-muted-foreground">
              Usually Meskerem 5 to Sene 30. Use the dates from this year&apos;s Ministry plan. All dates are in {year.yearEc} E.C.
            </p>
            <div className="space-y-1">
              <label htmlFor="ministry-target" className="text-sm font-medium text-foreground">
                Ministry total school days <span className="font-normal text-muted-foreground">(optional)</span>
              </label>
              <input
                id="ministry-target"
                inputMode="numeric"
                value={draft.ministryTarget}
                onChange={(e) => setDraft((d) => ({ ...d, ministryTarget: e.target.value.replace(/\D/g, '').slice(0, 3) }))}
                placeholder="e.g. 210"
                className="h-10 w-32 rounded-md border border-input bg-background px-3 text-sm"
              />
              <p className="text-xs text-muted-foreground">
                A reminder only. If you type the total from the Ministry plan, the calendar will show how it compares. It never changes any date or count.
              </p>
            </div>
            <Notes issues={review.byStep.year} />
          </div>
        )
      case 'semesters':
        return (
          <div className="space-y-4">
            <RangeFields label="Semester 1" range={draft.sem1} yearEc={year.yearEc} onChange={(r) => setDraft((d) => ({ ...d, sem1: r }))} />
            <RangeFields label="Semester 2" range={draft.sem2} yearEc={year.yearEc} onChange={(r) => setDraft((d) => ({ ...d, sem2: r }))} />
            {semesterBreak && (
              <p className="rounded-md bg-card px-3 py-2 text-sm text-muted-foreground">
                Break between semesters: {formatShortEthiopian(semesterBreak.startDate)} – {formatShortEthiopian(semesterBreak.endDate)}. Worked out for you.
              </p>
            )}
            <Notes issues={review.byStep.semesters} />
          </div>
        )
      case 'holidays':
        return (
          <div className="space-y-6">
            <div>
              <p className="mb-1 flex items-center gap-1.5 text-sm font-medium text-foreground">
                <Lock className="h-3.5 w-3.5" /> Permanent holidays — added automatically
              </p>
              <p className="mb-2 text-xs text-muted-foreground">The dates never change, so there is nothing to enter. Switch a holiday off if your school teaches on that day.</p>
              <ul className="divide-y divide-border rounded-lg border border-border">
                {fixed.map((h) => {
                  const on = draft.closes[h.holidayTypeKey]
                  return (
                    <li key={h.holidayTypeKey} className="flex items-center justify-between gap-3 px-3 py-2.5">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground">{HOLIDAY_TYPES[h.holidayTypeKey].name}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatShortWithWeekday(h.date)}
                          {!on ? ' · school teaches this day' : isWeekend(h.date) ? ' · falls on a weekend, no effect' : ' · no school'}
                        </p>
                      </div>
                      <Switch
                        checked={on}
                        label={`School closed for ${HOLIDAY_TYPES[h.holidayTypeKey].name}`}
                        onChange={(v) => setDraft((d) => ({ ...d, closes: { ...d.closes, [h.holidayTypeKey]: v } }))}
                      />
                    </li>
                  )
                })}
              </ul>
            </div>

            <div className="space-y-3">
              <div>
                <p className="text-sm font-medium text-foreground">Holidays that move every year</p>
                <p className="text-xs text-muted-foreground">Take the dates from the Ministry plan. If your school teaches on a holiday, switch it off and there is no date to enter.</p>
              </div>
              {MOVABLE_HOLIDAY_KEYS.map((k) => {
                const on = draft.closes[k]
                const value = draft.movable[k]
                return (
                  <div key={k} className="space-y-2 rounded-lg border border-border p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-foreground">{HOLIDAY_TYPES[k].name}</p>
                        <p className="text-xs text-muted-foreground">{HOLIDAY_HINT[k]}</p>
                      </div>
                      <Switch
                        checked={on}
                        label={`School closed for ${HOLIDAY_TYPES[k].name}`}
                        onChange={(v) => setDraft((d) => ({ ...d, closes: { ...d.closes, [k]: v } }))}
                      />
                    </div>
                    {on ? (
                      <div className="flex flex-wrap items-end gap-3">
                        <EthiopianDateField
                          label="Date"
                          name={k}
                          ethiopianYear={year.yearEc}
                          defaultValue={value}
                          onValueChange={(v) => setDraft((d) => ({ ...d, movable: { ...d.movable, [k]: v } }))}
                        />
                        {value && (
                          <span className="pb-2 text-xs text-muted-foreground">
                            {formatShortWithWeekday(isoDate(value))}
                            {isWeekend(isoDate(value)) ? ' · weekend, no school anyway' : ''}
                          </span>
                        )}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">School teaches on this day. No date needed.</p>
                    )}
                  </div>
                )
              })}
            </div>
            <Notes issues={review.byStep.holidays} />
          </div>
        )
      case 'exams':
        return (
          <div className="space-y-3">
            {ALL_EXAM_KEYS.map((k) => examCard(k))}
          </div>
        )
      case 'return':
        return (
          <div className="space-y-3">
            <div className="flex flex-wrap items-end gap-3">
              <EthiopianDateField
                key={`r-${resetKeys.return ?? 0}`}
                label="Date"
                name="studentReturn"
                ethiopianYear={year.yearEc}
                defaultValue={draft.studentReturn}
                onValueChange={(v) => setDraft((d) => ({ ...d, studentReturn: v }))}
              />
              {draft.studentReturn && <span className="pb-2 text-xs text-muted-foreground">{formatShortWithWeekday(isoDate(draft.studentReturn))}</span>}
            </div>
            <Notes issues={review.byStep.return} />
          </div>
        )
      case 'review':
        return <ReviewBody draft={draft} review={review} fixedCount={fixed.length} semesterBreak={semesterBreak} onGo={go} />
    }
  }

  const meta = STEP_META[step]
  const last = step === 'review'

  return (
    <div className="space-y-5">
      <Stepper current={index} maxReached={maxReached} status={status} onGo={go} />

      <form
        className="space-y-5 rounded-xl border border-border bg-card/40 p-4 sm:p-6"
        onSubmit={(e) => {
          e.preventDefault()
          if (allowed && !busy) void onContinue()
        }}
      >
        <header className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Step {index + 1} of {STEP_KEYS.length}
          </p>
          <h2 className="text-lg font-semibold text-foreground">{meta.title}</h2>
          <p className="text-sm text-muted-foreground">{meta.why}</p>
        </header>

        {body()}

        {error && (
          <p role="alert" className="flex items-start gap-2 text-sm font-medium text-error-text">
            <Ban className="mt-0.5 h-4 w-4 shrink-0" /> {error}
          </p>
        )}

        <footer className="flex items-center justify-between gap-3 border-t border-border pt-4">
          <Button type="button" level="ghost" disabled={index === 0 || busy} onClick={() => go(index - 1)}>
            <ChevronLeft className="h-4 w-4" /> Back
          </Button>
          <div className="flex items-center gap-3">
            {!allowed && !last && !requiredFilled(step, draft) && <span className="text-xs text-muted-foreground">Fill in both dates to continue</span>}
            <Button type="submit" disabled={!allowed} loading={busy} loadingText={last ? 'Building…' : 'Saving…'}>
              {last ? 'Save & build calendar' : 'Continue'} {!last && <ChevronRight className="h-4 w-4" />}
            </Button>
          </div>
        </footer>
      </form>
    </div>
  )
}

// ------------------------------------------------------------------ review

function ReviewBody({
  draft,
  review,
  fixedCount,
  semesterBreak,
  onGo,
}: {
  draft: SetupDraft
  review: ReturnType<typeof reviewDraft>
  fixedCount: number
  semesterBreak: { startDate: ISODate; endDate: ISODate } | null
  onGo: (i: number) => void
}) {
  const range = (r: DateRange) => (r.start && r.end ? `${formatShortEthiopian(isoDate(r.start))} – ${formatShortEthiopian(isoDate(r.end))}` : 'Not entered yet')
  const movableActive = MOVABLE_HOLIDAY_KEYS.filter((k) => draft.closes[k]).length
  const enteredMovable = MOVABLE_HOLIDAY_KEYS.filter((k) => draft.closes[k] && draft.movable[k]).length
  const switchedOff = [...FIXED_HOLIDAY_KEYS, ...MOVABLE_HOLIDAY_KEYS].filter((k) => !draft.closes[k]).length
  const rows: { label: string; value: string; step: StepKey }[] = [
    { label: 'School year', value: range(draft.year), step: 'year' },
    { label: 'Semester 1', value: range(draft.sem1), step: 'semesters' },
    { label: 'Semester 2', value: range(draft.sem2), step: 'semesters' },
    ...(semesterBreak ? [{ label: 'Break', value: `${formatShortEthiopian(semesterBreak.startDate)} – ${formatShortEthiopian(semesterBreak.endDate)}`, step: 'semesters' as StepKey }] : []),
    {
      label: 'Holidays',
      value: `${fixedCount} permanent (automatic) + ${enteredMovable} of ${movableActive} that move${switchedOff ? ` · ${switchedOff} switched off` : ''}`,
      step: 'holidays',
    },
    ...ALL_EXAM_KEYS.map((k) => ({ label: EXAM_TYPES[k].name, value: range(draft.exams[k]), step: 'exams' as StepKey })),
    { label: 'Student return', value: draft.studentReturn ? formatShortWithWeekday(isoDate(draft.studentReturn)) : 'Not entered yet', step: 'return' },
  ]
  const stepIndex = (s: StepKey) => STEP_KEYS.indexOf(s)
  const groups: { title: string; tone: string; issues: ValidationIssue[]; action: string }[] = [
    { title: 'Fix these before finishing', tone: 'text-error-text', issues: review.errors, action: 'Fix' },
    { title: 'Still to enter', tone: 'text-foreground', issues: review.missing, action: 'Add' },
    { title: 'Worth a look', tone: 'text-muted-foreground', issues: review.issues.filter((i) => i.severity === 'WARNING'), action: 'Look' },
  ]
  return (
    <div className="space-y-5">
      <dl className="divide-y divide-border rounded-lg border border-border">
        {rows.map((r, i) => (
          <div key={`${r.label}-${i}`} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
            <dt className="text-muted-foreground">{r.label}</dt>
            <dd className="flex items-center gap-3 text-foreground">
              {r.value}
              <button type="button" onClick={() => onGo(stepIndex(r.step))} className="text-xs text-primary underline underline-offset-4">
                Edit
              </button>
            </dd>
          </div>
        ))}
      </dl>

      {review.counts && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-border p-3">
            <p className="text-2xl font-semibold text-emerald-700">{review.counts.teachingDays}</p>
            <p className="text-sm text-muted-foreground">learning days — lessons are held and attendance is taken</p>
          </div>
          <div className="rounded-lg border border-border p-3">
            <p className="text-2xl font-semibold text-indigo-700">{review.counts.examLostDays}</p>
            <p className="text-sm text-muted-foreground">exam days — held at school, no lessons and no attendance</p>
          </div>
        </div>
      )}
      {review.counts && draft.ministryTarget && (
        <p className="text-sm text-muted-foreground">
          Ministry total you entered: {draft.ministryTarget} days. This calendar has {review.counts.ministryBasisDays} working days (learning + exam + student return).
        </p>
      )}

      {groups.map(
        (g) =>
          g.issues.length > 0 && (
            <div key={g.title} className="space-y-2">
              <p className={`text-sm font-medium ${g.tone}`}>{g.title}</p>
              <ul className="space-y-1.5">
                {g.issues.map((i, n) => (
                  <li key={`${i.code}-${n}`} className="flex flex-wrap items-start justify-between gap-2 text-sm">
                    <span className="max-w-[34rem] text-foreground">{friendlyLines([i])[0]?.text ?? localizeMessage(i.message)}</span>
                    <button
                      type="button"
                      onClick={() => onGo(stepIndex(stepForIssueSafe(i)))}
                      className="text-xs text-primary underline underline-offset-4"
                    >
                      {g.action}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ),
      )}

      {review.errors.length === 0 && review.missing.length === 0 && (
        <p className="flex items-center gap-2 text-sm font-medium text-success-text">
          <Check className="h-4 w-4" /> Everything is entered and every rule checks out.
        </p>
      )}
      {review.errors.length === 0 && review.missing.length > 0 && (
        <p className="text-sm text-muted-foreground">You can finish now and add the rest later — the calendar will use what is entered.</p>
      )}
    </div>
  )
}

function stepForIssueSafe(i: ValidationIssue): StepKey {
  const s = stepForIssue(i)
  return s === 'review' ? 'year' : s
}
