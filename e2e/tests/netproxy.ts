import http from 'node:http';
import type { Socket } from 'node:net';

/**
 * 플레이어와 서버 사이에 끼우는 역방향 프록시. cut() 하면 열린 연결을 모두 끊고 새 연결도 받지 않아서
 * 와이파이가 나간 것과 같은 상태(이벤트 스트림이 끊기고 요청이 실패)를 만든다. restore() 하면 다시 통한다.
 */
export class CuttableProxy {
  private sockets = new Set<Socket>();
  private isCut = false;
  private constructor(
    private readonly server: http.Server,
    readonly port: number,
  ) {}

  static async start(target: string): Promise<CuttableProxy> {
    const t = new URL(target);
    const holder: { self?: CuttableProxy } = {};
    const server = http.createServer((req, res) => {
      if (holder.self!.isCut) {
        req.socket.destroy();
        return;
      }
      const up = http.request({ host: t.hostname, port: t.port, path: req.url, method: req.method, headers: req.headers }, (ur) => {
        res.writeHead(ur.statusCode ?? 502, ur.headers);
        ur.pipe(res);
      });
      up.on('error', () => res.destroy());
      res.on('close', () => up.destroy());
      req.pipe(up);
    });
    server.on('connection', (s) => {
      holder.self!.sockets.add(s);
      s.on('close', () => holder.self!.sockets.delete(s));
    });
    await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
    holder.self = new CuttableProxy(server, (server.address() as { port: number }).port);
    return holder.self;
  }

  get url(): string {
    return `http://127.0.0.1:${this.port}`;
  }
  cut(): void {
    this.isCut = true;
    for (const s of this.sockets) s.destroy();
  }
  restore(): void {
    this.isCut = false;
  }
  async stop(): Promise<void> {
    this.cut();
    await new Promise<void>((ok) => this.server.close(() => ok()));
  }
}
