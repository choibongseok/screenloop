package screenloop.store

import com.fasterxml.jackson.databind.ObjectMapper
import org.springframework.dao.DuplicateKeyException
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.support.GeneratedKeyHolder
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import screenloop.billing.BillRecord
import screenloop.billing.Billing
import screenloop.billing.ClosedMonth
import screenloop.billing.InvoiceCalc
import screenloop.billing.Plan
import screenloop.billing.Tier
import java.sql.Statement
import java.time.Clock

data class InvoiceLineDto(val id: Long?, val kind: String, val description: String, val quantity: Long, val unitWon: Long?, val amountWon: Long)
data class InvoiceDto(val id: Long?, val accountId: String, val month: String, val status: String, val currency: String, val totalWon: Long, val lines: List<InvoiceLineDto>)
data class UsageDailyDto(val id: Long, val deviceId: String, val day: String, val billedSeconds: Long, val recordIds: List<Long>)
data class TraceDto(val line: InvoiceLineDto, val daily: List<UsageDailyDto>, val records: List<RecordRow>)

class AlreadyClosed(message: String) : RuntimeException(message)

@Service
class BillingService(private val jdbc: JdbcTemplate, private val mapper: ObjectMapper, private val records: RecordService, private val clock: Clock) {
    private fun plan(accountId: String): Plan {
        val json = jdbc.query("select plan::text from account where id = ?", { rs, _ -> rs.getString(1) }, accountId).firstOrNull() ?: throw NoSuchElementException("없는 계정: $accountId")
        val n = mapper.readTree(json)
        return Plan(n["screenFeeWon"].asLong(), n["tiers"].map { Tier(if (it["upToHours"].isNull) null else it["upToHours"].asLong(), it["rateWonPerHour"].asLong()) })
    }

    /** 정산에 쓰는 기록: 수집된 것 중 보류(quarantined)가 아닌 것. 시각은 서버 시각으로 맞춘 값. */
    private fun billRecords(accountId: String): List<BillRecord> = jdbc.query(
        """select p.id, p.device_id, p.server_started_ms, p.server_ended_ms, p.received_at_ms from play_record p
           join device d on d.id = p.device_id where d.account_id = ? and p.status = 'accepted' order by p.id""",
        { rs, _ -> BillRecord(rs.getLong(1), rs.getString(2), rs.getLong(3), rs.getLong(4), rs.getLong(5)) }, accountId,
    )

    /** 마감한 달과 그 달 몫으로 지금까지 청구한 금액(마감 정산서의 기본료·구간 합 + 이후 조정 합) */
    private fun closedMonths(accountId: String): List<ClosedMonth> = jdbc.query(
        """select i.month, i.closed_at_ms,
             coalesce((select sum(l.amount_won) from invoice_line l where l.invoice_id = i.id and l.kind <> 'adjustment'), 0)
           + coalesce((select sum(l2.amount_won) from invoice_line l2 where l2.kind = 'adjustment' and l2.adjusts_month = i.month), 0)
           from invoice i where i.account_id = ? and i.status = 'closed' order by i.month""",
        { rs, _ -> ClosedMonth(rs.getString(1), rs.getLong(2), rs.getLong(3)) }, accountId,
    )

    private fun calc(accountId: String, month: String): InvoiceCalc = Billing.invoiceFor(month, billRecords(accountId), plan(accountId), closedMonths(accountId))

    fun preview(accountId: String, month: String): InvoiceDto {
        val c = calc(accountId, month)
        return InvoiceDto(null, accountId, month, "preview", "KRW", c.totalWon, c.lines.map { InvoiceLineDto(null, it.kind, it.description, it.quantity, it.unitWon, it.amountWon) })
    }

