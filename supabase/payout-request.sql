-- ============================================================================
-- ForgeVyn — creator payout requests
-- Paste this whole file into the Supabase SQL Editor and click "Run" (once).
-- ============================================================================

-- Adds request_payout(): a signed-in creator turns their ENTIRE balance into
-- one pending payout row. You (admin) later set status to 'approved' or 'paid'
-- from the Supabase dashboard or SQL editor. The creator's balance is zeroed
-- immediately so the same money can't be requested twice.
--
-- Guardrails built in:
--   * caller must be a signed-in creator (never anon)
--   * minimum payout of $10.00
--   * only one pending payout at a time

create or replace function public.request_payout()
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_creator_id uuid;
  v_balance    numeric;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '')
     not in ('anon', 'authenticated') then
    raise exception 'Call request_payout from the ForgeVyn app while signed in';
  end if;

  v_creator_id := auth.uid();
  if v_creator_id is null then
    raise exception 'You must be signed in to request a payout';
  end if;

  select balance into v_balance from public.profiles where profiles.id = v_creator_id;

  if v_balance is null then
    raise exception 'Creator profile not found';
  end if;

  if v_balance < 10 then
    raise exception 'Minimum payout is $10.00 — your balance is $%.', v_balance;
  end if;

  if exists (
    select 1 from public.payouts
    where payouts.creator_id = v_creator_id and payouts.status = 'pending'
  ) then
    raise exception 'You already have a payout waiting for approval';
  end if;

  -- The internal flag lets this server-side function update the balance
  -- (the profile trigger blocks balance edits coming from the browser).
  perform set_config('forgevyn.internal', 'on', true);

  insert into public.payouts (creator_id, amount, status)
  values (v_creator_id, v_balance, 'pending');

  update public.profiles set balance = 0 where profiles.id = v_creator_id;

  perform set_config('forgevyn.internal', 'off', true);

  return v_balance;
end;
$$;

revoke execute on function public.request_payout() from anon;
grant execute on function public.request_payout() to authenticated;
