// 정산 시험 벡터. 입력과 기대값을 모두 손으로 계산해서 적었다(구현이 낸 값을 옮겨 적지 않는다).
// 요금제: 화면 1대당 기본료 9,900원, 재생 100시간까지 시간당 100원, 100~300시간 시간당 80원, 300시간 초과 시간당 60원.
import { writeFileSync } from 'node:fs';

const kst = (s) => Date.parse(s.replace(' ', 'T') + ':00+09:00');
const H = 3600 * 1000;
const plan = {
  screenFeeWon: 9900,
  tiers: [
    { upToHours: 100, rateWonPerHour: 100 },
    { upToHours: 300, rateWonPerHour: 80 },
    { upToHours: null, rateWonPerHour: 60 },
  ],
};
const rec = (id, deviceId, start, end, received) => ({ id, deviceId, startMs: start, endMs: end, receivedAtMs: received ?? end });

const scenarios = [];

// 1. 구간 단가: d-1 이 10월 1~5일 하루 24시간씩 120시간, d-2 가 10월 3일 1시간
{
  const records = [];
  const t0 = kst('2026-10-01 00:00');
  for (let k = 0; k < 20; k++) records.push(rec(k + 1, 'd-1', t0 + k * 6 * H, t0 + (k + 1) * 6 * H));
  records.push(rec(21, 'd-2', kst('2026-10-03 10:00'), kst('2026-10-03 11:00')));
  const usage = [1, 2, 3, 4, 5].map((d) => ({ deviceId: 'd-1', day: `2026-10-0${d}`, billedSeconds: 86400 }));
  usage.push({ deviceId: 'd-2', day: '2026-10-03', billedSeconds: 3600 });
  scenarios.push({
    name: 'tier-pricing',
    note: '121시간 = 100시간×100원 + 21시간×80원, 화면 2대 기본료',
    plan,
    records,
    steps: [
      {
        op: 'close',
        month: '2026-10',
        nowMs: kst('2026-11-01 00:00'),
        expectLines: [
          { kind: 'screen', quantity: 2, unitWon: 9900, amountWon: 19800 },
          { kind: 'usage_tier', quantity: 360000, unitWon: 100, amountWon: 10000 },
          { kind: 'usage_tier', quantity: 75600, unitWon: 80, amountWon: 1680 },
        ],
        expectTotalWon: 31480,
        expectUsage: usage,
      },
    ],
  });
}

// 2. 겹침과 자정: A 가 10/1 23:30~10/2 00:30, B 가 A 안에 들어가는 10/2 00:10~00:40, C 가 10/2 00:20~01:00, 끝이 시작보다 빠른 기록 D
scenarios.push({
  name: 'overlap-and-midnight',
  note: '겹친 구간은 한 번만 센다. 자정을 넘는 기록은 날짜별로 나눈다. 길이가 없는 기록은 무시',
  plan,
  records: [
    rec(1, 'd-1', kst('2026-10-01 23:30'), kst('2026-10-02 00:30')),
    rec(2, 'd-1', kst('2026-10-02 00:10'), kst('2026-10-02 00:40')),
    rec(3, 'd-1', kst('2026-10-02 00:20'), kst('2026-10-02 01:00')),
    rec(4, 'd-1', kst('2026-10-02 05:00'), kst('2026-10-02 04:00')),
  ],
  steps: [
    {
      op: 'close',
      month: '2026-10',
      nowMs: kst('2026-11-01 00:00'),
      expectLines: [
        { kind: 'screen', quantity: 1, unitWon: 9900, amountWon: 9900 },
        { kind: 'usage_tier', quantity: 5400, unitWon: 100, amountWon: 150 },
      ],
      expectTotalWon: 10050,
      expectUsage: [
        { deviceId: 'd-1', day: '2026-10-01', billedSeconds: 1800, recordIds: [1] },
        { deviceId: 'd-1', day: '2026-10-02', billedSeconds: 3600, recordIds: [1, 2, 3] },
      ],
    },
  ],
});

// 3. 마감 뒤 늦게 도착한 기록은 다음 정산서의 조정 항목
scenarios.push({
  name: 'late-record-adjustment',
  note: '10월 마감 뒤(11/3)에 10월 기록 2건이 도착. 10월 정산서는 그대로 두고 11월 정산서에 차액을 조정 항목으로 넣는다',
  plan,
  records: [
    rec(1, 'd-1', kst('2026-10-10 12:00'), kst('2026-10-10 13:00'), kst('2026-10-10 13:00')),
    rec(2, 'd-1', kst('2026-10-20 12:00'), kst('2026-10-20 14:00'), kst('2026-11-03 09:00')),
    rec(3, 'd-2', kst('2026-10-25 12:00'), kst('2026-10-25 12:30'), kst('2026-11-03 09:00')),
    rec(4, 'd-1', kst('2026-11-05 12:00'), kst('2026-11-05 13:00'), kst('2026-11-05 13:00')),
  ],
  steps: [
    {
      op: 'close',
      month: '2026-10',
      nowMs: kst('2026-11-01 00:00'),
      expectLines: [
        { kind: 'screen', quantity: 1, unitWon: 9900, amountWon: 9900 },
        { kind: 'usage_tier', quantity: 3600, unitWon: 100, amountWon: 100 },
      ],
      expectTotalWon: 10000,
      expectUsage: [{ deviceId: 'd-1', day: '2026-10-10', billedSeconds: 3600, recordIds: [1] }],
    },
    {
      op: 'close',
      month: '2026-11',
      nowMs: kst('2026-12-01 00:00'),
      // 11월 몫 10,000 + 10월 차액: 다시 계산하면 화면 2대 19,800 + 12,600초×100/3,600=350 → 20,150, 이미 청구한 10,000 → 차액 10,150
      expectLines: [
        { kind: 'screen', quantity: 1, unitWon: 9900, amountWon: 9900 },
        { kind: 'usage_tier', quantity: 3600, unitWon: 100, amountWon: 100 },
        {
          kind: 'adjustment',
          quantity: 2,
          unitWon: null,
          amountWon: 10150,
          adjustsMonth: '2026-10',
          basisDays: [
            { deviceId: 'd-1', day: '2026-10-20' },
            { deviceId: 'd-2', day: '2026-10-25' },
          ],
        },
      ],
      expectTotalWon: 20150,
      expectUsage: [{ deviceId: 'd-1', day: '2026-11-05', billedSeconds: 3600, recordIds: [4] }],
    },
    {
      // 같은 달을 마감 뒤 다시 계산해도(재실행) 이미 반영한 차액은 다시 나오지 않는다
      op: 'preview',
      month: '2026-12',
      nowMs: kst('2026-12-02 00:00'),
      expectLines: [],
      expectTotalWon: 0,
      expectUsage: [],
    },
  ],
});

writeFileSync('spec/vectors/billing.json', JSON.stringify({ scenarios }, null, 2) + '\n');
console.log('정산 벡터:', scenarios.map((s) => s.name).join(', '));
