-- 정산: 집계 실행(run) 단위로 일별 사용량을 저장하고, 정산 줄이 그 일별 사용량을 가리킨다. 저장한 집계는 고치지 않는다.
create table billing_run (
  id bigserial primary key,
  account_id text not null references account (id),
  month text not null,
  at_ms bigint not null
);

create table usage_daily (
  id bigserial primary key,
  run_id bigint not null references billing_run (id),
  device_id text not null references device (id),
  day text not null,
  billed_seconds bigint not null,
  record_ids bigint[] not null
);
create index usage_daily_run on usage_daily (run_id);

create table invoice (
  id bigserial primary key,
  account_id text not null references account (id),
  month text not null,
  status text not null check (status in ('closed')),
  total_won bigint not null,
  closed_at_ms bigint not null,
  run_id bigint not null references billing_run (id),
  constraint invoice_account_month unique (account_id, month)
);

create table invoice_line (
  id bigserial primary key,
  invoice_id bigint not null references invoice (id),
  seq int not null,
  kind text not null check (kind in ('screen', 'usage_tier', 'adjustment')),
  description text not null,
  quantity bigint not null,
  unit_won bigint,
  amount_won bigint not null,
  adjusts_month text
);

create table invoice_line_usage (
  line_id bigint not null references invoice_line (id),
  usage_daily_id bigint not null references usage_daily (id),
  primary key (line_id, usage_daily_id)
);
