\set ON_ERROR_STOP on

begin;

\i /work/db/migrations/001_control_schema.sql

insert into users (id, email, password_hash)
values
  ('00000000-0000-0000-0000-000000000001', 'owner@example.com', 'hash'),
  ('00000000-0000-0000-0000-000000000002', 'other@example.com', 'hash');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);

create temp table created_form as
select *
from create_sheet_form('Revenue Tracker', array['1 Revenue', 'Company Name', 'Company Name']);

do $$
declare
  form_id uuid;
  generated_table text;
  field_columns text[];
  physical_columns text[];
begin
  select id, generated_table_name into form_id, generated_table from created_form;

  if generated_table !~ '^sheet_[0-9a-f_]+$' then
    raise exception 'generated table name was not sanitized: %', generated_table;
  end if;

  select array_agg(column_name order by position)
  into field_columns
  from sheet_fields
  where sheet_form_id = form_id;

  if field_columns != array['field_1_revenue', 'company_name', 'company_name_2'] then
    raise exception 'unexpected field columns: %', field_columns;
  end if;

  select array_agg(column_name order by ordinal_position)
  into physical_columns
  from information_schema.columns
  where table_schema = 'public'
    and table_name = generated_table
    and column_name in ('field_1_revenue', 'company_name', 'company_name_2');

  if physical_columns != array['field_1_revenue', 'company_name', 'company_name_2'] then
    raise exception 'generated table missing expected columns: %', physical_columns;
  end if;
end;
$$;

do $$
declare
  form_id uuid := (select id from created_form);
  generated_table text := (select generated_table_name from created_form);
  visible_count integer;
begin
  set local role sheetbase_api;
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);

  select count(*) into visible_count from sheet_forms;
  if visible_count != 1 then
    raise exception 'owner should see one sheet form, saw %', visible_count;
  end if;

  execute format('select count(*) from %I', generated_table) into visible_count;
  if visible_count != 0 then
    raise exception 'owner generated table query failed';
  end if;

  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
  select count(*) into visible_count from sheet_forms;
  if visible_count != 0 then
    raise exception 'other user should not see sheet form, saw %', visible_count;
  end if;

  execute format('select count(*) from %I', generated_table) into visible_count;
  if visible_count != 0 then
    raise exception 'other user should not see generated rows, saw %', visible_count;
  end if;

  begin
    perform add_sheet_field(form_id, 'Stolen Field');
    raise exception 'other user should not add fields';
  exception
    when raise_exception then
      if sqlerrm = 'other user should not add fields' then
        raise;
      end if;
  end;

  begin
    perform count(*) from users;
    raise exception 'sheetbase_api should not read users';
  exception
    when insufficient_privilege then
      null;
  end;

  reset role;
end;
$$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);

create temp table added_field as
select *
from add_sheet_field((select id from created_form), 'Headcount');

do $$
declare
  form_id uuid := (select id from created_form);
  generated_table text := (select generated_table_name from created_form);
  field_id uuid := (select id from added_field);
  field_column text := (select column_name from added_field);
  field_row sheet_fields;
  hidden_row sheet_fields;
  column_type text;
begin
  if field_column != 'headcount' then
    raise exception 'unexpected added field column: %', field_column;
  end if;

  execute format(
    'insert into %I (field_1_revenue, company_name, company_name_2, %I) values ($1, $2, $3, $4)',
    generated_table,
    field_column
  )
  using '1000', 'Acme Labs', 'Acme Duplicate', '42';

  select *
  from tighten_sheet_field_type(form_id, field_id, 'integer')
  into field_row;

  if field_row.type != 'integer' then
    raise exception 'field was not tightened to integer';
  end if;

  select data_type
  into column_type
  from information_schema.columns
  where table_schema = 'public'
    and table_name = generated_table
    and column_name = field_column;

  if column_type != 'integer' then
    raise exception 'physical column type is %, expected integer', column_type;
  end if;

  select *
  from hide_sheet_field(form_id, field_id)
  into hidden_row;

  if hidden_row.hidden is not true then
    raise exception 'field was not hidden';
  end if;
end;
$$;

do $$
declare
  form_id uuid := (select id from created_form);
  bad_field uuid;
begin
  select id into bad_field
  from sheet_fields
  where sheet_form_id = form_id
    and column_name = 'company_name';

  begin
    perform tighten_sheet_field_type(form_id, bad_field, 'integer');
    raise exception 'expected unsafe type tightening to fail';
  exception
    when raise_exception then
      if sqlerrm = 'expected unsafe type tightening to fail' then
        raise;
      end if;
  end;

  if (select type from sheet_fields where id = bad_field) != 'text' then
    raise exception 'failed tightening changed metadata type';
  end if;
end;
$$;

rollback;
