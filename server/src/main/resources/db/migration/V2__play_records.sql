-- 플레이어가 보낸 재생 기록. (device_id, seq) 가 같은 기록은 한 번만 들어온다(멱등).
-- started/ended 는 기기 시계 기준 원본, server_* 는 기기가 보낸 시계 차이를 더해 서버 시각으로 맞춘 값이다.
create table play_record (
  id bigserial primary key,
  device_id text not null references device (id),
  seq bigint not null,
  item_id text not null,
  started_at_ms bigint not null,
  ended_at_ms bigint not null,
  clock_offset_ms bigint not null,
  received_at_ms bigint not null,
  server_started_ms bigint not null,
  server_ended_ms bigint not null,
  status text not null check (status in ('accepted', 'quarantined')),
  reason text,
  constraint play_record_device_seq unique (device_id, seq)
);
create index play_record_device_time on play_record (device_id, server_started_ms);
