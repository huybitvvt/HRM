-- Expose client public IP seen by PostgREST headers for Wi-Fi / Office Network Attendance
create or replace function public.get_online_attendance_network()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_headers jsonb := '{}'::jsonb;
  v_raw_ip text := '';
  v_ip text := '';
begin
  begin
    v_headers := coalesce(nullif(current_setting('request.headers', true), '')::jsonb, '{}'::jsonb);
  exception when others then
    v_headers := '{}'::jsonb;
  end;

  v_raw_ip := coalesce(
    nullif(btrim(split_part(coalesce(v_headers ->> 'cf-connecting-ip', ''), ',', 1)), ''),
    nullif(btrim(split_part(coalesce(v_headers ->> 'x-real-ip', ''), ',', 1)), ''),
    nullif(btrim(split_part(coalesce(v_headers ->> 'x-forwarded-for', ''), ',', 1)), ''),
    ''
  );

  v_ip := regexp_replace(v_raw_ip, '^::ffff:', '', 'i');

  return jsonb_build_object(
    'ip', nullif(v_ip, ''),
    'timestamp', clock_timestamp()
  );
end;
$$;

revoke all on function public.get_online_attendance_network() from public;
grant execute on function public.get_online_attendance_network() to anon, authenticated;

