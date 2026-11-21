# 테스트 케이스

모든 행은 실제 테스트 하나와 1:1 이고, `make verify` 가 실행 결과와 대조한다(행 수, 통과 여부, 종류, 요약 표). 아래 표는 TypeScript(vitest)·Kotlin(JUnit)·Playwright 의 실행 결과 파일에서 얻은 테스트 이름을 그대로 쓴다.

## 요약

| 종류 | 개수 |
|---|---|
| unit (단위) | 67 |
| integration (실제 PostgreSQL·Redis 포함, 계약 테스트 포함) | 16 |
| e2e (compose 전체 + 브라우저, 데모 사이트 브라우저 시험 포함) | 26 |
| **합계** | **109** |

실행 명령: `make test`(단위·계약·통합), `make e2e`, `make verify`(전부). 영역 접두사: SYNC(동기화 핵심 TypeScript), SRV(서버 Kotlin), WEB(웹 헬퍼), FLOW(운영 웹·플레이어·배포 e2e), DEMO(데모 사이트).

## 동기화 핵심(`packages/sync-core`)과 공유 벡터

| ID | 영역 | 시나리오 | 입력/조건 | 기대 결과 | 자동화 테스트(파일::함수) | 종류(unit/integration/e2e) |
|---|---|---|---|---|---|---|
| SYNC-001 | 클라이언트 | 기기 시계 90초 차이 | 시계가 90초 빠른 클라이언트 | 서버 시각으로 보정해 같은 항목·위치 | `packages/sync-core/test/client.test.ts::DeviceClient: 스냅샷·스트림·따라잡기·낙관적 갱신 기기 시계가 90초 빨라도 서버 시각으로 보정해 같은 항목을 가리킨다` | unit |
| SYNC-002 | 클라이언트 | 시계가 바뀐 뒤 재보정 | 시계가 갑자기 45초 빨라짐 후 resync | 오프셋 다시 계산 | `packages/sync-core/test/client.test.ts::DeviceClient: 스냅샷·스트림·따라잡기·낙관적 갱신 기기 시계가 바뀐 뒤 resync 하면 시계 차이를 다시 재서 보정한다` | unit |
| SYNC-003 | 클라이언트 | 끊김과 재접속 | 스트림 끊김, 그 사이 변경 | 마지막 상태 유지, 재접속 시 스냅샷으로 따라잡음 | `packages/sync-core/test/client.test.ts::DeviceClient: 스냅샷·스트림·따라잡기·낙관적 갱신 끊기면 마지막 상태를 유지하고, 다시 붙으면 스냅샷으로 따라잡는다` | unit |
| SYNC-004 | 클라이언트 | 마지막 이벤트 유실 | 마지막 이벤트가 안 오고 하트비트가 최신 버전을 알림 | 뒤처진 것을 알아채고 스냅샷으로 따라잡음 | `packages/sync-core/test/client.test.ts::DeviceClient: 스냅샷·스트림·따라잡기·낙관적 갱신 마지막 이벤트가 유실돼 빠진 구간이 안 보여도, 하트비트가 알려 준 서버 버전으로 뒤처진 것을 알아채고 따라잡는다` | unit |
| SYNC-005 | 클라이언트 | 시작과 스트림 | 스냅샷 후 스트림 이벤트 | 상태가 이벤트를 따라감 | `packages/sync-core/test/client.test.ts::DeviceClient: 스냅샷·스트림·따라잡기·낙관적 갱신 스냅샷으로 시작하고 스트림 이벤트로 상태를 따라간다` | unit |
| SYNC-006 | 클라이언트 | 중복 시작 | start-stop-start 연속 호출 | 스트림은 하나만 열림 | `packages/sync-core/test/client.test.ts::DeviceClient: 스냅샷·스트림·따라잡기·낙관적 갱신 시작-중지-시작을 빠르게 반복해도 스트림은 하나만 열린다 (개발 모드의 이중 마운트)` | unit |
| SYNC-007 | 클라이언트 | 이벤트 누락 | 중간 이벤트 유실, 마지막만 도착 | 잠시 뒤 스냅샷 재요청으로 따라잡음 | `packages/sync-core/test/client.test.ts::DeviceClient: 스냅샷·스트림·따라잡기·낙관적 갱신 이벤트가 빠지면 잠시 뒤 스냅샷을 다시 받아 따라잡는다` | unit |
| SYNC-008 | 클라이언트 | 낙관적 갱신 | 서버에는 이미 반영된 조작을 한 번 더 보냄 | 먼저 보였다가 서버 거절(unchanged) 시 걷어냄 | `packages/sync-core/test/client.test.ts::DeviceClient: 스냅샷·스트림·따라잡기·낙관적 갱신 조작은 서버 답 전에 지역 판정으로 먼저 보이고, 서버가 거절하면 걷어낸다` | unit |
| SYNC-009 | 시계 보정 | 시계 점프 | 시계가 갑자기 바뀐 뒤의 표본 | 옛 표본을 버리고 새 값을 따름 | `packages/sync-core/test/clock.test.ts::기기 시계 차이 보정 기기 시계가 갑자기 바뀌면 옛 표본을 버리고 새 표본을 따른다` | unit |
| SYNC-010 | 시계 보정 | 두 기기 보정 | 시계 +90초, −45초 기기 | 같은 항목·같은 위치, 보정 없으면 다름 | `packages/sync-core/test/clock.test.ts::기기 시계 차이 보정 시계가 전혀 다른 두 기기도 보정하면 같은 항목·같은 위치를 가리킨다` | unit |
| SYNC-011 | 시계 보정 | 최소 왕복 표본 | 왕복 900ms / 50ms / 400ms 표본 | 왕복이 가장 짧은 표본을 사용 | `packages/sync-core/test/clock.test.ts::기기 시계 차이 보정 왕복이 가장 짧은 표본을 쓴다 (느린 왕복은 오차가 커서 버린다)` | unit |
| SYNC-012 | 시계 보정 | 대칭 왕복 | 시계 +37초, 왕복 80ms | 오프셋 오차 1ms 이내 | `packages/sync-core/test/clock.test.ts::기기 시계 차이 보정 왕복이 대칭이면 오프셋 오차가 1ms 이내다 (기기 시계가 37초 빠른 경우)` | unit |
| SYNC-013 | 플레이어 엔진 | 시계 틀린 기기의 기록 | 시계 90초 빠른 기기 | 오프셋과 함께 보내 서버 시각으로 정확히 저장 | `packages/sync-core/test/engine.test.ts::PlayerEngine: 재생 기록 만들기·보내기 기기 시계가 90초 빨라도 오프셋을 같이 보내 서버 시각으로 맞춘 기록이 정확하다` | unit |
| SYNC-014 | 플레이어 엔진 | 오프라인 재생 기록 | 1분 오프라인 후 재접속 | 기록 적립, 재접속 후 한꺼번에 전송 | `packages/sync-core/test/engine.test.ts::PlayerEngine: 재생 기록 만들기·보내기 끊긴 동안에도 마지막 편성으로 계속 재생하며 기록을 쌓고, 다시 붙으면 한꺼번에 보낸다` | unit |
| SYNC-015 | 플레이어 엔진 | 응답 유실과 재전송 | 서버는 받았으나 응답 유실 | 재전송은 중복으로 걸러짐, ack 로 대기열 비움 | `packages/sync-core/test/engine.test.ts::PlayerEngine: 재생 기록 만들기·보내기 응답이 유실돼 같은 기록을 다시 보내도 서버에는 한 번만 쌓이고, 받았다는 번호로 대기열을 비운다` | unit |
| SYNC-016 | 플레이어 엔진 | 기록하지 않는 구간 | 일시정지 중, 긴급 공지가 덮는 중 | 새 기록 없음 | `packages/sync-core/test/engine.test.ts::PlayerEngine: 재생 기록 만들기·보내기 일시정지 중과 긴급 공지가 덮는 동안은 재생 기록을 쌓지 않는다` | unit |
| SYNC-017 | 플레이어 엔진 | 기록 경계 | 65초 재생(8·12·… 항목) | 틈 없이 이어지고 길이가 항목 길이와 정확히 같음 | `packages/sync-core/test/engine.test.ts::PlayerEngine: 재생 기록 만들기·보내기 항목이 바뀐 시각을 경계로 빠짐없이 이어지는 재생 기록을 만든다` | unit |
| SYNC-018 | 재생 기록 | PlayTracker 기본 | 항목 변경, 중지, 재시작 | 지나간 항목마다 기록 한 건 | `packages/sync-core/test/records.test.ts::재생 기록 대기열과 중복 방지 PlayTracker 는 항목이 바뀔 때마다 지나간 항목의 기록을 낸다` | unit |
| SYNC-019 | 재생 기록 | 관측 지연 보정 | 항목이 10초에 바뀌었는데 10.4초에 관측 | 10초 경계로 끊음 | `packages/sync-core/test/records.test.ts::재생 기록 대기열과 중복 방지 관측이 늦어도 항목이 실제로 바뀐 시각(boundary)으로 끊는다` | unit |
| SYNC-020 | 재생 기록 | 대기열 영속 | 새로고침, ack 전후 | 일련번호 이어짐, ack 까지만 삭제 | `packages/sync-core/test/records.test.ts::재생 기록 대기열과 중복 방지 새로고침해도 일련번호가 이어지고, 받았다는 알림(ackSeq) 전에는 지우지 않는다` | unit |
| SYNC-021 | 재생 기록 | 재전송 멱등 | 같은 배치를 두 번 전송 | 서버에 한 번만 쌓임 | `packages/sync-core/test/records.test.ts::재생 기록 대기열과 중복 방지 응답을 못 받아 같은 배치를 다시 보내도 서버에는 한 번만 쌓인다` | unit |
| SYNC-022 | 재생 기록 | 단일 항목 반복 | 한 항목만 계속 재생 | maxSegmentMs 마다 기록 | `packages/sync-core/test/records.test.ts::재생 기록 대기열과 중복 방지 한 항목만 계속 돌아도 maxSegmentMs 마다 기록을 낸다` | unit |
| SYNC-023 | Replica | 오래된 스냅샷 | 현재보다 낮은 버전의 스냅샷 | 무시 | `packages/sync-core/test/replica.test.ts::Replica: 순서가 뒤바뀌거나 중복·누락된 이벤트 더 오래된 스냅샷은 무시한다` | unit |
| SYNC-024 | Replica | 속성: commandId 멱등 | 같은 commandId 를 두 번씩 제출(무작위 명령열) | 이벤트 로그가 한 번 제출한 것과 같음 | `packages/sync-core/test/replica.test.ts::Replica: 순서가 뒤바뀌거나 중복·누락된 이벤트 속성: 서버 쪽 명령이 같은 commandId 로 여러 번 와도 이벤트는 한 번만 생긴다` | unit |
| SYNC-025 | Replica | 속성: 순서·중복 | 무작위 명령열의 이벤트를 무작위 순서·중복으로 전달 | 끝 상태가 서버와 같음 | `packages/sync-core/test/replica.test.ts::Replica: 순서가 뒤바뀌거나 중복·누락된 이벤트 속성: 이벤트가 어떤 순서·중복으로 와도(빠짐 없음) 끝 상태가 서버와 같다` | unit |
| SYNC-026 | Replica | 속성: 누락 | 일부를 빼고 무작위 순서로 전달 후 스냅샷 | 끝 상태가 서버와 같음 | `packages/sync-core/test/replica.test.ts::Replica: 순서가 뒤바뀌거나 중복·누락된 이벤트 속성: 일부가 빠져도 스냅샷을 받으면 끝 상태가 서버와 같다` | unit |
| SYNC-027 | Replica | 순서 뒤바뀜 | v4, v3, v1, v2 순으로 도착 | 보관 후 순서대로 적용 | `packages/sync-core/test/replica.test.ts::Replica: 순서가 뒤바뀌거나 중복·누락된 이벤트 앞 버전이 늦게 와도 보관했다가 이어서 적용한다 (순서 뒤바뀜)` | unit |
| SYNC-028 | Replica | 중복 | 이미 적용했거나 보관 중인 버전 재도착 | 버리고 중복으로 센다 | `packages/sync-core/test/replica.test.ts::Replica: 순서가 뒤바뀌거나 중복·누락된 이벤트 이미 적용한 버전과 보관 중인 버전이 또 오면 버린다 (중복)` | unit |
| SYNC-029 | Replica | 누락 | 중간 버전 빠짐 후 스냅샷 | hasGap 켜짐, 스냅샷 후 보관분 이어 적용 | `packages/sync-core/test/replica.test.ts::Replica: 순서가 뒤바뀌거나 중복·누락된 이벤트 중간이 빠지면 hasGap 이 켜지고, 스냅샷을 받으면 따라잡아 보관분까지 이어 적용한다 (누락)` | unit |
| SYNC-030 | 스트림 | 메시지 처리 | state 이벤트, 깨진 JSON | 정상은 전달, 깨진 것은 버림 | `packages/sync-core/test/sse.test.ts::openEventStream: 이벤트 스트림과 하트비트 감시 state 메시지는 이벤트로 넘기고, 깨진 메시지는 버린다` | unit |
| SYNC-031 | 스트림 | 브라우저 오류 | onerror 두 번 | 한 번만 onError, 닫힘 | `packages/sync-core/test/sse.test.ts::openEventStream: 이벤트 스트림과 하트비트 감시 브라우저가 오류를 알리면 즉시 닫고 onError 를 한 번만 부른다` | unit |
| SYNC-032 | 스트림 | 직접 닫기 | close 후 60초 | 오류 없음 | `packages/sync-core/test/sse.test.ts::openEventStream: 이벤트 스트림과 하트비트 감시 직접 닫으면 감시 타이머도 멈춰 오류를 부르지 않는다` | unit |
| SYNC-033 | 스트림 | 하트비트 감시 | 하트비트 유지 / 15초 무소식 | 유지 / 끊긴 것으로 보고 닫음 | `packages/sync-core/test/sse.test.ts::openEventStream: 이벤트 스트림과 하트비트 감시 하트비트가 오는 동안은 유지하고, 15초 동안 아무것도 안 오면 끊긴 것으로 보고 닫는다` | unit |
| SYNC-034 | 스트림 | 하트비트 버전 | v=12, hb, v=13 | 12, 13 만 전달 | `packages/sync-core/test/sse.test.ts::openEventStream: 이벤트 스트림과 하트비트 감시 하트비트의 서버 버전을 알려 주고, 형식이 다른 하트비트는 무시한다` | unit |
| SYNC-035 | 공유 벡터(판정) | basic-playback | 다음·일시정지·재개·이동·음량, 같은 상태 반복, stale | 단계별 결과·이벤트·끝 상태·재생 위치가 벡터와 같음 | `packages/sync-core/test/vectors.test.ts::공유 벡터: 명령 판정과 상태 전이 (Kotlin 서버도 같은 파일을 읽는다) basic-playback: 단계별 결과·이벤트·끝 상태·재생 위치가 벡터와 같다` | unit |
| SYNC-036 | 공유 벡터(판정) | concurrent-operators | 두 운영자 동시 조작 | 다음은 늦은 쪽 stale, 편성표 conflict, 음량·공지는 마지막 도착 | `packages/sync-core/test/vectors.test.ts::공유 벡터: 명령 판정과 상태 전이 (Kotlin 서버도 같은 파일을 읽는다) concurrent-operators: 단계별 결과·이벤트·끝 상태·재생 위치가 벡터와 같다` | unit |
| SYNC-037 | 공유 벡터(판정) | empty-schedule | 빈 편성표에서 조작 | invalid, 일시정지는 위치 0 | `packages/sync-core/test/vectors.test.ts::공유 벡터: 명령 판정과 상태 전이 (Kotlin 서버도 같은 파일을 읽는다) empty-schedule: 단계별 결과·이벤트·끝 상태·재생 위치가 벡터와 같다` | unit |
| SYNC-038 | 공유 벡터(판정) | invalid-inputs | 빈 목록·중복 ID·없는 장면·길이 0·범위 밖 값 | 모두 invalid 로 거절 | `packages/sync-core/test/vectors.test.ts::공유 벡터: 명령 판정과 상태 전이 (Kotlin 서버도 같은 파일을 읽는다) invalid-inputs: 단계별 결과·이벤트·끝 상태·재생 위치가 벡터와 같다` | unit |
| SYNC-039 | 공유 벡터(판정) | time-windows | 오전·오후·야간(자정 넘김) 시간대 | 시간대 밖 항목으로 이동하면 invalid | `packages/sync-core/test/vectors.test.ts::공유 벡터: 명령 판정과 상태 전이 (Kotlin 서버도 같은 파일을 읽는다) time-windows: 단계별 결과·이벤트·끝 상태·재생 위치가 벡터와 같다` | unit |
| SYNC-040 | 공유 벡터(판정) | window-boundary | 11:59:50 편성 후 12:00 경과 | 재생 대상이 바뀌어도 위치가 서버 시각 기준으로 결정 | `packages/sync-core/test/vectors.test.ts::공유 벡터: 명령 판정과 상태 전이 (Kotlin 서버도 같은 파일을 읽는다) window-boundary: 단계별 결과·이벤트·끝 상태·재생 위치가 벡터와 같다` | unit |
| SYNC-041 | 공유 벡터(스키마) | 벡터가 스키마를 통과 | 모든 이벤트·명령·끝 상태를 JSON Schema 로 검증 | 모두 통과 | `packages/sync-core/test/vectors.test.ts::공유 벡터: 명령 판정과 상태 전이 (Kotlin 서버도 같은 파일을 읽는다) 벡터의 모든 이벤트와 끝 상태가 이벤트 스키마(openapi 에서 생성한 JSON Schema)를 통과한다` | unit |
| SYNC-042 | 공유 벡터(스키마) | 스키마가 거절하는 것 | 음량 101, 모르는 이벤트 종류, 필드 누락 | 모두 거절 | `packages/sync-core/test/vectors.test.ts::공유 벡터: 명령 판정과 상태 전이 (Kotlin 서버도 같은 파일을 읽는다) 스키마는 모르는 이벤트 종류와 빠진 필드를 거절한다` | unit |
| SYNC-043 | 공유 벡터(기록) | invalid-records | 길이 0·음수·6시간 초과·미래 | 보류 사유가 벡터와 같음(5분 이내 미래는 허용) | `packages/sync-core/test/vectors.test.ts::공유 벡터: 재생 기록 수집 (멱등·시계 차이·보류) invalid-records: 배치별 수집 결과와 보류 사유가 벡터와 같다` | unit |
| SYNC-044 | 공유 벡터(기록) | resend-is-idempotent | 같은 일련번호 재전송 | 수집 수·중복 수·ackSeq 가 벡터와 같음 | `packages/sync-core/test/vectors.test.ts::공유 벡터: 재생 기록 수집 (멱등·시계 차이·보류) resend-is-idempotent: 배치별 수집 결과와 보류 사유가 벡터와 같다` | unit |
| SYNC-045 | 공유 벡터(기록) | skewed-device-clock | 시계 20분 빠른 기기, 오프셋 유무 | 오프셋을 더하면 정상, 없으면 미래로 보류 | `packages/sync-core/test/vectors.test.ts::공유 벡터: 재생 기록 수집 (멱등·시계 차이·보류) skewed-device-clock: 배치별 수집 결과와 보류 사유가 벡터와 같다` | unit |

