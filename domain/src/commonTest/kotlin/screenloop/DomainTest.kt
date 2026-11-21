package screenloop

import screenloop.billing.BillRecord
import screenloop.billing.BillingBook
import screenloop.records.RecordBatch
import screenloop.records.RecordInput
import screenloop.records.RecordIntake
import screenloop.sync.DeviceServer
import screenloop.sync.DomainJson
import screenloop.sync.DeviceState
import screenloop.sync.PlaybackNext
import screenloop.sync.PlaybackPause
import screenloop.sync.ScheduleItem
import screenloop.sync.ScheduleReplace
import screenloop.sync.StateEvent
import screenloop.sync.VolumeSet
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** JVM 과 JS 양쪽에서 같은 이름으로 돌아가는 도메인 시험(메모리판 서버·수집·정산 장부). */
class DomainTest {
    private val items = listOf(ScheduleItem("a", "A", "grid", 10), ScheduleItem("b", "B", "waves", 20))
    private val t0 = 1_700_000_000_000L

    private fun server(): DeviceServer {
        val s = DeviceServer("d-1")
        s.submit(ScheduleReplace("seed", 0, items), t0, "sys")
        return s
    }

    @Test
    fun deviceServerAssignsContiguousVersionsAndRepliesToRepeatedCommandId() {
        val s = server()
        val a = s.submit(VolumeSet("c1", 70), t0 + 10, "op")
        val again = s.submit(VolumeSet("c1", 70), t0 + 20, "op")
        val b = s.submit(VolumeSet("c2", 30), t0 + 30, "op")
        assertEquals(listOf(1L, 2L, 3L), s.log.map { it.version })
        assertFalse(a.replayed)
        assertTrue(again.replayed)
        assertEquals(a.version, again.version)
        assertEquals(3L, b.version)
    }

    @Test
    fun secondNextFromTheSameItemIsStaleAndNoEventIsAdded() {
        val s = server()
        val first = s.submit(PlaybackNext("n1", "a"), t0 + 1000, "op-a")
        val second = s.submit(PlaybackNext("n2", "a"), t0 + 1100, "op-b")
        assertEquals("accepted", first.result)
        assertEquals("stale", second.reason)
        assertEquals(2, s.log.size)
        assertEquals("unchanged", run { s.submit(PlaybackPause("p1"), t0 + 1200, "op"); s.submit(PlaybackPause("p2"), t0 + 1300, "op").reason })
    }

    @Test
    fun eventJsonUsesTypeFieldAndOmitsNullWindow() {
        val s = server()
        val ev = s.log.first()
        val json = DomainJson.encodeToString(StateEvent.serializer(), ev)
        assertTrue(json.contains("\"type\":\"schedule.replaced\""), json)
        assertFalse(json.contains("window"), json)
        assertTrue(DomainJson.encodeToString(DeviceState.serializer(), s.state).contains("\"override\":null"))
    }

    @Test
    fun intakeCountsRepeatedSequenceNumbersOnceAndQuarantinesImpossibleRecords() {
        val intake = RecordIntake()
        val now = t0
        val batch = RecordBatch(0, listOf(RecordInput(1, "a", now - 60_000, now - 50_000), RecordInput(2, "a", now - 5_000, now - 9_000), RecordInput(3, "a", now + 3_600_000, now + 3_660_000)))
        val r1 = intake.ingest("d-1", batch, now)
        val r2 = intake.ingest("d-1", batch, now + 1000)
        assertEquals(1, r1.accepted)
        assertEquals(2, r1.quarantined)
        assertEquals(3, r2.duplicates)
        assertEquals(3L, r2.ackSeq)
        assertEquals(3, intake.rows.size)
    }

    @Test
    fun billingBookPutsLateRecordsIntoNextMonthAsAdjustment() {
        val book = BillingBook()
        val h = 3_600_000L
        val oct10 = 1_760_054_400_000L // 2025-10-10 00:00 UTC 근처. 날짜는 한국 시간으로 계산된다.
        book.add(BillRecord(1, "d-1", oct10, oct10 + h, oct10 + h))
        val closedOct = book.close("2025-10", oct10 + 30 * 24 * h)
        assertEquals(10_000L, closedOct.totalWon)
        // 마감 뒤 도착한 10월 기록
        book.add(BillRecord(2, "d-1", oct10 + 24 * h, oct10 + 26 * h, oct10 + 35 * 24 * h))
        val nov = book.calc("2025-11", oct10 + 40 * 24 * h)
        val adj = nov.lines.single { it.kind == "adjustment" }
        assertEquals("2025-10", adj.adjustsMonth)
        assertEquals(200L, adj.amountWon) // 2시간 × 시간당 100원, 화면 수는 그대로
        assertEquals(200L, nov.totalWon)
    }
}
