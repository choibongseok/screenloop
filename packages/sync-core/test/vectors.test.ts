import { describe, expect, it } from 'vitest';
import { nowPlaying, type Command, type StateEvent } from '../src/index';
import { DeviceAuthority, RecordLedger, classifyRecord } from './fakeServer';
import { readJson, schemaValidator } from './support';

const authority = readJson('spec/vectors/sync-authority.json');
const ingest = readJson('spec/vectors/records-ingest.json');
const validate = schemaValidator();

describe('공유 벡터: 명령 판정과 상태 전이 (Kotlin 서버도 같은 파일을 읽는다)', () => {
  for (const scn of authority.scenarios) {
    it(`${scn.name}: 단계별 결과·이벤트·끝 상태·재생 위치가 벡터와 같다`, () => {
      const dev = new DeviceAuthority(scn.deviceId);
      for (const [i, step] of scn.steps.entries()) {
        const r = dev.submit(step.command as Command, step.nowMs, step.actor);
        const label = `${scn.name} 단계 ${i + 1} ${step.command.type}`;
        expect(r.result, label).toBe(step.expect.result);
        if (step.expect.result === 'accepted') expect(r.event, label).toEqual(step.expect.event);
        else expect(r.reason, label).toBe(step.expect.reason);
      }
      expect(dev.state).toEqual(scn.finalState);
      for (const p of scn.probes) {
        const np = nowPlaying(dev.state, p.atMs);
        expect(np ? np.item.id : null, `재생 위치 ${p.atMs}`).toBe(p.itemId);
        expect(np ? np.offsetInItemMs : null, `항목 안 위치 ${p.atMs}`).toBe(p.offsetInItemMs);
      }
    });
  }

  it('벡터의 모든 이벤트와 끝 상태가 이벤트 스키마(openapi 에서 생성한 JSON Schema)를 통과한다', () => {
    let events = 0;
    for (const scn of authority.scenarios) {
      expect(validate('DeviceState', scn.finalState).errors, `${scn.name} 끝 상태`).toEqual([]);
      for (const step of scn.steps) {
        // invalid-inputs 의 명령은 일부러 스키마를 어긴 값이라 서버가 invalid 로 거절하는 것을 확인하는 용도다
        if (scn.name !== 'invalid-inputs') expect(validate('Command', step.command).errors, `${scn.name} 명령 ${step.command.type}`).toEqual([]);
        if (step.expect.event) {
          events++;
          expect(validate('StateEvent', step.expect.event as StateEvent).errors, `${scn.name} v${step.expect.event.version}`).toEqual([]);
        }
      }
    }
    expect(events).toBeGreaterThan(20);
  });

  it('스키마는 모르는 이벤트 종류와 빠진 필드를 거절한다', () => {
    expect(validate('StateEvent', { type: 'volume.changed', deviceId: 'd', version: 1, serverTimeMs: 1, actor: 'a', volume: 101 }).ok).toBe(false);
    expect(validate('StateEvent', { type: 'volume.exploded', deviceId: 'd', version: 1, serverTimeMs: 1, actor: 'a' }).ok).toBe(false);
    expect(validate('StateEvent', { type: 'override.cleared', deviceId: 'd', version: 1, serverTimeMs: 1 }).ok).toBe(false);
  });
});

describe('공유 벡터: 재생 기록 수집 (멱등·시계 차이·보류)', () => {
  for (const scn of ingest.scenarios) {
    it(`${scn.name}: 배치별 수집 결과와 보류 사유가 벡터와 같다`, () => {
      const ledger = new RecordLedger();
      for (const b of scn.batches) {
        const r = ledger.ingest(scn.deviceId, b.clockOffsetMs, b.records, b.receivedAtMs);
        expect(r).toEqual(b.expect);
        const statuses = b.records.map((rec: never) => {
          const c = classifyRecord(rec, b.clockOffsetMs, b.receivedAtMs);
          return c.status === 'accepted' ? 'accepted' : `quarantined:${c.reason}`;
        });
        expect(statuses).toEqual(b.firstSeenStatuses);
      }
      expect(ledger.rows.length).toBe(scn.storedRows);
    });
  }
});
