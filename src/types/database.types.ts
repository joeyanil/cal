/**
 * database.types.ts — Calendar Engine slice.
 *
 * Hand-authored to mirror `supabase gen types typescript` output, scoped to
 * the tables/enums/functions this subsystem owns (supabase/migrations/).
 * When this merges into the real K2 project, regenerate the full project
 * type file with the Supabase CLI and this file's shape should already
 * match it — if it doesn't, that's a sign a migration and this file drifted
 * and need reconciling.
 */

export type AcademicYearStatus = 'PREPARING' | 'READY' | 'ACTIVE' | 'CLOSED'
export type SemesterStatus = 'UPCOMING' | 'ACTIVE' | 'CLOSED'
export type HolidayTypeKeyDb =
  | 'NEW_YEAR'
  | 'GENNA'
  | 'TIMKAT'
  | 'ADWA'
  | 'PATRIOTS'
  | 'DERG_DOWNFALL'
  | 'SIKLET'
  | 'FASIKA'
  | 'EID_FITR'
  | 'EID_ADHA'
export type HolidaySourceDb = 'AUTO_PROPOSED' | 'ADMIN_ENTERED'
export type ExamTypeKeyDb = 'S1_REGIONAL_MODEL' | 'S1_FINAL' | 'S2_REGIONAL_MODEL' | 'S2_FINAL' | 'GRADE12_NATIONAL'
export type ExamGradeScopeDb = 'ALL' | 'GRADE_12'
export type CalendarFactKindDb =
  | 'ACADEMIC_YEAR_START'
  | 'ACADEMIC_YEAR_END'
  | 'SEMESTER_START'
  | 'SEMESTER_END'
  | 'HOLIDAY_OCCURRENCE'
  | 'EXAM_START'
  | 'EXAM_END'
  | 'STUDENT_RETURN'
export type TimelineBuildStatusDb = 'CANDIDATE' | 'CURRENT' | 'FAILED' | 'SUPERSEDED'
export type ValidationSeverityDb = 'MISSING' | 'ERROR' | 'WARNING' | 'INFORMATION'
export type ReminderStatusDb = 'PENDING' | 'SKIPPED' | 'SENT'

