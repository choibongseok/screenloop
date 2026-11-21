// 서버의 도메인 코드(Kotlin Multiplatform)를 JavaScript 로 컴파일한 산출물을 Node 에서 불러, JVM 서버가 통과하는 것과 같은 공유 벡터를 통과시킨다.
// 산출물이 없으면 `bash scripts/build-domain-js.sh` 로 먼저 만든다(make verify 가 한다).
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readJson, root, schemaValidator } from './support';

const modPath = resolve(root, 'build/domain-js/screenloop-domain.mjs');
if (!existsSync(modPath)) throw new Error('build/domain-js/screenloop-domain.mjs 가 없음: bash scripts/build-domain-js.sh 를 먼저 실행해야 함');

interface KServer {
  submit(commandJson: string, actor: string, nowMs: number): string;
  snapshot(nowMs: number): string;
  state(): string;
  eventsAfter(version: number): string;
  nowPlaying(nowMs: number): string;
  ingest(deviceId: string, batchJson: string, receivedAtMs: number): string;
  records(): string;
  invoice(month: string, nowMs: number, close: boolean): string;
  duplicatesTotal(): number;
}
const kotlin = (await import(modPath)) as { engineName(): string; KotlinServer: new (deviceId: string) => KServer; runBillingScenario(json: string): string };

const authority = readJson('spec/vectors/sync-authority.json');
const ingest = readJson('spec/vectors/records-ingest.json');
const billing = readJson('spec/vectors/billing.json');
const validate = schemaValidator();