    /** 마감: 집계 결과(일별 사용량)와 정산 줄을 저장하고, 줄마다 근거가 되는 일별 사용량을 연결한다. 이미 마감한 달이면 AlreadyClosed. */
    @Transactional
    fun close(accountId: String, month: String): InvoiceDto {
        // 같은 계정의 마감이 동시에 두 번 오지 않도록 계정 행을 잠근다
        jdbc.queryForObject("select id from account where id = ? for update", String::class.java, accountId)
        if (jdbc.queryForObject("select count(*) from invoice where account_id = ? and month = ?", Long::class.java, accountId, month)!! > 0) throw AlreadyClosed("$month 은 이미 마감했습니다")
        val now = clock.millis()
        val c = calc(accountId, month)
        val runId = insertReturningId("insert into billing_run (account_id, month, at_ms) values (?,?,?)", accountId, month, now)
        val keepMonths = setOf(month) + c.lines.mapNotNull { it.adjustsMonth }
        val dailyIds = HashMap<Pair<String, String>, Long>()
        for (u in c.usage.filter { Billing.monthOf(it.day) in keepMonths }) {
            val id = insertReturningId(
                "insert into usage_daily (run_id, device_id, day, billed_seconds, record_ids) values (?,?,?,?,?)",
                runId, u.deviceId, u.day, u.billedSeconds, jdbc.dataSource!!.connection.use { it.createArrayOf("bigint", u.recordIds.toTypedArray()) },
            )
            dailyIds[u.deviceId to u.day] = id
        }
        val invoiceId = insertReturningId("insert into invoice (account_id, month, status, total_won, closed_at_ms, run_id) values (?,?,?,?,?,?)", accountId, month, "closed", c.totalWon, now, runId)
        val lines = ArrayList<InvoiceLineDto>()
        for ((i, l) in c.lines.withIndex()) {
            val lineId = insertReturningId(
                "insert into invoice_line (invoice_id, seq, kind, description, quantity, unit_won, amount_won, adjusts_month) values (?,?,?,?,?,?,?,?)",
                invoiceId, i, l.kind, l.description, l.quantity, l.unitWon, l.amountWon, l.adjustsMonth,
            )
            for (b in l.basis) dailyIds[b.deviceId to b.day]?.let { jdbc.update("insert into invoice_line_usage (line_id, usage_daily_id) values (?,?) on conflict do nothing", lineId, it) }
            lines.add(InvoiceLineDto(lineId, l.kind, l.description, l.quantity, l.unitWon, l.amountWon))
        }
        return InvoiceDto(invoiceId, accountId, month, "closed", "KRW", c.totalWon, lines)
    }

    private fun insertReturningId(sql: String, vararg args: Any?): Long {
        val kh = GeneratedKeyHolder()
        try {
            jdbc.update({ con ->
                val ps = con.prepareStatement(sql, Statement.RETURN_GENERATED_KEYS)
                args.forEachIndexed { i, a -> ps.setObject(i + 1, a) }
                ps
            }, kh)
        } catch (e: DuplicateKeyException) { throw AlreadyClosed("이미 마감했습니다") }
        return (kh.keys!!["id"] as Number).toLong()
    }

    private fun lines(invoiceId: Long): List<InvoiceLineDto> = jdbc.query(
        "select id, kind, description, quantity, unit_won, amount_won from invoice_line where invoice_id = ? order by seq",
        { rs, _ -> InvoiceLineDto(rs.getLong(1), rs.getString(2), rs.getString(3), rs.getLong(4), rs.getLong(5).takeUnless { rs.wasNull() }, rs.getLong(6)) }, invoiceId,
    )

    fun invoice(id: Long): InvoiceDto? = jdbc.query("select id, account_id, month, status, total_won from invoice where id = ?", { rs, _ ->
        InvoiceDto(rs.getLong(1), rs.getString(2), rs.getString(3), rs.getString(4), "KRW", rs.getLong(5), lines(rs.getLong(1)))
    }, id).firstOrNull()

    fun trace(lineId: Long): TraceDto? {
        val line = jdbc.query("select id, kind, description, quantity, unit_won, amount_won from invoice_line where id = ?", { rs, _ ->
            InvoiceLineDto(rs.getLong(1), rs.getString(2), rs.getString(3), rs.getLong(4), rs.getLong(5).takeUnless { rs.wasNull() }, rs.getLong(6))
        }, lineId).firstOrNull() ?: return null
        val daily = jdbc.query(
            """select u.id, u.device_id, u.day, u.billed_seconds, u.record_ids from invoice_line_usage x join usage_daily u on u.id = x.usage_daily_id
               where x.line_id = ? order by u.device_id, u.day""",
            { rs, _ -> UsageDailyDto(rs.getLong(1), rs.getString(2), rs.getString(3), rs.getLong(4), (rs.getArray(5).array as Array<*>).map { (it as Number).toLong() }) }, lineId,
        )
        // 조정 항목은 늦게 도착한 기록만 근거로 보여 준다(그 줄이 설명하는 차액의 원인)
        val ids = daily.flatMap { it.recordIds }.distinct()
        return TraceDto(line, daily, records.byIds(ids))
    }
}
