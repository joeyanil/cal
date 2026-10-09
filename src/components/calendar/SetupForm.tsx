'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '../ui/button'
import { Panel } from '../ui/panel'
import { EthiopianDateField } from './EthiopianDateField'
import {
  MOVABLE_HOLIDAY_KEYS,
  STANDARD_EXAM_KEYS,
  GRADE12_EXAM_KEY,
  indexHolidaysByDate,
  suggestExamShift,
  formatEthiopian,
  isoDate,
} from '@/lib/calendar'
import type {
  AcademicYear,
  Semester,
  SemesterOrder,
  HolidayOccurrence,
  HolidayTypeKey,
  ExamInstance,
  ExamTypeKey,
  ExamShiftSuggestion,
  StudentReturnDay,
} from '@/lib/calendar'

interface Props {
  yearId: string
  year: AcademicYear
  semesters: Semester[]
  holidays: HolidayOccurrence[]
  exams: ExamInstance[]
  studentReturn: StudentReturnDay | null
}

/** Error thrown by `post()` that preserves the server's AppError code, so
 * callers (like ExamForm's weekend/holiday shift suggestion) can react to
 * *which* validation failed, not just display its message. */
class PostError extends Error {
  code: string
  constructor(message: string, code: string) {
    super(message)
    this.code = code
  }
}

async function post(url: string, method: string, body: unknown) {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const json = await res.json()
  if (!json.success) throw new PostError(json.error.message, json.error.code)
  return json.data
}

type SaveStatus = 'idle' | 'saving' | 'saved' | string // any other string is an error message

/**
 * Shared save/dirty machinery for one form section. Extracted once instead
 * of repeated ~15 times (one per semester/holiday/exam) — every section
 * below reduces to "am I dirty" + "call save(fn) on submit", nothing else.
 */
function useSectionSave() {
  const router = useRouter()
  const [status, setStatus] = useState<SaveStatus>('idle')
  const [dirty, setDirty] = useState(false)

  async function save(fn: () => Promise<unknown>, onError?: (err: unknown) => void) {
    setStatus('saving')
    try {
      await fn()
      setStatus('saved')
      setDirty(false)
      router.refresh()
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Failed.')
      onError?.(err)
    }
  }

  return { status, dirty, setDirty, save }
}

/**
 * The Save button every section uses. Ghost and disabled until the section
 * is actually dirty, then switches to primary — the button itself signals
 * "there's something to save here" instead of ~15 identically loud buttons
 * sitting on the page whether or not anything changed.
 */
function SaveButton({ status, dirty }: { status: SaveStatus; dirty: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <Button type="submit" level={dirty ? 'primary' : 'ghost'} size="sm" disabled={!dirty || status === 'saving'} loading={status === 'saving'} loadingText="Saving…">
        Save
      </Button>
      {status === 'saved' && <span className="text-xs text-success-text">Saved</span>}
      {status !== 'idle' && status !== 'saving' && status !== 'saved' && <span className="text-xs text-error-text">{status}</span>}
    </div>
  )
}

/** States the Ethiopian year once, at the top of the page, instead of next
 *  to every single field below it (SetupForm previously repeated a locked
 *  "2019" chip ~15 times — once per date field — which read as cluttered
 *  more than it read as reassuring). */
function YearContextNote({ yearEc }: { yearEc: number }) {
  return (
    <p className="text-sm text-muted-foreground">
      Every date below is in <span className="font-medium text-foreground">{yearEc} E.C.</span> — Meskerem through
      Pagumen — since a school year never crosses into a different Ethiopian year.
    </p>
  )
}

