package screenloop.billing

/** 정산 계산. 모두 순수 함수이고 금액은 원 단위 정수다. 같은 입력이면 항상 같은 결과가 나온다(집계 재실행 안전). */

const val KST_OFFSET_MS = 9L * 3600 * 1000
const val DAY_MS = 86_400_000L

/** 정산에 쓰는 재생 기록. 시각은 이미 서버 시각으로 맞춘 값이다. */
data class BillRecord(val id: Long, val deviceId: String, val startMs: Long, val endMs: Long, val receivedAtMs: Long)

data class UsageDay(val deviceId: String, val day: String, val billedSeconds: Long, val recordIds: List<Long>)

data class Tier(val upToHours: Long?, val rateWonPerHour: Long)
data class Plan(val screenFeeWon: Long, val tiers: List<Tier>)

/** 이미 마감한 달. billedWon 은 그 달 몫으로 지금까지 청구한 금액(마감 정산서의 기본료·구간 합 + 이후 조정 합). */
data class ClosedMonth(val month: String, val closedAtMs: Long, val billedWon: Long)

data class DayKey(val deviceId: String, val day: String)

data class CalcLine(
    val kind: String,
    val description: String,
    val quantity: Long,
    val unitWon: Long?,
    val amountWon: Long,
    val adjustsMonth: String?,
    /** 이 줄의 근거가 되는 일별 사용량 */
    val basis: List<DayKey>,
)

data class InvoiceCalc(val month: String, val lines: List<CalcLine>, val totalWon: Long, val usage: List<UsageDay>)

object Billing {
    /** 서버 시각(ms)이 속한 한국 날짜 yyyy-MM-dd */
    fun dayOf(ms: Long): String {
        val d = java.time.LocalDate.ofEpochDay(Math.floorDiv(ms + KST_OFFSET_MS, DAY_MS))
        return d.toString()
    }

    fun monthOf(day: String): String = day.substring(0, 7)

    private fun dayStartMs(day: String): Long = java.time.LocalDate.parse(day).toEpochDay() * DAY_MS - KST_OFFSET_MS

    /** 겹치는 구간을 하나로 합친다. 맞닿은 구간도 합친다. */
    fun union(intervals: List<LongRange>): List<LongRange> {
        val sorted = intervals.sortedBy { it.first }
        val out = ArrayList<LongRange>()
        for (iv in sorted) {
            val last = out.lastOrNull()
            if (last != null && iv.first <= last.last + 1) {
                if (iv.last > last.last) out[out.lastIndex] = last.first..iv.last
            } else out.add(iv)
        }
        return out
    }

    /**
     * 기기·날짜별 정산 초. 같은 기기에서 겹친 구간은 한 번만 센다(재전송·시계 보정으로 겹치는 경우).
     * 자정(한국 시간)을 넘는 기록은 날짜별로 나눈다. 구간은 [start, end) 이고 하루 안의 ms 합을 1000 으로 나눈 몫(버림)이 정산 초다.
     */
    fun dailyUsage(records: List<BillRecord>): List<UsageDay> {
        val out = ArrayList<UsageDay>()
        for ((device, recs) in records.groupBy { it.deviceId }.toSortedMap()) {
            // 닫힌 구간으로 다루기 위해 end-1 을 끝으로 쓴다
            val merged = union(recs.filter { it.endMs > it.startMs }.map { it.startMs..(it.endMs - 1) })
            val perDay = java.util.TreeMap<String, Long>()
            for (iv in merged) {
                var cur = iv.first
                while (cur <= iv.last) {
                    val day = dayOf(cur)
                    val dayEnd = dayStartMs(day) + DAY_MS - 1
                    val pieceEnd = minOf(iv.last, dayEnd)
                    perDay.merge(day, pieceEnd - cur + 1, Long::plus)
                    cur = pieceEnd + 1
                }
            }
            for ((day, ms) in perDay) {
                val s = dayStartMs(day)
                val e = s + DAY_MS - 1
                val ids = recs.filter { it.endMs > it.startMs && it.startMs <= e && (it.endMs - 1) >= s }.map { it.id }.sorted()
                out.add(UsageDay(device, day, ms / 1000, ids))
            }
        }
        return out
    }

    private fun hoursLabel(lo: Long, hi: Long?): String = if (hi == null) "${lo}시간 초과" else "${lo}~${hi}시간"

    /** 한 달의 기본료와 구간별 사용료. 활성 화면은 그 달에 정산 초가 있는 화면이다. */
    fun priceMonth(month: String, usage: List<UsageDay>, plan: Plan): List<CalcLine> {
        val days = usage.filter { monthOf(it.day) == month && it.billedSeconds > 0 }
        if (days.isEmpty()) return emptyList()
        val basis = days.map { DayKey(it.deviceId, it.day) }
        val devices = days.map { it.deviceId }.toSet().size.toLong()
        val lines = ArrayList<CalcLine>()
        lines.add(CalcLine("screen", "화면 ${devices}대 기본료", devices, plan.screenFeeWon, devices * plan.screenFeeWon, null, basis))
        val total = days.sumOf { it.billedSeconds }
        var lo = 0L
        for (t in plan.tiers) {
            val hi = t.upToHours
            val capSec = if (hi == null) Long.MAX_VALUE else (hi - lo) * 3600
            val sec = minOf(maxOf(0L, total - lo * 3600), capSec)
            if (sec > 0) lines.add(CalcLine("usage_tier", "재생 ${hoursLabel(lo, hi)} 구간", sec, t.rateWonPerHour, sec * t.rateWonPerHour / 3600, null, basis))
            if (hi != null) lo = hi
        }
        return lines
    }

    /**
     * 한 달 정산서. 그 달 몫(기본료·구간 사용료)에, 이전에 마감한 달 중 마감 뒤에 늦게 도착한 기록 때문에 금액이 달라진 달의 차액(조정 항목)을 더한다.
     * 마감한 달의 정산서는 고치지 않는다. 차액은 다음 정산서에 조정 항목으로 들어간다.
     */
    fun invoiceFor(month: String, records: List<BillRecord>, plan: Plan, closed: List<ClosedMonth>): InvoiceCalc {
        val usage = dailyUsage(records)
        val lines = ArrayList(priceMonth(month, usage, plan))
        for (c in closed.filter { it.month < month }.sortedBy { it.month }) {
            val now = priceMonth(c.month, usage, plan).sumOf { it.amountWon }
            val delta = now - c.billedWon
            if (delta == 0L) continue
            val late = records.filter { it.receivedAtMs > c.closedAtMs && overlapsMonth(it, c.month) }
            val lateIds = late.map { it.id }.toSet()
            val basis = usage.filter { monthOf(it.day) == c.month && it.recordIds.any { id -> id in lateIds } }.map { DayKey(it.deviceId, it.day) }
            lines.add(CalcLine("adjustment", "${c.month} 마감 후 도착한 기록 ${late.size}건 반영", late.size.toLong(), null, delta, c.month, basis))
        }
        return InvoiceCalc(month, lines, lines.sumOf { it.amountWon }, usage)
    }

    private fun overlapsMonth(r: BillRecord, month: String): Boolean {
        if (r.endMs <= r.startMs) return false
        return monthOf(dayOf(r.startMs)) == month || monthOf(dayOf(r.endMs - 1)) == month
    }
}
