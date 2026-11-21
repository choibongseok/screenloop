// 서버 도메인(Kotlin Multiplatform)을 JS 로 컴파일한 산출물(build/domain-js/screenloop-domain.mjs)의 내보내기. 값은 JSON 글자로 주고받는다.
declare module 'kotlin-domain' {
  export function engineName(): string;
  export class KotlinServer {
    constructor(deviceId: string);
    submit(commandJson: string, actor: string, nowMs: number): string;
    snapshot(nowMs: number): string;
    state(): string;
    version(): number;
    eventsAfter(version: number): string;
    nowPlaying(nowMs: number): string;
    ingest(deviceId: string, batchJson: string, receivedAtMs: number): string;
    duplicatesTotal(): number;
    records(): string;
    invoice(month: string, nowMs: number, close: boolean): string;
    isClosed(month: string): boolean;
  }
  export function runBillingScenario(scenarioJson: string): string;
}
