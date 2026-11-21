import { $ } from './dom';
import { initEvidence } from './evidence';
import * as kotlin from 'kotlin-domain';
import { closeNovember, renderLive } from './live';
import { KIND_LABEL, RECV_LABEL, World, type DeviceKind, type LogLine } from './sim';
import { initTour, type TourStep } from './tour';
import { buildDevices, renderLogs, renderRecords, renderResult, type CommandInput, type Ui } from './view';

// 테마
const root = document.documentElement;
try {
  const t = localStorage.getItem('sl_demo_theme');
  if (t === 'light' || t === 'dark') root.dataset.theme = t;
} catch {
  /* 저장소를 못 쓰면 기본값 */
}
$('#theme').addEventListener('click', () => {
  const next = root.dataset.theme === 'light' ? 'dark' : 'light';
  root.dataset.theme = next;
  try {
    localStorage.setItem('sl_demo_theme', next);
  } catch {
    /* 무시 */
  }
});

let world = new World();
const cmdLog: LogLine[] = [];
const since = new Map<string, number>();
let cmdSeq = 0;
let updateDevices: () => void = () => undefined;

const REASON: Record<string, string> = {
  stale: '거절(stale): 그 사이 다른 곳에서 이미 바뀌었습니다',
  conflict: '거절(conflict): 다른 사람이 먼저 편성표를 저장했습니다',
  invalid: '거절(invalid): 값이 올바르지 않습니다',
  unchanged: '거절(unchanged): 이미 그 상태입니다',
};

const ui: Ui = {
  get world() {
    return world;
  },
  cmdLog,
  async run(kind: DeviceKind, cmd: CommandInput, label: string) {
    const dev = world.device(kind);
    const at = () => world.clock.now();
    try {
      const r = await dev.client.send({ ...cmd, commandId: `${kind}-${++cmdSeq}` } as never);
      cmdLog.push(
        r.result === 'accepted'
          ? { at: at(), who: KIND_LABEL[kind], text: `${label} → 적용됨(v${r.version})`, tone: 'ok' }
          : { at: at(), who: KIND_LABEL[kind], text: `${label} → ${REASON[r.reason ?? ''] ?? '거절'}`, tone: r.reason === 'unchanged' ? 'warn' : 'bad' },
      );
    } catch {
      cmdLog.push({ at: at(), who: KIND_LABEL[kind], text: `${label} → 연결이 끊겨 서버에 보내지 못했습니다`, tone: 'bad' });
    }
  },
  setRecv(kind, mode) {
    world.device(kind).channel.mode = mode;
    cmdLog.push({ at: world.clock.now(), who: KIND_LABEL[kind], text: `받는 알림: ${RECV_LABEL[mode]}`, tone: 'info' });
  },
  setSkew(kind, ms) {
    const d = world.device(kind);
    d.skewMs = ms;
    cmdLog.push({
      at: world.clock.now(),
      who: KIND_LABEL[kind],
      text: ms === 0 ? '기기 시계를 정상으로' : `기기 시계를 ${ms > 0 ? '+' : '−'}${Math.abs(ms / 1000)}초로 틀리게`,
      tone: 'info',
    });
    void d.client.resync();
  },
  setConnected(kind, on) {
    const d = world.device(kind);
    if (on) d.channel.connect();
    else d.channel.disconnect();
    cmdLog.push({ at: world.clock.now(), who: KIND_LABEL[kind], text: on ? '연결을 다시 이음' : '연결을 끊음', tone: on ? 'info' : 'warn' });
  },
};

function build(): void {
  updateDevices = buildDevices(ui);
  ($('#lose-reply') as HTMLButtonElement).setAttribute('aria-pressed', 'false');
  ($('#speed') as HTMLSelectElement).value = String(world.clock.speed);
}

const nextFrom = (kind: DeviceKind): CommandInput | null => {
  const np = world.device(kind).client.nowPlaying();
  return np ? { type: 'playback.next', fromItemId: np.item.id } : null;
};

