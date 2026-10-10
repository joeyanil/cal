'use client'

import { useMemo, useState, type CSSProperties } from 'react'
import clsx from 'clsx'
import { X } from 'lucide-react'
import {
  DAY_KINDS,
  ETHIOPIAN_MONTH_NAMES_EN,
  classifyDay,
  groupByEthiopianMonth,
  overlayOf,
  summarizeYear,
} from '@/lib/calendar'
import type { DailyTimelineEntry, DayKind } from '@/lib/calendar'

type Focus = DayKind | 'G12' | 'HOLIDAY_ON_WEEKEND' | null

interface KindMeta {
  name: string
  blurb: string
  /** Fill + text colour of a day cell. */
  cell: string
  style?: CSSProperties
}

// One distinct hue per kind, so no two meanings ever share a colour. The
// semester break also carries a stripe pattern, so it still reads for people
// who cannot tell the hues apart.
const STRIPES: CSSProperties = {
  backgroundImage: 'repeating-linear-gradient(135deg, #e0f2fe 0 5px, #bae6fd 5px 10px)',
}

const KIND_META: Record<DayKind, KindMeta> = {
  LEARNING: {
    name: 'Learning day',
    blurb: 'Lessons are held and attendance is taken.',
    cell: 'bg-emerald-100 text-emerald-900',
  },
  EXAM_CLOSED: {
    name: 'Exam day (school closed)',
    blurb: 'A regional or final exam. No normal lessons and no attendance.',
    cell: 'bg-red-600 text-white font-semibold',
  },
  HOLIDAY: {
    name: 'Holiday (school closed)',
    blurb: 'A public or religious holiday on a weekday. No lessons.',
    cell: 'bg-amber-400 text-amber-950 font-semibold',
  },
  BREAK: {
    name: 'Semester break',
    blurb: 'Weekdays between Semester 1 and Semester 2. No lessons.',
    cell: 'text-sky-900',
    style: STRIPES,
  },
  RETURN: {
    name: 'Student return day',
    blurb: 'Students come back for orientation. No lessons and no attendance.',
    cell: 'bg-blue-600 text-white font-semibold',
  },
  YEAR_END: {
    name: 'Last day of the year',
    blurb: 'Closing day. No lessons and no attendance.',
    cell: 'bg-slate-800 text-white font-semibold',
  },
  WEEKEND: {
    name: 'Weekend',
    blurb: 'Saturday and Sunday. Includes holidays that fall on a weekend.',
    cell: 'bg-slate-100 text-slate-400',
  },
  OTHER: {
    name: 'Other non-learning day',
    blurb: 'A day with no lessons that does not fit the types above.',
    cell: 'bg-fuchsia-100 text-fuchsia-900',
  },
}

const OVERLAY_META = {
  G12: {
    name: 'Grade 12 national exam week',
    blurb: 'Held nationally. K2 stays open and teaching, so these are still learning days.',
  },
  HOLIDAY_ON_WEEKEND: {
    name: 'Holiday on a weekend',
    blurb: 'Shown with an orange dot. No school day is lost, so it costs nothing.',
  },
} as const

const MONDAY_FIRST = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY']
const WEEKDAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

function gregorian(date: string, withWeekday = false): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', {
    weekday: withWeekday ? 'short' : undefined,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

function gregorianShort(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
}

function matches(entry: DailyTimelineEntry, focus: Focus): boolean {
  if (!focus) return true
  if (focus === 'G12' || focus === 'HOLIDAY_ON_WEEKEND') return overlayOf(entry) === focus
  return classifyDay(entry) === focus
}

function Swatch({ kind, className }: { kind: DayKind; className?: string }) {
  const meta = KIND_META[kind]
  return <span aria-hidden className={clsx('inline-block h-6 w-6 shrink-0 rounded-md', meta.cell, className)} style={meta.style} />
}

function StatCard({ value, label, tone }: { value: number; label: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-border bg-white p-3">
      <p className={clsx('tabular-dates text-3xl font-bold', tone ?? 'text-foreground')}>{value}</p>
      <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{label}</p>
    </div>
  )
}

function dayDetails(entry: DailyTimelineEntry): { title: string; kind: DayKind; lines: string[] } {
  const kind = classifyDay(entry)
  const lines: string[] = [KIND_META[kind].blurb]
  for (const h of entry.holidays) {
    lines.push(`${h.name}${h.closesSchool ? ' — school closed' : ''}${entry.isWeekend ? ' (falls on a weekend)' : ''}`)
  }
  for (const e of entry.exams) {
    lines.push(`${e.name} — day ${e.dayNumber} of ${e.totalDays}${e.closesSchool ? '' : ' (held nationally, school stays open)'}`)
  }
  lines.push(entry.semesterOrder ? `Semester ${entry.semesterOrder}` : 'Between semesters')
  return {
    title: `${ETHIOPIAN_MONTH_NAMES_EN[entry.ethiopian.month - 1]} ${entry.ethiopian.day}, ${entry.ethiopian.year} · ${gregorian(entry.date, true)}`,
    kind,
    lines,
  }
}

