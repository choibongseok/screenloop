import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';

export const root = resolve(import.meta.dirname, '../../..');
export const readJson = (rel: string) => JSON.parse(readFileSync(resolve(root, rel), 'utf8'));

/** spec/events.schema.json 의 $defs 이름으로 검증하는 함수를 만든다 */
export function schemaValidator() {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const schema = readJson('spec/events.schema.json');
  ajv.addSchema(schema);
  return (def: string, value: unknown) => {
    const v = ajv.getSchema(`${schema.$id}#/$defs/${def}`);
    if (!v) throw new Error(`스키마 없음: ${def}`);
    const ok = v(value) as boolean;
    return { ok, errors: ok ? [] : (v.errors ?? []).map((e) => `${e.instancePath} ${e.message}`) };
  };
}
