import { api, requireSession } from '@/lib/server';
import type { DeviceSummary, Group } from '@screenloop/sync-core';
import { GroupControl } from '@/components/GroupControl';

export default async function GroupsPage() {
  const s = await requireSession();
  const [groups, devices] = await Promise.all([api<Group[]>('/api/groups'), api<DeviceSummary[]>('/api/devices')]);
  const names = Object.fromEntries(devices.map((d) => [d.id, d.name]));
  return (
    <>
      <div>
        <h1 className="title">묶음 조작</h1>
        <p className="sub">여러 화면에 같은 조작을 한 번에 보냅니다. 화면마다 따로 판정하므로 결과가 다를 수 있습니다.</p>
      </div>
      {groups.length === 0 ? (
        <p className="empty panel">묶음이 없습니다.</p>
      ) : (
        groups.map((g) => <GroupControl key={g.id} group={g} names={names} canOperate={s.role === 'operator'} />)
      )}
    </>
  );
}
