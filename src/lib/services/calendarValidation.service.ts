import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'
import { AppError } from '../errors/AppError'
import { can } from '../permissions/engine'
import type { AuthContext } from '../auth/withAuth'
import { ensureFixedHolidays } from './holiday.service'
import { validateCalendarConfiguration, summarizeValidation, type ISODate, type ValidationIssue } from '../calendar'

export async function runCalendarValidation(
  supabase: SupabaseClient<Database>,
  ctx: AuthContext,
  academicYearId: string,
): Promise<ValidationIssue[]> {
  if (!can(ctx, 'calendar.view')) throw new AppError('FORBIDDEN', 403)

  {
    const { data: yearRow } = await supabase.from('academic_years').select('year_ec').eq('id', academicYearId).single()
    if (yearRow) await ensureFixedHolidays(supabase, academicYearId, yearRow.year_ec, ctx.user.id)
  }

  const [{ data: year, error: yearError }, { data: semesters }, { data: holidays }, { data: exams }, { data: studentReturn }, { data: deps }] =
    await Promise.all([
      supabase.from('academic_years').select().eq('id', academicYearId).single(),
      supabase.from('semesters').select().eq('academic_year_id', academicYearId).order('sem_order'),
      supabase.from('holiday_occurrences').select().eq('academic_year_id', academicYearId),
      supabase.from('exam_instances').select().eq('academic_year_id', academicYearId),
      supabase.from('student_return_days').select().eq('academic_year_id', academicYearId).maybeSingle(),
      supabase.from('calendar_dependencies').select().eq('academic_year_id', academicYearId),
    ])
  if (yearError || !year) throw new AppError('CALENDAR_YEAR_NOT_FOUND', 404)

  const issues = validateCalendarConfiguration({
    academicYear: {
      id: year.id,
      yearEc: year.year_ec,
      name: year.name,
      startDate: year.start_date as ISODate,
      endDate: year.end_date as ISODate,
      isDefaultBoundary: year.is_default_boundary,
      status: year.status,
    },
    semesters: (semesters ?? []).map((s) => ({
      id: s.id,
      academicYearId: s.academic_year_id,
      order: s.sem_order,
      startDate: s.start_date as ISODate | null,
      endDate: s.end_date as ISODate | null,
      status: s.status,
    })),
    holidayOccurrences: (holidays ?? []).map((h) => ({
      id: h.id,
      academicYearId: h.academic_year_id,
      holidayTypeKey: h.holiday_type_key,
      date: h.date as ISODate,
      closesSchool: h.closes_school,
      source: h.source,
      confirmedByUserId: h.confirmed_by,
      confirmedAt: h.confirmed_at,
    })),
    examInstances: (exams ?? []).map((e) => ({
      id: e.id,
      academicYearId: e.academic_year_id,
      examTypeKey: e.exam_type_key,
      startDate: e.start_date as ISODate,
      endDate: e.end_date as ISODate,
    })),
    studentReturn: studentReturn
      ? { id: studentReturn.id, academicYearId: studentReturn.academic_year_id, date: studentReturn.date as ISODate }
      : null,
    dependencyRules: (deps ?? []).map((d) => ({
      id: d.id,
      academicYearId: d.academic_year_id,
      anchor: buildFactRef(d.anchor_kind, d.anchor_semester_order, d.anchor_holiday_type_key, d.anchor_exam_type_key),
      dependent: buildFactRef(d.dependent_kind, d.dependent_semester_order, d.dependent_holiday_type_key, d.dependent_exam_type_key),
      offsetDays: d.offset_days,
      active: d.active,
      createdByUserId: d.created_by,
      createdAt: d.created_at,
    })),
  })

  const summary = summarizeValidation(issues)
  await supabase.from('calendar_validation_runs').insert({
    academic_year_id: academicYearId,
    missing_count: summary.MISSING ?? 0,
    error_count: summary.ERROR ?? 0,
    warning_count: summary.WARNING ?? 0,
    information_count: summary.INFORMATION ?? 0,
    issues: issues as unknown,
  })

  return issues
}

// Shared with calendarDependency.service.ts
export function buildFactRef(
  kind: Database['public']['Tables']['calendar_dependencies']['Row']['anchor_kind'],
  semesterOrder: 1 | 2 | null,
  holidayKey: Database['public']['Tables']['calendar_dependencies']['Row']['anchor_holiday_type_key'],
  examKey: Database['public']['Tables']['calendar_dependencies']['Row']['anchor_exam_type_key'],
) {
  switch (kind) {
    case 'SEMESTER_START':
      return { kind: 'SEMESTER_START' as const, order: semesterOrder as 1 | 2 }
    case 'SEMESTER_END':
      return { kind: 'SEMESTER_END' as const, order: semesterOrder as 1 | 2 }
    case 'HOLIDAY_OCCURRENCE':
      return { kind: 'HOLIDAY_OCCURRENCE' as const, holidayTypeKey: holidayKey as never }
    case 'EXAM_START':
      return { kind: 'EXAM_START' as const, examTypeKey: examKey as never }
    case 'EXAM_END':
      return { kind: 'EXAM_END' as const, examTypeKey: examKey as never }
    case 'ACADEMIC_YEAR_START':
      return { kind: 'ACADEMIC_YEAR_START' as const }
    case 'ACADEMIC_YEAR_END':
      return { kind: 'ACADEMIC_YEAR_END' as const }
    default:
      return { kind: 'STUDENT_RETURN' as const }
  }
}
