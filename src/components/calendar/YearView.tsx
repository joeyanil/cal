import clsx from 'clsx'
import { groupByEthiopianMonth, ETHIOPIAN_MONTH_NAMES_EN } from '@/lib/calendar'
import type { DailyTimelineEntry } from '@/lib/calendar'

const WEEKDAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

function dayClasses(entry: DailyTimelineEntry): string {
  // FIX (v2 merge): text-destructive-foreground (white) against error at 70%
  // opacity, composited over this card, measures 3.22:1 — fails AA. Slate
  // Ink (text-foreground) on the same composite measures 4.66:1. Unlike the
  // holiday-closure line below, this one needed the class itself changed —
  // the underlying token (--destructive-foreground) is deliberately still
  // white, correct for a SOLID destructive fill (a delete button); this
  // cell is a 70%-opacity tint over a light card, a different case.
  if (entry.exams.some((e) => e.closesSchool)) return 'bg-destructive/70 text-foreground'
  // warning is used at full opacity here, so its paired --warning-foreground
  // token (globals.css — computed near-black, 4.83:1) is the correct fit
  // as-is; nothing to change on this line.
  if (entry.holidayClosure) return 'bg-warning text-warning-foreground'
  if (entry.isSemesterBreak) return 'bg-muted text-muted-foreground'
  if (entry.isStudentReturn) return 'bg-primary/20 text-foreground ring-1 ring-inset ring-primary'
  if (entry.reasons.includes('YEAR_END')) return 'bg-transparent text-foreground ring-1 ring-inset ring-muted-foreground/60'
  if (entry.exams.length > 0) return 'bg-primary/15 text-foreground' // Grade 12 exam, non-closing
  if (entry.isWeekend) return 'bg-transparent text-muted-foreground/50'
  return 'bg-transparent text-foreground'
}

function dayTitle(entry: DailyTimelineEntry): string {
  const parts: string[] = [entry.date]
  for (const h of entry.holidays) parts.push(`${h.name}${h.closesSchool ? ' (closed)' : ''}`)
  for (const e of entry.exams) parts.push(`${e.name} — day ${e.dayNumber} of ${e.totalDays}`)
  if (entry.isStudentReturn) parts.push('Student Return / Orientation')
  if (entry.isSemesterBreak) parts.push('Semester break')
  if (entry.reasons.includes('YEAR_END')) parts.push('Last day of the school year — no attendance')
  if (!entry.teachingDay && entry.holidays.length === 0 && entry.exams.length === 0 && !entry.isSemesterBreak && !entry.isStudentReturn && !entry.isWeekend && !entry.reasons.includes('YEAR_END')) {
    parts.push('Non-teaching')
  }
  return parts.join(' — ')
}

function MonthBlock({ label, days }: { label: string; days: DailyTimelineEntry[] }) {
  const firstWeekdayIndex = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'].indexOf(
    days[0]?.weekday ?? 'SUNDAY',
  )
  return (
    <div className="border border-border p-3">
      <h3 className="mb-2 text-sm font-semibold text-foreground">{label}</h3>
      <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-muted-foreground">
        {WEEKDAY_LETTERS.map((w, i) => (
          <div key={i}>{w}</div>
        ))}
        {Array.from({ length: firstWeekdayIndex }).map((_, i) => (
          <div key={`pad-${i}`} />
        ))}
        {days.map((entry) => (
          <div
            key={entry.date}
            title={dayTitle(entry)}
            className={clsx('tabular-dates flex h-6 w-6 items-center justify-center text-[11px]', dayClasses(entry))}
          >
            {entry.ethiopian.day}
          </div>
        ))}
      </div>
    </div>
  )
}

export function YearView({ entries }: { entries: DailyTimelineEntry[] }) {
  const months = groupByEthiopianMonth(entries)
  const sortedKeys = [...months.keys()].sort()

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-muted-foreground">
        <LegendItem swatch="bg-destructive/70" label="Exam (closes school)" />
        <LegendItem swatch="bg-warning" label="Holiday (closes school)" />
        <LegendItem swatch="bg-muted" label="Semester break" />
        <LegendItem swatch="bg-primary/20 ring-1 ring-primary" label="Student Return" />
        <LegendItem swatch="bg-primary/15" label="Grade 12 exam (school open)" />
        <LegendItem swatch="bg-transparent ring-1 ring-muted-foreground/60" label="Last day of year (no attendance)" />
        <LegendItem swatch="bg-transparent" outline label="Ordinary teaching day" />
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {sortedKeys.map((key) => {
          const monthDays = months.get(key)
          if (!monthDays || monthDays.length === 0) return null
          const monthNumber = monthDays[0]!.ethiopian.month
          const yearNumber = monthDays[0]!.ethiopian.year
          const label = `${ETHIOPIAN_MONTH_NAMES_EN[monthNumber - 1]} ${yearNumber}`
          return <MonthBlock key={key} label={label} days={monthDays} />
        })}
      </div>
    </div>
  )
}

function LegendItem({ swatch, label, outline }: { swatch: string; label: string; outline?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={clsx('inline-block h-3 w-3', swatch, outline && 'border border-border')} />
      {label}
    </span>
  )
}
