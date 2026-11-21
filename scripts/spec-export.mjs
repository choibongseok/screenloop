// spec/openapi.yaml 을 기준으로 두 파일을 만든다.
//   spec/events.schema.json                      이벤트·상태 JSON Schema (components.schemas 를 $defs 로 옮긴 것)
//   packages/sync-core/src/generated/openapi.ts  TypeScript 타입 (openapi-typescript)
// `--check` 를 주면 파일을 쓰지 않고, 지금 파일이 명세와 같은지만 본다(다르면 1로 종료).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { parse } from 'yaml';

const check = process.argv.includes('--check');
const doc = parse(readFileSync('spec/openapi.yaml', 'utf8'));
const defs = JSON.parse(JSON.stringify(doc.components.schemas).replaceAll('#/components/schemas/', '#/$defs/'));
const keep = ['Schedule', 'ScheduleItem', 'Window', 'Playback', 'Override', 'DeviceState', 'Snapshot', 'ScheduleReplaced', 'PlaybackChanged', 'VolumeChanged', 'OverrideSet', 'OverrideCleared', 'StateEvent', 'Command', 'CommandBase', 'ScheduleReplaceCommand', 'PlaybackNextCommand', 'PlaybackJumpCommand', 'PlaybackPauseCommand', 'PlaybackResumeCommand', 'PlaybackSeekCommand', 'VolumeSetCommand', 'OverrideSetCommand', 'OverrideClearCommand', 'CommandResult'];
const out = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://screenloop.example/events.schema.json',
  title: 'Screenloop 이벤트와 상태 (spec/openapi.yaml 에서 생성, 직접 고치지 않는다)',
  $defs: Object.fromEntries(keep.map((k) => [k, defs[k]])),
};
const eventsText = JSON.stringify(out, null, 2) + '\n';
const problems = [];

if (check) {
  if (!existsSync('spec/events.schema.json') || readFileSync('spec/events.schema.json', 'utf8') !== eventsText) problems.push('spec/events.schema.json 이 openapi.yaml 과 다름 (npm run spec:export)');
} else {
  writeFileSync('spec/events.schema.json', eventsText);
}

const tsPath = 'packages/sync-core/src/generated/openapi.ts';
const bin = 'node_modules/.bin/openapi-typescript';
const generated = execFileSync(bin, ['spec/openapi.yaml'], { encoding: 'utf8', maxBuffer: 20_000_000 });
if (check) {
  if (!existsSync(tsPath) || readFileSync(tsPath, 'utf8') !== generated) problems.push(`${tsPath} 가 openapi.yaml 과 다름 (npm run spec:export)`);
} else {
  writeFileSync(tsPath, generated);
}
if (problems.length) { console.error('명세와 생성물이 어긋남:\n - ' + problems.join('\n - ')); process.exit(1); }
console.log(check ? '명세와 생성물(이벤트 스키마·TS 타입)이 일치' : '생성 완료: spec/events.schema.json, ' + tsPath);
