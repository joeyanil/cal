'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '../ui/button'
import { Panel } from '../ui/panel'
import { EthiopianDateField } from './EthiopianDateField'
import {
  MOVABLE_HOLIDAY_KEYS,
  STANDARD_EXAM_KEYS,
  GRADE12_EXAM_KEY,
  indexHolidaysByDate,
  analyzeExamWindow,
  toEthiopian,
  ETHIOPIAN_MONTH_NAMES_EN,
  isoDate,
  weekdayName,
  HOLIDAY_TYPES,
} from '@/lib/calendar'
import type {
  ISODate,
  AcademicYear,
  Semester,
  SemesterOrder,
  HolidayOccurrence,
  HolidayTypeKey,
  ExamInstance,
  ExamTypeKey,
  ExamShiftSuggestion,
  StudentReturnDay,
  ValidationIssue,
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

/** "Hidar 5" — Ethiopian month and day only; the year is already stated at
 *  the top of the page. */
function shortEc(date: ISODate): string {
  const ec = toEthiopian(date)
  return `${ETHIOPIAN_MONTH_NAMES_EN[ec.month - 1]} ${ec.day}`
}

function dayName(date: ISODate): string {
  const w = weekdayName(date).toLowerCase()
  return w.charAt(0).toUpperCase() + w.slice(1)
}

/** Plain-English lines for a set of issues. Consecutive weekend days (a
 *  Saturday and Sunday) are merged into one line instead of two. */
function problemLines(issues: ValidationIssue[]): { text: string; error: boolean }[] {
  const lines: { text: string; error: boolean }[] = []
  const weekendDates = issues.filter((i) => i.code === 'CALENDAR_EXAM_ON_WEEKEND' && i.date).map((i) => i.date!)
  if (weekendDates.length > 0) {
    const first = weekendDates[0]!
    const last = weekendDates[weekendDates.length - 1]!
    lines.push({
      text:
        weekendDates.length === 1
          ? `${shortEc(first)} (${dayName(first)}) is a weekend \u2014 no exams on Saturday or Sunday.`
          : `${shortEc(first)} \u2013 ${shortEc(last)} includes a weekend (${dayName(first)}\u2013${dayName(last)}) \u2014 no exams on Saturday or Sunday.`,
      error: true,
    })
  }
  for (const i of issues) {
    if (i.code === 'CALENDAR_EXAM_ON_WEEKEND') continue
    lines.push({ text: problemText(i), error: i.severity === 'ERROR' })
  }
  return lines
}

/** One plain-English line per problem, with Ethiopian dates. */
function problemText(issue: ValidationIssue): string {
  const when = issue.date ? `${shortEc(issue.date)} (${dayName(issue.date)})` : ''
  const holiday = issue.ref && 'holidayTypeKey' in issue.ref ? HOLIDAY_TYPES[issue.ref.holidayTypeKey]?.name : null
  switch (issue.code) {
    case 'CALENDAR_EXAM_ON_WEEKEND':
      return `${when} is a weekend \u2014 no exams on Saturday or Sunday.`
    case 'CALENDAR_EXAM_ON_CLOSING_HOLIDAY':
      return `${when} is a school holiday${holiday ? ` (${holiday})` : ''}.`
    case 'CALENDAR_EXAM_IN_HOLIDAY_WEEK':
      return `That week has a holiday on ${when}${holiday ? ` (${holiday})` : ''} \u2014 no exams in a holiday week.`
    case 'CALENDAR_EXAM_INVALID_RANGE':
      return 'The end date is before the start date.'
    case 'CALENDAR_EXAM_CROSSES_SEMESTER_BOUNDARY':
      return 'This window goes outside its semester.'
    case 'CALENDAR_EXAM_OUTSIDE_YEAR':
      return 'This window is outside the school year.'
    case 'CALENDAR_EXAM_OVERLAPS_OTHER_EXAM':
      return `This overlaps another exam${issue.date ? ` starting ${shortEc(issue.date)}` : ''}.`
    default:
      return issue.message
  }
}

function describeSuggestion(s: ExamShiftSuggestion): string {
  const dirLabel = s.direction === 'EARLIER' ? 'earlier' : 'later'
  return `${s.offsetDays} day${s.offsetDays === 1 ? '' : 's'} ${dirLabel}: ${shortEc(s.startDate)} \u2013 ${shortEc(s.endDate)}`
}

function ExamForm({
  yearId,
  examKey,
  existing,
  yearEc,
  holidays,
  semesters,
  exams,
  year,
}: {
  yearId: string
  examKey: ExamTypeKey
  existing?: ExamInstance
  yearEc: number
  holidays: HolidayOccurrence[]
  semesters: Semester[]
  exams: ExamInstance[]
  year: AcademicYear
}) {
  const { status, dirty, setDirty, save } = useSectionSave()
  const [values, setValues] = useState<{ start: string; end: string }>({
    start: existing?.startDate ?? '',
    end: existing?.endDate ?? '',
  })
  // Remount key: applying a suggestion resets the (uncontrolled) date fields.
  const [fieldsKey, setFieldsKey] = useState(0)
  const [defaults, setDefaults] = useState({ start: existing?.startDate ?? '', end: existing?.endDate ?? '' })

  // Live check while typing: same function the server runs on Save.
  const analysis = useMemo(() => {
    if (!values.start || !values.end) return null
    return analyzeExamWindow(
      { examTypeKey: examKey, startDate: isoDate(values.start), endDate: isoDate(values.end) },
      {
        holidaysByDate: indexHolidaysByDate(holidays),
        semesters,
        academicYear: { startDate: year.startDate, endDate: year.endDate },
        otherExams: exams.filter((e) => e.examTypeKey !== examKey),
      },
    )
  }, [values, examKey, holidays, semesters, exams, year])

  const blocked = !!analysis && analysis.problems.length > 0
  const hasHelp = !!analysis && (analysis.problems.length > 0 || analysis.warnings.length > 0 || !!analysis.swapped)

  function applyWindow(startDate: string, endDate: string) {
    // Offered, never applied automatically: this only fills the fields in;
    // the admin still reviews and presses Save.
    setDefaults({ start: startDate, end: endDate })
    setValues({ start: startDate, end: endDate })
    setDirty(true)
    setFieldsKey((k) => k + 1)
  }

  return (
    <div className="flex flex-col gap-1.5">
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          if (blocked) return // the box below already says why
          const form = new FormData(e.currentTarget)
          void save(() =>
            post(`/api/v1/academic-years/${yearId}/exams`, 'PUT', {
              examTypeKey: examKey,
              startDate: form.get('startDate'),
              endDate: form.get('endDate'),
            }),
          )
        }}
      >
        <span className="w-40 text-sm">{examKey}</span>
        <EthiopianDateField
          key={`start-${fieldsKey}`}
          label="Start"
          name="startDate"
          ethiopianYear={yearEc}
          defaultValue={defaults.start}
          onChange={() => setDirty(true)}
          onValueChange={(v) => setValues((p) => ({ ...p, start: v }))}
        />
        <EthiopianDateField
          key={`end-${fieldsKey}`}
          label="End"
          name="endDate"
          ethiopianYear={yearEc}
          defaultValue={defaults.end}
          onChange={() => setDirty(true)}
          onValueChange={(v) => setValues((p) => ({ ...p, end: v }))}
        />
        <SaveButton status={status} dirty={dirty && !blocked} />
      </form>

      {analysis && hasHelp && (
        <div
          role="status"
          className={`ml-0 space-y-1.5 rounded-md border px-3 py-2 text-xs sm:ml-[calc(10rem+0.75rem)] ${
            blocked ? 'border-error-text/40' : 'border-input'
          }`}
        >
          {problemLines([...analysis.problems, ...analysis.warnings]).map((line, i) => (
            <p key={i} className={line.error ? 'font-medium text-error-text' : 'text-muted-foreground'}>
              {line.error ? '\u26D4 ' : '\u26A0 '}
              {line.text}
            </p>
          ))}
          <div className="flex flex-wrap items-center gap-2">
            {analysis.swapped && (
              <button
                type="button"
                onClick={() => applyWindow(analysis.swapped!.startDate, analysis.swapped!.endDate)}
                className="rounded border border-input bg-background px-2 py-1 font-medium hover:bg-accent"
              >
                Swap: {shortEc(analysis.swapped.startDate)} – {shortEc(analysis.swapped.endDate)}
              </button>
            )}
            {analysis.suggestions.length > 0 && <span className="text-muted-foreground">Nearest open window:</span>}
            {analysis.suggestions.map((sg) => (
              <button
                key={sg.direction}
                type="button"
                onClick={() => applyWindow(sg.startDate, sg.endDate)}
                className="rounded border border-input bg-background px-2 py-1 font-medium hover:bg-accent"
              >
                {describeSuggestion(sg)}
              </button>
            ))}
            {analysis.noWindowFound && (
              <span className="text-muted-foreground">
                No open window of this length found nearby inside its semester. Shorten the exam, or check the holiday and semester dates.
              </span>
            )}
          </div>
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
              semesters={semesters}
              exams={exams}
              year={year}
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