export interface Database {
  public: {
    Tables: {
      academic_years: {
        Row: {
          id: string
          year_ec: number
          name: string
          start_date: string
          end_date: string
          is_default_boundary: boolean
          status: AcademicYearStatus
          ministry_target_days: number | null
          /** Advanced by the database itself (Migration 0015 triggers) on
           *  every real change to an authoritative fact belonging to this
           *  year — never settable directly by authenticated (column-level
           *  REVOKE). This is the true configuration identity a timeline
           *  candidate is built from and checked against at publish time. */
          calendar_config_revision: number
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          year_ec: number
          name: string
          start_date: string
          end_date: string
          is_default_boundary?: boolean
          status?: AcademicYearStatus
          ministry_target_days?: number | null
          created_by?: string | null
        }
        Update: Partial<Database['public']['Tables']['academic_years']['Insert']>
      }
      semesters: {
        Row: {
          id: string
          academic_year_id: string
          sem_order: 1 | 2
          start_date: string | null
          end_date: string | null
          status: SemesterStatus
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          academic_year_id: string
          sem_order: 1 | 2
          start_date?: string | null
          end_date?: string | null
          status?: SemesterStatus
        }
        Update: Partial<Database['public']['Tables']['semesters']['Insert']>
      }
      holiday_types: {
        Row: {
          key: HolidayTypeKeyDb
          name: string
          movable: boolean
          fixed_month: number | null
          fixed_day: number | null
        }
        Insert: never // system catalog, seeded by migration only
        Update: never
      }
      holiday_occurrences: {
        Row: {
          id: string
          academic_year_id: string
          holiday_type_key: HolidayTypeKeyDb
          /** NULL only for a movable holiday this school does not observe
           *  (closes_school = false) — nothing to enter, school teaches. */
          date: string | null
          closes_school: boolean
          source: HolidaySourceDb
          confirmed_by: string | null
          confirmed_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          academic_year_id: string
          holiday_type_key: HolidayTypeKeyDb
          date?: string | null
          closes_school?: boolean
          source: HolidaySourceDb
          confirmed_by?: string | null
          confirmed_at?: string | null
        }
        Update: Partial<Database['public']['Tables']['holiday_occurrences']['Insert']>
      }
      exam_types: {
        Row: {
          key: ExamTypeKeyDb
          name: string
          semester_order: 1 | 2 | null
          closes_school: boolean
          grade_scope: ExamGradeScopeDb
        }
        Insert: never
        Update: never
      }
      exam_instances: {
        Row: {
          id: string
          academic_year_id: string
          exam_type_key: ExamTypeKeyDb
          start_date: string
          end_date: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          academic_year_id: string
          exam_type_key: ExamTypeKeyDb
          start_date: string
          end_date: string
        }
        Update: Partial<Database['public']['Tables']['exam_instances']['Insert']>
      }
      student_return_days: {
        Row: {
          id: string
          academic_year_id: string
          date: string
          created_at: string
          updated_at: string
        }
        Insert: { id?: string; academic_year_id: string; date: string }
        Update: Partial<Database['public']['Tables']['student_return_days']['Insert']>
      }
      calendar_dependencies: {
        Row: {
          id: string
          academic_year_id: string
          anchor_kind: CalendarFactKindDb
          anchor_semester_order: 1 | 2 | null
          anchor_holiday_type_key: HolidayTypeKeyDb | null
          anchor_exam_type_key: ExamTypeKeyDb | null
          dependent_kind: CalendarFactKindDb
          dependent_semester_order: 1 | 2 | null
          dependent_holiday_type_key: HolidayTypeKeyDb | null
          dependent_exam_type_key: ExamTypeKeyDb | null
          offset_days: number
          active: boolean
          created_by: string
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['calendar_dependencies']['Row'], 'id' | 'created_at' | 'active'> & {
          id?: string
          active?: boolean
        }
        Update: Partial<Database['public']['Tables']['calendar_dependencies']['Insert']>
      }
      calendar_timeline_builds: {
        Row: {
          id: string
          academic_year_id: string
          status: TimelineBuildStatusDb
          /** The academic_years.calendar_config_revision that was live when
           *  this candidate's configuration snapshot was read. Renamed from
           *  config_version (Migration 0015) — it is a real revision
           *  identity now, not a build counter. */
          source_config_revision: number
          config_hash: string
          created_by: string | null
          created_at: string
          published_at: string | null
          failure_reason: string | null
        }
        Insert: {
          id?: string
          academic_year_id: string
          status?: TimelineBuildStatusDb
          source_config_revision: number
          config_hash: string
          created_by?: string | null
        }
        Update: Partial<Database['public']['Tables']['calendar_timeline_builds']['Insert']>
      }
      calendar_timeline_days: {
        Row: {
          id: string
          build_id: string
          academic_year_id: string
          date: string
          ethiopian_year: number
          ethiopian_month: number
          ethiopian_day: number
          weekday: number
          is_weekend: boolean
          semester_order: 1 | 2 | null
          /** [{typeKey, name, closesSchool}, ...] — every holiday landing on
           *  this date, not just one (Migration 0018, fix #9). */
          holidays: unknown
          holiday_closure: boolean
          /** [{typeKey, name, dayNumber, totalDays, closesSchool, gradeScope}, ...]
           *  — every exam whose window includes this date (Migration 0018,
           *  fix #16); Grade 12 legitimately coexists with a standard exam here. */
          exams: unknown
          is_student_return: boolean
          is_semester_break: boolean
          school_open: boolean
          teaching_day: boolean
          attendance_available: boolean
          grade12_attendance_available: boolean
          reasons: string[]
        }
        Insert: Omit<Database['public']['Tables']['calendar_timeline_days']['Row'], 'id'> & { id?: string }
        Update: never // immutable once inserted (REVOKE UPDATE, Migration 0008)
      }
      calendar_validation_runs: {
        Row: {
          id: string
          academic_year_id: string
          ran_at: string
          missing_count: number
          error_count: number
          warning_count: number
          information_count: number
          issues: unknown // JSONB ValidationIssue[]
        }
        Insert: Omit<Database['public']['Tables']['calendar_validation_runs']['Row'], 'id' | 'ran_at'> & {
          id?: string
        }
        Update: never
      }
      calendar_corrections: {
        Row: {
          id: string
          academic_year_id: string
          fact_kind: CalendarFactKindDb
          fact_semester_order: 1 | 2 | null
          fact_holiday_type_key: HolidayTypeKeyDb | null
          fact_exam_type_key: ExamTypeKeyDb | null
          original_value: string
          corrected_value: string
          reason: string
          performed_by: string
          performed_at: string
        }
        Insert: never // written only via fn_apply_calendar_correction RPC
        Update: never
      }
      calendar_reminders: {
        Row: {
          id: string
          academic_year_id: string
          fact_kind: CalendarFactKindDb
          fact_semester_order: 1 | 2 | null
          fact_holiday_type_key: HolidayTypeKeyDb | null
          fact_exam_type_key: ExamTypeKeyDb | null
          threshold_days: 30 | 15 | 5
          trigger_date: string
          due_date: string
          status: ReminderStatusDb
          sent_at: string | null
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['calendar_reminders']['Row'], 'id' | 'created_at'> & {
          id?: string
        }
        Update: Pick<Database['public']['Tables']['calendar_reminders']['Row'], 'status' | 'sent_at'>
      }
    }
    Functions: {
      fn_load_calendar_config_snapshot: {
        Args: { p_academic_year_id: string }
        /** JSONB: { academicYear, semesters[], holidayOccurrences[],
         *  examInstances[], studentReturn, dependencies[], configRevision }.
         *  Raises ERRCODE 'serialization_failure' (hint
         *  CALENDAR_CONFIG_SNAPSHOT_TORN) if a coherent snapshot could not
         *  be assembled within its internal retry bound — callers should
         *  surface this as a clean, retriable error, not a generic 500. */
        Returns: unknown
      }
      fn_publish_calendar_timeline: {
        Args: { p_build_id: string }
        Returns: Database['public']['Tables']['calendar_timeline_builds']['Row']
      }
      fn_record_failed_build: {
        Args: { p_build_id: string; p_reason: string }
        Returns: Database['public']['Tables']['calendar_timeline_builds']['Row']
      }
      fn_transition_academic_year_status: {
        Args: { p_year_id: string; p_to: AcademicYearStatus }
        Returns: Database['public']['Tables']['academic_years']['Row']
      }
      fn_transition_semester_status: {
        Args: { p_semester_id: string; p_to: SemesterStatus }
        Returns: Database['public']['Tables']['semesters']['Row']
      }
      fn_apply_calendar_correction: {
        Args: {
          p_academic_year_id: string
          p_fact_kind: CalendarFactKindDb
          p_fact_semester_order: 1 | 2 | null
          p_fact_holiday_type_key: HolidayTypeKeyDb | null
          p_fact_exam_type_key: ExamTypeKeyDb | null
          p_corrected_value: string
          p_reason: string
        }
        Returns: Database['public']['Tables']['calendar_corrections']['Row']
      }
      has_permission: {
        Args: { p_permission_key: string }
        Returns: boolean
      }
    }
  }
}
