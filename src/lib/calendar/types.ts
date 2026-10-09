/**
 * types.ts — the Calendar Engine's domain vocabulary.
 *
 * Every type here corresponds directly to an entry in Deep Domain File 2,
 * section D ("The Complete Domain Inventory"). Where a comment cites
 * "item N", it's referring to that numbered entry.
 */
import type { ISODate } from './date-utils'
import type { EthiopianDateParts } from './ethiopian-date'
import type { WeekdayName } from './date-utils'

// ---------------------------------------------------------------------------
// Academic Year & Semesters (Domain Inventory items 1, 2, 10)
// ---------------------------------------------------------------------------

/** Mission item 5 / Deep Domain File 2 §F: replaces the obsolete
 *  PLANNING -> ACTIVE -> FINALIZATION -> ARCHIVED lifecycle outright. */
export const ACADEMIC_YEAR_STATUSES = ['PREPARING', 'READY', 'ACTIVE', 'CLOSED'] as const
export type AcademicYearStatus = (typeof ACADEMIC_YEAR_STATUSES)[number]

/** Mission item 6 / Deep Domain File 2 §F: replaces the obsolete
 *  UPCOMING -> ACTIVE -> LOCKED -> ARCHIVED lifecycle outright. */
export const SEMESTER_STATUSES = ['UPCOMING', 'ACTIVE', 'CLOSED'] as const
export type SemesterStatus = (typeof SEMESTER_STATUSES)[number]

export type SemesterOrder = 1 | 2

export interface AcademicYear {
  id: string
  /** The Ethiopian year number, e.g. 2019. Derived at creation, never
   *  independently editable (03_Database_Design's own MED-6 guard, preserved). */
  yearEc: number
  name: string // e.g. "2019 E.C."
  startDate: ISODate
  endDate: ISODate
  /** True until the admin replaces the Meskerem-5-through-Sene-30 default
   *  with the real Ministry-plan dates (Deep Domain File 4 §I). Never a
   *  second competing boundary — the default *is* startDate/endDate until
   *  replaced. */
  isDefaultBoundary: boolean
  status: AcademicYearStatus
}

export interface Semester {
  id: string
  academicYearId: string
  order: SemesterOrder
  startDate: ISODate | null // null while genuinely not yet entered (Missing, not Error)
  endDate: ISODate | null
  status: SemesterStatus
}

// ---------------------------------------------------------------------------
// Holidays (Domain Inventory items 4, 5)
// ---------------------------------------------------------------------------

/** The five permanent holidays with a fixed Ethiopian-calendar date
 *  (mission item 8 / Deep Domain File 2 item 4). */
export const FIXED_HOLIDAY_KEYS = [
  'NEW_YEAR',
  'GENNA',
  'TIMKAT',
  'ADWA',
  'PATRIOTS',
] as const
export type FixedHolidayKey = (typeof FIXED_HOLIDAY_KEYS)[number]

/** The four genuinely movable holidays (mission item 8 / Deep Domain File 2
 *  item 5) — the engine calculates NONE of them, for any of the four. */
export const MOVABLE_HOLIDAY_KEYS = ['SIKLET', 'FASIKA', 'EID_FITR', 'EID_ADHA'] as const
export type MovableHolidayKey = (typeof MOVABLE_HOLIDAY_KEYS)[number]

export type HolidayTypeKey = FixedHolidayKey | MovableHolidayKey

export interface HolidayType {
  key: HolidayTypeKey
  name: string
  movable: boolean
  /** Only present for fixed-date holidays — the permanent Ethiopian
   *  month/day this holiday always falls on. */
  fixedEthiopian?: { month: number; day: number }
}

/** A specific year's occurrence of a holiday. Two independently-toggleable
 *  facts live on this record: *which date* it falls on, and *whether it
 *  actually closes the school* this year (mission item 8, Deep Domain File 2
 *  item 4 — "two separate facts... every holiday normally does close K2, but
 *  an authorized admin can turn that off for a given year"). */
export interface HolidayOccurrence {
  id: string
  academicYearId: string
  holidayTypeKey: HolidayTypeKey
  date: ISODate
  /** Defaults to true. An authorized admin can toggle this off for a given
   *  year without the holiday disappearing from the list. */
  closesSchool: boolean
  /** How this occurrence's date was established — auto-proposed from the
   *  permanent Ethiopian day (fixed holidays only) or entered/confirmed
   *  directly by an admin (every movable holiday, always). Purely a record
   *  of provenance; it never changes how the date is used once set. */
  source: 'AUTO_PROPOSED' | 'ADMIN_ENTERED'
  confirmedByUserId: string | null
  confirmedAt: string | null // ISO 8601 timestamp
}

// ---------------------------------------------------------------------------
// Exams (Domain Inventory items 6, 7, 12)
// ---------------------------------------------------------------------------

export const STANDARD_EXAM_KEYS = [
  'S1_REGIONAL_MODEL',
  'S1_FINAL',
  'S2_REGIONAL_MODEL',
  'S2_FINAL',
] as const
export type StandardExamKey = (typeof STANDARD_EXAM_KEYS)[number]

