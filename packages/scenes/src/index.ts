export type SceneId = 'aurora' | 'waves' | 'grid' | 'pulse' | 'dusk';
export const SCENE_IDS: SceneId[] = ['aurora', 'waves', 'grid', 'pulse', 'dusk'];
export const SCENE_LABEL: Record<SceneId, string> = { aurora: '오로라', waves: '물결', grid: '격자', pulse: '파동', dusk: '노을' };

const HEAD = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 90" preserveAspectRatio="xMidYMid slice">';
const REDUCE = '@media (prefers-reduced-motion: reduce){*{animation:none!important}}';

const BODY: Record<SceneId, string> = {
  aurora: `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0b1b2b"/><stop offset="1" stop-color="#1d1236"/></linearGradient>
<filter id="b"><feGaussianBlur stdDeviation="6"/></filter></defs>
<style>.a{animation:d 9s ease-in-out infinite alternate}.b{animation:d 12s ease-in-out infinite alternate-reverse}.c{animation:d 7s ease-in-out infinite alternate}
@keyframes d{from{transform:translateX(-14px)}to{transform:translateX(14px)}}${REDUCE}</style>
<rect width="160" height="90" fill="url(#g)"/>
<g filter="url(#b)"><ellipse class="a" cx="50" cy="40" rx="46" ry="12" fill="#3fd0a0" opacity=".55"/><ellipse class="b" cx="100" cy="52" rx="50" ry="10" fill="#6a7cff" opacity=".5"/><ellipse class="c" cx="80" cy="30" rx="38" ry="8" fill="#c26bff" opacity=".45"/></g>
<g fill="#fff" opacity=".7"><circle cx="20" cy="12" r=".6"/><circle cx="64" cy="8" r=".5"/><circle cx="120" cy="14" r=".7"/><circle cx="144" cy="6" r=".5"/><circle cx="96" cy="20" r=".4"/></g>`,
  waves: `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0e2a47"/><stop offset="1" stop-color="#0a1626"/></linearGradient></defs>
<style>.w1{animation:s 8s linear infinite}.w2{animation:s 5s linear infinite}.w3{animation:s 3.5s linear infinite}
@keyframes s{from{transform:translateX(0)}to{transform:translateX(-80px)}}${REDUCE}</style>
<rect width="160" height="90" fill="url(#g)"/>
<g class="w1"><path d="M0 52 q20 -10 40 0 t40 0 t40 0 t40 0 t40 0 V90 H0Z" fill="#2a74c8" opacity=".55"/></g>
<g class="w2"><path d="M0 62 q20 -9 40 0 t40 0 t40 0 t40 0 t40 0 V90 H0Z" fill="#2f95d8" opacity=".6"/></g>
<g class="w3"><path d="M0 72 q20 -8 40 0 t40 0 t40 0 t40 0 t40 0 V90 H0Z" fill="#58c1e8" opacity=".7"/></g>`,
  grid: `<style>.l{stroke:#4ad1ff;stroke-width:.4;opacity:.7}.m{animation:m 3s linear infinite}.p{animation:p 2.4s ease-in-out infinite alternate}
@keyframes m{from{transform:translateY(0)}to{transform:translateY(10px)}}@keyframes p{from{opacity:.2}to{opacity:1}}${REDUCE}</style>
<rect width="160" height="90" fill="#0a0d1c"/>
<g class="m"><g class="l"><path d="M0 40H160M0 50H160M0 60H160M0 70H160M0 80H160M0 90H160M0 30H160"/></g></g>
<g class="l"><path d="M80 30V90M60 30L20 90M40 30L-20 90M100 30L140 90M120 30L180 90M20 30L-60 90M140 30L220 90"/></g>
<rect x="0" y="0" width="160" height="30" fill="#0a0d1c"/>
<g fill="#ff6bd6"><rect class="p" x="24" y="10" width="8" height="8"/><rect class="p" x="56" y="16" width="6" height="6" style="animation-delay:.4s"/><rect class="p" x="100" y="8" width="10" height="10" style="animation-delay:.8s"/><rect class="p" x="130" y="18" width="6" height="6" style="animation-delay:1.2s"/></g>`,
  pulse: `<style>.r{transform-origin:80px 45px;animation:r 3.6s ease-out infinite;fill:none;stroke:#ffb347;stroke-width:1.2}
@keyframes r{from{transform:scale(.1);opacity:1}to{transform:scale(2.4);opacity:0}}${REDUCE}</style>
<rect width="160" height="90" fill="#1a0f1e"/>
<circle class="r" cx="80" cy="45" r="20"/><circle class="r" cx="80" cy="45" r="20" style="animation-delay:1.2s"/><circle class="r" cx="80" cy="45" r="20" style="animation-delay:2.4s"/>
<circle cx="80" cy="45" r="5" fill="#ffb347"/>`,
  dusk: `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2b1b4a"/><stop offset=".6" stop-color="#c0475f"/><stop offset="1" stop-color="#f2a65a"/></linearGradient></defs>
<style>.s{animation:s 10s ease-in-out infinite alternate}@keyframes s{from{transform:translateY(-8px)}to{transform:translateY(12px)}}${REDUCE}</style>
<rect width="160" height="90" fill="url(#g)"/>
<circle class="s" cx="80" cy="52" r="16" fill="#ffd9a0"/>
<rect y="58" width="160" height="32" fill="#1b1230"/>
<path d="M0 62 L24 54 L44 60 L70 50 L100 60 L124 52 L160 62 V90 H0Z" fill="#241840"/>`,
};

/** 장면 하나를 독립된 SVG 문서 글자로 만든다(<img> 로 쓸 수 있다). 움직임 줄이기 설정을 따른다. */
export function sceneSvg(id: string): string {
  const body = BODY[(SCENE_IDS as string[]).includes(id) ? (id as SceneId) : 'grid'];
  return `${HEAD}${body}</svg>`;
}

/** <img src> 에 바로 쓰는 data URI */
export function sceneDataUri(id: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sceneSvg(id))}`;
}
