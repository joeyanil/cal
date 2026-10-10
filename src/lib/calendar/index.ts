/**
 * Calendar Engine domain module — public surface.
 *
 * Everything K2's services/API/UI layers need from the Calendar domain
 * comes through this barrel. Nothing outside `src/lib/calendar/` should
 * import a file inside it directly (except this file itself), so the
 * domain's internal organization can keep changing without breaking
 * consumers — the same discipline mission section 42 asks for between
 * Domain / Persistence / API / UI.
 */
export * from './types'
export * from './date-utils'
export * from './ethiopian-date'
export * from './holidays'
export * from './exams'
export * from './studentReturn'
export * from './semesterBreak'
export * from './dependencyGraph'
export * from './dependencyResolution'
export * from './timelineBuilder'
export * from './timelineQueries'
export * from './teachingDays'
export * from './validation'
export * from './reminders'
export * from './rollover'
export * from './rebuild'
export * from './issueText'
export * from './setupDraft'
