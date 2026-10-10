import { ensureFixedHolidays } from './holiday.service'
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import type { Database } from '@/types/database.types'
import { AppError } from '../errors/AppError'
import { can } from '../permissions/engine'
import type { AuthContext } from '../auth/withAuth'
import { buildFactRef } from './calendarValidation.service'
import {
  buildFullYearTimeline,
  hashConfiguration,
  resolveCalendarConfiguration,
  sliceRange,
  countTeachingDays,
  countAvailableDays,
  teachingDayBreakdown,
  type CalendarConfiguration,
  type DailyTimelineEntry,
  type DependencyRule,
  type ISODate,
} from '../calendar'

/** The raw shape returned by fn_load_calendar_config_snapshot — snake_case,
 *  mirroring the underlying table rows exactly (the RPC does no field
 *  renaming; that stays TypeScript's job, same division of labor as the
 *  five separate queries it replaces). */
interface RawConfigSnapshot {
  academicYear: Database['public']['Tables']['academic_years']['Row']
  semesters: Database['public']['Tables']['semesters']['Row'][]
  holidayOccurrences: Database['public']['Tables']['holiday_occurrences']['Row'][]
  examInstances: Database['public']['Tables']['exam_instances']['Row'][]
  studentReturn: Database['public']['Tables']['student_return_days']['Row'] | null
  dependencies: Database['public']['Tables']['calendar_dependencies']['Row'][]
  configRevision: number
}

/**
 * Reads every fact the timeline builder needs for one academic year via
 * `fn_load_calendar_config_snapshot` (Migration 0015) and assembles it into
 * the pure domain layer's `CalendarConfiguration` shape. This is the ONE
 * place persistence meets the domain layer for timeline construction
 * (mission §42's Domain/Persistence separation) — `buildFullYearTimeline`
 * itself never imports anything from `@supabase/supabase-js`.
 *
 * Previously this issued five independent parallel queries — a mutation
 * landing between any two of them could produce a snapshot mixing facts
 * from different configuration states. The RPC now does this as a single
 * call that internally re-checks the year's revision before and after
 * assembling the snapshot, retrying a bounded number of times, and raising
 * a clearly-tagged, retriable error if it truly cannot get a stable read —
 * surfaced here as CALENDAR_CONFIG_SNAPSHOT_TORN rather than a generic 500.
 */
export async function loadConfiguration(
  supabase: SupabaseClient<Database>,
  academicYearId: string,
): Promise<{ config: CalendarConfiguration; configRevision: number; dependencyRules: DependencyRule[] }> {
  const { data, error } = await supabase.rpc('fn_load_calendar_config_snapshot', {
    p_academic_year_id: academicYearId,
  })

  if (error) {
    if (error.hint === 'CALENDAR_CONFIG_SNAPSHOT_TORN') {
      throw new AppError('CALENDAR_CONFIG_SNAPSHOT_TORN', 409, error.message)
    }
    throw new AppError('CALENDAR_YEAR_NOT_FOUND', 404, error.message)
  }
  if (!data) throw new AppError('CALENDAR_YEAR_NOT_FOUND', 404)

  const snapshot = data as unknown as RawConfigSnapshot
  const { academicYear: year, semesters, holidayOccurrences, examInstances, studentReturn, dependencies, configRevision } = snapshot

  const config: CalendarConfiguration = {
    academicYear: { id: year.id, startDate: year.start_date as ISODate, endDate: year.end_date as ISODate },
    semesters: (semesters ?? []).map((s) => ({
      id: s.id,
      academicYearId: s.academic_year_id,
      order: s.sem_order,
      startDate: s.start_date as ISODate | null,
      endDate: s.end_date as ISODate | null,
      status: s.status,
    })),
    holidayOccurrences: (holidayOccurrences ?? []).map((h) => ({
      id: h.id,
      academicYearId: h.academic_year_id,
      holidayTypeKey: h.holiday_type_key,
      date: h.date as ISODate,
      closesSchool: h.closes_school,
      source: h.source,
      confirmedByUserId: h.confirmed_by,
      confirmedAt: h.confirmed_at,
    })),
    examInstances: (examInstances ?? []).map((e) => ({
      id: e.id,
      academicYearId: e.academic_year_id,
      examTypeKey: e.exam_type_key,
      startDate: e.start_date as ISODate,
      endDate: e.end_date as ISODate,
    })),
    studentReturn: studentReturn
      ? { id: studentReturn.id, academicYearId: studentReturn.academic_year_id, date: studentReturn.date as ISODate }
      : null,
  }

  // Read from the SAME coherent snapshot as every other fact — a separate
  // round-trip for dependency rules would reintroduce exactly the torn-read
  // risk fix #2 closed (rules could reflect a different point in time than
  // the facts they govern).
  const dependencyRules: DependencyRule[] = (dependencies ?? []).map((d) => ({
    id: d.id,
    academicYearId: d.academic_year_id,
    anchor: buildFactRef(d.anchor_kind, d.anchor_semester_order, d.anchor_holiday_type_key, d.anchor_exam_type_key) as DependencyRule['anchor'],
    dependent: buildFactRef(d.dependent_kind, d.dependent_semester_order, d.dependent_holiday_type_key, d.dependent_exam_type_key) as DependencyRule['dependent'],
    offsetDays: d.offset_days,
    active: d.active,
    createdByUserId: d.created_by,
    createdAt: d.created_at,
  }))

  return { config, configRevision, dependencyRules }
}

