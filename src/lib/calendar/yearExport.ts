/**
 * yearExport.ts - the whole school year as plain rows, one per day, ready to
 * become an Excel sheet or a PDF table. Pure: no files are made here (the
 * platform turns rows into PDF/Excel); a CSV is provided because every
 * spreadsheet program opens it.
 */
import { formatEthiopian } from './ethiopian-date'
import { weekdayName } from './date-utils'
import { EXAM_TYPES } from './exams'
import { HOLIDAY_TYPES } from './holidays'
import { specialDaysOn } from './specialDays'
import type { SpecialDay } from './specialDays'
import { SPECIAL_DAY_INFO } from './reminderMessages'
import type { DailyTimelineEntry, ExamTypeKey, HolidayTypeKey } from './types'

export const YEAR_EXPORT_COLUMNS = [
  'Date',
  'Ethiopian date',
  'Weekday',
  'Half of the year',
  'School',
  'Lessons',
  'What is on',
] as const

export interface YearExportRow {
  date: string
  ethiopianDate: string
  weekday: string
  half: string
  school: 'Open' | 'Closed'
  lessons: 'Yes' | 'No'
  whatIsOn: string
}

function reasonText(reason: string): string | null {
  const [code, key] = reason.split(':')
  switch (code) {
    case 'WEEKEND':
      return null
    case 'HOLIDAY_CLOSURE':
      return HOLIDAY_TYPES[key as HolidayTypeKey]?.name ?? 'Holiday'
    case 'SEMESTER_BREAK':
      return 'Break between the two halves'
    case 'YEAR_END':
      return 'Last day of the school year'
    case 'STUDENT_RETURN':
      return "Students' return day"
    case 'EXAM_CLOSURE':
    case 'EXAM_PRESENT':
      return EXAM_TYPES[key as ExamTypeKey]?.name ?? 'Test'
    case 'GRADE12_ATTENDANCE_SUPPRESSED':
      return 'No attendance for Grade 12'
    default:
      return null
  }
}

export function buildYearExportRows(entries: DailyTimelineEntry[], specialDays: SpecialDay[] = []): YearExportRow[] {
  return entries.map((e) => {
    const parts: string[] = []
    for (const r of e.reasons) {
      const t = reasonText(r)
      if (t && !parts.includes(t)) parts.push(t)
    }
    for (const d of specialDaysOn(specialDays, e.date)) {
      const scope = d.grades === null ? '' : ` (Grade ${d.grades.join(', ')})`
      const students = d.studentsCome ? '' : ' - students stay home'
      parts.push(`${d.name || SPECIAL_DAY_INFO[d.situation].label}${scope}${students}`)
    }
    return {
      date: e.date,
      ethiopianDate: formatEthiopian(e.date),
      weekday: weekdayName(e.date).charAt(0) + weekdayName(e.date).slice(1).toLowerCase(),
      half: e.semesterOrder === 1 ? 'Semester 1' : e.semesterOrder === 2 ? 'Semester 2' : '',
      school: e.schoolOpen ? 'Open' : 'Closed',
      lessons: e.teachingDay ? 'Yes' : 'No',
      whatIsOn: parts.join('; '),
    }
  })
}

function csvCell(v: string): string {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

/** CSV text with a leading byte-order mark so Excel reads it correctly. */
export function yearExportToCsv(rows: YearExportRow[]): string {
  const lines = [YEAR_EXPORT_COLUMNS.map(csvCell).join(',')]
  for (const r of rows) {
    lines.push([r.date, r.ethiopianDate, r.weekday, r.half, r.school, r.lessons, r.whatIsOn].map(csvCell).join(','))
  }
  return '\uFEFF' + lines.join('\r\n') + '\r\n'
}
