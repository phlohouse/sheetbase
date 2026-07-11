create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'sheetbase_api') then
    create role sheetbase_api nologin;
  end if;
end;
$$;

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

create or replace function normalize_api_slug(input text)
returns text
language plpgsql
immutable
strict
as $$
declare
  normalized text;
begin
  normalized := lower(regexp_replace(trim(input), '[^a-zA-Z0-9]+', '-', 'g'));
  normalized := trim(both '-' from normalized);
  if normalized = '' then
    raise exception 'API slug cannot be empty';
  end if;
  if normalized ~ '^[0-9]' then
    normalized := 'sheet-' || normalized;
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

create or replace function current_sheetbase_user_id()
returns uuid
language plpgsql
stable
as $$
begin
  return coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), '')::uuid,
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'sub')::uuid
  );
exception when others then
  return null;
end;
$$;

create or replace function can_access_sheet_form(sheet_form_id uuid, access text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from permissions p
    where p.sheet_form_id = can_access_sheet_form.sheet_form_id
      and p.user_id = current_sheetbase_user_id()
      and (
        access = 'read' and (p.can_read or p.can_write or p.can_admin)
        or access = 'write' and (p.can_write or p.can_admin)
        or access = 'delete' and p.can_admin
        or access = 'admin' and p.can_admin
      )
  );
$$;

create or replace function can_access_sheet_table(generated_table_name text, access text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from sheet_forms sf
    where sf.generated_table_name = can_access_sheet_table.generated_table_name
      and can_access_sheet_form(sf.id, access)
  );
$$;

create or replace function create_sheet_form(name text, headers text[])
returns sheet_forms
language plpgsql
security definer
set search_path = public
as $$
declare
  form_row sheet_forms;
  header text;
  column_name text;
  used_names text[] := array[]::text[];
  position integer := 0;
  requester uuid;
  base_slug text;
  api_slug text;
  slug_suffix integer := 2;
begin
  requester := current_sheetbase_user_id();
  if requester is null then
    raise exception 'authenticated user is required';
  end if;

  if name is null or trim(name) = '' then
    raise exception 'sheet form name is required';
  end if;

  if headers is null or array_length(headers, 1) is null then
    raise exception 'at least one header is required';
  end if;

  base_slug := normalize_api_slug(name);
  api_slug := base_slug;
  while exists (select 1 from sheet_forms where slug = api_slug)
    or to_regclass('public.' || quote_ident(api_slug)) is not null loop
    api_slug := left(base_slug, 44) || '-' || slug_suffix::text;
    slug_suffix := slug_suffix + 1;
  end loop;

  insert into sheet_forms (slug, name, generated_table_name)
  values (api_slug, trim(name), api_slug)
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

  insert into permissions (sheet_form_id, user_id, can_read, can_write, can_admin)
  values (form_row.id, requester, true, true, true);

  execute format('grant select, insert, update, delete on table %I to sheetbase_api', form_row.generated_table_name);
  execute format('alter table %I enable row level security', form_row.generated_table_name);
  execute format(
    'create policy sheetbase_generated_read on %I for select to sheetbase_api using (can_access_sheet_table(%L, ''read''))',
    form_row.generated_table_name,
    form_row.generated_table_name
  );
  execute format(
    'create policy sheetbase_generated_write on %I for insert to sheetbase_api with check (can_access_sheet_table(%L, ''write''))',
    form_row.generated_table_name,
    form_row.generated_table_name
  );
  execute format(
    'create policy sheetbase_generated_update on %I for update to sheetbase_api using (can_access_sheet_table(%L, ''write'')) with check (can_access_sheet_table(%L, ''write''))',
    form_row.generated_table_name,
    form_row.generated_table_name,
    form_row.generated_table_name
  );
  execute format(
    'create policy sheetbase_generated_delete on %I for delete to sheetbase_api using (can_access_sheet_table(%L, ''delete''))',
    form_row.generated_table_name,
    form_row.generated_table_name
  );
  perform pg_notify('pgrst', 'reload schema');

  return form_row;
end;
$$;

create or replace function set_sheet_form_slug(sheet_form_id uuid, slug text)
returns sheet_forms
language plpgsql
security definer
set search_path = public
as $$
declare
  form_row sheet_forms;
  new_slug text;
