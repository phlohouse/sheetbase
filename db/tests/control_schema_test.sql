\set ON_ERROR_STOP on

begin;

\i /work/db/migrations/001_control_schema.sql

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