function YearBoundaryForm({ yearId, year }: { yearId: string; year: AcademicYear }) {
  const { status, dirty, setDirty, save } = useSectionSave()

  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        const form = new FormData(e.currentTarget)
        void save(() =>
          post(`/api/v1/academic-years/${yearId}`, 'PATCH', {
            startDate: form.get('startDate'),
            endDate: form.get('endDate'),
          }),
        )
      }}
    >
      <EthiopianDateField label="Start date" name="startDate" ethiopianYear={year.yearEc} defaultValue={year.startDate} onChange={() => setDirty(true)} />
      <EthiopianDateField label="End date" name="endDate" ethiopianYear={year.yearEc} defaultValue={year.endDate} onChange={() => setDirty(true)} />
      <SaveButton status={status} dirty={dirty} />
    </form>
  )
}

function SemesterForm({ yearId, order, semester, yearEc }: { yearId: string; order: SemesterOrder; semester?: Semester; yearEc: number }) {
  const { status, dirty, setDirty, save } = useSectionSave()

  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        const form = new FormData(e.currentTarget)
        void save(() =>
          post(`/api/v1/academic-years/${yearId}/semesters/${order}`, 'PATCH', {
            startDate: form.get('startDate') || null,
            endDate: form.get('endDate') || null,
          }),
        )
      }}
    >
      <span className="w-20 text-sm font-medium text-foreground">Semester {order}</span>
      <EthiopianDateField label="Start date" name="startDate" ethiopianYear={yearEc} defaultValue={semester?.startDate ?? ''} onChange={() => setDirty(true)} />
      <EthiopianDateField label="End date" name="endDate" ethiopianYear={yearEc} defaultValue={semester?.endDate ?? ''} onChange={() => setDirty(true)} />
      <SaveButton status={status} dirty={dirty} />
    </form>
  )
}

function ProposeFixedHolidays({ yearId }: { yearId: string }) {
  const { status, save } = useSectionSave()
  // Always "actionable" — unlike the per-field forms, there's no dirty
  // concept here; it's a one-shot action, so it stays primary/enabled but
  // still shows the same Saving…/Saved/error feedback for consistency.
  return (
    <div className="flex items-center gap-2">
      <Button
        level="secondary"
        size="sm"
        loading={status === 'saving'}
        loadingText="Proposing…"
        onClick={() => void save(() => post(`/api/v1/academic-years/${yearId}/holidays`, 'POST', { action: 'seed_fixed' }))}
      >
        Propose the five fixed holidays
      </Button>
      {status === 'saved' && <span className="text-xs text-success-text">Proposed</span>}
      {status !== 'idle' && status !== 'saving' && status !== 'saved' && <span className="text-xs text-error-text">{status}</span>}
    </div>
  )
}

/**
 * Row for one of the 5 fixed holidays: date is always system-proposed
 * (never typed by an admin — see proposeFixedHolidayOccurrences), but until
 * now there was no way to actually *confirm* it. The backend's confirm
 * endpoint (fix #17) already existed for exactly this; this wires it up.
 * "Suggest, then one click to accept" — the fixed-holiday equivalent of
 * the movable-holiday form next to it, minus any date typing, since there's
 * nothing here for an admin to type: the date is deterministic every year.
 */
function FixedHolidayRow({ yearId, holiday }: { yearId: string; holiday: HolidayOccurrence }) {
  const { status, save } = useSectionSave()
  const confirmed = Boolean(holiday.confirmedAt)

  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-1.5">
      <span className="text-sm">{holiday.holidayTypeKey}</span>
      <span className="tabular-dates text-sm text-muted-foreground">
        {holiday.date} · {holiday.closesSchool ? 'closes school' : 'does not close school'}
      </span>
      {confirmed ? (
        <span className="text-xs text-success-text">✓ Confirmed</span>
      ) : (
        <div className="flex items-center gap-2">
          <Button
            level="primary"
            size="sm"
            loading={status === 'saving'}
            loadingText="Confirming…"
            onClick={() => void save(() => post(`/api/v1/academic-years/${yearId}/holidays/${holiday.holidayTypeKey}/confirm`, 'POST', {}))}
          >
            Confirm
          </Button>
          {status !== 'idle' && status !== 'saving' && status !== 'saved' && <span className="text-xs text-error-text">{status}</span>}
        </div>
      )}
    </li>
  )
}

