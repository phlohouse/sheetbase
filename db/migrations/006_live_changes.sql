create table if not exists workspace_changes (
  id bigserial primary key,
  scope text not null check (scope in ('workspace', 'dataset')),
  kind text not null,
  sheet_form_id uuid,
  row_id uuid,
  client_id text,
  audience uuid[] not null default '{}'::uuid[],
  created_at timestamptz not null default now()
);

alter table workspace_changes add column if not exists audience uuid[] not null default '{}'::uuid[];

create index if not exists workspace_changes_scope_id_idx on workspace_changes (scope, id);
create index if not exists workspace_changes_dataset_id_idx on workspace_changes (sheet_form_id, id) where scope = 'dataset';

create or replace function current_sheetbase_client_id()
returns text language plpgsql stable as $$
begin
  return nullif(current_setting('request.headers', true)::jsonb ->> 'x-sheetbase-client-id', '');
exception when others then
  return null;
end;
$$;

create or replace function record_sheet_form_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare form_id uuid;
begin
  form_id := case when tg_op = 'DELETE' then old.id else new.id end;
  insert into workspace_changes (scope, kind, sheet_form_id, client_id, audience)
  values ('workspace', 'form_' || lower(tg_op), form_id, current_sheetbase_client_id(),
    array(select user_id from permissions where sheet_form_id = form_id and user_id is not null)
      || coalesce(array[current_sheetbase_user_id()], '{}'::uuid[]));
  perform pg_notify('sheetbase_changes', currval('workspace_changes_id_seq')::text);
  return coalesce(new, old);
end;
$$;

drop trigger if exists sheetbase_form_changes on sheet_forms;
create trigger sheetbase_form_changes before insert or update or delete on sheet_forms
for each row execute function record_sheet_form_change();

create or replace function record_sheet_schema_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare form_id uuid;
begin
  form_id := case when tg_op = 'DELETE' then old.sheet_form_id else new.sheet_form_id end;
  insert into workspace_changes (scope, kind, sheet_form_id, client_id, audience)
  values ('dataset', 'schema_changed', form_id, current_sheetbase_client_id(),
    array(select user_id from permissions where sheet_form_id = form_id and user_id is not null));
  perform pg_notify('sheetbase_changes', currval('workspace_changes_id_seq')::text);
  return coalesce(new, old);
end;
$$;

drop trigger if exists sheetbase_field_changes on sheet_fields;
create trigger sheetbase_field_changes after insert or update or delete on sheet_fields
for each row execute function record_sheet_schema_change();

create or replace function record_dataset_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare changed_row record;
begin
  changed_row := case when tg_op = 'DELETE' then old else new end;
  insert into workspace_changes (scope, kind, sheet_form_id, row_id, client_id, audience)
  values ('dataset', 'row_' || lower(tg_op), tg_argv[0]::uuid, changed_row.id, current_sheetbase_client_id(),
    array(select user_id from permissions where sheet_form_id = tg_argv[0]::uuid and user_id is not null));
  perform pg_notify('sheetbase_changes', currval('workspace_changes_id_seq')::text);
  return coalesce(new, old);
end;
$$;

create or replace function attach_sheetbase_table_triggers()
returns event_trigger language plpgsql security definer set search_path = public as $$
declare form_row sheet_forms;
begin
  for form_row in select * from sheet_forms where to_regclass(format('%I', generated_table_name)) is not null loop
    if not exists (select 1 from pg_trigger where tgrelid = to_regclass(format('%I', form_row.generated_table_name)) and tgname = 'sheetbase_row_updated_at') then
      execute format('create trigger sheetbase_row_updated_at before update on %I for each row execute function set_updated_at()', form_row.generated_table_name);
    end if;
    if not exists (select 1 from pg_trigger where tgrelid = to_regclass(format('%I', form_row.generated_table_name)) and tgname = 'sheetbase_row_changes') then
      execute format('create trigger sheetbase_row_changes after insert or update or delete on %I for each row execute function record_dataset_change(%L)', form_row.generated_table_name, form_row.id::text);
    end if;
  end loop;
end;
$$;

drop event trigger if exists sheetbase_attach_table_triggers;
create event trigger sheetbase_attach_table_triggers on ddl_command_end
when tag in ('CREATE TABLE') execute function attach_sheetbase_table_triggers();

do $$
declare form_row sheet_forms;
begin
  for form_row in select * from sheet_forms loop
    execute format('drop trigger if exists sheetbase_row_updated_at on %I', form_row.generated_table_name);
    execute format('create trigger sheetbase_row_updated_at before update on %I for each row execute function set_updated_at()', form_row.generated_table_name);
    execute format('drop trigger if exists sheetbase_row_changes on %I', form_row.generated_table_name);
    execute format(
      'create trigger sheetbase_row_changes after insert or update or delete on %I for each row execute function record_dataset_change(%L)',
      form_row.generated_table_name,
      form_row.id::text
    );
  end loop;
end;
$$;

revoke all on workspace_changes from sheetbase_api;
notify pgrst, 'reload schema';
