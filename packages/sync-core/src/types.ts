// 타입은 spec/openapi.yaml 에서 생성한 것(generated/openapi.ts)을 그대로 쓴다. 손으로 다시 정의하지 않는다.
import type { components } from './generated/openapi';

type S = components['schemas'];
export type Window = S['Window'];
export type ScheduleItem = S['ScheduleItem'];
export type Schedule = S['Schedule'];
export type Playback = S['Playback'];
export type Override = S['Override'];
export type DeviceState = S['DeviceState'];
export type Snapshot = S['Snapshot'];
export type StateEvent = S['StateEvent'];
export type Command = S['Command'];
export type CommandResult = S['CommandResult'];
export type PlayRecordInput = S['PlayRecordInput'];
export type PlayRecordBatch = S['PlayRecordBatch'];
export type PlayRecordResult = S['PlayRecordResult'];
export type PlayRecordRow = S['PlayRecordRow'];
export type DeviceSummary = S['DeviceSummary'];
export type Invoice = S['Invoice'];
export type InvoiceLine = S['InvoiceLine'];
export type Group = S['Group'];
export type GroupCommandResult = S['GroupCommandResult'];
export type Trace = S['Trace'];
export type SceneId = ScheduleItem['sceneId'];
export type RejectReason = NonNullable<CommandResult['reason']>;
