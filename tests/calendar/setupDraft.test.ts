import { describe, it, expect } from 'vitest'
import {
  draftFromData, fixedHolidaysFor, reviewDraft, canContinue, requiredFilled, stepForIssue, localizeMessage,
  ALL_EXAM_KEYS,
} from '@/lib/calendar'
import { ethiopianDate as E } from '@/lib/calendar/ethiopian-date'
import type { AcademicYear } from '@/lib/calendar/types'

const Y = 2019
const year = { id: 'y', yearEc: Y, name: '2019 E.C.', startDate: E(Y, 1, 4), endDate: E(Y, 10, 30), isDefaultBoundary: true, status: 'PREPARING' } as AcademicYear
const empty = () => draftFromData({ year, semesters: [], holidays: [], exams: [], studentReturn: null })
const fixed = fixedHolidaysFor('y', Y, [])

function complete() {
  const d = empty()
  d.sem1 = { start: E(Y, 1, 5), end: E(Y, 5, 23) }
  d.sem2 = { start: E(Y, 6, 1), end: E(Y, 10, 30) }
  d.movable = { SIKLET: E(Y, 8, 22), FASIKA: E(Y, 8, 24), EID_FITR: E(Y, 6, 30), EID_ADHA: E(Y, 9, 8) }
  d.exams.S1_REGIONAL_MODEL = { start: E(Y, 3, 7), end: E(Y, 3, 11) } // Mon-Fri after the weekend fix
  d.exams.S1_FINAL = { start: E(Y, 5, 17), end: E(Y, 5, 21) }
  d.exams.S2_REGIONAL_MODEL = { start: E(Y, 10, 7), end: E(Y, 10, 11) }
  d.exams.S2_FINAL = { start: E(Y, 10, 14), end: E(Y, 10, 18) }
  d.exams.GRADE12_NATIONAL = { start: E(Y, 10, 21), end: E(Y, 10, 25) }
  d.studentReturn = E(Y, 1, 4)
  return d
}

describe('permanent holidays', () => {
  it('are always present with no admin action, even if nothing is stored', () => {
    expect(fixed.map((h) => h.holidayTypeKey)).toEqual(['NEW_YEAR', 'GENNA', 'TIMKAT', 'ADWA', 'PATRIOTS', 'DERG_DOWNFALL'])
    expect(fixed.every((h) => h.closesSchool)).toBe(true)
    const r = reviewDraft(empty(), year, fixed)
    expect(r.issues.some((i) => i.code === 'CALENDAR_HOLIDAY_OCCURRENCE_MISSING' && /GENNA|TIMKAT|ADWA|PATRIOTS|NEW_YEAR/.test(i.message))).toBe(false)
  })
})

describe('reviewDraft', () => {
  it('a fresh year lists what is missing, with no errors', () => {
    const r = reviewDraft(empty(), year, fixed)
    expect(r.errors).toEqual([])
    expect(r.missing.length).toBeGreaterThan(5)
    expect(r.counts).toBeNull()
    expect(requiredFilled('semesters', empty())).toBe(false)
  })

  it('a full, valid 2019 plan has no errors and gives the day counts', () => {
    const r = reviewDraft(complete(), year, fixed)
    expect(r.errors).toEqual([])
    expect(r.missing).toEqual([])
    expect(r.counts).not.toBeNull()
    expect(r.counts!.ministryBasisDays).toBeGreaterThan(r.counts!.teachingDays)
    expect(r.counts!.ministryBasisDays).toBe(r.counts!.teachingDays + r.counts!.examLostDays + r.counts!.studentReturnLostDays)
  })

  it('the Ministry Hidar 3-7 window is an error on the exams step only, and blocks Continue there', () => {
    const d = complete()
    d.exams.S1_REGIONAL_MODEL = { start: E(Y, 3, 3), end: E(Y, 3, 7) }
    const r = reviewDraft(d, year, fixed)
    expect(r.byStep.exams.some((i) => i.code === 'CALENDAR_EXAM_ON_WEEKEND')).toBe(true)
    expect(canContinue('exams', d, r)).toBe(false)
    expect(canContinue('semesters', d, r)).toBe(true)
  })

  it('a movable holiday entered into an exam week blocks the exam, in the exams step', () => {
    const d = complete()
    d.movable.EID_FITR = E(Y, 5, 18) // Wed, inside the S1 Final week (Tir 17-21)
    const r = reviewDraft(d, year, fixed)
    expect(r.errors.some((i) => stepForIssue(i) === 'exams')).toBe(true)
  })

  it('semesters out of order block step 2 and are required before moving on', () => {
    const d = complete()
    d.sem1 = { start: E(Y, 5, 23), end: E(Y, 1, 5) }
    const r = reviewDraft(d, year, fixed)
    expect(canContinue('semesters', d, r)).toBe(false)
    expect(r.counts).toBeNull()
  })

  it('every one of the five exams is accounted for', () => {
    expect(ALL_EXAM_KEYS.length).toBe(5)
    expect(reviewDraft(empty(), year, fixed).missing.filter((i) => i.code === 'CALENDAR_EXAM_INSTANCE_MISSING').length).toBe(5)
  })
})

describe('localizeMessage', () => {
  it('shows Ethiopian dates and names instead of ISO dates and keys', () => {
    const out = localizeMessage('S1_FINAL (2027-01-25 – 2027-01-29) overlaps TIMKAT')
    expect(out).toContain('Semester 1 Final Exam')
    expect(out).toContain('Tir')
    expect(out).toContain('Timkat')
    expect(out).not.toMatch(/\d{4}-\d{2}-\d{2}/)
  })
})

describe('holiday switches', () => {
  it('a movable holiday switched off needs no date and is not "missing"', () => {
    const d = complete()
    d.closes.FASIKA = false
    d.movable.FASIKA = ''
    const r = reviewDraft(d, year, fixed)
    expect(r.missing.some((i) => /FASIKA/.test(i.message))).toBe(false)
    expect(r.errors).toEqual([])
  })

  it('a movable holiday left on with no date is still missing', () => {
    const d = complete()
    d.movable.FASIKA = ''
    expect(reviewDraft(d, year, fixed).missing.some((i) => /FASIKA/.test(i.message))).toBe(true)
  })

  it('switching a permanent holiday off turns that day back into a learning day', () => {
    const on = reviewDraft(complete(), year, fixed).counts!.teachingDays
    const d = complete()
    d.closes.ADWA = false // Yekatit 23, a Tuesday
    expect(reviewDraft(d, year, fixed).counts!.teachingDays).toBe(on + 1)
  })

  it('Ginbot 20 is on by default and costs one school day (a Friday)', () => {
    expect(complete().closes.DERG_DOWNFALL).toBe(true)
    const on = reviewDraft(complete(), year, fixed).counts!.teachingDays
    const d = complete()
    d.closes.DERG_DOWNFALL = false
    expect(reviewDraft(d, year, fixed).counts!.teachingDays).toBe(on + 1)
  })
})
