package screenloop

import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.util.concurrent.Callable
import java.util.concurrent.Executors

/** 재생 기록 수집(멱등·보류)과 월 마감 정산(근거 추적·조정 항목·재실행)을 실제 PostgreSQL 로 확인한다. */
class RecordsAndBillingIT : IntegrationBase() {
    @AfterEach fun resetClock() = clock.reset()

    private val H = 3_600_000L
    private fun kst(s: String) = java.time.OffsetDateTime.parse(s.replace(' ', 'T') + ":00+09:00").toInstant().toEpochMilli()
    private fun rec(seq: Long, start: Long, end: Long) = mapOf("seq" to seq, "itemId" to "welcome", "startedAtMs" to start, "endedAtMs" to end)
    private fun upload(device: String, offset: Long, recs: List<Map<String, Any>>): Res {
        val r = call("POST", "/api/devices/$device/play-records", body = mapOf("clockOffsetMs" to offset, "records" to recs), deviceKey = "dk-$device")
        assertEquals(200, r.status, "기록 업로드 응답: ${r.raw}")
        return r
    }

    @Test
    fun resendingTheSameBatchDoesNotDuplicateRecords() {
        clock.set(kst("2031-03-01 12:00"))
        val batch = (1L..5L).map { rec(it, kst("2031-03-01 10:00") + it * 60_000, kst("2031-03-01 10:00") + it * 60_000 + 50_000) }
        val first = upload("d-001", 0, batch).body!!
        val second = upload("d-001", 0, batch).body!!
        assertEquals(5, first["accepted"].asInt())
        assertEquals(0, second["accepted"].asInt())
        assertEquals(5, second["duplicates"].asInt())
        assertEquals(5, second["ackSeq"].asInt())
        assertEquals(5, jdbc.queryForObject("select count(*) from play_record where device_id='d-001' and seq <= 5", Int::class.java))
    }

    @Test
    fun simultaneousIdenticalUploadsStillStoreEachRecordOnce() {
        clock.set(kst("2031-03-02 12:00"))
        val batch = (1L..30L).map { rec(it, kst("2031-03-02 09:00") + it * 100_000, kst("2031-03-02 09:00") + it * 100_000 + 90_000) }
        val pool = Executors.newFixedThreadPool(6)
        val rs = pool.invokeAll((1..6).map { Callable { upload("d-002", 0, batch).body!! } }).map { it.get() }
        pool.shutdown()
        assertEquals(30, rs.sumOf { it["accepted"].asInt() }, "6번 보내도 수락은 합쳐서 30건")
        assertEquals(150, rs.sumOf { it["duplicates"].asInt() })
        assertEquals(30, jdbc.queryForObject("select count(*) from play_record where device_id='d-002' and seq <= 30", Int::class.java))
    }

    @Test
    fun clockSkewedDeviceIsCorrectedAndImpossibleRecordsAreQuarantinedAndExcludedFromBilling() {
        clock.set(kst("2032-03-31 11:30"))
        val skew = 2 * H // 기기 시계가 2시간 빠르다
        val s = kst("2032-03-31 10:00") + skew
        val ok = upload("d-003", -skew, listOf(rec(101, s, s + H))).body!!
        val future = upload("d-003", 0, listOf(rec(102, s, s + H))).body!! // 오프셋을 못 구해서 0 으로 보냄 → 서버 기준 미래
        val bad = upload("d-003", 0, listOf(rec(103, 5000, 5000), rec(104, 0, 7 * H))).body!!
        assertEquals(1, ok["accepted"].asInt())
        assertEquals(1, future["quarantined"].asInt())
        assertEquals(2, bad["quarantined"].asInt())
        val rows = call("GET", "/api/devices/d-003/play-records", operator).body!!
        assertEquals(listOf("accepted", "quarantined", "quarantined", "quarantined"), rows.reversed().map { it["status"].asText() })
        assertEquals(kst("2032-03-31 10:00"), rows.last()["serverStartedAtMs"].asLong(), "기기 시각 + 오프셋 = 서버 시각")
        val inv = call("GET", "/api/billing/preview?accountId=acct-1&month=2032-03", operator).body!!
        val tier = inv["lines"].first { it["kind"].asText() == "usage_tier" }
        assertEquals(3600, tier["quantity"].asLong(), "보류된 기록은 정산하지 않고 1시간만 센다")
    }

