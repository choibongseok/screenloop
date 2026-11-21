import { getSession } from '@/lib/server';
import { redirect } from 'next/navigation';
import { LoginForm } from './LoginForm';

export default async function LoginPage() {
  if (await getSession()) redirect('/');
  return (
    <main className="login panel">
      <h1 className="title">Screenloop 운영 콘솔</h1>
      <p className="sub">매장 화면을 편성하고 원격으로 조작합니다.</p>
      <LoginForm />
    </main>
  );
}
