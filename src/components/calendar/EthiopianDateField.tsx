'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { toEthiopian, fromEthiopian, ETHIOPIAN_MONTH_NAMES_EN } from '@/lib/calendar'
import type { ISODate } from '@/lib/calendar'

interface Props {
  label: string
  name: string
  /** The academic year this date belongs to (AcademicYear.yearEc) — a
   *  school year never crosses an Ethiopian year boundary (Meskerem
   *  through Sene, all one E.C. year number), so every date field on the
   *  setup page shares this same fixed year rather than each having its
   *  own freely-typed one. That's what stops an admin from accidentally
   *  entering a date in the wrong Ethiopian year while setting up a
   *  specific year's calendar.
   *
   *  Not rendered here — showing "2019" next to every single field on a
   *  page that's already titled "Set up 2019 E.C." was pure repetition.
   *  The parent form states it once (see SetupForm's YearContextNote); this
   *  component only needs the number internally, for day-count math and
   *  Gregorian conversion. */
  ethiopianYear: number
  /** Gregorian ISODate ('' / undefined for a not-yet-set, nullable field). */
  defaultValue?: string
  /** Fires on genuine user interaction only (never on mount) — lets a
   *  parent form track "has anything here actually changed" without
   *  needing this field's internal state to be controlled from outside. */
  onChange?: () => void
  /** Fires with the resulting Gregorian date ('' while incomplete) each time
   *  it changes after mount — lets a parent show live feedback while the
   *  admin is still typing, before anything is saved. */
  onValueChange?: (value: ISODate | '') => void
}

interface EcParts {
  month: string
  day: string
}

function parseDefault(defaultValue?: string): EcParts {
  if (!defaultValue) return { month: '', day: '' }
  try {
    const ec = toEthiopian(defaultValue as ISODate)
    return { month: String(ec.month), day: String(ec.day) }
  } catch {
    // A malformed stored value shouldn't crash the form — just surface as
    // "not yet set" rather than taking the whole setup page down with it.
    return { month: '', day: '' }
  }
}

/**
 * Whether Pagumen (month 13) has 5 or 6 days in the given Ethiopian year.
 * Determined by round-tripping day 6 through the real converter rather than
 * hand-rolling Ethiopian leap-year math a second time — ethiopian-date.ts's
 * own "one authoritative conversion path, never reimplemented elsewhere"
 * rule applies to this input just as much as to the domain logic.
 */
function pagumenDayCount(ethiopianYear: number): 5 | 6 {
  try {
    const gc = fromEthiopian({ year: ethiopianYear, month: 13, day: 6 })
    const back = toEthiopian(gc)
    return back.year === ethiopianYear && back.month === 13 && back.day === 6 ? 6 : 5
  } catch {
    return 5
  }
}

function daysInEthiopianMonth(ethiopianYear: number, month: number): number {
  return month === 13 ? pagumenDayCount(ethiopianYear) : 30
}

/**
 * A date input the way K2 admins actually read Ministry plan documents —
 * Ethiopian month / day — instead of the browser's native Gregorian date
 * picker. Nobody using this form should ever have to convert a date by hand
 * before typing it in.
 *
 * The Gregorian ISODate the rest of the app runs on (API, database,
 * date-utils.ts) is still the only thing that ever leaves this component:
 * conversion happens locally via fromEthiopian(), and the result is
 * submitted through a hidden input under `name` — every existing
 * `new FormData(e.currentTarget).get(name)` call in SetupForm.tsx keeps
 * working completely unchanged.
 */
export function EthiopianDateField({ label, name, ethiopianYear, defaultValue, onChange, onValueChange }: Props) {
  const [parts, setParts] = useState<EcParts>(() => parseDefault(defaultValue))

  const maxDay = parts.month ? daysInEthiopianMonth(ethiopianYear, Number(parts.month)) : 30

  const gregorian = useMemo<ISODate | ''>(() => {
    if (!parts.month || !parts.day) return ''
    const m = Number(parts.month)
    const d = Number(parts.day)
    if (!Number.isInteger(m) || !Number.isInteger(d)) return ''
    if (d < 1 || d > daysInEthiopianMonth(ethiopianYear, m)) return ''
    try {
      return fromEthiopian({ year: ethiopianYear, month: m, day: d })
    } catch {
      return ''
    }
  }, [parts, ethiopianYear])

  const mounted = useRef(false)
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true
      return
    }
    onValueChange?.(gregorian)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gregorian])

  function setMonth(month: string) {
    onChange?.()
    setParts((p) => {
      // Switching into/within Pagumen can shrink the valid day range (e.g.
      // day 6 stops existing outside a leap year) — drop a day that no
      // longer fits rather than silently keeping an invalid combination.
      const newMax = month ? daysInEthiopianMonth(ethiopianYear, Number(month)) : 30
      const day = p.day && Number(p.day) > newMax ? '' : p.day
      return { month, day }
    })
  }

  function setDay(day: string) {
    onChange?.()
    setParts((p) => ({ ...p, day }))
  }

  return (
    <div className="flex flex-col gap-1 text-xs text-muted-foreground">
      <span>{label}</span>
      <div className="flex items-center gap-1.5">
        <select
          aria-label={`${label} — month (E.C.)`}
          value={parts.month}
          onChange={(e) => setMonth(e.target.value)}
          className="rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="">Month</option>
          {ETHIOPIAN_MONTH_NAMES_EN.map((monthName, i) => (
            <option key={monthName} value={i + 1}>
              {monthName}
            </option>
          ))}
        </select>
        <select
          aria-label={`${label} — day (E.C.)`}
          value={parts.day}
          onChange={(e) => setDay(e.target.value)}
          className="w-[4.5rem] rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="">Day</option>
          {Array.from({ length: maxDay }, (_, i) => i + 1).map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </div>
      <span className="text-[11px] text-muted-foreground/80">{gregorian ? `${new Date(`${gregorian}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })} (G.C.)` : 'Select month & day'}</span>
      <input type="hidden" name={name} value={gregorian} />
    </div>
  )
}