begin
  select * into form_row from sheet_forms where id = sheet_form_id;
  if not found then
    raise exception 'sheet form % not found', sheet_form_id;
  end if;
  if not can_access_sheet_form(form_row.id, 'admin') then
    raise exception 'permission denied for sheet form %', sheet_form_id;
  end if;

  new_slug := normalize_api_slug(slug);
  if new_slug = form_row.slug then
    return form_row;
  end if;
  if exists (select 1 from sheet_forms where sheet_forms.slug = new_slug and id != form_row.id)
    or to_regclass('public.' || quote_ident(new_slug)) is not null then
    raise exception 'API slug % is already in use', new_slug;
  end if;

  execute format('drop policy if exists sheetbase_generated_read on %I', form_row.generated_table_name);
  execute format('drop policy if exists sheetbase_generated_write on %I', form_row.generated_table_name);
  execute format('drop policy if exists sheetbase_generated_update on %I', form_row.generated_table_name);
  execute format('drop policy if exists sheetbase_generated_delete on %I', form_row.generated_table_name);
  execute format('alter table %I rename to %I', form_row.generated_table_name, new_slug);

  update sheet_forms
  set slug = new_slug, generated_table_name = new_slug
  where id = form_row.id
  returning * into form_row;

  execute format('create policy sheetbase_generated_read on %I for select to sheetbase_api using (can_access_sheet_table(%L, ''read''))', new_slug, new_slug);
  execute format('create policy sheetbase_generated_write on %I for insert to sheetbase_api with check (can_access_sheet_table(%L, ''write''))', new_slug, new_slug);
  execute format('create policy sheetbase_generated_update on %I for update to sheetbase_api using (can_access_sheet_table(%L, ''write'')) with check (can_access_sheet_table(%L, ''write''))', new_slug, new_slug, new_slug);
  execute format('create policy sheetbase_generated_delete on %I for delete to sheetbase_api using (can_access_sheet_table(%L, ''delete''))', new_slug, new_slug);
  perform pg_notify('pgrst', 'reload schema');
  return form_row;
end;
$$;

create or replace function add_sheet_field(sheet_form_id uuid, name text)
returns sheet_fields
language plpgsql
security definer
set search_path = public
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
  if not can_access_sheet_form(form_row.id, 'admin') then
    raise exception 'permission denied for sheet form %', sheet_form_id;
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

  perform pg_notify('pgrst', 'reload schema');

  return field_row;
end;
$$;

create or replace function rename_sheet_form(sheet_form_id uuid, name text)
returns sheet_forms
language plpgsql
security definer
set search_path = public
as $$
declare
  form_row sheet_forms;
begin
  if name is null or trim(name) = '' then
    raise exception 'sheet form name is required';
  end if;

  select * into form_row from sheet_forms where id = sheet_form_id;
  if not found then
    raise exception 'sheet form % not found', sheet_form_id;
  end if;
  if not can_access_sheet_form(form_row.id, 'admin') then
    raise exception 'permission denied for sheet form %', sheet_form_id;
  end if;

  update sheet_forms
  set name = trim(rename_sheet_form.name)
  where id = form_row.id
  returning * into form_row;

  return form_row;
end;
$$;

create or replace function rename_sheet_field(sheet_form_id uuid, field_id uuid, name text)
returns sheet_fields
language plpgsql
security definer
set search_path = public
as $$
declare
  field_row sheet_fields;
begin
  if name is null or trim(name) = '' then
    raise exception 'field name is required';
  end if;
  if not can_access_sheet_form(sheet_form_id, 'admin') then
    raise exception 'permission denied for sheet form %', sheet_form_id;
  end if;
  update sheet_fields
  set name = trim(rename_sheet_field.name)
  where id = field_id and sheet_fields.sheet_form_id = rename_sheet_field.sheet_form_id
  returning * into field_row;
  if not found then
    raise exception 'field % not found', field_id;
  end if;
  return field_row;
end;
$$;

create or replace function hide_sheet_field(sheet_form_id uuid, field_id uuid)
returns sheet_fields
language plpgsql
security definer
set search_path = public
as $$
declare
  field_row sheet_fields;
begin
  if not can_access_sheet_form(sheet_form_id, 'admin') then
    raise exception 'permission denied for sheet form %', sheet_form_id;
  end if;

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
security definer
set search_path = public
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
  if not can_access_sheet_form(form_row.id, 'admin') then
    raise exception 'permission denied for sheet form %', sheet_form_id;
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

  perform pg_notify('pgrst', 'reload schema');

  return field_row;
end;
$$;

create or replace function update_sheet_view_widths(sheet_form_id uuid, widths jsonb)
returns sheet_views
language plpgsql
security definer
set search_path = public
as $$
declare
  view_row sheet_views;
begin
  if widths is null or jsonb_typeof(widths) != 'object' then
    raise exception 'column widths must be a JSON object';
  end if;
  if not can_access_sheet_form(sheet_form_id, 'write') then
    raise exception 'permission denied for sheet form %', sheet_form_id;
  end if;

  update sheet_views
  set column_widths = widths
  where sheet_views.sheet_form_id = update_sheet_view_widths.sheet_form_id
    and name = 'Default'
  returning * into view_row;

  if not found then
    insert into sheet_views (sheet_form_id, name, column_widths)
    values (sheet_form_id, 'Default', widths)
    returning * into view_row;
  end if;

  return view_row;