export function YearView({ entries }: { entries: DailyTimelineEntry[] }) {
  const summary = useMemo(() => summarizeYear(entries), [entries])
  const months = useMemo(() => groupByEthiopianMonth(entries), [entries])
  const sortedKeys = useMemo(() => [...months.keys()].sort(), [months])
  const [focus, setFocus] = useState<Focus>(null)
  const [selected, setSelected] = useState<DailyTimelineEntry | null>(null)

  const toggleFocus = (f: Exclude<Focus, null>) => setFocus((cur) => (cur === f ? null : f))
  const shownKinds = DAY_KINDS.filter((k) => summary.counts[k] > 0)
  const barKinds: DayKind[] = [...shownKinds, ...(summary.counts.OTHER > 0 ? (['OTHER'] as DayKind[]) : [])]
  const detail = selected ? dayDetails(selected) : null

  return (
    <div className="space-y-6">
      {/* ---- the headline numbers ---- */}
      <section aria-label="Year totals" className="space-y-3">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard value={summary.learningDays} label="Learning days — lessons and attendance" tone="text-emerald-700" />
          <StatCard value={summary.counts.EXAM_CLOSED} label="Exam days — school closed" tone="text-red-600" />
          <StatCard value={summary.noLessonDays} label="Days without lessons — everything that is not a learning day" />
          <StatCard value={summary.ministryBasisDays} label="Ministry-basis days — learning + exam + student return" />
        </div>
        <p className="text-sm text-foreground">
          <strong>{summary.totalDays} calendar days</strong> = {summary.learningDays} learning days + {summary.noLessonDays} days without lessons.
          {' '}
          Semester 1 has <strong>{summary.learningBySemester[1]}</strong> learning days and Semester 2 has <strong>{summary.learningBySemester[2]}</strong>.
        </p>

        <div
          role="img"
          aria-label={`Where the ${summary.totalDays} days go: ${barKinds.map((k) => `${summary.counts[k]} ${KIND_META[k].name}`).join(', ')}`}
          className="flex h-4 w-full overflow-hidden rounded-full border border-border"
        >
          {barKinds.map((k) => (
            <span
              key={k}
              title={`${KIND_META[k].name}: ${summary.counts[k]}`}
              className={KIND_META[k].cell.split(' ').filter((c) => c.startsWith('bg-')).join(' ')}
              style={{ width: `${(summary.counts[k] / summary.totalDays) * 100}%`, ...KIND_META[k].style }}
            />
          ))}
        </div>
      </section>

      {/* ---- the key, which is also the breakdown ---- */}
      <section aria-label="Key and totals" className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-foreground">What each colour means</h2>
          {focus && (
            <button type="button" onClick={() => setFocus(null)} className="text-xs text-primary underline underline-offset-4">
              Show all days
            </button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">Tap a row to highlight those days on the calendar below.</p>
        <ul className="grid gap-2 sm:grid-cols-2">
          {shownKinds.map((k) => (
            <li key={k}>
              <button
                type="button"
                onClick={() => toggleFocus(k)}
                aria-pressed={focus === k}
                className={clsx(
                  'flex w-full items-start gap-3 rounded-lg border p-2.5 text-left transition-colors',
                  focus === k ? 'border-foreground bg-card' : 'border-border bg-white hover:bg-card',
                )}
              >
                <Swatch kind={k} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-medium text-foreground">{KIND_META[k].name}</span>
                    <span className="tabular-dates text-sm font-semibold text-foreground">{summary.counts[k]}</span>
                  </span>
                  <span className="block text-xs leading-snug text-muted-foreground">{KIND_META[k].blurb}</span>
                </span>
              </button>
            </li>
          ))}
          {([['G12', summary.g12Days], ['HOLIDAY_ON_WEEKEND', summary.weekendHolidayDays]] as const)
            .filter(([, n]) => n > 0)
            .map(([o, n]) => (
              <li key={o}>
                <button
                  type="button"
                  onClick={() => toggleFocus(o)}
                  aria-pressed={focus === o}
                  className={clsx(
                    'flex w-full items-start gap-3 rounded-lg border p-2.5 text-left transition-colors',
                    focus === o ? 'border-foreground bg-card' : 'border-border bg-white hover:bg-card',
                  )}
                >
                  <span
                    aria-hidden
                    className={clsx(
                      'relative inline-block h-6 w-6 shrink-0 rounded-md',
                      o === 'G12' ? 'bg-emerald-100 ring-2 ring-inset ring-violet-600' : 'bg-slate-100',
                    )}
                  >
                    {o === 'HOLIDAY_ON_WEEKEND' && <span className="absolute right-0.5 top-0.5 h-2 w-2 rounded-full bg-amber-500" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="text-sm font-medium text-foreground">{OVERLAY_META[o].name}</span>
                      <span className="tabular-dates text-sm font-semibold text-foreground">{n}</span>
                    </span>
                    <span className="block text-xs leading-snug text-muted-foreground">{OVERLAY_META[o].blurb}</span>
                  </span>
                </button>
              </li>
            ))}
        </ul>

        <details className="rounded-lg border border-border bg-white p-3 text-sm">
          <summary className="cursor-pointer font-medium text-foreground">How the days are counted</summary>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-xs leading-relaxed text-muted-foreground">
            <li>Every calendar day from the first to the last day of the school year has exactly one colour, so the numbers always add up to {summary.totalDays}.</li>
            <li><strong>Learning days</strong> are the days teachers teach and attendance is taken. This is the number to use for attendance and lesson planning.</li>
            <li><strong>Ministry-basis days</strong> also count exam days and the student return day, because the Ministry counts them as working days. No lessons or attendance happen on them. The Ministry&apos;s own total also adds about 9 teacher-only days before school opens, which K2 does not track.</li>
            <li>A holiday on a Saturday or Sunday is counted as a weekend day, because no school day is lost.</li>
            <li>The Grade 12 national exam is held outside K2, so the school stays open and those days stay learning days.</li>
          </ul>
        </details>
      </section>

      {/* ---- the calendar ---- */}
      <section aria-label="Calendar" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {sortedKeys.map((key) => {
          const days = months.get(key)
          if (!days || days.length === 0) return null
          const first = days[0]!
          const last = days[days.length - 1]!
          const monthNumber = first.ethiopian.month
          const pad = MONDAY_FIRST.indexOf(first.weekday)
          const learning = summary.learningByMonth[monthNumber] ?? 0
          return (
            <div key={key} className="rounded-xl border border-border bg-white p-3">
              <header className="mb-2 flex items-start justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">
                    {ETHIOPIAN_MONTH_NAMES_EN[monthNumber - 1]} {first.ethiopian.year}
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    {gregorianShort(first.date)} – {gregorian(last.date)}
                  </p>
                </div>
                <p className="shrink-0 text-right text-xs text-muted-foreground">
                  <span className="tabular-dates text-base font-bold text-emerald-700">{learning}</span> learning days
                </p>
              </header>
              <div className="grid grid-cols-7 gap-1 text-center">
                {WEEKDAY_LETTERS.map((w, i) => (
                  <div key={i} className={clsx('pb-0.5 text-[11px] font-medium', i >= 5 ? 'text-slate-400' : 'text-muted-foreground')}>
                    {w}
                  </div>
                ))}
                {Array.from({ length: pad }).map((_, i) => (
                  <div key={`p${i}`} />
                ))}
                {days.map((entry) => {
                  const kind = classifyDay(entry)
                  const meta = KIND_META[kind]
                  const overlay = overlayOf(entry)
                  const isSelected = selected?.date === entry.date
                  return (
                    <button
                      key={entry.date}
                      type="button"
                      onClick={() => setSelected(isSelected ? null : entry)}
                      aria-pressed={isSelected}
                      aria-label={`${ETHIOPIAN_MONTH_NAMES_EN[monthNumber - 1]} ${entry.ethiopian.day}: ${meta.name}${overlay ? `, ${OVERLAY_META[overlay].name}` : ''}`}
                      style={meta.style}
                      className={clsx(
                        'tabular-dates relative flex h-9 w-full items-center justify-center rounded-md text-xs transition-opacity',
                        meta.cell,
                        overlay === 'G12' && 'ring-2 ring-inset ring-violet-600',
                        isSelected && 'outline outline-2 outline-offset-1 outline-foreground',
                        !matches(entry, focus) && 'opacity-20',
                      )}
                    >
                      {entry.ethiopian.day}
                      {overlay === 'HOLIDAY_ON_WEEKEND' && <span aria-hidden className="absolute right-0.5 top-0.5 h-2 w-2 rounded-full bg-amber-500" />}
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </section>

      {/* ---- details of the tapped day ---- */}
      {detail && selected && (
        <div role="status" className="sticky bottom-3 z-20 flex items-start gap-3 rounded-xl border border-border bg-white p-3 shadow-lg">
          <Swatch kind={detail.kind} />
          <div className="min-w-0 flex-1 space-y-0.5">
            <p className="text-sm font-semibold text-foreground">{detail.title}</p>
            <p className="text-sm font-medium text-foreground">{KIND_META[detail.kind].name}</p>
            {detail.lines.map((l, i) => (
              <p key={i} className="text-xs text-muted-foreground">
                {l}
              </p>
            ))}
          </div>
          <button type="button" aria-label="Close day details" onClick={() => setSelected(null)} className="rounded p-1 text-muted-foreground hover:bg-card">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  )
}
