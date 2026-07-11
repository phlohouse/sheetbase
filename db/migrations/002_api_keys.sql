create table if not exists api_keys (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  token_hash text not null unique,
  token_prefix text not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

create table if not exists api_key_permissions (
  api_key_id uuid not null references api_keys(id) on delete cascade,
  sheet_form_id uuid not null references sheet_forms(id) on delete cascade,
  can_read boolean not null default true,
  can_write boolean not null default false,
  primary key (api_key_id, sheet_form_id)
);

create or replace function current_sheetbase_principal_kind()
returns text
language plpgsql
stable
as $$
begin
  return coalesce(
    nullif(current_setting('request.jwt.claim.kind', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'kind',
    'user'
  );
exception when others then
  return 'user';
end;
$$;

create or replace function can_access_sheet_form(sheet_form_id uuid, access text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select case current_sheetbase_principal_kind()
    when 'api_key' then exists (
      select 1
      from api_key_permissions p
      join api_keys k on k.id = p.api_key_id
      where p.sheet_form_id = can_access_sheet_form.sheet_form_id
        and p.api_key_id = current_sheetbase_user_id()
        and k.revoked_at is null
        and (
          access = 'read' and (p.can_read or p.can_write)
          or access = 'write' and p.can_write
          or access = 'delete' and p.can_write
        )
    )
    else exists (
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
    )
  end;
$$;

do $$
declare form_row record;
begin
  for form_row in select generated_table_name from sheet_forms loop
    execute format('drop policy if exists sheetbase_generated_delete on %I', form_row.generated_table_name);
    execute format(
      'create policy sheetbase_generated_delete on %I for delete to sheetbase_api using (can_access_sheet_table(%L, ''delete''))',
      form_row.generated_table_name,
      form_row.generated_table_name
    );
  end loop;
end;
$$;

revoke all on api_keys, api_key_permissions from sheetbase_api;
grant execute on function current_sheetbase_principal_kind() to sheetbase_api;