## 서버(Kotlin·Spring Boot)

| ID | 영역 | 시나리오 | 입력/조건 | 기대 결과 | 자동화 테스트(파일::함수) | 종류(unit/integration/e2e) |
|---|---|---|---|---|---|---|
| SRV-001 | 정산 | 실제 실행 결과 파일 생성 | 정산 벡터 입력을 Billing 에 넣음 | docs/evidence/billing-run.json 작성, 정산 줄이 충분히 나옴 | `server/src/test/kotlin/screenloop/BillingEvidenceTest.kt::writeBillingRunEvidenceFromActualComputation` | unit |
| SRV-002 | 정산 | 원 단위 정수와 구간별 버림 | 7,139초, 시간당 100원 | 198원(버림) | `server/src/test/kotlin/screenloop/BillingVectorsTest.kt::amountsAreIntegersAndRoundedDownPerTier` | unit |
| SRV-003 | 정산 | 마감 뒤 늦은 기록 | 10월 마감 뒤 11/3 에 10월 기록 2건 도착 | 11월 정산서에 조정 10,150원, 근거 일별 사용량 연결 | `server/src/test/kotlin/screenloop/BillingVectorsTest.kt::lateRecordsBecomeAdjustmentLineInNextInvoice` | unit |
| SRV-004 | 정산 | 겹침과 자정 | 겹치는 기록 3건, 자정을 넘는 기록, 길이 없는 기록 | 겹침은 한 번만 세고 날짜별로 나눔, 합계 10,050원 | `server/src/test/kotlin/screenloop/BillingVectorsTest.kt::overlapsAreCountedOnceAndMidnightIsSplit` | unit |
| SRV-005 | 정산 | 집계 재실행 | 입력 순서를 섞어 다시 계산 | 결과가 같음 | `server/src/test/kotlin/screenloop/BillingVectorsTest.kt::rerunningTheAggregationGivesTheSameResult` | unit |
| SRV-006 | 정산 | 구간 단가 | 121시간 재생, 화면 2대 | 31,480원(기본료 19,800 + 10,000 + 1,680) | `server/src/test/kotlin/screenloop/BillingVectorsTest.kt::tierPricing` | unit |
| SRV-007 | 명령 처리 | 동시 명령의 버전 | 스레드 8개로 명령 24건 | 버전이 빠짐·겹침 없이 이어지고 이벤트 수와 같음 | `server/src/test/kotlin/screenloop/CommandIT.kt::concurrentCommandsGetContiguousVersionsAndNoGaps` | integration |
| SRV-008 | 명령 처리 | 묶음 명령 | 묶음에 같은 음량 명령 | 화면마다 따로 판정(적용됨/이미 그 상태) | `server/src/test/kotlin/screenloop/CommandIT.kt::groupCommandAppliesToEveryDeviceWithSeparateOutcomes` | integration |
| SRV-009 | 권한 | 서버 권한 검사 | 토큰 없음·위조, 보기 전용, 기기 키 | 401, 403, 자기 화면만 허용 | `server/src/test/kotlin/screenloop/CommandIT.kt::permissionsAreCheckedOnTheServer` | integration |
| SRV-010 | 명령 처리 | 상대 명령과 commandId | 같은 항목에서 다음 두 번, 같은 commandId 재전송 | 두 번째 stale, 재전송은 replayed 이고 새 이벤트 없음 | `server/src/test/kotlin/screenloop/CommandIT.kt::relativeNextIsStaleForTheLaterOfTwoOperatorsAndSameCommandIdIsReplayed` | integration |
| SRV-011 | 명령 처리 | 편성표 충돌 | 같은 버전 기준으로 두 번 저장 | 먼저 온 것 수락, 나중 것 conflict | `server/src/test/kotlin/screenloop/CommandIT.kt::scheduleReplaceUsesFirstWriterWins` | integration |
| SRV-012 | 명령 처리 | 시작 시 시드 | 서버 기동 | 화면마다 이벤트 1번이 편성표 교체 | `server/src/test/kotlin/screenloop/CommandIT.kt::seededDevicesStartWithScheduleAtVersionOne` | integration |
| SRV-013 | 스트림 | SSE 와 Last-Event-ID | 명령 후 Redis 경유 수신, 끊었다 Last-Event-ID 로 재연결 | 이벤트 수신, 놓친 이벤트가 순서대로 재생됨 | `server/src/test/kotlin/screenloop/CommandIT.kt::sseStreamDeliversEventsThroughRedisAndReplaysAfterLastEventId` | integration |
| SRV-014 | 계약 | 오류 응답 스키마 | 401, 403, 404, 400 | Error 스키마와 같음 | `server/src/test/kotlin/screenloop/ContractIT.kt::errorResponsesFollowTheErrorSchema` | integration |
| SRV-015 | 계약 | 모든 작업의 응답 | 명세의 모든 경로·메서드 호출 | 응답이 스키마와 같고 호출하지 않은 작업이 없음 | `server/src/test/kotlin/screenloop/ContractIT.kt::everyOperationResponseMatchesTheSpec` | integration |
| SRV-016 | 계약 | 검증기 자체 | 필수 필드 제거, 추가 필드, 타입 변경 | 모두 실패해야 함 | `server/src/test/kotlin/screenloop/ContractIT.kt::theValidatorRejectsPayloadsThatDifferFromTheSpec` | integration |
| SRV-017 | DB | 되돌리기 스크립트 1:1 | 마이그레이션 파일과 rollback 폴더 | 번호·이름이 1:1 | `server/src/test/kotlin/screenloop/MigrationTest.kt::everyMigrationHasARollbackScript` | integration |
| SRV-018 | DB | 실제 되돌리기 | 최신 번호부터 되돌리기 스크립트 적용 후 재적용 | 테이블이 모두 사라지고 다시 올라감 | `server/src/test/kotlin/screenloop/MigrationTest.kt::rollbackScriptsUndoTheMigrationsAndTheyCanBeAppliedAgain` | integration |
| SRV-019 | 기록 수집 | 시계 보정과 보류 | 시계 2시간 빠른 기기, 오프셋 0 기록, 길이 0·7시간 | 오프셋 더한 서버 시각 저장, 나머지 보류, 정산에서 제외 | `server/src/test/kotlin/screenloop/RecordsAndBillingIT.kt::clockSkewedDeviceIsCorrectedAndImpossibleRecordsAreQuarantinedAndExcludedFromBilling` | integration |
| SRV-020 | 정산 | 마감·조정·추적 | 1월 마감 후 늦은 기록 2건, 2월 마감 | 마감 정산서 불변, 조정 10,150원, 줄→일별→원본 기록 추적, 재반영 없음 | `server/src/test/kotlin/screenloop/RecordsAndBillingIT.kt::monthCloseKeepsClosedInvoiceAndPutsLateRecordsIntoNextInvoiceAsAdjustmentWithTrace` | integration |
| SRV-021 | 기록 수집 | 재전송 멱등 | 같은 배치 두 번 | 수락 5, 중복 5, ackSeq 5, DB 5건 | `server/src/test/kotlin/screenloop/RecordsAndBillingIT.kt::resendingTheSameBatchDoesNotDuplicateRecords` | integration |
| SRV-022 | 기록 수집 | 동시 중복 전송 | 같은 30건 배치를 6개 스레드로 | 수락 합 30, 중복 합 150, DB 30건 | `server/src/test/kotlin/screenloop/RecordsAndBillingIT.kt::simultaneousIdenticalUploadsStillStoreEachRecordOnce` | integration |
| SRV-023 | 기록 기준(벡터) | invalid-records | TS 와 같은 벡터 | 보류 사유가 TS 와 같음 | `server/src/test/kotlin/screenloop/RecordsVectorsTest.kt::invalidRecordsAreQuarantinedForTheSameReasons` | unit |
| SRV-024 | 기록 기준(벡터) | resend-is-idempotent | TS 와 같은 벡터 | 분류가 TS 와 같음 | `server/src/test/kotlin/screenloop/RecordsVectorsTest.kt::resendClassificationMatches` | unit |
| SRV-025 | 기록 기준(벡터) | skewed-device-clock | TS 와 같은 벡터 | 분류가 TS 와 같음 | `server/src/test/kotlin/screenloop/RecordsVectorsTest.kt::skewedClockIsCorrectedByOffset` | unit |
| SRV-026 | 판정(벡터) | basic-playback | TS 와 같은 벡터 | 이벤트·끝 상태·위치가 TS 와 같음 | `server/src/test/kotlin/screenloop/SyncVectorsTest.kt::basicPlayback` | unit |
| SRV-027 | 판정(벡터) | concurrent-operators | TS 와 같은 벡터 | TS 와 같음 | `server/src/test/kotlin/screenloop/SyncVectorsTest.kt::concurrentOperators` | unit |
| SRV-028 | 판정(벡터) | empty-schedule | TS 와 같은 벡터 | TS 와 같음 | `server/src/test/kotlin/screenloop/SyncVectorsTest.kt::emptySchedule` | unit |
| SRV-029 | 판정(벡터) | invalid-inputs | TS 와 같은 벡터 | TS 와 같음 | `server/src/test/kotlin/screenloop/SyncVectorsTest.kt::invalidInputs` | unit |
| SRV-030 | 판정(벡터) | time-windows | TS 와 같은 벡터 | TS 와 같음 | `server/src/test/kotlin/screenloop/SyncVectorsTest.kt::timeWindows` | unit |
| SRV-031 | 판정(벡터) | window-boundary | TS 와 같은 벡터 | TS 와 같음 | `server/src/test/kotlin/screenloop/SyncVectorsTest.kt::windowBoundary` | unit |

