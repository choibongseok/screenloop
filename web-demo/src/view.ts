import { nowPlaying, type Command } from '@screenloop/sync-core';
import { sceneDataUri } from '@screenloop/scenes';
import { $, el, hms, setAttr, setText } from './dom';
import { KIND_LABEL, RECV_LABEL, World, type DeviceKind, type LogLine, type RecvMode, type SimDevice } from './sim';

export type CommandInput = Command extends infer C ? (C extends unknown ? Omit<C, 'commandId'> : never) : never;

export const KINDS: DeviceKind[] = ['web', 'phone', 'tv', 'pc'];
const SKEWS: [string, number][] = [
  ['정상', 0],
  ['+97초 빠름', 97_000],
  ['−45초 느림', -45_000],
];

export interface Ui {
  world: World;
  cmdLog: LogLine[];
  run(kind: DeviceKind, cmd: CommandInput, label: string): Promise<void>;
  setRecv(kind: DeviceKind, mode: RecvMode): void;
  setSkew(kind: DeviceKind, ms: number): void;
  setConnected(kind: DeviceKind, on: boolean): void;
}

/** 기기 카드와 고장 설정 표를 한 번 만들고, 갱신 함수를 돌려준다 */
export function buildDevices(ui: Ui): () => void {
  const root = $('#devices');
  root.replaceChildren();
  const updaters: (() => void)[] = [];
  for (const kind of KINDS) {
    const dev = ui.world.device(kind);
    const head = el(
      'div',
      { class: 'dev-head' },
      el('strong', { text: KIND_LABEL[kind] }),
      el('span', { class: 'badge conn', 'data-testid': `conn-${kind}` }),
      el('span', { class: 'badge skew', 'data-testid': `skew-${kind}` }),
    );
    const img = el('img', { alt: '', width: 160, height: 90 });
    const title = el('div', { class: 'title' });
    const prog = el('div', { class: 'prog' });
    const notice = el('div', { class: 'notice', role: 'alert', 'data-testid': `notice-${kind}` });
    const pause = el('div', { class: 'pause' }, '❚❚ 일시정지');
    const off = el('div', { class: 'off' }, '연결 끊김');
    const screen = el('div', { class: 'screen', 'data-testid': `screen-${kind}` }, img, title, prog, pause, off, notice);
    const foot = el('div', { class: 'dev-foot', 'data-testid': `foot-${kind}` });
    const card = el('article', { class: `dev ${kind}`, 'data-testid': `dev-${kind}` }, head, screen);
    let pauseBtn: HTMLButtonElement | null = null;
    if (kind === 'web' || kind === 'phone') {
      const b = (text: string, id: string) => el('button', { type: 'button', text, 'data-testid': `${kind}-${id}` });
      const btn = (text: string, id: string, fn: () => void) => {
        const x = b(text, id);
        x.addEventListener('click', fn);
        return x;
      };
      const ctl = el('div', { class: 'ctl' });
      const cur = () => nowPlaying(dev.client.view!, dev.client.serverNow());
      ctl.append(
        btn('다음 항목', 'next', () => {
          const np = dev.client.nowPlaying();
          if (np) void ui.run(kind, { type: 'playback.next', fromItemId: np.item.id }, '다음 항목');
        }),
        (pauseBtn = btn(
          '일시정지',
          'pause',
          () =>
            void ui.run(kind, dev.client.view?.playback.paused ? { type: 'playback.resume' } : { type: 'playback.pause' }, dev.client.view?.playback.paused ? '재개' : '일시정지'),
        )),
        btn('음량 −', 'vol-down', () => void ui.run(kind, { type: 'volume.set', volume: Math.max(0, (dev.client.view?.volume ?? 50) - 10) }, '음량 −')),
        btn('음량 +', 'vol-up', () => void ui.run(kind, { type: 'volume.set', volume: Math.min(100, (dev.client.view?.volume ?? 50) + 10) }, '음량 +')),
      );
      void cur;
      if (kind === 'web') {
        ctl.append(
          btn('긴급 공지', 'notice', () => void ui.run(kind, { type: 'override.set', text: '점심시간 안내: 11:30~13:00', durationSec: 20 }, '긴급 공지 20초')),
          btn('공지 해제', 'notice-clear', () => void ui.run(kind, { type: 'override.clear' }, '공지 해제')),
        );
      }
      card.append(ctl);
    }
    card.append(foot);
    root.append(card);

    let lastScene = '';
    updaters.push(() => {
      const view = dev.client.view;
      const np = dev.client.nowPlaying();
      const online = dev.channel.connected && dev.client.connection === 'online';
      const conn = $('.conn', head);
      setText(conn, online ? '연결됨' : dev.channel.connected ? '연결 중' : '끊김');
      setAttr(conn, 'class', `badge conn ${online ? 'ok' : 'bad'}`);
      setText($('.skew', head), dev.skewMs === 0 ? '시계 정상' : `시계 ${dev.skewMs > 0 ? '+' : '−'}${Math.abs(dev.skewMs / 1000)}초`);
      setAttr($('.skew', head), 'class', `badge skew ${dev.skewMs === 0 ? '' : 'warn'}`);
      const scene = np ? np.item.sceneId : '';
      if (scene !== lastScene) {
        lastScene = scene;
        if (scene) img.src = sceneDataUri(scene);
        else img.removeAttribute('src');
      }
      setText(title, np ? np.item.title : view ? '편성된 항목 없음' : '불러오는 중…');
      prog.style.width = np ? `${Math.round((np.offsetInItemMs / (np.item.durationSec * 1000)) * 100)}%` : '0%';
      const ov = view?.override && dev.client.overrideActive() ? view.override.text : '';
      setText(notice, ov);
      notice.hidden = !ov;
      pause.hidden = !view?.playback.paused;
      off.hidden = online;
      if (pauseBtn) {
        setText(pauseBtn, view?.playback.paused ? '재개' : '일시정지');
        pauseBtn.disabled = !online;
      }
      for (const b of card.querySelectorAll<HTMLButtonElement>('.ctl button')) if (b !== pauseBtn) b.disabled = !online;
      const st = dev.client.replicaStats;
      setText(foot, `v${dev.client.confirmed?.version ?? '–'} · 적용 ${st.applied} · 중복 버림 ${st.duplicates} · 보관 ${st.buffered} · 스냅샷 ${dev.client.stats.snapshots}`);
    });
  }

  // 고장 설정 표
  const tbody = $('#fault-table tbody');
  tbody.replaceChildren();
  for (const kind of KINDS) {
    const dev = ui.world.device(kind);
    const connBtn = el('button', { type: 'button', class: 'ghost2', 'aria-pressed': 'false', 'data-testid': `cut-${kind}` });
    connBtn.addEventListener('click', () => ui.setConnected(kind, !dev.channel.connected));
    const recv = el('select', { 'aria-label': `${KIND_LABEL[kind]}가 받는 이벤트`, 'data-testid': `recv-${kind}` });
    for (const m of Object.keys(RECV_LABEL) as RecvMode[]) recv.append(el('option', { value: m, text: RECV_LABEL[m] }));
    recv.addEventListener('change', () => ui.setRecv(kind, recv.value as RecvMode));
    const skew = el('select', { 'aria-label': `${KIND_LABEL[kind]} 시계`, 'data-testid': `clock-${kind}` });
    for (const [label, ms] of SKEWS) skew.append(el('option', { value: ms, text: label }));
    skew.addEventListener('change', () => ui.setSkew(kind, Number(skew.value)));
    tbody.append(el('tr', {}, el('th', { scope: 'row', text: KIND_LABEL[kind] }), el('td', {}, connBtn), el('td', {}, recv), el('td', {}, skew)));
    updaters.push(() => {
      const on = dev.channel.connected;
      setText(connBtn, on ? '연결 끊기' : '다시 잇기');
      setAttr(connBtn, 'aria-pressed', on ? 'false' : 'true');
      if (recv.value !== dev.channel.mode) recv.value = dev.channel.mode;
      if (Number(skew.value) !== dev.skewMs) skew.value = String(dev.skewMs);
    });
  }
  return () => updaters.forEach((u) => u());
}

