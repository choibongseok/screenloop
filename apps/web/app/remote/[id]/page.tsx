import { requireSession } from '@/lib/server';
import { Remote } from '@/components/Remote';

export default async function RemotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireSession();
  return <Remote deviceId={id} canOperate={s.role === 'operator'} />;
}
