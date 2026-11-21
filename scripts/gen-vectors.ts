// 공유 시험 벡터를 만든다. 입력(명령·시각·기록)은 여기서 손으로 정하고, 기대값은 sync-core 구현이 낸 값을 사람이 읽어 확인한 뒤 고정한다.
// 만든 파일은 spec/vectors/*.json 이고, TypeScript(vitest)와 Kotlin(JUnit)이 각자 읽어 같은 결과를 내야 통과한다.
import { writeFileSync } from 'node:fs';
import { DeviceAuthority, nowPlaying, classifyRecord, RecordLedger } from '../packages/sync-core/src/index';
import type { Command } from '../packages/sync-core/src/index';

const T0 = Date.UTC(2026, 10, 21, 0, 0, 0); // 한국 시간 09:00
const S = (sec: number) => T0 + sec * 1000;
const items = [
  { id: 'i1', title: '아침 인사', sceneId: 'aurora', durationSec: 10 },
  { id: 'i2', title: '신메뉴', sceneId: 'waves', durationSec: 20 },
  { id: 'i3', title: '이벤트', sceneId: 'grid', durationSec: 30 },
] as const;
let n = 0;
const id = () => `c${++n}`;
const c = (o: Record<string, unknown>) => ({ commandId: id(), ...o }) as unknown as Command;

interface Step { nowSec: number; actor: string; command: Command }
interface Scn { name: string; note: string; steps: Step[]; probes: number[] }
const replace = (base: number, its: unknown[]) => c({ type: 'schedule.replace', baseScheduleVersion: base, items: its });
const st = (nowSec: number, actor: string, command: Command): Step => ({ nowSec, actor, command });

