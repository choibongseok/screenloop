import { sceneDataUri } from '@screenloop/scenes';

/** 장면 미리보기. 직접 만든 SVG 를 data URI 로 넣는다(외부 요청 없음). */
export function Scene({ sceneId, label }: { sceneId: string; label?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={sceneDataUri(sceneId)} alt={label ?? ''} width={160} height={90} />;
}
