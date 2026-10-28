-- OTMS schema. Run once in Supabase Dashboard > SQL Editor (fresh project).
-- Security model: every table has RLS on; the browser only holds the public anon key.
-- Pay is computed HERE (trigger), never trusted from the client.

create type app_role  as enum ('admin', 'supervisor', 'user');
create type day_type  as enum ('reg', 'rest', 'hol');
create type ot_status as enum ('pending', 'approved', 'rejected');

create table public.profiles (
  id             uuid primary key references auth.users(id) on delete cascade,
  employee_id    text not null unique check (employee_id ~ '^[0-9A-Za-z-]{3,20}$'),
  full_name      text not null check (length(full_name) between 2 and 120),
  office         text not null default '',
  role           app_role not null default 'user',
  supervisor_id  uuid references public.profiles(id) on delete set null,
  monthly_salary numeric(12,2) not null default 0 check (monthly_salary >= 0),
  active         boolean not null default true,
  created_at     timestamptz not null default now()
);
create index profiles_supervisor_idx on public.profiles (supervisor_id);
create index profiles_role_idx       on public.profiles (role);

create table public.settings (
  id            boolean primary key default true check (id),   -- single row
  work_days     numeric not null default 22   check (work_days between 1 and 31),
  hours_per_day numeric not null default 8    check (hours_per_day between 1 and 24),
  mult_reg      numeric not null default 1.25 check (mult_reg  between 1 and 5),
  mult_rest     numeric not null default 1.69 check (mult_rest between 1 and 5),
  mult_hol      numeric not null default 2.60 check (mult_hol  between 1 and 5)
);
insert into public.settings default values;

create table public.overtime (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  work_date   date not null,
  day_type    day_type not null,
  start_time  time not null,
  end_time    time not null,
  hours       numeric(5,2)  not null,   -- set by trigger
  hourly_rate numeric(12,2) not null,   -- set by trigger (snapshot)
  multiplier  numeric(4,2)  not null,   -- set by trigger (snapshot)
  pay         numeric(12,2) not null,   -- set by trigger
  reason      text not null check (length(btrim(reason)) between 3 and 200),
  status      ot_status not null default 'pending',
  decided_by  uuid references public.profiles(id),
  decided_at  timestamptz,
  created_at  timestamptz not null default now()
);
create index overtime_user_date_idx on public.overtime (user_id, work_date desc);
create index overtime_date_idx      on public.overtime (work_date desc);
create index overtime_status_idx    on public.overtime (status);
create unique index overtime_no_duplicate
  on public.overtime (user_id, work_date, start_time) where status <> 'rejected';

