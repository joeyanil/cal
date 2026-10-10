/**
 * Calendar Engine error codes.
 *
 * 06_Backend_Architecture.md §5.2 is explicit that its table is "the single
 * canonical error-code taxonomy for the whole system." This file does not
 * fork that taxonomy — it appends the Calendar Engine's own codes to it,
 * in the same `{ code: { httpStatus, meaning } }` shape, so a future merge
 * back into that doc's table is a copy-paste, not a reconciliation.
 *
 * Every code here maps to a specific mission requirement or Deep Domain File
 * rule, cited inline.
 */
export const CALENDAR_ERROR_CODES = {
  // --- Structural / boundary validity -------------------------------------
  CALENDAR_INVALID_BOUNDARY: {
    httpStatus: 422,
    meaning: 'Start date is missing, end date is missing, or start is after end.',
  },
  CALENDAR_YEAR_NOT_FOUND: { httpStatus: 404, meaning: 'Academic year does not exist.' },
  CALENDAR_SEMESTER_NOT_FOUND: { httpStatus: 404, meaning: 'Semester does not exist.' },

  // --- Lifecycle / closed-history protection (mission §36-37) -------------
  CALENDAR_YEAR_CLOSED: {
    httpStatus: 423,
    meaning: 'Academic year is CLOSED; ordinary editing is prohibited. Use a formal correction.',
  },
  CALENDAR_SEMESTER_CLOSED: {
    httpStatus: 423,
    meaning: 'Semester is CLOSED; ordinary editing is prohibited. Use a formal correction.',
  },
  CALENDAR_INVALID_LIFECYCLE_TRANSITION: {
    httpStatus: 422,
    meaning: 'Requested status transition is not a legal step in the year/semester lifecycle.',
  },
  CALENDAR_YEAR_NOT_READY: {
    httpStatus: 422,
    meaning:
      'Cannot transition to READY/ACTIVE (or activate a semester): the full Missing/Error validation taxonomy reports at least one blocking issue, or the minimal DB-level structural backstop found a semester with no dates entered. WARNING and INFORMATION severities never block this.',
  },
  CALENDAR_SECOND_ACTIVE_YEAR: {
    httpStatus: 409,
    meaning: 'Another academic year is already ACTIVE; exactly one is allowed at a time.',
  },

  // --- Holidays (mission §8) ------------------------------------------------
  CALENDAR_MOVABLE_HOLIDAY_REQUIRES_MANUAL_DATE: {
    httpStatus: 422,
    meaning:
      'Movable holidays (Siklet, Fasika, Eid al-Fitr, Eid al-Adha) must be entered manually; the engine will not calculate one.',
  },
  CALENDAR_HOLIDAY_NOT_FIXED: {
    httpStatus: 422,
    meaning:
      'The fixed-holiday confirmation endpoint was called on a movable holiday — movable holidays are confirmed by entering their date, which already sets confirmedByUserId/confirmedAt at entry time.',
  },
  CALENDAR_HOLIDAY_NOT_PROPOSED: {
    httpStatus: 404,
    meaning: 'This fixed holiday has not been proposed for the year yet — seed the fixed holidays first.',
  },

  // --- Exams (mission §9) ----------------------------------------------------
  CALENDAR_EXAM_ON_WEEKEND: {
    httpStatus: 422,
    meaning: 'Exam window includes a Saturday or Sunday. Hard stop, not overridable.',
  },
  CALENDAR_EXAM_ON_CLOSING_HOLIDAY: {
    httpStatus: 422,
    meaning: 'Exam window includes a date on which a holiday closes the school. Hard stop.',
  },
  CALENDAR_EXAM_IN_HOLIDAY_WEEK: {
    httpStatus: 422,
    meaning: 'Exam window is in a Monday-Friday week that contains a school-closing holiday. Ministry rule: no exams in a holiday week. Hard stop.',
  },
  CALENDAR_EXAM_INVALID_RANGE: {
    httpStatus: 422,
    meaning: 'Exam end date is before its start date.',
  },

  // --- Dependencies (Deep Domain File 2 §E, mission §34) ---------------------
  CALENDAR_CIRCULAR_DEPENDENCY: {
    httpStatus: 422,
    meaning: 'Proposed dependency would create a cycle (A -> B -> ... -> A). Rejected outright.',
  },
  CALENDAR_CONFLICTING_DEPENDENCY: {
    httpStatus: 422,
    meaning:
      'The target fact already has an active incoming dependency from a different anchor. A fact must have exactly one authoritative source — no "first/last rule wins" tiebreak exists.',
  },
  CALENDAR_FACT_GOVERNED_BY_DEPENDENCY: {
    httpStatus: 409,
    meaning:
      "This fact's date is computed from an active dependency's anchor and cannot be edited directly — editing it would be silently ignored at build time, so the edit is rejected instead. Edit or remove the governing dependency.",
  },
  CALENDAR_DEPENDENCY_TARGET_NOT_DEPENDENT: {
    httpStatus: 422,
    meaning: 'Dependency was declared against a fact that is not modeled as DEPENDENT for this relationship.',
  },
  CALENDAR_DEPENDENCY_NOT_FOUND: { httpStatus: 404, meaning: 'Dependency rule does not exist.' },

  // --- Rebuild / publication (mission §29-32; v2 repair fixes #1-#3) ---------
  CALENDAR_TIMELINE_INTEGRITY_FAILURE: {
    httpStatus: 500,
    meaning:
      'Generated timeline failed the post-generation integrity check (gap, duplicate, or boundary mismatch). Never published.',
  },
  CALENDAR_STALE_BUILD: {
    httpStatus: 409,
    meaning:
      "This candidate's source_config_revision no longer equals the academic year's live calendar_config_revision — an authoritative fact changed since this candidate was built. Discarded, not applied, even if no other build was ever made after it.",
  },
  CALENDAR_CONFIG_SNAPSHOT_TORN: {
    httpStatus: 409,
    meaning:
      'The configuration kept changing while a coherent snapshot was being read (fn_load_calendar_config_snapshot could not get a stable revision within its retry bound). Retriable — this reflects genuine concurrent editing, not a defect.',
  },
  CALENDAR_CANDIDATE_INCOMPLETE: {
    httpStatus: 422,
    meaning:
      "Candidate's persisted timeline_days do not structurally match its academic year: wrong day count, or does not span exactly start_date..end_date. Rejected at the publish boundary before ever becoming CURRENT.",
  },
  CALENDAR_TIMELINE_DAY_YEAR_MISMATCH: {
    httpStatus: 422,
    meaning: "A timeline_days row's academic_year_id does not match its build's academic_year_id. Rejected at insert time by a database trigger, and re-verified at publish time.",
  },
  CALENDAR_NO_CURRENT_TIMELINE: {
    httpStatus: 404,
    meaning: 'No CURRENT timeline build exists yet for this academic year.',
  },

  // --- Corrections (mission §37) ---------------------------------------------
  CALENDAR_CORRECTION_REQUIRES_CLOSED_SCOPE: {
    httpStatus: 422,
    meaning: 'Formal corrections apply to facts inside a CLOSED year/semester only; use ordinary editing otherwise.',
  },

  // --- Rollover (mission §35) --------------------------------------------------
  CALENDAR_ROLLOVER_TARGET_MISSING: {
    httpStatus: 422,
    meaning: 'A suggested dependency referenced a fact type that does not exist yet in the new year.',
  },
} as const

export type CalendarErrorCode = keyof typeof CALENDAR_ERROR_CODES
