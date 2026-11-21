# 명세와 코드를 묶는 방법

`spec/openapi.yaml` 이 기준이다.

| 산출물 | 만드는 방법 | 어긋나면 |
|---|---|---|
| `spec/events.schema.json` | OpenAPI `components.schemas` 에서 이벤트·상태·명령 스키마를 옮김 | `scripts/spec-export.mjs --check` 실패 |
| `packages/sync-core/src/generated/openapi.ts` | `openapi-typescript` 로 TS 타입 생성. 웹·플레이어·sync-core 가 이 타입을 그대로 씀 | `--check` 실패, 타입 불일치는 `tsc` 실패 |
| 서버 응답 | `ContractIT` 가 모든 작업을 호출해 응답을 명세 스키마로 검사. 명세에 있는데 호출하지 않은 작업이 있어도 실패 | 계약 테스트 실패 |
| 판정·기록·정산 규칙 | `spec/vectors/*.json` 을 TypeScript(vitest)와 Kotlin(JUnit)이 각자 읽어 같은 결과를 내야 함 | 어느 한쪽 테스트 실패 |

## 일부러 깨뜨려 본 결과
`scripts/spec-drift.mjs` 가 파일을 잠깐 고쳐서 검사를 돌리고 원래대로 돌려놓는다. 출력은 `docs/evidence/spec-drift.json` 에 저장되고 데모 사이트에 실린다.

1. 명세만 바꿈: `Snapshot.serverTimeMs` → `serverClockMs`. 생성물 검사가 "openapi.yaml 과 다름"으로 실패하고, 계약 테스트는 응답에 `serverClockMs` 가 없고 `serverTimeMs` 가 스키마에 없다고 실패한다.
2. 코드만 바꿈: 서버 응답 필드 `serverTimeMs` → `serverClock`. 계약 테스트가 응답이 명세(Snapshot)와 다르다고 실패한다.
