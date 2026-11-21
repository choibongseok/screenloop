import { requireSession } from '@/lib/server';
import { logoutAction } from '@/lib/actions';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Nav } from '@/components/Nav';

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const s = await requireSession();
  return (
    <>
      <a className="skip" href="#main">
        본문으로 건너뛰기
      </a>
      <header className="top">
        <span className="brand">
          screenloop<span> / 운영 콘솔</span>
        </span>
        <Nav />
        <div className="who">
          <span data-testid="who">{s.username}</span>
          <span className={`badge ${s.role === 'operator' ? 'ok' : 'off'}`} data-testid="role">
            {s.role === 'operator' ? '운영자' : '보기 전용'}
          </span>
          <ThemeToggle />
          <form action={logoutAction}>
            <button className="btn small" type="submit">
              로그아웃
            </button>
          </form>
        </div>
      </header>
      <main id="main" className="page">
        {children}
      </main>
    </>
  );
}