## 운영 웹 헬퍼(`apps/web`)

| ID | 영역 | 시나리오 | 입력/조건 | 기대 결과 | 자동화 테스트(파일::함수) | 종류(unit/integration/e2e) |
|---|---|---|---|---|---|---|
| WEB-001 | 웹 헬퍼 | 명령 결과 안내 문구 | accepted / rejected(stale, conflict, unchanged) | 성공 문구, 거절 사유별 문구, unchanged 는 경고 톤 | `apps/web/test/validation.test.ts::명령 결과 안내 문구 받아들여지면 성공 문구, 거절 사유마다 다른 문구` | unit |
| WEB-002 | 웹 헬퍼 | 순서 바꾸기 함수 | 목록 [a,b,c] 를 앞뒤로 이동, 범위 밖 이동 | 원본 불변, 범위 밖이면 같은 배열 | `apps/web/test/validation.test.ts::편성 항목 입력 검사 순서 바꾸기는 원본을 고치지 않고 범위를 벗어나면 그대로 둔다` | unit |
| WEB-003 | 웹 헬퍼 | 시간대 입력 검사 | 9:00 형식 오류, 시작=끝, 22:00~06:00 | 형식 오류·같음은 오류 문구, 자정 넘김은 통과 | `apps/web/test/validation.test.ts::편성 항목 입력 검사 시간대는 HH:MM 이어야 하고 시작과 끝이 같으면 안 된다. 자정을 넘기는 시간대는 허용한다` | unit |
| WEB-004 | 웹 헬퍼 | 입력 초안 ↔ 서버 항목 변환 | 시간대 있는 항목, 시간대 끈 항목 | 값 보존, 끄면 window 키 없음 | `apps/web/test/validation.test.ts::편성 항목 입력 검사 입력 초안과 서버에 보내는 항목이 서로 오갈 때 값이 보존된다 (시간대 포함)` | unit |
| WEB-005 | 웹 헬퍼 | 재생 시간 입력 검사 | "", abc, 0, 3601, 1.5, -3 / 1, 10, 3600 | 앞 여섯은 오류, 뒤 셋은 통과 | `apps/web/test/validation.test.ts::편성 항목 입력 검사 재생 시간은 1~3600 사이 정수만 받는다` | unit |
| WEB-006 | 웹 헬퍼 | 정상 입력 | 제목·장면·10초 | 오류 없음 | `apps/web/test/validation.test.ts::편성 항목 입력 검사 정상 입력은 오류가 없다` | unit |
| WEB-007 | 웹 헬퍼 | 제목 입력 검사 | 공백 제목, 61자 제목 | "입력하세요", "60자까지" 문구 | `apps/web/test/validation.test.ts::편성 항목 입력 검사 제목이 비었거나 길면 알려 준다` | unit |

