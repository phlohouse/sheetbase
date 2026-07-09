create extension if not exists pgcrypto;

create table if not exists sheet_forms (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  generated_table_name text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists sheet_fields (
  id uuid primary key default gen_random_uuid(),
  sheet_form_id uuid not null references sheet_forms(id) on delete cascade,
  name text not null,
  column_name text not null,
  type text not null default 'text' check (type in ('text', 'integer', 'numeric', 'boolean', 'date', 'timestamptz')),
  position integer not null,
  hidden boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (sheet_form_id, column_name),
  unique (sheet_form_id, position)
);

create table if not exists sheet_views (
  id uuid primary key default gen_random_uuid(),
  sheet_form_id uuid not null references sheet_forms(id) on delete cascade,
  name text not null default 'Default',
  frozen_rows integer not null default 1,
  frozen_columns integer not null default 0,
  column_widths jsonb not null default '{}'::jsonb,
  sort_filter_state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  password_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists roles (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists permissions (
  id uuid primary key default gen_random_uuid(),
  sheet_form_id uuid not null references sheet_forms(id) on delete cascade,
  user_id uuid references users(id) on delete cascade,
  role_id uuid references roles(id) on delete cascade,
  can_read boolean not null default true,
  can_write boolean not null default false,
  can_admin boolean not null default false,
  created_at timestamptz not null default now(),
  check (user_id is not null or role_id is not null)
);

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists sheet_forms_updated_at on sheet_forms;
create trigger sheet_forms_updated_at
before update on sheet_forms
for each row execute function set_updated_at();

drop trigger if exists sheet_fields_updated_at on sheet_fields;
create trigger sheet_fields_updated_at
before update on sheet_fields
for each row execute function set_updated_at();

drop trigger if exists sheet_views_updated_at on sheet_views;
create trigger sheet_views_updated_at
before update on sheet_views
for each row execute function set_updated_at();

drop trigger if exists users_updated_at on users;
create trigger users_updated_at
before update on users
for each row execute function set_updated_at();

create or replace function normalize_identifier(input text)
returns text
language plpgsql
immutable
strict
as $$
declare
  normalized text;
begin
  normalized := lower(regexp_replace(trim(input), '[^a-zA-Z0-9]+', '_', 'g'));
  normalized := trim(both '_' from normalized);

  if normalized = '' then
    raise exception 'identifier cannot be empty';
  end if;

  if normalized ~ '^[0-9]' then
    normalized := 'field_' || normalized;
  end if;

  return left(normalized, 48);
end;
$$;

create or replace function unique_column_name(base_name text, used_names text[])
returns text
language plpgsql
immutable
strict
as $$
declare
  candidate text := normalize_identifier(base_name);
  suffix integer := 2;
begin
  while candidate = any(used_names) loop
    candidate := left(normalize_identifier(base_name), 43) || '_' || suffix::text;
    suffix := suffix + 1;
  end loop;

  return candidate;
end;
$$;

create or replace function create_sheet_form(name text, headers text[])
returns sheet_forms
language plpgsql
as $$
declare
  form_row sheet_forms;
  header text;
  column_name text;
  used_names text[] := array[]::text[];
  position integer := 0;
begin
  if name is null or trim(name) = '' then
    raise exception 'sheet form name is required';
  end if;

  if headers is null or array_length(headers, 1) is null then
    raise exception 'at least one header is required';
  end if;

  insert into sheet_forms (slug, name, generated_table_name)
  values (
    normalize_identifier(name) || '_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
    trim(name),
    'sheet_' || replace(gen_random_uuid()::text, '-', '_')
  )
  returning * into form_row;

  execute format(
    'create table %I (id uuid primary key default gen_random_uuid(), created_at timestamptz not null default now(), updated_at timestamptz not null default now())',
    form_row.generated_table_name
  );

  foreach header in array headers loop
    if header is null or trim(header) = '' then
      raise exception 'header at position % is empty', position + 1;
    end if;

    column_name := unique_column_name(header, used_names);
    used_names := array_append(used_names, column_name);

    execute format('alter table %I add column %I text', form_row.generated_table_name, column_name);

    insert into sheet_fields (sheet_form_id, name, column_name, position)
    values (form_row.id, trim(header), column_name, position);

    position := position + 1;
  end loop;

  insert into sheet_views (sheet_form_id, name)
  values (form_row.id, 'Default');

  return form_row;
end;
$$;

create or replace function add_sheet_field(sheet_form_id uuid, name text)
returns sheet_fields
language plpgsql
as $$
declare
  form_row sheet_forms;
  field_row sheet_fields;
  column_name text;
  used_names text[];
  next_position integer;
begin
  if name is null or trim(name) = '' then
    raise exception 'field name is required';
  end if;

  select * into form_row from sheet_forms where id = sheet_form_id;
  if not found then
    raise exception 'sheet form % not found', sheet_form_id;
  end if;

  select coalesce(array_agg(sf.column_name order by sf.position), array[]::text[])
  into used_names
  from sheet_fields sf
  where sf.sheet_form_id = add_sheet_field.sheet_form_id;

  select coalesce(max(position) + 1, 0)
  into next_position
  from sheet_fields sf
  where sf.sheet_form_id = add_sheet_field.sheet_form_id;

  column_name := unique_column_name(name, used_names);

  execute format('alter table %I add column %I text', form_row.generated_table_name, column_name);

  insert into sheet_fields (sheet_form_id, name, column_name, position)
  values (form_row.id, trim(name), column_name, next_position)
  returning * into field_row;

  return field_row;
end;
$$;

create or replace function hide_sheet_field(sheet_form_id uuid, field_id uuid)
returns sheet_fields
language plpgsql
as $$
declare
  field_row sheet_fields;
begin
  update sheet_fields
  set hidden = true
  where id = field_id
    and sheet_fields.sheet_form_id = hide_sheet_field.sheet_form_id
  returning * into field_row;

  if not found then
    raise exception 'field % not found for sheet form %', field_id, sheet_form_id;
  end if;

  return field_row;
end;
$$;

create or replace function tighten_sheet_field_type(sheet_form_id uuid, field_id uuid, target_type text)
returns sheet_fields
language plpgsql
as $$
declare
  form_row sheet_forms;
  field_row sheet_fields;
  conversion text;
begin
  if target_type not in ('text', 'integer', 'numeric', 'boolean', 'date', 'timestamptz') then
    raise exception 'unsupported target type %', target_type;
  end if;

  select * into form_row from sheet_forms where id = tighten_sheet_field_type.sheet_form_id;
  if not found then
    raise exception 'sheet form % not found', sheet_form_id;
  end if;

  select * into field_row
  from sheet_fields
  where id = tighten_sheet_field_type.field_id
    and sheet_fields.sheet_form_id = tighten_sheet_field_type.sheet_form_id;
  if not found then
    raise exception 'field % not found for sheet form %', field_id, sheet_form_id;
  end if;

  if target_type = 'text' then
    conversion := 'text';
  elsif target_type = 'integer' then
    conversion := 'integer';
  elsif target_type = 'numeric' then
    conversion := 'numeric';
  elsif target_type = 'boolean' then
    conversion := 'boolean';
  elsif target_type = 'date' then
    conversion := 'date';
  elsif target_type = 'timestamptz' then
    conversion := 'timestamptz';
  end if;

  begin
    execute format(
      'alter table %I alter column %I type %s using nullif(%I::text, '''')::%s',
      form_row.generated_table_name,
      field_row.column_name,
      conversion,
      field_row.column_name,
      conversion
    );
  exception when others then
    raise exception 'cannot tighten field % to % because existing values do not convert', field_row.name, target_type;
  end;

  update sheet_fields
  set type = target_type
  where id = field_row.id
  returning * into field_row;

  return field_row;
end;
$$;