function entryToRow(
  entry: DailyTimelineEntry,
  buildId: string,
): Database['public']['Tables']['calendar_timeline_days']['Insert'] {
  return {
    build_id: buildId,
    academic_year_id: entry.academicYearId,
    date: entry.date,
    ethiopian_year: entry.ethiopian.year,
    ethiopian_month: entry.ethiopian.month,
    ethiopian_day: entry.ethiopian.day,
    weekday: ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'].indexOf(entry.weekday),
    is_weekend: entry.isWeekend,
    semester_order: entry.semesterOrder,
    holidays: entry.holidays,
    holiday_closure: entry.holidayClosure,
    exams: entry.exams,
    is_student_return: entry.isStudentReturn,
    is_semester_break: entry.isSemesterBreak,
    school_open: entry.schoolOpen,
    teaching_day: entry.teachingDay,
    attendance_available: entry.attendanceAvailable,
    grade12_attendance_available: entry.grade12AttendanceAvailable,
    reasons: entry.reasons,
  }
}

function rowToEntry(row: Database['public']['Tables']['calendar_timeline_days']['Row']): DailyTimelineEntry {
  const weekdayNames = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'] as const
  return {
    date: row.date as ISODate,
    ethiopian: { year: row.ethiopian_year, month: row.ethiopian_month, day: row.ethiopian_day },
    weekday: weekdayNames[row.weekday] ?? 'SUNDAY',
    isWeekend: row.is_weekend,
    academicYearId: row.academic_year_id,
    semesterOrder: row.semester_order,
    holidays: (row.holidays ?? []) as DailyTimelineEntry['holidays'],
    holidayClosure: row.holiday_closure,
    exams: (row.exams ?? []) as DailyTimelineEntry['exams'],
    isStudentReturn: row.is_student_return,
    isSemesterBreak: row.is_semester_break,
    schoolOpen: row.school_open,
    teachingDay: row.teaching_day,
    attendanceAvailable: row.attendance_available,
    grade12AttendanceAvailable: row.grade12_attendance_available,
    reasons: row.reasons,
  }
}

/**
 * Builds a new CANDIDATE timeline from the year's current configuration and
 * persists it (mission §29 Steps 1-5). Does NOT publish it — that is a
 * separate, explicit `publishTimelineBuild` call, so a caller can inspect a
 * candidate before promoting it if they want to.
 */