function MovableHolidayForm({
  yearId,
  holidayKey,
  existing,
  yearEc,
}: {
  yearId: string
  holidayKey: HolidayTypeKey
  existing?: HolidayOccurrence
  yearEc: number
}) {
  const { status, dirty, setDirty, save } = useSectionSave()

  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        const form = new FormData(e.currentTarget)
        void save(() =>
          post(`/api/v1/academic-years/${yearId}/holidays`, 'POST', {
            action: 'enter_movable',
            holidayTypeKey: holidayKey,
            date: form.get('date'),
            closesSchool: true,
          }),
        )
      }}
    >
      <span className="w-24 text-sm">{holidayKey}</span>
      <EthiopianDateField label="Date" name="date" ethiopianYear={yearEc} defaultValue={existing?.date ?? ''} onChange={() => setDirty(true)} />
      <SaveButton status={status} dirty={dirty} />
    </form>
  )
}

/**
 * Formats a shift suggestion as something an admin reads at a glance:
 * direction, Ethiopian start/end, and how many days away. Nothing here
 * needs i18n beyond what formatEthiopian already gives us.
 */
function describeSuggestion(s: ExamShiftSuggestion): string {
  const dirLabel = s.direction === 'EARLIER' ? 'earlier' : 'later'
  return `${s.offsetDays}d ${dirLabel} \u2192 ${formatEthiopian(s.startDate)} \u2013 ${formatEthiopian(s.endDate)}`
}

