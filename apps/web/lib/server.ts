import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

/** 서버(Kotlin) 주소. 컨테이너에서는 compose 서비스 이름으로 바뀐다. */
export const SERVER_URL = process.env.SERVER_URL ?? 'http://127.0.0.1:59680';
export const TOKEN_COOKIE = 'sl_token';

export interface Session {
  username: string;
  role: 'operator' | 'viewer';
  token: string;
}

/** 쿠키의 토큰에서 화면에 보여 줄 사용자와 역할을 읽는다. 서명 검증과 권한 판정은 서버가 요청마다 다시 한다. */
export async function getSession(): Promise<Session | null> {
  const token = (await cookies()).get(TOKEN_COOKIE)?.value;
  if (!token) return null;
  try {
    const [user, role, exp] = Buffer.from(token.split('.')[0]!, 'base64url').toString().split('|');
    if (!user || (role !== 'operator' && role !== 'viewer') || Number(exp) < Date.now()) return null;
    return { username: user, role, token };
  } catch {
    return null;
  }
}

export async function requireSession(): Promise<Session> {
  const s = await getSession();
  if (!s) redirect('/login');
  return s;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** 로그인한 사용자의 토큰으로 서버를 부른다. 401 이면 다시 로그인하게 한다. */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const s = await requireSession();
  const res = await fetch(`${SERVER_URL}${path}`, {
    ...init,
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.token}`, ...(init.headers ?? {}) },
  });
  if (res.status === 401) redirect('/login');
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, body?.message ?? `서버 오류 ${res.status}`);
  return body as T;
}
