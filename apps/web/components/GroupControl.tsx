'use client';
import { useState } from 'react';
import type { Command, Group, GroupCommandResult } from '@screenloop/sync-core';
import { sendGroupCommand } from '@/lib/actions';
import { newCommandId, type CommandInput } from './messages';

const outcomeText = (o: GroupCommandResult['results'][number]['outcome']) =>
  o.result === 'accepted' ? '적용됨' : o.reason === 'unchanged' ? '이미 그 상태' : o.reason === 'stale' ? '그 사이 바뀌어 건너뜀' : '적용 안 됨';

export function GroupControl({ group, names, canOperate }: { group: Group; names: Record<string, string>; canOperate: boolean }) {
  const [result, setResult] = useState<GroupCommandResult | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState('');

  async function run(cmd: CommandInput) {
    setBusy(true); setError('');
    const r = await sendGroupCommand(group.id, { ...cmd, commandId: newCommandId() } as Command);
    setBusy(false);
    if (r.ok) setResult(r.value); else setError(r.status === 403 ? '운영자 권한이 필요합니다.' : r.message);
  }
  const dis = !canOperate || busy;
  return (
    <section className="panel" aria-labelledby={`g-${group.id}`} data-testid={`group-${group.id}`}>
      <h2 id={`g-${group.id}`}>{group.name} <span className="badge mono">{group.deviceIds.length}대</span></h2>
      <div className="row">
        <button className="btn" disabled={dis} onClick={() => run({ type: 'playback.pause' })}>전체 일시정지</button>
        <button className="btn" disabled={dis} onClick={() => run({ type: 'playback.resume' })}>전체 재개</button>
        <button className="btn" disabled={dis} onClick={() => run({ type: 'volume.set', volume: 20 })}>음량 20</button>
        <button className="btn" disabled={dis} onClick={() => run({ type: 'volume.set', volume: 60 })}>음량 60</button>
      </div>
      <form className="row" style={{ marginTop: 10 }} onSubmit={(e) => { e.preventDefault(); void run({ type: 'override.set', text, durationSec: 60 }); }}>
        <input type="text" aria-label={`${group.name} 긴급 공지 문구`} placeholder="묶음 전체에 1분간 띄울 긴급 공지" maxLength={80} style={{ flex: 1, minWidth: 200 }} value={text} disabled={!canOperate} onChange={(e) => setText(e.target.value)} />
        <button className="btn danger" type="submit" disabled={dis || text.trim() === ''}>공지 표시</button>
        <button className="btn" type="button" disabled={dis} onClick={() => run({ type: 'override.clear' })}>공지 해제</button>
      </form>
      {error && <p className="err" role="alert">{error}</p>}
      <div className="scroll" style={{ marginTop: 10 }}>
        <table aria-label={`${group.name} 화면별 결과`}>
          <thead><tr><th>화면</th><th>마지막 조작 결과</th></tr></thead>
          <tbody>
            {group.deviceIds.map((d) => {
              const o = result?.results.find((r) => r.deviceId === d)?.outcome;
              return <tr key={d} data-testid={`group-row-${d}`}><td>{names[d] ?? d} <span className="mono">{d}</span></td><td>{o ? outcomeText(o) : '—'}</td></tr>;
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
