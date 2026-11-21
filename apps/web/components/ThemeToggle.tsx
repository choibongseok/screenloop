'use client';
import { useEffect, useState } from 'react';

export function ThemeToggle() {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  useEffect(() => {
    try {
      const saved = localStorage.getItem('sl_theme');
      if (saved === 'light' || saved === 'dark') { setTheme(saved); document.documentElement.dataset.theme = saved; }
    } catch { /* 저장소를 쓸 수 없으면 기본(다크) */ }
  }, []);
  return (
    <button type="button" className="btn small" aria-label={`테마 전환(지금 ${theme === 'dark' ? '다크' : '라이트'})`} onClick={() => {
      const next = theme === 'dark' ? 'light' : 'dark';
      setTheme(next);
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem('sl_theme', next); } catch { /* 무시 */ }
    }}>◐</button>
  );
}