const scenarios: Scn[] = [
  {
    name: 'basic-playback',
    note: '편성표를 넣고 다음·일시정지·재개·이동·음량. 같은 상태로 다시 보내면 unchanged, 안 보던 항목에서 다음을 누르면 stale',
    steps: [
      st(0, 'op-a', replace(0, [...items])),
      st(3, 'op-a', c({ type: 'playback.next', fromItemId: 'i1' })),
      st(4, 'op-a', c({ type: 'playback.next', fromItemId: 'i1' })),
      st(15, 'op-a', c({ type: 'playback.pause' })),
      st(16, 'op-a', c({ type: 'playback.pause' })),
      st(20, 'op-a', c({ type: 'playback.resume' })),
      st(21, 'op-a', c({ type: 'playback.resume' })),
      st(22, 'op-a', c({ type: 'playback.seek', positionMs: 50000 })),
      st(23, 'op-a', c({ type: 'playback.seek', positionMs: 60000 })),
      st(24, 'op-a', c({ type: 'volume.set', volume: 80 })),
      st(25, 'op-a', c({ type: 'volume.set', volume: 80 })),
      st(26, 'op-a', c({ type: 'playback.jump', itemId: 'i3' })),
      st(27, 'op-a', c({ type: 'playback.jump', itemId: 'nope' })),
    ],
    probes: [26, 35.999, 36, 55.999, 56, 86, 125, 4000],
  },
  {
    name: 'concurrent-operators',
    note: '두 사람이 거의 동시에 조작. 다음(상대 명령)은 늦은 쪽 stale, 편성표는 먼저 저장한 쪽, 음량과 긴급 공지는 마지막 도착',
    steps: [
      st(0, 'op-a', replace(0, [...items])),
      st(1.0, 'op-a', c({ type: 'playback.next', fromItemId: 'i1' })),
      st(1.2, 'op-b', c({ type: 'playback.next', fromItemId: 'i1' })),
      st(2.0, 'op-a', replace(1, [items[0], items[1]])),
      st(2.1, 'op-b', replace(1, [items[2]])),
      st(3.0, 'op-a', c({ type: 'volume.set', volume: 30 })),
      st(3.1, 'op-b', c({ type: 'volume.set', volume: 70 })),
      st(4.0, 'op-a', c({ type: 'override.set', text: '점심시간 안내', durationSec: 60 })),
      st(4.1, 'op-b', c({ type: 'override.set', text: '정전 대비 점검 중' })),
      st(5.0, 'op-a', c({ type: 'override.clear' })),
      st(5.1, 'op-b', c({ type: 'override.clear' })),
    ],
    probes: [5.1, 12, 100],
  },
  {
    name: 'time-windows',
    note: '시간대 편성. 09:00~12:00 항목과 12:00~18:00 항목, 자정을 넘기는 항목. 재생 대상이 아닌 항목으로 이동하면 invalid',
    steps: [
      st(0, 'op-a', replace(0, [
        { id: 'am', title: '오전 메뉴', sceneId: 'dusk', durationSec: 10, window: { fromMin: 540, toMin: 720 } },
        { id: 'pm', title: '오후 메뉴', sceneId: 'pulse', durationSec: 20, window: { fromMin: 720, toMin: 1080 } },
        { id: 'night', title: '야간', sceneId: 'dusk', durationSec: 15, window: { fromMin: 1320, toMin: 360 } },
        { id: 'all', title: '하루 종일', sceneId: 'grid', durationSec: 5 },
      ])),
      st(1, 'op-a', c({ type: 'playback.jump', itemId: 'pm' })),
      st(2, 'op-a', c({ type: 'playback.jump', itemId: 'night' })),
      st(3, 'op-a', c({ type: 'playback.jump', itemId: 'all' })),
      st(4, 'op-a', c({ type: 'playback.next', fromItemId: 'all' })),
      st(3 * 3600 + 1, 'op-a', c({ type: 'playback.jump', itemId: 'pm' })),
      st(3 * 3600 + 2, 'op-a', c({ type: 'playback.jump', itemId: 'am' })),
      st(14 * 3600, 'op-a', c({ type: 'playback.jump', itemId: 'night' })),
    ],
    probes: [14 * 3600, 14 * 3600 + 7, 14 * 3600 + 16, 21 * 3600],
  },
  {
    name: 'invalid-inputs',
    note: '잘못된 입력은 이벤트 없이 invalid 로 거절',
    steps: [
      st(0, 'op-a', replace(0, [])),
      st(0, 'op-a', replace(0, [items[0], items[0]])),
      st(0, 'op-a', replace(0, [{ id: 'x', title: '장면 없음', sceneId: 'movie', durationSec: 5 }])),
      st(0, 'op-a', replace(0, [{ id: 'x', title: '길이 0', sceneId: 'grid', durationSec: 0 }])),
      st(0, 'op-a', replace(0, [{ id: 'x', title: '', sceneId: 'grid', durationSec: 5 }])),
      st(0, 'op-a', replace(0, [{ id: 'x', title: '창 범위', sceneId: 'grid', durationSec: 5, window: { fromMin: 0, toMin: 1441 } }])),
      st(1, 'op-a', replace(0, [...items])),
      st(2, 'op-a', c({ type: 'volume.set', volume: 101 })),
      st(2, 'op-a', c({ type: 'volume.set', volume: -1 })),
      st(2, 'op-a', c({ type: 'override.set', text: '   ' })),
      st(2, 'op-a', c({ type: 'override.set', text: 'x'.repeat(81) })),
      st(2, 'op-a', c({ type: 'override.set', text: '정상', durationSec: 0 })),
      st(2, 'op-a', c({ type: 'playback.seek', positionMs: -1 })),
      st(2, 'op-a', c({ type: 'playback.next', fromItemId: 'i2' })),
    ],
    probes: [2, 100],
  },
  {
    name: 'empty-schedule',
    note: '편성표가 비어 있으면 재생할 것이 없다. 다음·이동·이동 시도는 invalid, 일시정지는 위치 0',
    steps: [
      st(0, 'op-a', c({ type: 'playback.next', fromItemId: 'i1' })),
      st(1, 'op-a', c({ type: 'playback.seek', positionMs: 0 })),
      st(2, 'op-a', c({ type: 'playback.pause' })),
      st(3, 'op-a', c({ type: 'override.set', text: '긴급', durationSec: 5 })),
    ],
    probes: [3, 10],
  },
  {
    name: 'window-boundary',
    note: '시간대 경계(11:59:50 편성 후 12:00 를 지나감). 재생 대상이 바뀌면 같은 서버 시각에서 모든 기기가 같은 항목을 가리킨다',
    steps: [
      st(3 * 3600 - 10, 'op-a', replace(0, [
        { id: 'am', title: '오전 메뉴', sceneId: 'dusk', durationSec: 10, window: { fromMin: 540, toMin: 720 } },
        { id: 'pm', title: '오후 메뉴', sceneId: 'pulse', durationSec: 20, window: { fromMin: 720, toMin: 1080 } },
        { id: 'all', title: '하루 종일', sceneId: 'grid', durationSec: 5 },
      ])),
    ],
    probes: [3 * 3600 - 10, 3 * 3600 - 1, 3 * 3600, 3 * 3600 + 15, 3 * 3600 + 25],
  },
];