describe('서버 도메인(Kotlin→JS 산출물): JVM 서버와 같은 공유 벡터', () => {
  it('산출물은 Kotlin/JS 로 컴파일된 모듈이다', () => {
    expect(kotlin.engineName()).toBe('kotlin-js');
    expect(typeof kotlin.KotlinServer).toBe('function');
  });

  for (const scn of authority.scenarios) {
    it(`${scn.name}: Kotlin 산출물이 낸 결과·이벤트·끝 상태·재생 위치가 벡터와 같다`, () => {
      const server = new kotlin.KotlinServer(scn.deviceId);
      for (const [i, step] of scn.steps.entries()) {
        const out = JSON.parse(server.submit(JSON.stringify(step.command), step.actor, step.nowMs));
        const label = `${scn.name} 단계 ${i + 1} ${step.command.type}`;
        expect(out.result, label).toBe(step.expect.result);
        if (step.expect.result === 'accepted') expect(out.event, label).toEqual(step.expect.event);
        else expect(out.reason, label).toBe(step.expect.reason);
      }
      expect(JSON.parse(server.state())).toEqual(scn.finalState);
      for (const p of scn.probes) {
        const np = JSON.parse(server.nowPlaying(p.atMs));
        expect(np ? np.itemId : null, `재생 위치 ${p.atMs}`).toBe(p.itemId);
        expect(np ? np.offsetInItemMs : null, `항목 안 위치 ${p.atMs}`).toBe(p.offsetInItemMs);
      }
    });
  }

  for (const scn of ingest.scenarios) {
    it(`${scn.name}: Kotlin 산출물의 재생 기록 수집 결과가 벡터와 같다`, () => {
      const server = new kotlin.KotlinServer('unused');
      for (const b of scn.batches) {
        const r = JSON.parse(server.ingest(scn.deviceId, JSON.stringify({ clockOffsetMs: b.clockOffsetMs, records: b.records }), b.receivedAtMs));
        expect(r).toEqual(b.expect);
      }
      const rows = JSON.parse(server.records()) as { status: string; reason: string | null }[];
      expect(rows).toHaveLength(scn.storedRows);
      // 처음 보는 (일련번호)의 상태만 차례로 모으면 서버가 저장한 행의 상태와 같다
      const seen = new Set<number>();
      const expected: string[] = [];
      for (const b of scn.batches)
        b.records.forEach((r: { seq: number }, i: number) => {
          if (!seen.has(r.seq)) {
            seen.add(r.seq);
            expected.push(b.firstSeenStatuses[i]);
          }
        });
      expect(rows.map((r) => (r.status === 'accepted' ? 'accepted' : `quarantined:${r.reason}`))).toEqual(expected);
    });
  }

  for (const scn of billing.scenarios) {
    it(`${scn.name}: Kotlin 산출물의 정산 줄·금액·일별 사용량이 손으로 계산한 값과 같다`, () => {
      const steps = JSON.parse(kotlin.runBillingScenario(JSON.stringify(scn))) as {
        totalWon: number;
        lines: { kind: string; quantity: number; unitWon: number | null; amountWon: number; adjustsMonth?: string; basisDays: string[] }[];
        usage: { deviceId: string; day: string; billedSeconds: number; recordIds: number[] }[];
      }[];
      expect(steps).toHaveLength(scn.steps.length);
      scn.steps.forEach(
        (
          exp: {
            expectLines: { kind: string; quantity: number; unitWon: number | null; amountWon: number; adjustsMonth?: string; basisDays?: { deviceId: string; day: string }[] }[];
            expectTotalWon: number;
            expectUsage: { deviceId: string; day: string; billedSeconds: number; recordIds?: number[] }[];
          },
          i: number,
        ) => {
          const got = steps[i]!;
          expect(got.totalWon, `${scn.name} 단계 ${i + 1} 합계`).toBe(exp.expectTotalWon);
          expect(got.lines).toHaveLength(exp.expectLines.length);
          exp.expectLines.forEach((e, j) => {
            const l = got.lines[j]!;
            expect([l.kind, l.quantity, l.unitWon, l.amountWon]).toEqual([e.kind, e.quantity, e.unitWon, e.amountWon]);
            if (e.adjustsMonth) expect(l.adjustsMonth).toBe(e.adjustsMonth);
            if (e.basisDays) expect(l.basisDays).toEqual(e.basisDays.map((b) => `${b.deviceId} ${b.day}`));
          });
          expect(got.usage).toHaveLength(exp.expectUsage.length);
          exp.expectUsage.forEach((e, j) => {
            const u = got.usage[j]!;
            expect([u.deviceId, u.day, u.billedSeconds]).toEqual([e.deviceId, e.day, e.billedSeconds]);
            if (e.recordIds) expect(u.recordIds).toEqual(e.recordIds);
          });
        },
      );
    });
  }

  it('Kotlin 산출물이 낸 이벤트·상태·응답이 이벤트 스키마를 통과하고, 같은 commandId 는 처음 결과를 돌려준다', () => {
    const scn = authority.scenarios[0];
    const server = new kotlin.KotlinServer(scn.deviceId);
    for (const step of scn.steps) {
      const out = JSON.parse(server.submit(JSON.stringify(step.command), step.actor, step.nowMs));
      expect(validate('CommandResult', out).errors).toEqual([]);
      if (out.event) expect(validate('StateEvent', out.event).errors).toEqual([]);
    }
    expect(validate('DeviceState', JSON.parse(server.state())).errors).toEqual([]);
    const snap = JSON.parse(server.snapshot(scn.steps.at(-1).nowMs));
    expect(validate('Snapshot', snap).errors).toEqual([]);
    const again = JSON.parse(server.submit(JSON.stringify(scn.steps[0].command), 'someone-else', scn.steps[0].nowMs + 999));
    expect(again.replayed).toBe(true);
    expect(server.eventsAfter(0)).toContain('schedule.replaced');
  });

  it('잘못된 요청(commandId 없음, 모르는 종류)은 빈 응답으로 알린다', () => {
    const server = new kotlin.KotlinServer('d');
    expect(server.submit('{"type":"volume.set","volume":3}', 'op', 1)).toBe('');
    expect(server.submit('{"commandId":"x","type":"volume.explode"}', 'op', 1)).toBe('');
    expect(server.submit('{깨짐', 'op', 1)).toBe('');
  });
});
