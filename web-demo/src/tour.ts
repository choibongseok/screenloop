import { $, el, setText } from './dom';

export interface TourStep {
  title: string;
  text: string[];
  look: string;
  highlight: string[];
  /** 이 장으로 올 때 실행할 조작 */
  enter?: () => void;
}

const COOKIE = 'sl_tour';
const hasSeen = () => {
  try {
    return /(?:^|;\s*)sl_tour=seen(?:;|$)/.test(document.cookie);
  } catch {
    return false;
  }
};
const markSeen = () => {
  try {
    document.cookie = `${COOKIE}=seen; path=/screenloop/; max-age=15552000; SameSite=Lax`;
  } catch {
    /* 쿠키를 쓸 수 없는 환경 */
  }
};

export function initTour(steps: TourStep[]): { open(i?: number): void } {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const tour = { open: false, i: 0 };
  const panel = $('#tour');
  const highlight = (sels: string[]) => {
    document.querySelectorAll('.tour-hl').forEach((e) => e.classList.remove('tour-hl'));
    for (const s of sels) document.querySelectorAll(s).forEach((e) => e.classList.add('tour-hl'));
  };
  const sheet = () => document.documentElement.style.setProperty('--sheet-h', tour.open ? `${panel.offsetHeight}px` : '0px');
  const go = (i: number, scroll = true) => {
    tour.i = Math.max(0, Math.min(steps.length - 1, i));
    const st = steps[tour.i]!;
    setText($('#tour-prog'), `${tour.i + 1}/${steps.length}`);
    $('#tour-prog').setAttribute('aria-label', `${steps.length}장 중 ${tour.i + 1}장`);
    setText($('#tour-title'), st.title);
    $('#tour-text').replaceChildren(...st.text.map((t) => el('p', { text: t })));
    setText($('#tour-look'), `지금 화면에서 볼 곳: ${st.look}`);
    ($('#tour-prev') as HTMLButtonElement).disabled = tour.i === 0;
    setText($('#tour-next'), tour.i === steps.length - 1 ? '마치기' : '다음');
    highlight(st.highlight);
    st.enter?.();
    if (scroll) document.querySelector('.tour-hl')?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
    sheet();
  };
  const open = (i = tour.i, focus = false, scroll = true) => {
    tour.open = true;
    panel.hidden = false;
    ($('#tour-open') as HTMLElement).hidden = true;
    document.body.classList.add('tour-open');
    go(i, scroll);
    if (focus) $('#tour-title').focus({ preventScroll: true });
  };
  const collapse = () => {
    highlight([]);
    tour.open = false;
    panel.hidden = true;
    ($('#tour-open') as HTMLElement).hidden = false;
    document.body.classList.remove('tour-open');
    sheet();
  };
  const finish = () => {
    markSeen();
    tour.i = 0;
    collapse();
    ($('#tour-open') as HTMLElement).hidden = true;
  };

  $('#tour-start').addEventListener('click', () => {
    tour.i = 0;
    open(0, true);
  });
  $('#tour-skip').addEventListener('click', () => {
    finish();
    $('#p-devices').scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' });
  });
  $('#tour-open').addEventListener('click', () => open(tour.i, true));
  $('#tour-collapse').addEventListener('click', () => {
    collapse();
    $('#tour-open').focus();
  });
  $('#tour-prev').addEventListener('click', () => go(tour.i - 1));
  $('#tour-next').addEventListener('click', () => {
    if (tour.i === steps.length - 1) {
      finish();
      $('#p-hero').scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' });
    } else go(tour.i + 1);
  });
  document.addEventListener('keydown', (e) => {
    if (!tour.open || e.altKey || e.ctrlKey || e.metaKey) return;
    const t = e.target as HTMLElement;
    if (t.matches('input, select, textarea')) return;
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      go(tour.i + 1);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      go(tour.i - 1);
    } else if (e.key === 'Escape') {
      collapse();
      $('#tour-open').focus();
    }
  });
  addEventListener('resize', sheet);
  // 처음 방문이면 자동으로 연다(사이트가 준비된 뒤 한 번)
  if (!hasSeen()) setTimeout(() => open(0, false, false), 300);
  return { open: (i = 0) => open(i, true) };
}
