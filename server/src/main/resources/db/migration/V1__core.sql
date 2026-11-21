-- 화면·묶음·상태·이벤트 로그·명령 중복 방지
create table account (
  id text primary key,
  name text not null,
  plan jsonb not null
);

create table device_group (
  id text primary key,
  name text not null
);

create table device (
  id text primary key,
  name text not null,
  group_id text not null references device_group (id),
  account_id text not null references account (id),
  device_key text not null,
  last_seen_ms bigint
);

-- 화면의 현재 상태. version 이 마지막으로 적용한 이벤트 버전이다.
create table device_state (
  device_id text primary key references device (id),
  version bigint not null,
  state jsonb not null
);

-- 상태 변경 이벤트 로그. 버전은 화면마다 1부터 빠짐없이 이어진다.
create table device_event (
  device_id text not null references device (id),
  version bigint not null,
  server_time_ms bigint not null,
  payload jsonb not null,
  primary key (device_id, version)
);

-- 같은 commandId 를 다시 보내면 처음 결과를 그대로 돌려주기 위한 기록
create table command_log (
  device_id text not null references device (id),
  command_id text not null,
  result jsonb not null,
  primary key (device_id, command_id)
);

insert into account (id, name, plan) values
  ('acct-1', '합성 매장 A', '{"screenFeeWon":9900,"tiers":[{"upToHours":100,"rateWonPerHour":100},{"upToHours":300,"rateWonPerHour":80},{"upToHours":null,"rateWonPerHour":60}]}');
insert into device_group (id, name) values ('g-1', '1층'), ('g-2', '2층');
insert into device (id, name, group_id, account_id, device_key) values
  ('d-001', '입구 TV', 'g-1', 'acct-1', 'dk-d-001'),
  ('d-002', '카운터 TV', 'g-1', 'acct-1', 'dk-d-002'),
  ('d-003', '창가 PC', 'g-2', 'acct-1', 'dk-d-003'),
  ('d-004', '로비 PC', 'g-2', 'acct-1', 'dk-d-004');