    @Test
    fun monthCloseKeepsClosedInvoiceAndPutsLateRecordsIntoNextInvoiceAsAdjustmentWithTrace() {
        // 2033-01 에 d-004 가 1시간 재생, 2월 1일에 마감
        clock.set(kst("2033-01-10 13:00"))
        upload("d-004", 0, listOf(rec(1, kst("2033-01-10 12:00"), kst("2033-01-10 13:00"))))
        clock.set(kst("2033-02-01 00:00"))
        val preview1 = call("GET", "/api/billing/preview?accountId=acct-1&month=2033-01", operator).body!!
        val preview1Again = call("GET", "/api/billing/preview?accountId=acct-1&month=2033-01", operator).body!!
        assertEquals(preview1, preview1Again, "집계를 다시 돌려도 같은 결과")
        val closeRes = call("POST", "/api/billing/close", operator, mapOf("accountId" to "acct-1", "month" to "2033-01"))
        assertEquals(200, closeRes.status, closeRes.raw)
        val closed = closeRes.body!!
        assertEquals(10_000, closed["totalWon"].asLong())
        assertEquals(409, call("POST", "/api/billing/close", operator, mapOf("accountId" to "acct-1", "month" to "2033-01")).status)

        // 마감 뒤(2/3)에 1월 기록이 늦게 도착: d-004 2시간, d-003 30분
        clock.set(kst("2033-02-03 09:00"))
        upload("d-004", 0, listOf(rec(2, kst("2033-01-20 12:00"), kst("2033-01-20 14:00"))))
        upload("d-003", 0, listOf(rec(201, kst("2033-01-25 12:00"), kst("2033-01-25 12:30"))))
        // 2월에는 1시간 재생
        clock.set(kst("2033-02-05 13:00"))
        upload("d-004", 0, listOf(rec(3, kst("2033-02-05 12:00"), kst("2033-02-05 13:00"))))
        clock.set(kst("2033-03-01 00:00"))
        val febRes = call("POST", "/api/billing/close", operator, mapOf("accountId" to "acct-1", "month" to "2033-02"))
        assertEquals(200, febRes.status, febRes.raw)
        val feb = febRes.body!!
        val adj = feb["lines"].first { it["kind"].asText() == "adjustment" }
        assertEquals(10_150, adj["amountWon"].asLong(), "1월을 다시 계산한 20,150 - 이미 청구한 10,000")
        assertEquals(20_150, feb["totalWon"].asLong())
        // 마감한 1월 정산서는 그대로다
        assertEquals(10_000, call("GET", "/api/invoices/${closed["id"].asLong()}", operator).body!!["totalWon"].asLong())

        // 조정 한 줄에서 일별 사용량과 원본 재생 기록까지 거슬러 올라간다
        val trace = call("GET", "/api/invoice-lines/${adj["id"].asLong()}/trace", viewer).body!!
        assertEquals(listOf("2033-01-20", "2033-01-25"), trace["daily"].map { it["day"].asText() }.sorted())
        val recordRows = trace["records"].map { it["deviceId"].asText() + "#" + it["seq"].asInt() }.sorted()
        assertEquals(listOf("d-003#201", "d-004#2"), recordRows)
        // 한 번 반영한 차액은 다음 달 정산서에 다시 나오지 않는다
        clock.set(kst("2033-03-02 00:00"))
        val mar = call("GET", "/api/billing/preview?accountId=acct-1&month=2033-03", operator).body!!
        assertTrue(mar["lines"].none { it["kind"].asText() == "adjustment" })
        assertEquals(0, mar["totalWon"].asLong())
    }
}
