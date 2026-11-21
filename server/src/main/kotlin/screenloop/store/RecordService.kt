package screenloop.store

import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import screenloop.records.classifyRecord
import java.time.Clock

data class RecordInput(val seq: Long, val itemId: String, val startedAtMs: Long, val endedAtMs: Long)
data class RecordBatch(val clockOffsetMs: Long, val records: List<RecordInput>)
data class RecordResult(val accepted: Int, val duplicates: Int, val quarantined: Int, val ackSeq: Long)
data class RecordRow(
    val id: Long, val deviceId: String, val seq: Long, val itemId: String, val startedAtMs: Long, val endedAtMs: Long,
    val status: String, val reason: String?, val receivedAtMs: Long, val serverStartedAtMs: Long, val serverEndedAtMs: Long,
)

@Service
class RecordService(private val jdbc: JdbcTemplate, private val repo: DeviceRepo, private val clock: Clock) {
    /**
     * 재생 기록 수집. (device_id, seq) 가 이미 있으면 처음 것을 남기고 중복으로 센다 — 같은 배치를 몇 번 보내도 결과가 같다.
     * 시각이 이상한 기록(길이 0 이하, 6시간 초과, 미래)은 버리지 않고 quarantined 로 저장해 정산에서만 뺀다.
     */
    @Transactional
    fun ingest(deviceId: String, batch: RecordBatch): RecordResult {
        val now = clock.millis()
        var accepted = 0; var dup = 0; var quarantined = 0
        for (r in batch.records) {
            val c = classifyRecord(r.startedAtMs, r.endedAtMs, batch.clockOffsetMs, now)
            val n = jdbc.update(
                """insert into play_record (device_id, seq, item_id, started_at_ms, ended_at_ms, clock_offset_ms, received_at_ms, server_started_ms, server_ended_ms, status, reason)
                   values (?,?,?,?,?,?,?,?,?,?,?) on conflict (device_id, seq) do nothing""",
                deviceId, r.seq, r.itemId, r.startedAtMs, r.endedAtMs, batch.clockOffsetMs, now,
                r.startedAtMs + batch.clockOffsetMs, r.endedAtMs + batch.clockOffsetMs, if (c.accepted) "accepted" else "quarantined", c.reason,
            )
            if (n == 0) dup++ else if (c.accepted) accepted++ else quarantined++
        }
        repo.touch(deviceId, now)
        val ack = jdbc.queryForObject("select coalesce(max(seq), 0) from play_record where device_id = ?", Long::class.java, deviceId) ?: 0L
        return RecordResult(accepted, dup, quarantined, ack)
    }

    fun list(deviceId: String): List<RecordRow> = jdbc.query(
        """select id, device_id, seq, item_id, started_at_ms, ended_at_ms, status, reason, received_at_ms, server_started_ms, server_ended_ms
           from play_record where device_id = ? order by seq desc limit 200""", ::row, deviceId,
    )

    fun byIds(ids: List<Long>): List<RecordRow> = if (ids.isEmpty()) emptyList() else jdbc.query(
        """select id, device_id, seq, item_id, started_at_ms, ended_at_ms, status, reason, received_at_ms, server_started_ms, server_ended_ms
           from play_record where id = any(?) order by device_id, seq""", ::row, jdbc.dataSource!!.connection.use { it.createArrayOf("bigint", ids.toTypedArray()) },
    )

    private fun row(rs: java.sql.ResultSet, i: Int) = RecordRow(
        rs.getLong(1), rs.getString(2), rs.getLong(3), rs.getString(4), rs.getLong(5), rs.getLong(6),
        rs.getString(7), rs.getString(8), rs.getLong(9), rs.getLong(10), rs.getLong(11),
    )
}
