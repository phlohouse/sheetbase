alter table sheet_forms add column if not exists archived_at timestamptz;

create or replace function archive_sheet_form(sheet_form_id uuid, archived boolean)
returns sheet_forms
language plpgsql
security definer
set search_path = public
as $$
declare
  form_row sheet_forms;
begin
  select * into form_row from sheet_forms where id = sheet_form_id;
  if not found then raise exception 'sheet form % not found', sheet_form_id; end if;
  if not can_access_sheet_form(form_row.id, 'admin') then raise exception 'permission denied for sheet form %', sheet_form_id; end if;

  update sheet_forms
  set archived_at = case when archived then now() else null end
  where id = form_row.id
  returning * into form_row;
  return form_row;
end;
$$;

create or replace function delete_sheet_form(sheet_form_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  form_row sheet_forms;
begin
  select * into form_row from sheet_forms where id = sheet_form_id;
  if not found then raise exception 'sheet form % not found', sheet_form_id; end if;
  if not can_access_sheet_form(form_row.id, 'admin') then raise exception 'permission denied for sheet form %', sheet_form_id; end if;

  execute format('drop table if exists %I', form_row.generated_table_name);
  delete from sheet_forms where id = form_row.id;
  perform pg_notify('pgrst', 'reload schema');
end;
$$;

grant execute on function archive_sheet_form(uuid, boolean) to sheetbase_api;
grant execute on function delete_sheet_form(uuid) to sheetbase_api;
notify pgrst, 'reload schema';
