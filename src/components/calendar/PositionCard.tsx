import { formatEthiopian } from '@/lib/calendar'
import type { CalendarPosition, UpcomingItem } from '@/lib/calendar'
import { Panel } from '@/components/ui/panel'

const PHASE_TEXT: Record<CalendarPosition['phase'], string> = {
  BEFORE_YEAR: 'The school year has not started yet',
  SEMESTER_1: 'Semester 1',
  BREAK: 'The break between the two halves',
  SEMESTER_2: 'Semester 2',
  IN_YEAR: 'The school year is under way',
  AFTER_YEAR: 'The school year has ended',
}

function when(n: number) {
  return n === 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`
}

function Line({ label, item }: { label: string; item: UpcomingItem | null }) {
  if (!item) return null
  return (
    <p>
      {label}: <strong className="text-foreground">{item.name}</strong>, {when(item.daysUntil)} ({formatEthiopian(item.date)})
    </p>
  )
}

/** "Where are we today?" - read-only, for everyone who can see the calendar. */
export function PositionCard({ position, teachingDaysLeft }: { position: CalendarPosition; teachingDaysLeft: number | null }) {
  return (
    <Panel title="Where we are today">
      <div className="space-y-1 text-sm text-muted-foreground">
        <p className="text-base font-semibold text-foreground">{PHASE_TEXT[position.phase]}</p>
        {position.daysUntilYearStarts !== null && <p>The year starts {when(position.daysUntilYearStarts)}.</p>}
        {position.dayOfYear !== null && position.daysLeftInYear !== null && (
          <p>
            Day {position.dayOfYear} of the school year, with {position.daysLeftInYear} days left
            {teachingDaysLeft !== null && <> ({teachingDaysLeft} of them with lessons)</>}.
          </p>
        )}
        {position.currentSemester && (
          <p>
            Day {position.currentSemester.dayOfSemester} of Semester {position.currentSemester.order}; it ends in{' '}
            {position.currentSemester.daysLeft} days.
          </p>
        )}
        {position.today_items.length > 0 && (
          <p>
            Happening now: <strong className="text-foreground">{position.today_items.map((i) => i.name).join(', ')}</strong>
          </p>
        )}
        <Line label="Next test" item={position.nextTest} />
        <Line label="Next holiday" item={position.nextHoliday} />
        <Line label="Next special day" item={position.nextSpecialDay} />
      </div>
    </Panel>
  )
}
