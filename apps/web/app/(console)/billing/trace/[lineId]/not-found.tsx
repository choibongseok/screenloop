import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="panel empty">
      없는 정산 항목입니다. <Link href="/records">재생 기록·정산으로</Link>
    </div>
  );
}