const out = scenarios.map((s) => {
  const dev = new DeviceAuthority('d-test');
  const steps = s.steps.map((step) => {
    const now = Math.round(S(step.nowSec));
    const r = dev.submit(step.command, now, step.actor);
    const expect = r.result === 'accepted' ? { result: 'accepted', event: r.event } : { result: 'rejected', reason: r.reason };
    return { nowMs: now, actor: step.actor, command: step.command, expect };
  });
  const probes = s.probes.map((p) => {
    const now = Math.round(S(p));
    const np = nowPlaying(dev.state, now);
    return { atMs: now, itemId: np ? np.item.id : null, offsetInItemMs: np ? np.offsetInItemMs : null };
  });
  return { name: s.name, note: s.note, deviceId: 'd-test', steps, probes, finalState: dev.state };
});
writeFileSync('spec/vectors/sync-authority.json', JSON.stringify({ baseTimeMs: T0, scenarios: out }, null, 2) + '\n');

// 재생 기록 수집 벡터
const R = (seq: number, s: number, e: number, item = 'i1') => ({ seq, itemId: item, startedAtMs: s, endedAtMs: e });
const RT = Date.UTC(2026, 10, 21, 3, 0, 0);
const ingestScn = [
  {
    name: 'resend-is-idempotent',
    note: '같은 일련번호를 다시 보내도 한 번만 센다. ackSeq 는 받은 가장 큰 번호',
    deviceId: 'd-001',
    batches: [
      { receivedAtMs: RT, clockOffsetMs: 0, records: [R(1, RT - 60000, RT - 50000), R(2, RT - 50000, RT - 30000), R(3, RT - 30000, RT - 10000)] },
      { receivedAtMs: RT + 5000, clockOffsetMs: 0, records: [R(2, RT - 50000, RT - 30000), R(3, RT - 30000, RT - 10000), R(4, RT - 10000, RT - 1000)] },
      { receivedAtMs: RT + 9000, clockOffsetMs: 0, records: [R(1, RT - 60000, RT - 50000)] },
    ],
  },
  {
    name: 'skewed-device-clock',
    note: '기기 시계가 20분 빠르다. 오프셋을 더해 서버 시각으로 맞추면 정상, 오프셋을 못 구한 기기(0)의 같은 기록은 미래 시각으로 보류',
    deviceId: 'd-002',
    batches: [
      { receivedAtMs: RT, clockOffsetMs: -1200000, records: [R(1, RT + 1200000 - 60000, RT + 1200000 - 30000)] },
      { receivedAtMs: RT, clockOffsetMs: 0, records: [R(2, RT + 1200000 - 60000, RT + 1200000 - 30000)] },
    ],
  },
  {
    name: 'invalid-records',
    note: '끝이 시작보다 빠르거나 같음, 6시간 초과, 미래 시각은 보류(수집은 하되 정산에 쓰지 않음). 5분 이내 미래는 허용',
    deviceId: 'd-003',
    batches: [
      {
        receivedAtMs: RT,
        clockOffsetMs: 0,
        records: [
          R(1, RT - 5000, RT - 5000),
          R(2, RT - 5000, RT - 9000),
          R(3, RT - 7 * 3600000, RT - 1800000),
          R(4, RT - 6 * 3600000, RT),
          R(5, RT + 60000, RT + 120000),
          R(6, RT + 100000, RT + 299999),
          R(7, RT + 100000, RT + 300001),
        ],
      },
    ],
  },
];
const ingestOut = ingestScn.map((s) => {
  const ledger = new RecordLedger();
  const batches = s.batches.map((b) => {
    const r = ledger.ingest(s.deviceId, b.clockOffsetMs, b.records, b.receivedAtMs);
    const statuses = b.records.map((rec) => {
      const cl = classifyRecord(rec, b.clockOffsetMs, b.receivedAtMs);
      return cl.status === 'accepted' ? 'accepted' : `quarantined:${cl.reason}`;
    });
    return { ...b, expect: { accepted: r.accepted, duplicates: r.duplicates, quarantined: r.quarantined, ackSeq: r.ackSeq }, firstSeenStatuses: statuses };
  });
  return { ...s, batches, storedRows: ledger.rows.length };
});
writeFileSync('spec/vectors/records-ingest.json', JSON.stringify({ scenarios: ingestOut }, null, 2) + '\n');
console.log('벡터 생성:', out.map((o) => `${o.name}(${o.steps.length}단계)`).join(', '), '/', ingestOut.map((o) => o.name).join(', '));
