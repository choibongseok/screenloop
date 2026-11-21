'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const links = [
  { href: '/', label: '화면' },
  { href: '/groups', label: '묶음 조작' },
  { href: '/records', label: '재생 기록·정산' },
];

export function Nav() {
  const path = usePathname();
  const active = (h: string) => (h === '/' ? path === '/' || path.startsWith('/devices') : path.startsWith(h));
  return (
    <nav className="nav" aria-label="주 메뉴">
      {links.map((l) => (
        <Link key={l.href} href={l.href} aria-current={active(l.href) ? 'page' : undefined}>
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