const actions: Record<string, () => void> = {
  'web-next': () => {
    const c = nextFrom('web');
    if (c) void ui.run('web', c, '다음 항목');
  },
  burst: () => {
    const seq: [CommandInput, string][] = [
      [{ type: 'volume.set', volume: 20 }, '음량 20'],
      [{ type: 'playback.pause' }, '일시정지'],
      [{ type: 'volume.set', volume: 35 }, '음량 35'],
      [{ type: 'playback.resume' }, '재개'],
      [{ type: 'volume.set', volume: 70 }, '음량 70'],
      [{ type: 'volume.set', volume: 45 }, '음량 45'],
    ];
    seq.forEach(([c, l], i) => setTimeout(() => void ui.run('web', c, l), i * 140));
  },
  'race-next': () => {
    const a = nextFrom('web');
    const b = nextFrom('phone');
    if (a) void ui.run('web', a, '다음 항목(동시)');
    if (b) void ui.run('phone', b, '다음 항목(동시)');
  },
  'race-schedule': () => {
    const w = world.device('web').client.view;
    const p = world.device('phone').client.view;
    if (!w || !p) return;
    void ui.run('web', { type: 'schedule.replace', baseScheduleVersion: w.scheduleVersion, items: [...w.schedule.items].reverse() }, '편성표 저장(순서 뒤집기, 동시)');
    void ui.run(
      'phone',
      {
        type: 'schedule.replace',
        baseScheduleVersion: p.scheduleVersion,
        items: p.schedule.items.map((it, i) => (i === 0 ? { ...it, title: `${it.title} (휴대폰이 고침)` } : it)),
      },
      '편성표 저장(제목 고침, 동시)',
    );
  },
  'race-volume': () => {
    void ui.run('web', { type: 'volume.set', volume: 20 }, '음량 20(동시)');
    void ui.run('phone', { type: 'volume.set', volume: 80 }, '음량 80(동시)');
  },
  notice: () => void ui.run('web', { type: 'override.set', text: '점심시간 안내: 11:30~13:00', durationSec: 20 }, '긴급 공지 20초'),
};
document.querySelectorAll<HTMLButtonElement>('#actions [data-act]').forEach((b) => b.addEventListener('click', () => actions[b.dataset.act!]!()));

$('#lose-reply').addEventListener('click', (e) => {
  world.server.loseNextReply = !world.server.loseNextReply;
  (e.currentTarget as HTMLElement).setAttribute('aria-pressed', String(world.server.loseNextReply));
});
$('#speed').addEventListener('change', (e) => world.clock.setSpeed(Number((e.target as HTMLSelectElement).value)));

function reset(): void {
  world.stop();
  world = new World();
  cmdLog.length = 0;
  since.clear();
  build();
  renderLive(world);
}
$('#reset').addEventListener('click', reset);