export async function buildCandidateTimeline(
  supabase: SupabaseClient<Database>,
  ctx: AuthContext,
  academicYearId: string,
): Promise<{ buildId: string; entryCount: number; teachingDays: number }> {
  if (!can(ctx, 'calendar.build_timeline')) throw new AppError('FORBIDDEN', 403)

  {
    const { data: yearRow } = await supabase.from('academic_years').select('year_ec').eq('id', academicYearId).single()
    if (yearRow) await ensureFixedHolidays(supabase, academicYearId, yearRow.year_ec, ctx.user.id)
  }

  const { config: rawConfig, configRevision, dependencyRules } = await loadConfiguration(supabase, academicYearId)
  // The real pipeline step fix #8 was missing entirely: a DEPENDENT fact's
  // stored column is never what the timeline builder sees below — only its
  // anchor-derived resolved value is (dependencyResolution.ts).
  const config = resolveCalendarConfiguration(rawConfig, dependencyRules)
  const configHash = hashConfiguration(config)

  // Throws CALENDAR_INVALID_BOUNDARY / CALENDAR_TIMELINE_INTEGRITY_FAILURE
  // rather than ever producing something unsafe to persist.
  const entries = buildFullYearTimeline(config)

  const { data: build, error: buildError } = await supabase
    .from('calendar_timeline_builds')
    .insert({
      academic_year_id: academicYearId,
      status: 'CANDIDATE',
      source_config_revision: configRevision,
      config_hash: configHash,
      created_by: ctx.user.id,
    })
    .select()
    .single()
  if (buildError || !build) throw new AppError('CALENDAR_CREATE_FAILED', 500, buildError?.message)

  const rows = entries.map((e) => entryToRow(e, build.id))
  // Batched to stay well clear of any statement-size limit on a ~300-400 row insert.
  const BATCH = 100
  for (let i = 0; i < rows.length; i += BATCH) {
    const { error: daysError } = await supabase.from('calendar_timeline_days').insert(rows.slice(i, i + BATCH))
    if (daysError) {
      await supabase.rpc('fn_record_failed_build', { p_build_id: build.id, p_reason: daysError.message })
      throw new AppError('CALENDAR_CREATE_FAILED', 500, daysError.message)
    }
  }

  return { buildId: build.id, entryCount: entries.length, teachingDays: entries.filter((e) => e.teachingDay).length }
}

/** Promotes a CANDIDATE build to CURRENT, atomically, via the
 *  `fn_publish_calendar_timeline` RPC (Migration 0013, rewritten by 0015) —
 *  the real concurrency AND correctness boundary. The database now
 *  independently re-verifies staleness against the year's live revision
 *  and the candidate's structural completeness (exact day count, exact
 *  span, year match) — this call can fail for reasons beyond "someone else
 *  published first", surfaced below with their own error codes rather than
 *  collapsed into one generic failure. */
const publishTimelineBuildSchema = z.object({ buildId: z.string().uuid() })

export async function publishTimelineBuild(
  supabase: SupabaseClient<Database>,
  ctx: AuthContext,
  input: unknown,
): Promise<void> {
  if (!can(ctx, 'calendar.build_timeline')) throw new AppError('FORBIDDEN', 403)
  const { buildId } = publishTimelineBuildSchema.parse(input)
  const { error } = await supabase.rpc('fn_publish_calendar_timeline', { p_build_id: buildId })
  if (error) {
    if (error.hint === 'CALENDAR_STALE_BUILD') throw new AppError('CALENDAR_STALE_BUILD', 409, error.message)
    if (error.hint === 'CALENDAR_CANDIDATE_INCOMPLETE') throw new AppError('CALENDAR_CANDIDATE_INCOMPLETE', 422, error.message)
    if (error.hint === 'CALENDAR_TIMELINE_DAY_YEAR_MISMATCH')
      throw new AppError('CALENDAR_TIMELINE_DAY_YEAR_MISMATCH', 422, error.message)
    throw new AppError('CALENDAR_PUBLISH_FAILED', 500, error.message)
  }
}

/** Fix #29: a CURRENT build is not necessarily a CURRENT *and fresh* build
 *  — a fact can be edited after publication without anyone rebuilding.
 *  This makes that distinction inspectable instead of implicit, by
 *  comparing the published build's captured revision against the year's
 *  live revision. Consumers (UI, `timeline/current`) use `isStale` to warn
 *  rather than silently presenting stale data as freshly built. */