export interface Row {
  dev: SimDevice;
  online: boolean;
  version: number | null;
  item: string;
  posDiff: number | null;
  paused: boolean | null;
  volume: number | null;
  notice: string;
  status: 'same' | 'syncing' | 'offline' | 'diverged';
  reasons: string[];
}

const circ = (a: number, b: number, len: number) => {
  const d = Math.abs(a - b) % len;
  return Math.min(d, len - d);
};

/** 서버의 지금 상태와 기기 네 대를 같은 시각에 견준다 */
export function compare(world: World, since: Map<string, number>): { rows: Row[]; serverVersion: number; maxDiff: number } {
  const t = world.clock.now();
  const S = world.server.auth.state;
  const sNp = nowPlaying(S, t);
  const sNotice = S.override && (S.override.untilMs === null || t < S.override.untilMs) ? S.override.text : '';
  let maxDiff = 0;
  const rows = world.devices.map((dev): Row => {
    const c = dev.client;
    const conf = c.confirmed;
    const np = c.nowPlaying();
    const online = dev.channel.connected && c.connection === 'online';
    const posDiff = np && sNp ? circ(np.loopPositionMs, sNp.loopPositionMs, sNp.loopLengthMs) : null;
    const notice = conf?.override && c.overrideActive() ? conf.override.text : '';
    const reasons: string[] = [];
    if (!conf || conf.version !== S.version) reasons.push(`버전 ${conf?.version ?? '–'} (서버 ${S.version})`);
    if ((np?.item.id ?? '') !== (sNp?.item.id ?? '')) reasons.push('재생 항목이 다름');
    if (conf && conf.playback.paused !== S.playback.paused) reasons.push('일시정지 상태가 다름');
    if (conf && conf.volume !== S.volume) reasons.push('음량이 다름');
    if (notice !== sNotice) reasons.push('공지가 다름');
    if (posDiff !== null && !S.playback.paused && posDiff > 300) reasons.push(`위치 차이 ${posDiff}ms`);
    let status: Row['status'] = online ? 'same' : 'offline';
    if (reasons.length > 0) {
      if (online) {
        const first = since.get(dev.kind) ?? t;
        since.set(dev.kind, first);
        status = t - first > 6000 ? 'diverged' : 'syncing';
      }
    } else since.delete(dev.kind);
    if (online && posDiff !== null) maxDiff = Math.max(maxDiff, posDiff);
    return {
      dev,
      online,
      version: conf?.version ?? null,
      item: np?.item.title ?? '—',
      posDiff,
      paused: conf?.playback.paused ?? null,
      volume: conf?.volume ?? null,
      notice,
      status,
      reasons,
    };
  });
  return { rows, serverVersion: S.version, maxDiff };
}