## e2e (운영 웹·플레이어·서버·배포)

| ID | 영역 | 시나리오 | 입력/조건 | 기대 결과 | 자동화 테스트(파일::함수) | 종류(unit/integration/e2e) |
|---|---|---|---|---|---|---|
| FLOW-001 | 운영 웹 | 월 마감과 근거 추적 | 보기 전용으로 마감 시도 후 운영자가 마감, 정산 줄 근거 보기, 같은 달 재마감 | 보기 전용 403·버튼 비활성, 마감 성공, 근거에 원본 기록, 재마감 409 | `e2e/tests/billing.spec.ts::월 마감: 보기 전용은 못 하고, 운영자는 마감한 뒤 정산 줄에서 원본 재생 기록까지 거슬러 올라가며, 같은 달은 다시 마감되지 않는다` | e2e |
| FLOW-002 | 운영 웹 | 재생 기록이 정산 미리보기에 반영 | 시계 41초 빠른 플레이어가 기록 전송, 미래 시각 기록 직접 전송 | 서버 시각으로 보정 저장, 미래 기록은 보류 표시, 화면 합계 = 서버 합계 | `e2e/tests/billing.spec.ts::플레이어가 보낸 재생 기록이 정산 미리보기에 반영되고, 시각이 틀린 기록은 보류로 보인다` | e2e |
| FLOW-003 | 운영 웹 | 권한: 운영자와 보기 전용 | 두 계정으로 로그인, 보기 전용 토큰으로 명령 직접 호출 | 카드 4개, 보기 전용은 버튼 비활성, 서버 403 | `e2e/tests/console.spec.ts::운영자는 화면 카드 4개를 보고 보기 전용 계정은 조작이 막히며 서버도 같은 이유로 거절한다` | e2e |
| FLOW-004 | 운영 웹 | 로그인 실패와 보호된 경로 | 틀린 비밀번호, 빈 입력, 로그인 없이 /records | 오류 문구, 로그인 화면으로 이동 | `e2e/tests/console.spec.ts::잘못된 비밀번호는 오류를 보이고, 로그인 없이 열면 로그인 화면으로 보낸다` | e2e |
| FLOW-005 | 플레이어 | 네트워크 차단과 복구 | 프록시로 연결 차단 → 그 사이 일시정지·공지 → 복구 | 계속 재생·기록 적립, 복구 후 상태 따라잡기, 기록 전부 도착(번호 빈틈·중복 없음) | `e2e/tests/offline.spec.ts::네트워크가 끊겨도 마지막 편성으로 계속 재생하고, 다시 붙으면 놓친 조작을 따라잡고 쌓은 재생 기록을 보낸다` | e2e |
| FLOW-006 | 운영 웹 | 두 운영자 동시 편성표 편집 | 한 사람이 먼저 저장, 다른 사람은 편집 중 | 늦은 쪽에 안내·conflict 거절, 최신본 불러오기 | `e2e/tests/schedule.spec.ts::두 운영자가 동시에 편성표를 고치면 먼저 저장한 쪽이 이기고 늦은 쪽은 안내를 받고 최신본을 불러온다` | e2e |
| FLOW-007 | 운영 웹 | 편성표 입력 검사 화면 | 제목 비움, 시간 abc, 3601초, 시작=끝 | 오류 문구와 첫 오류로 초점, 저장 안 됨 | `e2e/tests/schedule.spec.ts::편성표 입력 검사: 비운 제목·잘못된 시간이 오류로 보이고 저장되지 않는다` | e2e |
| FLOW-008 | 운영 웹 | 편성표 편집과 시간대 | 끌어서·버튼 순서 변경, 시간대 지정 | 플레이어가 시간대 안 항목만 새 순서로 재생 | `e2e/tests/schedule.spec.ts::편성표 편집: 끌어서·버튼으로 순서를 바꾸고 시간대를 주면 플레이어가 그대로 재생한다` | e2e |
| FLOW-009 | 플레이어 | 기기 시계 97초 차이 | 두 플레이어(0초, +97초) 30회 표본 | 경계 근처를 뺀 모든 표본에서 같은 항목 | `e2e/tests/sync.spec.ts::기기 시계가 97초 어긋난 플레이어 두 대가 같은 순간 같은 항목을 보인다 (서버 시각 기준 보정)` | e2e |
| FLOW-010 | 플레이어 | 긴급 공지 | 화면 단위·묶음 단위 공지 표시와 해제 | 두 플레이어에 표시, 나중 공지가 이김, 해제하면 복귀 | `e2e/tests/sync.spec.ts::긴급 공지가 플레이어 두 대를 덮고 해제하면 원래 화면으로 돌아온다` | e2e |
| FLOW-011 | 운영 웹 | 다음·일시정지·재개와 묶음 조작 | 운영 웹에서 다음, 묶음 일시정지·재개·음량 | 플레이어에 반영, 이미 그 상태면 "이미 그 상태" | `e2e/tests/sync.spec.ts::운영 웹의 다음·일시정지·재개가 같은 편성표를 보는 플레이어에 반영되고 화면 두 개가 같은 상태를 보인다` | e2e |
| FLOW-012 | 휴대폰 리모컨 | 리모컨(390px) | 리모컨에서 다음·음량·일시정지, 다른 곳의 재개 | 플레이어와 콘솔 상태 동기, 가로 스크롤 없음 | `e2e/tests/sync.spec.ts::휴대폰 리모컨(390px)이 운영 콘솔·플레이어와 같은 상태를 보고 같은 명령을 보낸다` | e2e |
| FLOW-013 | 배포 | 배포·되돌리기·잘못된 릴리스 | 1.0.0→1.0.1 배포, rollback.sh, DB 연결 못 하는 1.0.2 | 되돌리기 성공, 헬스 체크 실패 시 자동 복귀, 데이터 유지 | `e2e/tests/z-rollback.spec.ts::배포와 되돌리기: 새 버전 배포, 직전 버전으로 되돌리기, 잘못된 릴리스는 헬스 체크에서 걸려 자동으로 되돌아가고 데이터는 그대로다` | e2e |

