package screenloop.billing

import kotlinx.serialization.Serializable

/** 정산서 한 줄/전체(명세의 Invoice 와 같은 모양, 미리보기는 id 가 null) */
@Serializable
data class InvoiceLineView(val id: Long?, val kind: String, val description: String, val quantity: Long, val unitWon: Long?, val amountWon: Long, val adjustsMonth: String? = null, val basisDays: List<String> = emptyList())

@Serializable
data class InvoiceView(val id: Long?, val accountId: String, val month: String, val status: String, val currency: String, val totalWon: Long, val lines: List<InvoiceLineView>)

fun InvoiceCalc.toView(accountId: String, status: String, id: Long? = null) = InvoiceView(
    id, accountId, month, status, "KRW", totalWon,
    lines.map { InvoiceLineView(null, it.kind, it.description, it.quantity, it.unitWon, it.amountWon, it.adjustsMonth, it.basis.map { b -> "${b.deviceId} ${b.day}" }) },
)

val DEFAULT_PLAN = Plan(9900, listOf(Tier(100, 100), Tier(300, 80), Tier(null, 60)))

/**
 * 정산 장부(메모리판): 수집한 기록과 마감한 달을 들고, 미리보기와 마감을 한다. 계산은 Billing.invoiceFor 그대로다.
 * 서버(PostgreSQL)는 같은 계산에 저장과 근거 추적(일별 사용량 보관)을 더한다.
 */
class BillingBook(val plan: Plan = DEFAULT_PLAN) {
    val records = ArrayList<BillRecord>()
    val closed = ArrayList<ClosedMonth>()

    fun add(r: BillRecord) { records.add(r) }

    /** nowMs 까지 도착한 기록으로 계산한다 */
    fun calc(month: String, nowMs: Long): InvoiceCalc = Billing.invoiceFor(month, records.filter { it.receivedAtMs <= nowMs }, plan, closed)

    /** 마감: 지금까지 반영한 조정액을 해당 달의 청구액에 더하고, 이 달을 마감 목록에 넣는다 */
    fun close(month: String, nowMs: Long): InvoiceCalc {
        val c = calc(month, nowMs)
        val own = c.lines.filter { it.kind != "adjustment" }.sumOf { it.amountWon }
        for (adj in c.lines.filter { it.kind == "adjustment" }) {
            val i = closed.indexOfFirst { it.month == adj.adjustsMonth }
            if (i >= 0) closed[i] = closed[i].copy(billedWon = closed[i].billedWon + adj.amountWon)
        }
        closed.add(ClosedMonth(month, nowMs, own))
        return c
    }

    fun isClosed(month: String) = closed.any { it.month == month }
}