const STATUS_TEXT: Record<Row['status'], string> = { same: '일치', syncing: '맞추는 중', offline: '끊김', diverged: '어긋남' };

export function renderResult(world: World, since: Map<string, number>, ui: Ui): void {
  const { rows, serverVersion, maxDiff } = compare(world, since);
  const tbody = $('#result-table tbody');
  if (tbody.children.length !== rows.length) {
    tbody.replaceChildren(...rows.map(() => el('tr', {}, ...Array.from({ length: 9 }, () => el('td')))));
  }
  rows.forEach((r, i) => {
    const tr = tbody.children[i] as HTMLTableRowElement;
    const cells = [
      KIND_LABEL[r.dev.kind],
      r.online ? '연결됨' : '끊김',
      r.version === null ? '–' : String(r.version),
      r.item,
      r.posDiff === null ? '–' : String(r.posDiff),
      r.paused === null ? '–' : r.paused ? '일시정지' : '재생 중',
      r.volume === null ? '–' : String(r.volume),
      r.notice || '—',
      STATUS_TEXT[r.status],
    ];
    cells.forEach((c, j) => {
      const td = tr.children[j] as HTMLElement;
      setText(td, c);
      setAttr(
        td,
        'class',
        j === 2 || j === 4 || j === 6 ? 'num' : j === 8 ? (r.status === 'same' ? 'good' : r.status === 'syncing' ? 'syncing' : r.status === 'offline' ? 'off' : 'bad') : null,
      );
      if (j === 8) {
        td.setAttribute('data-testid', `verdict-${r.dev.kind}`);
        td.title = r.reasons.join(', ');
      }
    });
  });
  const live = rows.filter((r) => r.online);
  const same = live.filter((r) => r.status === 'same').length;
  const offline = rows.length - live.length;
  const bad = rows.some((r) => r.status === 'diverged');
  const syncing = rows.some((r) => r.status === 'syncing');
  let title: string;
  let easy: string;
  let ok: string;
  if (bad) {
    title = '어긋난 기기가 있습니다';
    ok = 'false';
    easy = rows
      .filter((r) => r.status === 'diverged')
      .map((r) => `${KIND_LABEL[r.dev.kind]}: ${r.reasons.join(', ')}`)
      .join(' / ');
  } else if (syncing) {
    title = '맞추는 중입니다';
    ok = 'warn';
    easy = '이벤트가 도착하거나 스냅샷을 받는 동안에는 잠깐 어긋나 보일 수 있습니다.';
  } else if (offline > 0) {
    title = `연결된 ${live.length}대는 서버와 같은 상태입니다`;
    ok = 'warn';
    easy = `끊긴 ${offline}대는 마지막 상태로 계속 재생하고, 다시 연결되면 스냅샷으로 맞춥니다. 서버 버전 ${serverVersion}.`;
  } else {
    title = `${live.length}대 모두 서버와 같은 상태입니다`;
    ok = 'true';
    easy = `서버 버전 ${serverVersion}. 재생 항목이 모두 같고, 재생 위치 차이는 최대 ${maxDiff}ms 입니다.`;
  }
  setText($('#verdict-title'), title);
  setText($('#verdict-easy'), easy);
  setAttr($('#p-result'), 'data-ok', ok);
  void same;
  void ui;
}

