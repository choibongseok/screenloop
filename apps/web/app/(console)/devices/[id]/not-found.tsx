import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="panel empty">
      없는 화면입니다. <Link href="/">화면 목록으로</Link>
    </div>
  );
}
