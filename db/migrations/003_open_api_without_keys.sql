create or replace function can_access_sheet_form(sheet_form_id uuid, access text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select case current_sheetbase_principal_kind()
    when 'public' then not exists (select 1 from api_keys where revoked_at is null)
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
