'use client';
import { useActionState } from 'react';
import { loginAction, type LoginState } from '@/lib/actions';

export function LoginForm() {
  const [state, action, pending] = useActionState<LoginState, FormData>(loginAction, {});
  return (
    <form action={action} noValidate>
      <div>
        <label htmlFor="username">계정</label>
        <input id="username" name="username" type="text" autoComplete="username" required aria-invalid={!!state.error} style={{ width: '100%' }} />
      </div>
      <div>
        <label htmlFor="password">비밀번호</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required aria-invalid={!!state.error} style={{ width: '100%' }} />
      </div>
      {state.error && <p className="err" role="alert">{state.error}</p>}
      <button className="btn primary" type="submit" disabled={pending}>{pending ? '확인 중…' : '로그인'}</button>
      <p className="hint">데모 계정: 운영자 <code>operator</code> / <code>operator-demo</code>, 보기 전용 <code>viewer</code> / <code>viewer-demo</code></p>
    </form>
  );
}
