package screenloop.records

/** 재생 기록 한 건을 검사하는 기준. TypeScript sync-core 의 classifyRecord 와 같은 값이다(spec/vectors/records-ingest.json). */
const val MAX_RECORD_MS = 6L * 3600 * 1000
const val FUTURE_TOLERANCE_MS = 5L * 60 * 1000

data class Classified(val accepted: Boolean, val reason: String?)

fun classifyRecord(startedAtMs: Long, endedAtMs: Long, clockOffsetMs: Long, receivedAtMs: Long): Classified = when {
    endedAtMs <= startedAtMs -> Classified(false, "non_positive")
    endedAtMs - startedAtMs > MAX_RECORD_MS -> Classified(false, "too_long")
    endedAtMs + clockOffsetMs > receivedAtMs + FUTURE_TOLERANCE_MS -> Classified(false, "in_future")
    else -> Classified(true, null)
}
