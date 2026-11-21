package screenloop

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import screenloop.records.classifyRecord

/** 재생 기록 검사 기준이 TypeScript 와 같은지(spec/vectors/records-ingest.json). 멱등(중복 제거)은 DB 제약이라 통합 테스트에서 본다. */
class RecordsVectorsTest {
    private val vectors = Spec.vector("records-ingest.json")

    private fun statuses(name: String): List<String> {
        val scn = vectors["scenarios"].first { it["name"].asText() == name }
        return scn["batches"].flatMap { b ->
            b["records"].map { r ->
                val c = classifyRecord(r["startedAtMs"].asLong(), r["endedAtMs"].asLong(), b["clockOffsetMs"].asLong(), b["receivedAtMs"].asLong())
                if (c.accepted) "accepted" else "quarantined:${c.reason}"
            }
        }
    }

    private fun expected(name: String) = vectors["scenarios"].first { it["name"].asText() == name }["batches"].flatMap { b -> b["firstSeenStatuses"].map { it.asText() } }

    @Test fun invalidRecordsAreQuarantinedForTheSameReasons() = assertEquals(expected("invalid-records"), statuses("invalid-records"))

    @Test fun skewedClockIsCorrectedByOffset() = assertEquals(expected("skewed-device-clock"), statuses("skewed-device-clock"))

    @Test fun resendClassificationMatches() = assertEquals(expected("resend-is-idempotent"), statuses("resend-is-idempotent"))
}
