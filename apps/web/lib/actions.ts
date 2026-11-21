'use server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import type { Command, CommandResult, GroupCommandResult, Invoice } from '@screenloop/sync-core';
import { ApiError, SERVER_URL, TOKEN_COOKIE, api } from './server';

export interface LoginState {
  error?: string;
}

export async function loginAction(_prev: LoginState, form: FormData): Promise<LoginState> {
  const username = String(form.get('username') ?? '').trim();
  const password = String(form.get('password') ?? '');
  if (!username || !password) return { error: '계정과 비밀번호를 모두 입력하세요.' };
  const res = await fetch(`${SERVER_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
    cache: 'no-store',
  });
  if (!res.ok) return { error: '계정 정보가 맞지 않습니다.' };
  const { token } = (await res.json()) as { token: string };
  (await cookies()).set(TOKEN_COOKIE, token, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 12 * 3600 });
  redirect('/');
}

export async function logoutAction(): Promise<void> {
  (await cookies()).delete(TOKEN_COOKIE);
  redirect('/login');
}

export type ActionResult<T> = { ok: true; value: T } | { ok: false; status: number; message: string };

async function wrap<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    if (e instanceof ApiError) return { ok: false, status: e.status, message: e.message };
    throw e;
  }
}

/** 한 화면에 조작 명령. 권한(운영자)은 서버가 판정하고, 여기서는 결과를 그대로 전달한다. */
export async function sendCommand(deviceId: string, cmd: Command): Promise<ActionResult<CommandResult>> {
  return wrap(() => api<CommandResult>(`/api/devices/${encodeURIComponent(deviceId)}/commands`, { method: 'POST', body: JSON.stringify(cmd) }));
}

export async function sendGroupCommand(groupId: string, cmd: Command): Promise<ActionResult<GroupCommandResult>> {
  return wrap(() => api<GroupCommandResult>(`/api/groups/${encodeURIComponent(groupId)}/commands`, { method: 'POST', body: JSON.stringify(cmd) }));
}

export async function closeMonthAction(accountId: string, month: string): Promise<ActionResult<Invoice>> {
  const r = await wrap(() => api<Invoice>('/api/billing/close', { method: 'POST', body: JSON.stringify({ accountId, month }) }));
  if (r.ok) revalidatePath('/records');
  return r;
}