export function renderLogs(world: World, cmdLog: LogLine[]): void {
  const fill = (ol: HTMLElement, lines: LogLine[], key: string) => {
    if (ol.dataset.key === key) return;
    ol.dataset.key = key;
    ol.replaceChildren(...lines.map((l) => el('li', { 'data-tone': l.tone, text: `${hms(l.at)} ${l.who}: ${l.text}` })));
    ol.scrollTop = ol.scrollHeight;
  };
  const cmds = cmdLog.slice(-14);
  fill($('#cmd-log'), cmds, `${cmdLog.length}`);
  const traces = world.devices
    .flatMap((d) => d.trace.map((t) => ({ ...t })))
    .sort((a, b) => a.at - b.at)
    .filter((t) => !/처음 스냅샷|시계 차이/.test(t.text))
    .slice(-14);
  fill($('#trace-log'), traces, traces.map((t) => `${t.at}${t.who}${t.text}`).join('|'));
}

export function renderRecords(world: World): void {
  const players = world.devices.filter((d) => d.engine);
  const rows = world.server.ledger.rows;
  const acc = rows.filter((r) => r.status === 'accepted').length;
  const quar = rows.length - acc;
  const stats = $('#rec-stats');
  if (stats.children.length === 0) {
    stats.append(
      ...['collected:서버가 받은 재생 기록:ok', 'dups:중복으로 걸러낸 기록:warn', 'quar:시각이 이상해 보류한 기록:warn'].map((s) => {
        const [id, k, tone] = s.split(':');
        return el('div', { class: `stat ${tone}`, 'data-testid': `stat-${id}` }, el('div', { class: 'k', text: k }), el('div', { class: 'v', text: '0' }));
      }),
    );
  }
  setText($('.v', stats.children[0] as HTMLElement), String(acc));
  setText($('.v', stats.children[1] as HTMLElement), String(world.server.duplicatesFiltered));
  setText($('.v', stats.children[2] as HTMLElement), String(quar));
  const tbody = $('#rec-table tbody');
  if (tbody.children.length !== players.length) tbody.replaceChildren(...players.map(() => el('tr', {}, ...Array.from({ length: 6 }, () => el('td')))));
  players.forEach((d, i) => {
    const e = d.engine!;
    const cells = [
      KIND_LABEL[d.kind],
      String(e.queue.size),
      String(e.stats.lastAckSeq),
      String(e.stats.flushes),
      String(e.stats.flushFailures),
      String(e.stats.duplicatesReported),
    ];
    cells.forEach((c, j) => {
      const td = (tbody.children[i] as HTMLElement).children[j] as HTMLElement;
      setText(td, c);
      setAttr(td, 'class', j > 0 ? 'num' : null);
      td.setAttribute('data-testid', `rec-${d.kind}-${j}`);
    });
  });
}
