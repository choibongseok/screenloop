const CACHE = 'screenloop-scenes-v1';

/**
 * 편성표에 나오는 장면 파일을 미리 내려받아 브라우저 캐시(Cache Storage)에 둔다.
 * 네트워크가 끊겨도 이미 받은 장면은 계속 그릴 수 있다.
 */
export class SceneCache {
  private urls = new Map<string, string>();
  readonly cached = new Set<string>();
  private inflight = new Set<string>();

  async prefetch(sceneIds: string[], onChange: () => void): Promise<void> {
    if (typeof caches === 'undefined') return;
    const c = await caches.open(CACHE);
    for (const id of new Set(sceneIds)) {
      if (this.cached.has(id) || this.inflight.has(id)) continue;
      this.inflight.add(id);
      try {
        const path = `/scenes/${id}.svg`;
        let res = await c.match(path);
        if (!res) {
          await c.add(path);
          res = await c.match(path);
        }
        if (res) {
          this.urls.set(id, URL.createObjectURL(await res.blob()));
          this.cached.add(id);
          onChange();
        }
      } catch {
        /* 네트워크가 안 되면 다음 편성표 변경 때 다시 시도 */
      }
      this.inflight.delete(id);
    }
  }

  /** 캐시에서 꺼낸 주소가 있으면 그것, 없으면 원래 주소 */
  src(id: string): string {
    return this.urls.get(id) ?? `/scenes/${id}.svg`;
  }
}
