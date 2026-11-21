package screenloop

import com.fasterxml.jackson.databind.JsonNode
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import screenloop.billing.BillRecord
import screenloop.billing.Billing
import screenloop.billing.ClosedMonth
import screenloop.billing.DayKey
import screenloop.billing.Plan
import screenloop.billing.Tier

/** 정산 벡터(spec/vectors/billing.json, 기대값은 손으로 계산한 것)를 순수 계산 함수로 확인한다. */
class BillingVectorsTest {
    private val vectors = Spec.vector("billing.json")

    private fun plan(n: JsonNode) = Plan(n["screenFeeWon"].asLong(), n["tiers"].map { Tier(if (it["upToHours"].isNull) null else it["upToHours"].asLong(), it["rateWonPerHour"].asLong()) })

    private fun runScenario(name: String) {
        val scn = vectors["scenarios"].first { it["name"].asText() == name }
        val plan = plan(scn["plan"])
        val all = scn["records"].map { BillRecord(it["id"].asLong(), it["deviceId"].asText(), it["startMs"].asLong(), it["endMs"].asLong(), it["receivedAtMs"].asLong()) }
        val closed = ArrayList<ClosedMonth>()
        for (step in scn["steps"]) {
            val now = step["nowMs"].asLong()
            val month = step["month"].asText()
            val visible = all.filter { it.receivedAtMs <= now }
            val calc = Billing.invoiceFor(month, visible, plan, closed)
            val label = "$name ${step["op"].asText()} $month"

            val expLines = step["expectLines"]
            assertEquals(expLines.size(), calc.lines.size, "$label 줄 수: ${calc.lines}")
            for ((i, e) in expLines.withIndex()) {
                val l = calc.lines[i]
                assertEquals(e["kind"].asText(), l.kind, "$label 줄 $i 종류")
                assertEquals(e["quantity"].asLong(), l.quantity, "$label 줄 $i 수량")
                assertEquals(if (e["unitWon"].isNull) null else e["unitWon"].asLong(), l.unitWon, "$label 줄 $i 단가")
                assertEquals(e["amountWon"].asLong(), l.amountWon, "$label 줄 $i 금액")
                if (e.has("adjustsMonth")) assertEquals(e["adjustsMonth"].asText(), l.adjustsMonth, "$label 조정 대상 월")
                if (e.has("basisDays")) assertEquals(e["basisDays"].map { DayKey(it["deviceId"].asText(), it["day"].asText()) }, l.basis, "$label 근거 일별 사용량")
            }
            assertEquals(step["expectTotalWon"].asLong(), calc.totalWon, "$label 합계")

            val usage = calc.usage.filter { Billing.monthOf(it.day) == month }
            assertEquals(step["expectUsage"].size(), usage.size, "$label 일별 사용량 수: $usage")
            for ((i, e) in step["expectUsage"].withIndex()) {
                assertEquals(e["deviceId"].asText(), usage[i].deviceId, "$label 사용량 $i 기기")
                assertEquals(e["day"].asText(), usage[i].day, "$label 사용량 $i 날짜")
                assertEquals(e["billedSeconds"].asLong(), usage[i].billedSeconds, "$label 사용량 $i 초")
                if (e.has("recordIds")) assertEquals(e["recordIds"].map { it.asLong() }, usage[i].recordIds, "$label 사용량 $i 기록")
            }

            if (step["op"].asText() == "close") {
                // 마감: 지금까지의 조정액을 해당 달의 청구액에 더하고, 이 달을 마감 목록에 넣는다
                val own = calc.lines.filter { it.kind != "adjustment" }.sumOf { it.amountWon }
                for (adj in calc.lines.filter { it.kind == "adjustment" }) {
                    val idx = closed.indexOfFirst { it.month == adj.adjustsMonth }
                    closed[idx] = closed[idx].copy(billedWon = closed[idx].billedWon + adj.amountWon)
                }
                closed.add(ClosedMonth(month, now, own))
            }
        }
    }

    @Test fun tierPricing() = runScenario("tier-pricing")
    @Test fun overlapsAreCountedOnceAndMidnightIsSplit() = runScenario("overlap-and-midnight")
    @Test fun lateRecordsBecomeAdjustmentLineInNextInvoice() = runScenario("late-record-adjustment")

    @Test
    fun rerunningTheAggregationGivesTheSameResult() {
        val scn = vectors["scenarios"].first { it["name"].asText() == "overlap-and-midnight" }
        val recs = scn["records"].map { BillRecord(it["id"].asLong(), it["deviceId"].asText(), it["startMs"].asLong(), it["endMs"].asLong(), it["receivedAtMs"].asLong()) }
        val plan = plan(scn["plan"])
        val first = Billing.invoiceFor("2026-10", recs, plan, emptyList())
        val again = Billing.invoiceFor("2026-10", recs.shuffled(java.util.Random(7)).reversed(), plan, emptyList())
        assertEquals(first, again)
        assertTrue(first.lines.isNotEmpty())
    }

    @Test
    fun amountsAreIntegersAndRoundedDownPerTier() {
        // 1시간 59초 = 7,139초 → 7,139 × 100 / 3,600 = 198.3 → 198원(버림)
        val r = listOf(BillRecord(1, "d", 0, 7_139_000, 0))
        val calc = Billing.invoiceFor("1970-01", r, Plan(9900, listOf(Tier(null, 100))), emptyList())
        assertEquals(listOf(9900L, 198L), calc.lines.map { it.amountWon })
    }
}