-- ---------- helpers (SECURITY DEFINER so policies don't recurse) ----------
create or replace function public.my_role() returns app_role
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and active
$$;

create or replace function public.is_my_report(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = p_user and supervisor_id = auth.uid())
$$;

-- ---------- compute hours / rate / pay on insert ----------
create or replace function public.overtime_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare p public.profiles; s public.settings; mins numeric; m numeric;
begin
  select * into p from public.profiles where id = new.user_id and active;
  if not found then raise exception 'Unknown or inactive employee'; end if;
  select * into s from public.settings;
  if new.work_date > (now() at time zone 'Asia/Manila')::date then
    raise exception 'Date cannot be in the future';
  end if;
  mins := extract(epoch from (new.end_time - new.start_time)) / 60;
  if mins <= 0 then mins := mins + 1440; end if;           -- overnight shift
  if mins > 720 then raise exception 'Overtime cannot exceed 12 hours'; end if;
  m := case new.day_type when 'reg' then s.mult_reg when 'rest' then s.mult_rest else s.mult_hol end;
  new.hours       := round(mins / 60, 2);
  new.multiplier  := m;
  new.hourly_rate := round(p.monthly_salary / s.work_days / s.hours_per_day, 2);
  new.pay         := round(new.hourly_rate * m * new.hours, 2);
  new.status := 'pending'; new.decided_by := null; new.decided_at := null;
  return new;
end $$;
create trigger overtime_bi before insert on public.overtime
  for each row execute function public.overtime_before_insert();

-- nobody can demote/promote themselves through the API
create or replace function public.profiles_guard() returns trigger
language plpgsql as $$
begin
  if auth.uid() is not null and auth.uid() = old.id
     and (new.role <> old.role or new.active <> old.active) then
    raise exception 'You cannot change your own role or status';
  end if;
  return new;
end $$;
create trigger profiles_bu before update on public.profiles
  for each row execute function public.profiles_guard();

-- ---------- Row Level Security ----------
alter table public.profiles enable row level security;
alter table public.settings enable row level security;
alter table public.overtime enable row level security;

create policy profiles_read on public.profiles for select to authenticated using (
  id = auth.uid() or public.my_role() = 'admin'
  or (public.my_role() = 'supervisor' and supervisor_id = auth.uid()));
create policy profiles_admin_update on public.profiles for update to authenticated
  using (public.my_role() = 'admin') with check (public.my_role() = 'admin');

create policy settings_read   on public.settings for select to authenticated using (true);
create policy settings_update on public.settings for update to authenticated
  using (public.my_role() = 'admin') with check (public.my_role() = 'admin');

create policy overtime_read on public.overtime for select to authenticated using (
  user_id = auth.uid() or public.my_role() = 'admin'
  or (public.my_role() = 'supervisor' and public.is_my_report(user_id)));
create policy overtime_insert on public.overtime for insert to authenticated
  with check (user_id = auth.uid());
create policy overtime_cancel on public.overtime for delete to authenticated
  using (user_id = auth.uid() and status = 'pending');
-- No UPDATE policy on overtime: approvals go through decide_overtime() only.

-- ---------- approve / reject ----------
create or replace function public.decide_overtime(p_id bigint, p_status ot_status) returns void
language plpgsql security definer set search_path = public as $$
declare r public.overtime; me app_role := public.my_role();
begin
  if p_status not in ('approved', 'rejected') then raise exception 'Invalid status'; end if;
  select * into r from public.overtime where id = p_id for update;
  if not found or r.status <> 'pending' then raise exception 'Entry is not pending'; end if;
  if r.user_id = auth.uid() then raise exception 'You cannot decide your own entry'; end if;
  if not (me = 'admin' or (me = 'supervisor' and public.is_my_report(r.user_id))) then
    raise exception 'Not allowed';
  end if;
  update public.overtime set status = p_status, decided_by = auth.uid(), decided_at = now() where id = p_id;
end $$;

-- ---------- dashboard summary (SECURITY INVOKER: RLS limits it to what the caller may see) ----------
create or replace function public.ot_summary(p_from date default null, p_to date default null, p_group text default 'office')
returns table (grp text, entries bigint, hours numeric, pay numeric, pending bigint, rejected bigint)
language sql stable security invoker set search_path = public as $$
  select case p_group when 'employee' then p.full_name
                      when 'month'    then to_char(o.work_date, 'YYYY-MM')
                      else p.office end as grp,
         count(*),
         coalesce(sum(o.hours) filter (where o.status = 'approved'), 0),
         coalesce(sum(o.pay)   filter (where o.status = 'approved'), 0),
         count(*) filter (where o.status = 'pending'),
         count(*) filter (where o.status = 'rejected')
  from public.overtime o join public.profiles p on p.id = o.user_id
  where (p_from is null or o.work_date >= p_from) and (p_to is null or o.work_date <= p_to)
  group by 1 order by 4 desc, 1
$$;

-- ---------- least privilege on functions ----------
revoke all on function public.decide_overtime(bigint, ot_status) from public, anon;
revoke all on function public.ot_summary(date, date, text)       from public, anon;
revoke all on function public.my_role()                          from public, anon;
revoke all on function public.is_my_report(uuid)                 from public, anon;
grant execute on function public.decide_overtime(bigint, ot_status) to authenticated;
grant execute on function public.ot_summary(date, date, text)       to authenticated;
grant execute on function public.my_role()                          to authenticated;
grant execute on function public.is_my_report(uuid)                 to authenticated;
