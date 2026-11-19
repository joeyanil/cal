import { describe, expect, it } from 'vitest'
import { csvCell, yearExportToCsv, buildYearExportRows, isoDate } from '../../src/lib/calendar'
import type { DailyTimelineEntry, SpecialDay } from '../../src/lib/calendar'

describe('spreadsheet export is safe and readable', () => {
  it('neutralises text that a spreadsheet would run as a formula', () => {
    for (const bad of ['=HYPERLINK("http://evil.test","click")', '+1+1', '-2+3', '@SUM(A1)', '\tcmd']) {
      expect(csvCell(bad).replace(/^"/, '')).toMatch(/^'/)
    }
    expect(csvCell('Sports day')).toBe('Sports day')
    expect(csvCell('a, b')).toBe('"a, b"')
    expect(csvCell('say "hi"')).toBe('"say ""hi"""')
  })

  it('writes a header row, one row per day, and a byte-order mark for Excel', () => {
    const entry = { date: isoDate('2027-03-05'), semesterOrder: 2, schoolOpen: true, teachingDay: true, reasons: [] } as unknown as DailyTimelineEntry
    const day: SpecialDay = {
      id: 's', academicYearId: 'y', situation: 'CUSTOM', name: '=BAD()', startDate: isoDate('2027-03-05'), endDate: isoDate('2027-03-05'),
      studentsCome: false, grades: [9], customMessage: null, teacherAudience: 'AFFECTED_GRADES',
    }
    const rows = buildYearExportRows([entry], [day])
    expect(rows).toHaveLength(1)
    expect(rows[0]!.whatIsOn).toContain('(Grade 9) - students stay home')
    const csv = yearExportToCsv(rows)
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    expect(csv).toContain("'=BAD()")
    expect(csv.split('\r\n')[0]).toContain('Ethiopian date')
  })
})