export const GRADE12_EXAM_KEY = 'GRADE12_NATIONAL' as const
export type ExamTypeKey = StandardExamKey | typeof GRADE12_EXAM_KEY

export type ExamGradeScope = 'ALL' | 'GRADE_12'

export interface ExamType {
  key: ExamTypeKey
  name: string
  semesterOrder: SemesterOrder | null // Grade 12 National Exam isn't scoped to a semester
  /** The four standard exams close the whole school; the Grade 12 National
   *  Exam never does — K2 doesn't host it (mission item 9 / Deep Domain
   *  File 2 item 7). */
  closesSchool: boolean
  gradeScope: ExamGradeScope
}

/** One year's actual dates for an exam type (mission item 9 / Deep Domain
 *  File 2 item 6-7). `endDate` is the exam's final day. */
export interface ExamInstance {
  id: string
  academicYearId: string
  examTypeKey: ExamTypeKey
  startDate: ISODate
  endDate: ISODate // inclusive
}

// ---------------------------------------------------------------------------
// Student Return / Orientation (Domain Inventory item 8)
// ---------------------------------------------------------------------------

export interface StudentReturnDay {
  id: string
  academicYearId: string
  date: ISODate
}

// ---------------------------------------------------------------------------
// The Dependency Model (Deep Domain File 2, section E)
// ---------------------------------------------------------------------------

/** Identifies any single calendar-owned date fact, generically — the anchor
 *  or dependent end of a DEPENDENT relationship, or the subject of a
 *  correction record. Deliberately a closed union: dependency/correction
 *  targets must be facts the Calendar Engine actually owns. */
export type CalendarFactRef =
  | { kind: 'ACADEMIC_YEAR_START' }
  | { kind: 'ACADEMIC_YEAR_END' }
  | { kind: 'SEMESTER_START'; order: SemesterOrder }
  | { kind: 'SEMESTER_END'; order: SemesterOrder }
  | { kind: 'HOLIDAY_OCCURRENCE'; holidayTypeKey: HolidayTypeKey }
  | { kind: 'EXAM_START'; examTypeKey: ExamTypeKey }
  | { kind: 'EXAM_END'; examTypeKey: ExamTypeKey }
  | { kind: 'STUDENT_RETURN' }

export function factRefKey(ref: CalendarFactRef): string {
  switch (ref.kind) {
    case 'SEMESTER_START':
    case 'SEMESTER_END':
      return `${ref.kind}:${ref.order}`
    case 'HOLIDAY_OCCURRENCE':
      return `${ref.kind}:${ref.holidayTypeKey}`
    case 'EXAM_START':
    case 'EXAM_END':
      return `${ref.kind}:${ref.examTypeKey}`
    default:
      return ref.kind
  }
}

/** The four kinds a date-relationship can be (File 2 §E). PROTECTED is
 *  modeled separately as a state flag (`protected: boolean`) rather than a
 *  fourth sibling kind here, per the domain files' own note that "PROTECTED
 *  ... is a *state*, not a date-type equivalent to the others." */
export const DEPENDENCY_KINDS = ['INDEPENDENT', 'DERIVED', 'DEPENDENT'] as const
export type DependencyKind = (typeof DEPENDENCY_KINDS)[number]

/** An explicitly-declared DEPENDENT relationship: `dependent` is defined to
 *  fall `offsetDays` calendar days after (or before, if negative) `anchor`.
 *  Never inferred from proximity — always created by an authorized person
 *  explicitly declaring it (File 2 §E, "DEPENDENT"). */
export interface DependencyRule {
  id: string
  academicYearId: string
  anchor: CalendarFactRef
  dependent: CalendarFactRef
  offsetDays: number
  active: boolean
  createdByUserId: string
  createdAt: string
}

// ---------------------------------------------------------------------------
// Formal Corrections (Deep Domain File 2, section E — "PROTECTED")
// ---------------------------------------------------------------------------

export interface CalendarCorrection {
  id: string
  academicYearId: string
  fact: CalendarFactRef
  originalValue: ISODate
  correctedValue: ISODate
  reason: string
  performedByUserId: string
  performedAt: string
}

// ---------------------------------------------------------------------------
// The Full-Year Daily Timeline (Deep Domain File 3, section N)
// ---------------------------------------------------------------------------

export interface TimelineHolidayInfo {
  typeKey: HolidayTypeKey
  name: string
  closesSchool: boolean
}

export interface TimelineExamInfo {
  typeKey: ExamTypeKey
  name: string
  dayNumber: number // DERIVED — "day 3 of 5" (item 12)
  totalDays: number
  closesSchool: boolean
  gradeScope: ExamGradeScope
}

/**
 * One date's complete, authoritative picture. This is the single structure
 * every other Calendar-dependent behavior reads from (mission section 23) —
 * nothing recalculates "what today means" independently.
 */
