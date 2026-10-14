select (jsonb_build_object(
  'holidays', (select jsonb_agg(jsonb_build_object('key',h.holiday_type_key,'year',a.year_ec,'date',h.date,'closes_school',h.closes_school,'source',h.source,'confirmed',h.confirmed_at is not null) order by a.year_ec, h.holiday_type_key) from holiday_occurrences h join academic_years a on a.id=h.academic_year_id),
  'years', (select jsonb_agg(jsonb_build_object('year',year_ec,'status',status,'revision',calendar_config_revision)) from academic_years),
  'dependency_rules', (select count(*) from calendar_dependencies),
  'triggers_on_holidays', (select jsonb_agg(tgname order by tgname) from pg_trigger where tgrelid='holiday_occurrences'::regclass and not tgisinternal),
  'policies_on_holidays', (select jsonb_agg(policyname||' ['||cmd||']' order by policyname) from pg_policies where tablename='holiday_occurrences'),
  'holiday_columns', (select jsonb_agg(column_name||case when is_nullable='YES' then ' (nullable)' else '' end order by ordinal_position) from information_schema.columns where table_name='holiday_occurrences'),
  'holiday_enum', (select jsonb_agg(enumlabel order by enumsortorder) from pg_enum where enumtypid='holiday_type_key'::regtype),
  'functions_present', (select jsonb_agg(proname order by proname) from pg_proc where proname in ('fn_publish_calendar_timeline','fn_load_calendar_config_snapshot','fn_validate_exam_placement','fn_apply_calendar_correction','has_permission')),
  'ministry_column', exists(select 1 from information_schema.columns where table_name='academic_years' and column_name='ministry_target_days')
))::text as diagnostic;
