import { describe, expect, it } from 'vitest'
import { isoDate } from '@/lib/calendar/date-utils'
import { createHolidayOccurrence } from '@/lib/calendar/holidays'
import { buildFullYearTimeline } from '@/lib/calendar/timelineBuilder'
import {
  countAvailableDays,
  countTeachingDays,
  sliceRange,
  teachingDayBreakdown,
} from '@/lib/calendar/teachingDays'
import type { CalendarConfiguration, ExamInstance, Semester } from '@/lib/calendar/types'

function config(overrides: Partial<CalendarConfiguration> = {}): CalendarConfiguration {
  const semesters: Semester[] = [
    { id: 's1', academicYearId: 'y', order: 1, startDate: isoDate('2026-09-14'), endDate: isoDate('2027-01-15'), status: 'ACTIVE' },
    { id: 's2', academicYearId: 'y', order: 2, startDate: isoDate('2027-02-01'), endDate: isoDate('2027-07-01'), status: 'UPCOMING' },
  ]
  return {
    academicYear: { id: 'y', startDate: isoDate('2026-09-11'), endDate: isoDate('2027-07-08') },
    semesters,
    holidayOccurrences: [],
    examInstances: [],
    studentReturn: null,
    ...overrides,
  }
}

describe('teachingDays: whole-year count matches a hand count for a simple one-week range', () => {
  it('a plain Mon-Sun week has exactly 5 teaching days', () => {
    const entries = buildFullYearTimeline(config())
    const week = sliceRange(entries, isoDate('2026-10-05'), isoDate('2026-10-11')) // arbitrary in-semester week
    expect(countTeachingDays(week)).toBe(5)
  })
})

describe('teachingDays: works identically across whole-year / semester / month / arbitrary range', () => {
  it('produces a smaller count for a sub-range than the whole year', () => {
    const entries = buildFullYearTimeline(config())
    const wholeYear = countTeachingDays(entries)
    const oneMonth = countTeachingDays(sliceRange(entries, isoDate('2026-10-01'), isoDate('2026-10-31')))
    expect(oneMonth).toBeLessThan(wholeYear)
    expect(oneMonth).toBeGreaterThan(0)
  })

  it('semester 1 teaching days + semester 2 teaching days + lost days = total calendar days (accounting identity)', () => {
    const entries = buildFullYearTimeline(config())
    const breakdown = teachingDayBreakdown(entries)
    const sum =
      breakdown.teachingDays +
      breakdown.weekendDays +
      breakdown.holidayLostDays +
      breakdown.examLostDays +
      breakdown.breakLostDays +
      breakdown.studentReturnLostDays +
      breakdown.yearEndLostDays
    expect(sum).toBe(breakdown.totalCalendarDays)
  })
})

describe('teachingDays: overlapping-reason days are never double-subtracted', () => {
  it('a weekday that is both a closing holiday and inside an exam window is removed exactly once', () => {
    // Construct a contrived overlap: exam window that includes a holiday.
    const holiday = {
      ...createHolidayOccurrence({ academicYearId: 'y', holidayTypeKey: 'TIMKAT', ethiopianYear: 2019 }),
      id: 'h1',
    }
    const examInstance: ExamInstance = {
      id: 'e1',
      academicYearId: 'y',
      examTypeKey: 'S1_FINAL',
      startDate: isoDate('2027-01-04'), // Monday
      endDate: isoDate('2027-01-08'), // Friday
    }
    // Force the holiday onto a date inside the exam window for this test,
    // regardless of Timkat's real date, to isolate the overlap behavior.
    const overlapping = { ...holiday, date: isoDate('2027-01-06') }
    const entries = buildFullYearTimeline(
      config({ holidayOccurrences: [overlapping], examInstances: [examInstance] }),
    )
    const breakdown = teachingDayBreakdown(sliceRange(entries, examInstance.startDate, examInstance.endDate))
    // 5 weekdays total in the exam window; every single one is lost to
    // exactly one bucket (holiday OR exam, never both), so the buckets sum
    // to 5, not 6.
    expect(breakdown.holidayLostDays + breakdown.examLostDays).toBe(5)
    expect(breakdown.teachingDays).toBe(0)
  })
})

describe('teachingDays: Grade 12 National Exam treatment', () => {
  it('does not reduce the whole-school teaching-day count', () => {
    const withoutExam = countTeachingDays(buildFullYearTimeline(config()))
    const instance: ExamInstance = {
      id: 'g12',
      academicYearId: 'y',
      examTypeKey: 'GRADE12_NATIONAL',
      startDate: isoDate('2027-05-10'),
      endDate: isoDate('2027-05-12'),
    }
    const withExam = countTeachingDays(buildFullYearTimeline(config({ examInstances: [instance] })))
    expect(withExam).toBe(withoutExam) // identical — Grade 12 exam never closes school
  })

  it('reduces the Grade-12-scoped attendance-availability count, but not the whole-school one', () => {
    const instance: ExamInstance = {
      id: 'g12',
      academicYearId: 'y',
      examTypeKey: 'GRADE12_NATIONAL',
      startDate: isoDate('2027-05-10'), // Monday
      endDate: isoDate('2027-05-12'),
    }
    const entries = buildFullYearTimeline(config({ examInstances: [instance] }))
    const window = sliceRange(entries, instance.startDate, instance.endDate)
    expect(countAvailableDays(window, 'ALL')).toBe(3) // whole school: all 3 days available
    expect(countAvailableDays(window, 'GRADE_12')).toBe(0) // Grade 12: none available
  })
})

describe('teachingDays: Student Return exclusion', () => {
  it('is excluded from the teaching-day count but present in the calendar-day count', () => {
    const date = isoDate('2026-09-14')
    const entries = buildFullYearTimeline(config({ studentReturn: { id: 'sr', academicYearId: 'y', date } }))
    const day = sliceRange(entries, date, date)
    expect(day).toHaveLength(1)
    expect(countTeachingDays(day)).toBe(0)
    const breakdown = teachingDayBreakdown(day)
    expect(breakdown.studentReturnLostDays).toBe(1)
    expect(breakdown.totalCalendarDays).toBe(1)
  })
})

describe('year-end day and Ministry-basis count', () => {
  it('last day of the year has no attendance and is not a teaching day', () => {
    const entries = buildFullYearTimeline(config())
    const last = entries[entries.length - 1]!
    if (!last.isWeekend) {
      expect(last.teachingDay).toBe(false)
      expect(last.attendanceAvailable).toBe(false)
      expect(last.schoolOpen).toBe(true)
      expect(last.reasons).toContain('YEAR_END')
    }
  })

  it('Ministry-basis count = teaching days + exam days + student-return day', () => {
    const b = teachingDayBreakdown(buildFullYearTimeline(config()))
    expect(b.ministryBasisDays).toBe(b.teachingDays + b.examLostDays + b.studentReturnLostDays)
  })
})