export interface DailyTimelineEntry {
  date: ISODate
  ethiopian: EthiopianDateParts
  weekday: WeekdayName
  isWeekend: boolean
  academicYearId: string
  /** null when the date doesn't fall inside either semester's boundaries
   *  (e.g. inside the derived break, or outside both semesters but still
   *  inside the academic year). */
  semesterOrder: SemesterOrder | null
  /** Every holiday occurrence landing on this date — almost always 0 or 1,
   *  but the Ministry's plan is not guaranteed to keep two holidays from
   *  ever coinciding (Deep Domain File 3 §F: "the Ministry's own rule
   *  mostly prevents this by design... but the calculation still needs to
   *  handle it gracefully if it ever does"). Never silently drops one to
   *  keep this a single value — see `holidayClosure` below for the
   *  derived single answer everything else actually needs. */
  holidays: TimelineHolidayInfo[]
  /** ANY holiday today closes school — this is what schoolOpen/teachingDay
   *  actually consult, never a single holiday's own closesSchool in
   *  isolation (fix #9: "no configured Calendar fact disappears merely
   *  because two facts share a date"). */
  holidayClosure: boolean
  /** Every exam whose window includes this date. The Grade 12 National
   *  Exam legitimately coexists with a standard exam here (Deep Domain
   *  File 5 §M: K2 doesn't host it, "the school stays completely normal
   *  for every other grade throughout") — this is the normal case this
   *  array exists for, not an edge case. Two *school-closing* exams
   *  overlapping is a genuine data problem instead, caught as a WARNING
   *  by validation.ts, not silently resolved here. */
  exams: TimelineExamInfo[]
  isStudentReturn: boolean
  isSemesterBreak: boolean
  /** Is the school physically open at all today (mission section 21) — true
   *  even on non-teaching days like Student Return, and true on exam days
   *  of any kind (people are physically present); false on weekends,
   *  school-closing holidays, and the derived semester break. */
  schoolOpen: boolean
  /** Is ordinary teaching happening today, whole-school (mission section 22's
   *  teaching-day calculation, read per-date). */
  teachingDay: boolean
  /** Is whole-school attendance available today (mission section 21/14). In
   *  this design's confirmed rules these coincide with `teachingDay` for
   *  every currently-defined event type, but the fields are kept distinct
   *  because they answer different questions and are allowed to diverge if
   *  a future rule ever requires it. */
  attendanceAvailable: boolean
  /** The Grade-12-specific exception (mission section 9/14, Deep Domain
   *  File 5 §M): identical to `attendanceAvailable` on every date except
   *  those covered by the Grade 12 National Exam, where the whole-school
   *  answer stays true (K2 doesn't host the exam, the school isn't closed)
   *  but this narrower answer is false. */
  grade12AttendanceAvailable: boolean
  /** Every reason contributing to the status above, for transparency in the
   *  UI and in validation messages — a date can have more than one reason
   *  even though it is only ever removed from a count once (mission section
   *  22, "one date, several reasons — but it only gets removed once"). */
  reasons: string[]
}

// ---------------------------------------------------------------------------
// Validation (Deep Domain File 3, section G)
// ---------------------------------------------------------------------------

export const VALIDATION_SEVERITIES = ['MISSING', 'ERROR', 'WARNING', 'INFORMATION'] as const
export type ValidationSeverity = (typeof VALIDATION_SEVERITIES)[number]

export interface ValidationIssue {
  severity: ValidationSeverity
  code: string
  message: string
  ref?: CalendarFactRef
  relatedRefs?: CalendarFactRef[]
  /** The specific date this issue is about, when there is one — lets a UI
   *  show it in Ethiopian form instead of parsing it out of `message`. */
  date?: ISODate
}

// ---------------------------------------------------------------------------
// Timeline Builds — candidate/current publication (mission sections 29-32)
// ---------------------------------------------------------------------------

export const TIMELINE_BUILD_STATUSES = ['CANDIDATE', 'CURRENT', 'FAILED', 'SUPERSEDED'] as const
export type TimelineBuildStatus = (typeof TIMELINE_BUILD_STATUSES)[number]

export interface TimelineBuildMeta {
  id: string
  academicYearId: string
  status: TimelineBuildStatus
  /** The academic year's calendar_config_revision at the moment this
   *  build's configuration snapshot was captured — a real, content-tied
   *  revision the database advances on every genuine fact change, not a
   *  build sequence counter. Publication compares this against the year's
   *  LIVE revision (read fresh, under lock), which is what catches a stale
   *  candidate even when no other build was ever made after it. */
  configRevision: number
  configHash: string
  createdAt: string
  publishedAt: string | null
  failureReason: string | null
}

// ---------------------------------------------------------------------------
// The complete resolved configuration a timeline is built from
// ---------------------------------------------------------------------------

export interface CalendarConfiguration {
  academicYear: Pick<AcademicYear, 'id' | 'startDate' | 'endDate'>
  semesters: Semester[] // exactly two, orders 1 and 2 (may have null dates if Missing)
  holidayOccurrences: HolidayOccurrence[]
  examInstances: ExamInstance[]
  studentReturn: StudentReturnDay | null
}