export async function getTimelineStalenessInfo(
  supabase: SupabaseClient<Database>,
  ctx: AuthContext,
  academicYearId: string,
): Promise<{ timelineRevision: number; currentConfigurationRevision: number; isStale: boolean } | null> {
  if (!can(ctx, 'calendar.view')) throw new AppError('FORBIDDEN', 403)

  const [{ data: build }, { data: year, error: yearError }] = await Promise.all([
    supabase
      .from('calendar_timeline_builds')
      .select('source_config_revision')
      .eq('academic_year_id', academicYearId)
      .eq('status', 'CURRENT')
      .maybeSingle(),
    supabase.from('academic_years').select('calendar_config_revision').eq('id', academicYearId).single(),
  ])
  if (yearError || !year) throw new AppError('CALENDAR_YEAR_NOT_FOUND', 404)
  if (!build) return null

  return {
    timelineRevision: build.source_config_revision,
    currentConfigurationRevision: year.calendar_config_revision,
    isStale: build.source_config_revision !== year.calendar_config_revision,
  }
}

/** Convenience: build + publish in one call, for the common "just rebuild
 *  it" UI action. Kept as two underlying steps (buildCandidateTimeline then
 *  publishTimelineBuild) so a caller who wants to inspect the candidate
 *  first still can, by calling them separately instead. */
export async function rebuildAndPublishTimeline(
  supabase: SupabaseClient<Database>,
  ctx: AuthContext,
  academicYearId: string,
): Promise<{ buildId: string; entryCount: number; teachingDays: number }> {
  const result = await buildCandidateTimeline(supabase, ctx, academicYearId)
  await publishTimelineBuild(supabase, ctx, result.buildId)
  return result
}

async function fetchCurrentEntries(
  supabase: SupabaseClient<Database>,
  academicYearId: string,
): Promise<DailyTimelineEntry[]> {
  const { data: build } = await supabase
    .from('calendar_timeline_builds')
    .select('id')
    .eq('academic_year_id', academicYearId)
    .eq('status', 'CURRENT')
    .maybeSingle()
  if (!build) throw new AppError('CALENDAR_NO_CURRENT_TIMELINE', 404)

  const { data: days, error } = await supabase
    .from('calendar_timeline_days')
    .select()
    .eq('build_id', build.id)
    .order('date')
  if (error) throw new AppError('CALENDAR_LIST_FAILED', 500, error.message)
  return (days ?? []).map(rowToEntry)
}

export async function getCurrentTimeline(
  supabase: SupabaseClient<Database>,
  ctx: AuthContext,
  academicYearId: string,
): Promise<DailyTimelineEntry[]> {
  if (!can(ctx, 'calendar.view')) throw new AppError('FORBIDDEN', 403)
  return fetchCurrentEntries(supabase, academicYearId)
}

export async function getDay(
  supabase: SupabaseClient<Database>,
  ctx: AuthContext,
  academicYearId: string,
  date: ISODate,
): Promise<DailyTimelineEntry | null> {
  if (!can(ctx, 'calendar.view')) throw new AppError('FORBIDDEN', 403)
  const entries = await fetchCurrentEntries(supabase, academicYearId)
  return entries.find((e) => e.date === date) ?? null
}

export async function getTeachingDaySummary(
  supabase: SupabaseClient<Database>,
  ctx: AuthContext,
  academicYearId: string,
  start: ISODate,
  end: ISODate,
) {
  if (!can(ctx, 'calendar.view')) throw new AppError('FORBIDDEN', 403)
  const entries = await fetchCurrentEntries(supabase, academicYearId)
  const range = sliceRange(entries, start, end)
  return {
    teachingDays: countTeachingDays(range),
    attendanceAvailableDays: countAvailableDays(range, 'ALL'),
    grade12AttendanceAvailableDays: countAvailableDays(range, 'GRADE_12'),
    breakdown: teachingDayBreakdown(range),
  }
}
