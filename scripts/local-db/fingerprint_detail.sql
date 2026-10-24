-- Detail for ONE kind of object, when the fingerprint shows a difference.
-- Change 'functions' on the next line to: tables, columns, triggers, policies,
-- indexes, constraints or enums. Each line is  name | short code of its definition.
with pick as (select 'functions'::text as cat),
objs as (
  select 'tables' cat, c.relname::text nm, '' def
    from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'
  union all select 'columns', table_name||'.'||column_name, data_type||':'||is_nullable||':'||coalesce(column_default, '')
    from information_schema.columns where table_schema = 'public'
  union all select 'functions', p.proname||'('||pg_get_function_identity_arguments(p.oid)||')', pg_get_functiondef(p.oid)
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prokind = 'f'
  union all select 'triggers', c.relname||'.'||t.tgname, pg_get_triggerdef(t.oid)
    from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and not t.tgisinternal
  union all select 'policies', tablename||'.'||policyname, cmd||permissive||roles::text||coalesce(qual, '')||coalesce(with_check, '')
    from pg_policies where schemaname = 'public'
  union all select 'indexes', indexname, indexdef from pg_indexes where schemaname = 'public'
  union all select 'constraints', c.relname||'.'||k.conname, pg_get_constraintdef(k.oid)
    from pg_constraint k join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public'
  union all select 'enums', t.typname, string_agg(e.enumlabel, ',' order by e.enumsortorder)
    from pg_type t join pg_enum e on e.enumtypid = t.oid join pg_namespace n on n.oid = t.typnamespace where n.nspname = 'public' group by t.typname
)
select string_agg(nm||' | '||left(md5(def), 6), chr(10) order by nm) as detail
from objs, pick where objs.cat = pick.cat;
