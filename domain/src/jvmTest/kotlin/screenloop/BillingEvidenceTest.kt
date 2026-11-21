package screenloop

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.node.ArrayNode
import com.fasterxml.jackson.databind.node.ObjectNode
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import screenloop.billing.BillRecord
import screenloop.billing.Billing
import screenloop.billing.ClosedMonth
import screenloop.billing.Plan
import screenloop.billing.Tier
import java.io.File
import java.time.Instant
import java.time.ZoneOffset

/**
 * 데모 사이트에 싣는 "서버가 실제로 계산한 결과"를 만든다. 정산 벡터의 입력을 Billing(Kotlin 서버 코드)에 넣어
 * 나온 줄·일별 사용량을 docs/evidence/billing-run.json 으로 쓴다. 브라우저에서는 정산을 계산하지 않고 이 파일을 읽는다.
 */
class BillingEvidenceTest {
    private val m = Spec.mapper
    private fun kst(ms: Long): String = Instant.ofEpochMilli(ms).atOffset(ZoneOffset.ofHours(9)).toLocalDateTime().toString().replace('T', ' ').substring(0, 16)

    @Test
    fun writeBillingRunEvidenceFromActualComputation() {
        val vectors = Spec.vector("billing.json")
        val out = m.createObjectNode()
        out.put("generatedBy", "server 의 Billing(Kotlin)을 spec/vectors/billing.json 입력으로 실행한 결과")
        val scenarios = out.putArray("scenarios")
        var lines = 0
        for (scn in vectors["scenarios"]) {
            val plan = scn["plan"].let { p -> Plan(p["screenFeeWon"].asLong(), p["tiers"].map { Tier(if (it["upToHours"].isNull) null else it["upToHours"].asLong(), it["rateWonPerHour"].asLong()) }) }
            val all = scn["records"].map { BillRecord(it["id"].asLong(), it["deviceId"].asText(), it["startMs"].asLong(), it["endMs"].asLong(), it["receivedAtMs"].asLong()) }
            val s = scenarios.addObject()
            s.put("name", scn["name"].asText()).put("note", scn["note"].asText())
            s.set<JsonNode>("plan", scn["plan"])
            val recs: ArrayNode = s.putArray("records")
            all.forEach { r -> recs.addObject().put("id", r.id).put("deviceId", r.deviceId).put("start", kst(r.startMs)).put("end", kst(r.endMs)).put("receivedAt", kst(r.receivedAtMs)).put("seconds", (r.endMs - r.startMs) / 1000) }
            val steps = s.putArray("steps")
            val closed = ArrayList<ClosedMonth>()
            for (step in scn["steps"]) {
                val now = step["nowMs"].asLong()
                val month = step["month"].asText()
                val calc = Billing.invoiceFor(month, all.filter { it.receivedAtMs <= now }, plan, closed)
                val st: ObjectNode = steps.addObject()
                st.put("op", step["op"].asText()).put("month", month).put("at", kst(now)).put("totalWon", calc.totalWon)
                val ls = st.putArray("lines")
                for (l in calc.lines) {
                    val o = ls.addObject().put("kind", l.kind).put("description", l.description).put("quantity", l.quantity).put("amountWon", l.amountWon)
                    if (l.unitWon == null) o.putNull("unitWon") else o.put("unitWon", l.unitWon)
                    if (l.adjustsMonth != null) o.put("adjustsMonth", l.adjustsMonth)
                    val b = o.putArray("basisDays")
                    l.basis.forEach { b.add("${it.deviceId} ${it.day}") }
                    lines++
                }
                val us = st.putArray("usage")
                val basisKeys = calc.lines.flatMap { l -> l.basis.map { "${it.deviceId} ${it.day}" } }.toSet()
                for (u in calc.usage.filter { Billing.monthOf(it.day) == month || "${it.deviceId} ${it.day}" in basisKeys }) us.addObject().put("deviceId", u.deviceId).put("day", u.day).put("billedSeconds", u.billedSeconds).set<JsonNode>("recordIds", m.valueToTree(u.recordIds))
                if (step["op"].asText() == "close") {
                    val own = calc.lines.filter { it.kind != "adjustment" }.sumOf { it.amountWon }
                    for (adj in calc.lines.filter { it.kind == "adjustment" }) {
                        val idx = closed.indexOfFirst { it.month == adj.adjustsMonth }
                        closed[idx] = closed[idx].copy(billedWon = closed[idx].billedWon + adj.amountWon)
                    }
                    closed.add(ClosedMonth(month, now, own))
                }
            }
        }
        assertTrue(lines >= 7, "정산 줄이 충분히 나와야 한다: $lines")
        val file = File(Spec.dir.parentFile, "docs/evidence/billing-run.json")
        file.parentFile.mkdirs()
        file.writeText(m.writerWithDefaultPrettyPrinter().writeValueAsString(out) + "\n")
    }
}