## 데모 사이트(`web-demo`)

| ID | 영역 | 시나리오 | 입력/조건 | 기대 결과 | 자동화 테스트(파일::함수) | 종류(unit/integration/e2e) |
|---|---|---|---|---|---|---|
| DEMO-001 | 데모 사이트 | 390px 모바일 | 폭 390 에서 열기 | 가로 스크롤 없음, 설명이 아래 시트로 열림 | `web-demo/e2e/demo.spec.ts::390px 모바일: 가로 스크롤이 없고 설명은 아래 시트로 열린다` | e2e |
| DEMO-002 | 데모 사이트 | 시계 틀리게 | TV +97초, PC −45초 | 판정 일치, 위치 차이 300ms 미만 | `web-demo/e2e/demo.spec.ts::기기 시계가 97초·45초 틀려도 재생 위치 차이가 작다` | e2e |
| DEMO-003 | 데모 사이트 | 긴급 공지 | 공지 표시·해제 | 플레이어 두 대에 표시되고 해제하면 사라짐 | `web-demo/e2e/demo.spec.ts::긴급 공지가 플레이어를 덮고 해제하면 돌아온다` | e2e |
| DEMO-004 | 데모 사이트 | 동시 조작 | 동시에 다음, 동시에 편성표 저장 | 적용됨과 거절(stale, conflict)이 함께 나옴 | `web-demo/e2e/demo.spec.ts::두 사람이 동시에 조작하면 한쪽은 거절된다` | e2e |
| DEMO-005 | 데모 사이트 | 설명 따라가기 3~4장 | 3장에서 4장으로 이동 | 보관·스냅샷 재요청 기록이 실제로 나오고 일치로 돌아옴 | `web-demo/e2e/demo.spec.ts::설명 따라가기 3~4장은 고장을 실제로 일으켜 보관·스냅샷 재요청 기록이 나온다` | e2e |
| DEMO-006 | 데모 사이트 | 연결 끊기와 따라잡기 | TV 연결 끊기, 그 사이 일시정지, 다시 잇기 | 끊김 표시, 나머지 일치, 다시 이으면 스냅샷으로 따라잡음 | `web-demo/e2e/demo.spec.ts::연결을 끊으면 끊김으로 표시하며 계속 재생하고, 다시 이으면 따라잡는다` | e2e |
| DEMO-007 | 데모 사이트 | 오프라인 기록 몰아 보내기 | 4배속, TV 끊기, 응답 유실 켜기, 다시 잇기 | 기록 적립 후 전송, 중복 걸러짐, 대기열 비움 | `web-demo/e2e/demo.spec.ts::오프라인 재생 뒤 기록 몰아 보내기: 응답이 유실돼도 중복은 걸러지고 기록은 빠짐없이 모인다` | e2e |
| DEMO-008 | 데모 사이트 | 다음 항목 | 운영 웹에서 다음 | 네 대가 같은 항목으로 바뀜 | `web-demo/e2e/demo.spec.ts::운영 웹에서 다음 항목을 누르면 네 대가 같은 항목으로 바뀐다` | e2e |
| DEMO-009 | 데모 사이트 | 이벤트 누락 | PC 이벤트 누락 후 연속 조작 | "스냅샷 재요청" 기록, 일치로 돌아옴 | `web-demo/e2e/demo.spec.ts::이벤트 누락: 빠진 구간을 알아채고 스냅샷을 다시 받아 같은 상태로 돌아온다` | e2e |
| DEMO-010 | 데모 사이트 | 순서 뒤바뀜·중복 | TV 뒤바뀜, PC 중복 후 연속 조작 | "보관", "중복이라 버림" 기록, 일치 | `web-demo/e2e/demo.spec.ts::이벤트 순서 뒤바뀜·중복: 기기가 보관·중복 버림을 하고 끝 상태는 같다` | e2e |
| DEMO-011 | 데모 사이트 | 정산 패널 | 사례 선택, 줄 클릭 | Kotlin 결과(31,480원, 20,150원)와 근거(날짜·기록 번호) 표시 | `web-demo/e2e/demo.spec.ts::정산 패널: Kotlin 실행 결과 파일을 읽고, 줄을 누르면 근거(날짜·기록 번호)가 나온다` | e2e |
| DEMO-012 | 데모 사이트 | 설명 따라가기 동작 | 첫 방문 | 자동 열림, 키보드, 접기·다시 열기, 쿠키 sl_tour(180일, Lax, /screenloop/) | `web-demo/e2e/demo.spec.ts::첫 방문이면 설명 따라가기가 자동으로 열리고 쿠키를 남기며, 키보드로 넘기고 접었다 다시 열 수 있다` | e2e |
| DEMO-013 | 데모 사이트 | 첫 화면 | 첫 로드 | 제목·문단·실행 범위 표시, 일치, 콘솔 오류 없음 | `web-demo/e2e/demo.spec.ts::첫 화면: 제목·문단·실행 범위 표시, 기기 네 대가 같은 상태이고 콘솔 오류가 없다` | e2e |