end;
$$;

create or replace function update_sheet_view_column_order(sheet_form_id uuid, column_order text[])
returns sheet_views
language plpgsql
security definer
set search_path = public
as $$
declare
  view_row sheet_views;
  state jsonb;
begin
  if column_order is null then
    raise exception 'column order is required';
  end if;
  if not can_access_sheet_form(sheet_form_id, 'write') then
    raise exception 'permission denied for sheet form %', sheet_form_id;
  end if;

  state := jsonb_build_object('column_order', column_order);

  update sheet_views
  set sort_filter_state = sort_filter_state || state
  where sheet_views.sheet_form_id = update_sheet_view_column_order.sheet_form_id
    and name = 'Default'
  returning * into view_row;

  if not found then
    insert into sheet_views (sheet_form_id, name, sort_filter_state)
    values (sheet_form_id, 'Default', state)
    returning * into view_row;
  end if;

  return view_row;
end;
$$;

alter table sheet_forms enable row level security;
alter table sheet_fields enable row level security;
alter table sheet_views enable row level security;
alter table permissions enable row level security;

drop policy if exists sheet_forms_read on sheet_forms;
create policy sheet_forms_read on sheet_forms
for select to sheetbase_api
using (can_access_sheet_form(id, 'read'));

drop policy if exists sheet_fields_read on sheet_fields;
create policy sheet_fields_read on sheet_fields
for select to sheetbase_api
using (can_access_sheet_form(sheet_form_id, 'read'));

drop policy if exists sheet_views_read on sheet_views;
create policy sheet_views_read on sheet_views
for select to sheetbase_api
using (can_access_sheet_form(sheet_form_id, 'read'));

drop policy if exists permissions_read on permissions;
create policy permissions_read on permissions
for select to sheetbase_api
using (user_id = current_sheetbase_user_id());

do $$
declare
  form_row sheet_forms;
begin
  for form_row in select * from sheet_forms loop
    execute format('grant select, insert, update, delete on table %I to sheetbase_api', form_row.generated_table_name);
    execute format('alter table %I enable row level security', form_row.generated_table_name);
    execute format('drop policy if exists sheetbase_generated_read on %I', form_row.generated_table_name);
    execute format(
      'create policy sheetbase_generated_read on %I for select to sheetbase_api using (can_access_sheet_table(%L, ''read''))',
      form_row.generated_table_name,
      form_row.generated_table_name
    );
    execute format('drop policy if exists sheetbase_generated_write on %I', form_row.generated_table_name);
    execute format(
      'create policy sheetbase_generated_write on %I for insert to sheetbase_api with check (can_access_sheet_table(%L, ''write''))',
      form_row.generated_table_name,
      form_row.generated_table_name
    );
    execute format('drop policy if exists sheetbase_generated_update on %I', form_row.generated_table_name);
    execute format(
      'create policy sheetbase_generated_update on %I for update to sheetbase_api using (can_access_sheet_table(%L, ''write'')) with check (can_access_sheet_table(%L, ''write''))',
      form_row.generated_table_name,
      form_row.generated_table_name,
      form_row.generated_table_name
    );
    execute format('drop policy if exists sheetbase_generated_delete on %I', form_row.generated_table_name);
    execute format(
      'create policy sheetbase_generated_delete on %I for delete to sheetbase_api using (can_access_sheet_table(%L, ''delete''))',
      form_row.generated_table_name,
      form_row.generated_table_name
    );
  end loop;
end;
$$;

grant usage on schema public to sheetbase_api;
revoke all on users, roles, permissions from sheetbase_api;
grant select on sheet_forms, sheet_fields, sheet_views to sheetbase_api;
grant execute on function create_sheet_form(text, text[]) to sheetbase_api;
grant execute on function add_sheet_field(uuid, text) to sheetbase_api;
grant execute on function rename_sheet_form(uuid, text) to sheetbase_api;
grant execute on function rename_sheet_field(uuid, uuid, text) to sheetbase_api;
grant execute on function set_sheet_form_slug(uuid, text) to sheetbase_api;
grant execute on function hide_sheet_field(uuid, uuid) to sheetbase_api;
grant execute on function tighten_sheet_field_type(uuid, uuid, text) to sheetbase_api;
grant execute on function update_sheet_view_widths(uuid, jsonb) to sheetbase_api;
grant execute on function update_sheet_view_column_order(uuid, text[]) to sheetbase_api;
grant execute on function current_sheetbase_user_id() to sheetbase_api;
grant execute on function can_access_sheet_form(uuid, text) to sheetbase_api;
grant execute on function can_access_sheet_table(text, text) to sheetbase_api;
notify pgrst, 'reload schema';