// 설명 따라가기
const normalAll = () => {
  for (const k of ['web', 'phone', 'tv', 'pc'] as DeviceKind[]) {
    world.device(k).channel.mode = 'normal';
    world.device(k).channel.connect();
    if (world.device(k).skewMs !== 0) {
      world.device(k).skewMs = 0;
      void world.device(k).client.resync();
    }
  }
  world.clock.setSpeed(1);
  ($('#speed') as HTMLSelectElement).value = '1';
};
let evidence: Awaited<ReturnType<typeof initEvidence>> | null = null;
let offlineTimer: ReturnType<typeof setTimeout> | null = null;
const steps: TourStep[] = [
  {
    title: '무엇을 만든 것인지',
    text: [
      '매장 화면 하나의 상태는 서버가 정합니다. 지금 무엇을 틀고 있는지, 어디까지 틀었는지, 멈췄는지, 음량, 긴급 공지입니다.',
      '운영 웹, 휴대폰, TV, PC 는 서버가 보내는 변경 알림을 번호 순서대로 받아 따라갑니다. 요금은 서버와 같은 Kotlin 코드가 계산합니다.',
    ],
    look: '맨 위 안내와 기기 네 대. 네 대가 같은 항목을 틀고 있습니다.',
    highlight: ['#banner', '#p-devices'],
    enter: () => {
      normalAll();
    },
  },
  {
    title: '누르면 모두에게 간다',
    text: [
      '운영 웹에서 다음 항목을 누릅니다. 운영 웹은 서버 답을 기다리지 않고 먼저 바꿔 보여 주고, 서버가 받아들이면 네 대 모두에게 알립니다.',
      '잠깐 뒤 결과 표의 맨 오른쪽 칸이 모두 일치로 돌아옵니다.',
    ],
    look: '기기 네 대의 재생 항목과 결과 표의 맨 오른쪽 칸.',
    highlight: ['#p-devices', '#p-result'],
    enter: () => {
      normalAll();
      setTimeout(() => actions['web-next']!(), 400);
    },
  },
  {
    title: '알림 순서가 뒤섞이고 중복돼도 같은 상태',
    text: [
      'TV 에는 알림이 순서가 뒤섞여 가고, PC 에는 같은 알림이 두 번씩 갑니다. 운영 웹에서 조작을 여섯 번 연달아 보냅니다.',
      '기기는 번호가 이어질 때만 적용합니다. 앞 번호가 안 왔으면 보관해 두고, 이미 적용한 번호는 버립니다.',
    ],
    look: '오른쪽 아래 처리 기록의 "보관"과 "이미 받아서 버림", 그리고 끝에 모두 일치로 돌아오는 것.',
    highlight: ['#p-faults', '#trace-log', '#p-result'],
    enter: () => {
      normalAll();
      world.device('tv').channel.mode = 'reorder';
      world.device('pc').channel.mode = 'duplicate';
      setTimeout(() => actions.burst!(), 400);
    },
  },
  {
    title: '알림이 빠지면 현재 상태를 다시 받는다',
    text: ['PC 로 가는 알림의 절반을 일부러 빠뜨립니다. 번호가 건너뛰어 오면 PC 는 빠진 것을 알아채고 서버에서 현재 상태 전체를 다시 받아 옵니다.'],
    look: '처리 기록의 "현재 상태를 다시 받음"과 PC 카드의 "상태 받기" 횟수.',
    highlight: ['#trace-log', '[data-testid="dev-pc"]'],
    enter: () => {
      normalAll();
      world.device('pc').channel.mode = 'drop';
      setTimeout(() => actions.burst!(), 400);
    },
  },
  {
    title: '기기 시계가 틀려도 같은 위치',
    text: [
      'TV 시계를 97초 빠르게, PC 시계를 45초 느리게 바꿉니다. 재생 위치는 기기 시계가 아니라 서버가 알려 준 시각으로 계산하므로, 시계가 틀려도 같은 항목의 같은 위치를 틉니다.',
    ],
    look: '결과 표의 "위치 차이(ms)"가 작고 맨 오른쪽 칸이 일치입니다.',
    highlight: ['#fault-table', '#result-table'],
    enter: () => {
      normalAll();
      ui.setSkew('tv', 97_000);
      ui.setSkew('pc', -45_000);
    },
  },
  {
    title: '두 사람이 동시에 누르면',
    text: [
      '운영 웹과 휴대폰이 같은 순간에 "다음"과 편성표 저장을 보냅니다. 서버가 도착한 순서대로 하나씩 처리합니다.',
      '"다음"은 누른 사람이 본 항목이 아직 재생 중일 때만 받습니다. 편성표는 먼저 저장한 쪽이 이깁니다. 늦은 쪽은 거절되고, 먼저 바꿔 보였던 화면은 원래대로 돌아옵니다.',
    ],
    look: '조작 결과 기록에서 한쪽은 "적용됨", 다른 쪽은 stale 또는 conflict 로 거절됩니다.',
    highlight: ['#cmd-log', '#p-result'],
    enter: () => {
      normalAll();
      setTimeout(() => {
        actions['race-next']!();
        actions['race-schedule']!();
      }, 400);
    },
  },
  {
    title: '끊긴 동안 쌓은 재생 기록을 몰아 보내기',
    text: [
      'TV 연결을 끊습니다. 끊긴 동안에도 마지막 편성으로 계속 틀면서 재생 기록을 기기 안에 쌓습니다. 시간은 4배속입니다.',
      '9초 뒤 자동으로 다시 연결하고 쌓인 기록을 한꺼번에 보냅니다. 첫 전송은 서버 답이 사라지게 해 두었습니다. TV 는 못 받은 줄 알고 같은 기록을 다시 보내고, 서버는 일련번호로 중복을 걸러 냅니다.',
    ],
    look: '재생 기록 패널의 "중복으로 걸러낸 기록"이 늘고, TV 의 "기기 안에 쌓인 기록"이 0 으로 돌아오는 것.',
    highlight: ['#p-records', '[data-testid="dev-tv"]'],
    enter: () => {
      normalAll();
      world.clock.setSpeed(4);
      ($('#speed') as HTMLSelectElement).value = '4';
      ui.setConnected('tv', false);
      if (offlineTimer) clearTimeout(offlineTimer);
      offlineTimer = setTimeout(() => {
        world.server.loseNextReply = true;
        ($('#lose-reply') as HTMLElement).setAttribute('aria-pressed', 'true');
        ui.setConnected('tv', true);
      }, 9000);
    },
  },
  {
    title: '재생 기록이 요금이 되는 과정',
    text: [
      '요금은 서버 코드(Kotlin)가 계산하고, 이 페이지에서도 같은 코드가 돕니다. 겹친 시간은 한 번만 세고, 자정을 넘기면 날짜별로 나누고, 시간 구간별 단가로 금액을 냅니다. 금액은 원 단위 정수입니다.',
      '마감한 달의 정산서는 고치지 않습니다. 마감 뒤에 늦게 도착한 기록은 다음 달 정산서에 "조정" 줄로 들어갑니다. 줄을 누르면 그 금액의 근거가 된 날짜와 기록 번호가 나옵니다.',
    ],
    look: '요금 패널 맨 위의 실시간 계산, 그리고 아래 "마감 뒤 늦은 기록" 사례의 11월 정산서와 조정 줄.',
    highlight: ['#p-billing'],
    enter: () => {
      normalAll();
      evidence?.selectBilling('late-record-adjustment', 1);
    },
  },
];
const tour = initTour(steps);
void tour;

let liveTick = 0;
$('#live-close').addEventListener('click', () => {
  closeNovember(world);
  cmdLog.push({ at: world.clock.now(), who: '서버', text: '2026-11 을 마감함', tone: 'info' });
  renderLive(world);
});

build();
setInterval(() => {
  updateDevices();
  renderResult(world, since, ui);
  renderLogs(world, cmdLog);
  renderRecords(world);
  if (++liveTick % 5 === 0) renderLive(world);
  const lr = $('#lose-reply');
  if (world.server.loseNextReply !== (lr.getAttribute('aria-pressed') === 'true')) lr.setAttribute('aria-pressed', String(world.server.loseNextReply));
}, 200);
void initEvidence().then((e) => {
  evidence = e;
  document.body.dataset.ready = 'true';
});
(window as unknown as { __demo: unknown }).__demo = {
  kotlin,
  get world() {
    return world;
  },
};
