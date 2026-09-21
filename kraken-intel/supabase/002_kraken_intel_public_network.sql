-- Kraken Intel public contributor network v1
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run.
-- This supersedes the invite-based schema. Old ki_* tables may remain unused.

create table if not exists public.ki_public_loadouts (
    target_id bigint primary key check (target_id > 0),
    target_name text,
    observed_at timestamptz not null,
    captured_by uuid not null,
    fingerprint text not null,
    fight_id bigint,
    attack_status text,
    items jsonb not null check (jsonb_typeof(items) = 'array'),
    schema_version integer not null default 1,
    updated_at timestamptz not null default now()
);

create table if not exists public.ki_public_loadout_history (
    id bigint generated always as identity primary key,
    target_id bigint not null check (target_id > 0),
    target_name text,
    observed_at timestamptz not null,
    captured_by uuid not null,
    fingerprint text not null,
    fight_id bigint,
    attack_status text,
    items jsonb not null check (jsonb_typeof(items) = 'array'),
    schema_version integer not null default 1,
    created_at timestamptz not null default now(),
    unique (target_id, fingerprint, observed_at)
);

create index if not exists ki_public_loadouts_updated_idx
    on public.ki_public_loadouts (updated_at desc);

create index if not exists ki_public_history_target_idx
    on public.ki_public_loadout_history (target_id, observed_at desc);

alter table public.ki_public_loadouts enable row level security;
alter table public.ki_public_loadout_history enable row level security;

drop policy if exists "Authenticated users read shared intel" on public.ki_public_loadouts;
create policy "Authenticated users read shared intel"
on public.ki_public_loadouts for select to authenticated
using (true);

drop policy if exists "Authenticated users read shared history" on public.ki_public_loadout_history;
create policy "Authenticated users read shared history"
on public.ki_public_loadout_history for select to authenticated
using (true);

-- Direct client writes remain blocked. All submissions pass through this
-- validating function, which records the authenticated anonymous contributor.
create or replace function public.ki_submit_public_loadout(
    p_target_id bigint,
    p_target_name text,
    p_observed_at timestamptz,
    p_fingerprint text,
    p_fight_id bigint,
    p_attack_status text,
    p_items jsonb,
    p_schema_version integer default 1
)
returns table(saved boolean, changed boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user_id uuid := auth.uid();
    v_existing public.ki_public_loadouts%rowtype;
    v_changed boolean;
    v_saved_rows integer := 0;
begin
    if v_user_id is null then
        raise exception 'Authentication required';
    end if;
    if p_target_id is null or p_target_id <= 0 then
        raise exception 'Invalid target ID';
    end if;
    if p_observed_at is null
       or p_observed_at > now() + interval '5 minutes'
       or p_observed_at < now() - interval '7 days' then
        raise exception 'Invalid observation time';
    end if;
    if p_fingerprint is null or p_fingerprint !~ '^[0-9a-f]{64}$' then
        raise exception 'Invalid fingerprint';
    end if;
    if jsonb_typeof(p_items) <> 'array'
       or jsonb_array_length(p_items) = 0
       or jsonb_array_length(p_items) > 12 then
        raise exception 'Invalid equipment list';
    end if;
    if pg_column_size(p_items) > 65536 then
        raise exception 'Equipment payload too large';
    end if;

    -- Serialise updates for the same target to avoid two simultaneous reports
    -- racing past one another.
    perform pg_advisory_xact_lock(p_target_id);

    select * into v_existing
    from public.ki_public_loadouts
    where target_id = p_target_id;

    v_changed := v_existing.target_id is null
        or v_existing.fingerprint <> p_fingerprint;

    if v_changed then
        insert into public.ki_public_loadout_history (
            target_id, target_name, observed_at, captured_by, fingerprint,
            fight_id, attack_status, items, schema_version
        ) values (
            p_target_id, left(nullif(trim(p_target_name), ''), 64), p_observed_at,
            v_user_id, p_fingerprint, p_fight_id,
            left(nullif(trim(p_attack_status), ''), 32), p_items,
            greatest(1, least(coalesce(p_schema_version, 1), 10))
        ) on conflict do nothing;
    end if;

    insert into public.ki_public_loadouts (
        target_id, target_name, observed_at, captured_by, fingerprint,
        fight_id, attack_status, items, schema_version, updated_at
    ) values (
        p_target_id, left(nullif(trim(p_target_name), ''), 64), p_observed_at,
        v_user_id, p_fingerprint, p_fight_id,
        left(nullif(trim(p_attack_status), ''), 32), p_items,
        greatest(1, least(coalesce(p_schema_version, 1), 10)), now()
    )
    on conflict (target_id) do update
    set target_name = excluded.target_name,
        observed_at = excluded.observed_at,
        captured_by = excluded.captured_by,
        fingerprint = excluded.fingerprint,
        fight_id = excluded.fight_id,
        attack_status = excluded.attack_status,
        items = excluded.items,
        schema_version = excluded.schema_version,
        updated_at = now()
    where excluded.observed_at >= ki_public_loadouts.observed_at;

    get diagnostics v_saved_rows = row_count;
    return query select v_saved_rows > 0, v_changed and v_saved_rows > 0;
end;
$$;

revoke all on table public.ki_public_loadouts from anon;
revoke all on table public.ki_public_loadout_history from anon;
revoke insert, update, delete on table public.ki_public_loadouts from authenticated;
revoke insert, update, delete on table public.ki_public_loadout_history from authenticated;
grant select on table public.ki_public_loadouts to authenticated;
grant select on table public.ki_public_loadout_history to authenticated;

revoke all on function public.ki_submit_public_loadout(
    bigint, text, timestamptz, text, bigint, text, jsonb, integer
) from public, anon;
grant execute on function public.ki_submit_public_loadout(
    bigint, text, timestamptz, text, bigint, text, jsonb, integer
) to authenticated;

do $$
begin
    if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'ki_public_loadouts'
    ) then
        alter publication supabase_realtime add table public.ki_public_loadouts;
    end if;
end $$;
