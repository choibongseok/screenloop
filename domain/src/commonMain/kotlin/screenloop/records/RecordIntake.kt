package screenloop.records

import kotlinx.serialization.Serializable

@Serializable
data class RecordInput(val seq: Long, val itemId: String, val startedAtMs: Long, val endedAtMs: Long)

@Serializable
data class RecordBatch(val clockOffsetMs: Long, val records: List<RecordInput>)

@Serializable
data class IntakeResult(val accepted: Int, val duplicates: Int, val quarantined: Int, val ackSeq: Long)

@Serializable
data class StoredRecord(
    val id: Long, val deviceId: String, val seq: Long, val itemId: String, val startedAtMs: Long, val endedAtMs: Long,
    val status: String, val reason: String?, val receivedAtMs: Long, val serverStartedAtMs: Long, val serverEndedAtMs: Long,
)

/**
 * 재생 기록 수집(메모리판). (기기, 일련번호)가 같은 기록은 처음 것만 남기고 중복으로 센다. 검사 기준은 classifyRecord.
 * 서버(PostgreSQL)는 같은 규칙을 유일 제약과 INSERT ... ON CONFLICT 로 구현한다.
 */
class RecordIntake {
    val rows = ArrayList<StoredRecord>()
    private val keys = HashSet<String>()
    private val ack = HashMap<String, Long>()
    var duplicatesTotal = 0
        private set

    fun ingest(deviceId: String, batch: RecordBatch, receivedAtMs: Long): IntakeResult {
        var accepted = 0
        var dup = 0
        var quarantined = 0
        for (r in batch.records) {
            if (!keys.add("$deviceId#${r.seq}")) { dup++; continue }
            val c = classifyRecord(r.startedAtMs, r.endedAtMs, batch.clockOffsetMs, receivedAtMs)
            rows.add(
                StoredRecord(
                    rows.size + 1L, deviceId, r.seq, r.itemId, r.startedAtMs, r.endedAtMs, if (c.accepted) "accepted" else "quarantined", c.reason,
                    receivedAtMs, r.startedAtMs + batch.clockOffsetMs, r.endedAtMs + batch.clockOffsetMs,
                ),
            )
            if (c.accepted) accepted++ else quarantined++
            ack[deviceId] = maxOf(ack[deviceId] ?: 0L, r.seq)
        }
        duplicatesTotal += dup
        return IntakeResult(accepted, dup, quarantined, ack[deviceId] ?: 0L)
    }
}
