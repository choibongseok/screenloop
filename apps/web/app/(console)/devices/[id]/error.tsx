'use client';

export default function ErrorPage({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="panel" role="alert">
      <p className="err">화면 정보를 불러오지 못했습니다. {error.message}</p>
      <button className="btn" onClick={reset}>다시 시도</button>
    </div>
  );
}