function ExamForm({
  yearId,
  examKey,
  existing,
  yearEc,
  holidays,
}: {
  yearId: string
  examKey: ExamTypeKey
  existing?: ExamInstance
  yearEc: number
  holidays: HolidayOccurrence[]
}) {
  const { status, dirty, setDirty, save } = useSectionSave()
  // Holds the suggestions computed after a rejected save, and a remount
  // key so applying one can reset the (uncontrolled) date fields to the
  // suggested dates without hand-rolling controlled-input plumbing here.
  const [suggestions, setSuggestions] = useState<ExamShiftSuggestion[]>([])
  const [fieldValues, setFieldValues] = useState({ startDate: existing?.startDate ?? '', endDate: existing?.endDate ?? '' })
  const [fieldsKey, setFieldsKey] = useState(0)

  function handleSubmit(startDate: string, endDate: string) {
    void save(
      () =>
        post(`/api/v1/academic-years/${yearId}/exams`, 'PUT', {
          examTypeKey: examKey,
          startDate,
          endDate,
        }),
      (err) => {
        const code = err instanceof Error && 'code' in err ? (err as { code: string }).code : undefined
        if (code === 'CALENDAR_EXAM_ON_WEEKEND' || code === 'CALENDAR_EXAM_ON_CLOSING_HOLIDAY') {
          setSuggestions(
            suggestExamShift({ startDate: isoDate(startDate), endDate: isoDate(endDate) }, indexHolidaysByDate(holidays)),
          )
        } else {
          setSuggestions([])
        }
      },
    )
  }

  function applySuggestion(s: ExamShiftSuggestion) {
    // Suggestions are offered, never applied automatically (same rule the
    // engine already holds for every other auto-derived date, e.g.
    // rollover.ts) — this only fills the fields in; the admin still has to
    // review and press Save.
    setFieldValues({ startDate: s.startDate, endDate: s.endDate })
    setSuggestions([])
    setDirty(true)
    setFieldsKey((k) => k + 1)
  }

  return (
    <div className="flex flex-col gap-1.5">
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          const form = new FormData(e.currentTarget)
          handleSubmit(String(form.get('startDate') ?? ''), String(form.get('endDate') ?? ''))
        }}
      >
        <span className="w-40 text-sm">{examKey}</span>
        <EthiopianDateField
          key={`start-${fieldsKey}`}
          label="Start"
          name="startDate"
          ethiopianYear={yearEc}
          defaultValue={fieldValues.startDate}
          onChange={() => setDirty(true)}
        />
        <EthiopianDateField
          key={`end-${fieldsKey}`}
          label="End"
          name="endDate"
          ethiopianYear={yearEc}
          defaultValue={fieldValues.endDate}
          onChange={() => setDirty(true)}
        />
        <SaveButton status={status} dirty={dirty} />
      </form>
      {suggestions.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 pl-[calc(10rem+0.75rem)] text-xs">
          <span className="text-muted-foreground">That window hits a weekend or closing holiday. Nearest open window:</span>
          {suggestions.map((s) => (
            <button
              key={s.direction}
              type="button"
              onClick={() => applySuggestion(s)}
              className="rounded border border-input bg-background px-2 py-1 font-medium hover:bg-accent"
            >
              {describeSuggestion(s)}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function StudentReturnForm({ yearId, studentReturn, yearEc }: { yearId: string; studentReturn: StudentReturnDay | null; yearEc: number }) {
  const { status, dirty, setDirty, save } = useSectionSave()

  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        const form = new FormData(e.currentTarget)
        void save(() => post(`/api/v1/academic-years/${yearId}/student-return`, 'PUT', { date: form.get('date') }))
      }}
    >
      <EthiopianDateField label="Date" name="date" ethiopianYear={yearEc} defaultValue={studentReturn?.date ?? ''} onChange={() => setDirty(true)} />
      <SaveButton status={status} dirty={dirty} />
    </form>
  )
}

export function SetupForm({ yearId, year, semesters, holidays, exams, studentReturn }: Props) {
  const s1 = semesters.find((s) => s.order === 1)
  const s2 = semesters.find((s) => s.order === 2)

  return (
    <div className="space-y-6">
      <YearContextNote yearEc={year.yearEc} />

      <Panel title="1. Year boundary">
        <p className="mb-3 text-sm text-muted-foreground">
          Defaults to Meskerem 5 → Sene 30. Replace with the real Ministry-plan dates once available — this is not a
          permanent official date.
        </p>
        <YearBoundaryForm yearId={yearId} year={year} />
      </Panel>

      <Panel title="2. Semesters">
        <div className="space-y-4">
          <SemesterForm yearId={yearId} order={1} semester={s1} yearEc={year.yearEc} />
          <SemesterForm yearId={yearId} order={2} semester={s2} yearEc={year.yearEc} />
        </div>
      </Panel>

      <Panel title="3. Holidays">
        <div className="space-y-4">
          <ProposeFixedHolidays yearId={yearId} />

          <ul className="divide-y divide-border">
            {holidays
              .filter((h) => h.source === 'AUTO_PROPOSED')
              .map((h) => (
                <FixedHolidayRow key={h.holidayTypeKey} yearId={yearId} holiday={h} />
              ))}
          </ul>

          <div className="space-y-2 border-t border-border pt-3">
            <p className="text-sm text-muted-foreground">
              Movable holidays — enter the confirmed date from this year&apos;s Ministry plan. Never calculated.
            </p>
            {MOVABLE_HOLIDAY_KEYS.map((key) => (
              <MovableHolidayForm key={key} yearId={yearId} holidayKey={key} existing={holidays.find((h) => h.holidayTypeKey === key)} yearEc={year.yearEc} />
            ))}
          </div>
        </div>
      </Panel>

      <Panel title="4. Exams">
        <div className="space-y-2">
          {[...STANDARD_EXAM_KEYS, GRADE12_EXAM_KEY].map((key) => (
            <ExamForm
              key={key}
              yearId={yearId}
              examKey={key}
              existing={exams.find((e) => e.examTypeKey === key)}
              yearEc={year.yearEc}
              holidays={holidays}
            />
          ))}
        </div>
      </Panel>

      <Panel title="5. Student Return / Orientation">
        <StudentReturnForm yearId={yearId} studentReturn={studentReturn} yearEc={year.yearEc} />
      </Panel>
    </div>
  )
}
