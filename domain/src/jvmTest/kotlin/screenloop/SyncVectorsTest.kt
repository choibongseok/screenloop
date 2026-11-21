package screenloop

import com.fasterxml.jackson.databind.JsonNode
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import screenloop.sync.Accepted
import screenloop.sync.CommandParser
import screenloop.sync.DeviceState
import screenloop.sync.Rejected
import screenloop.sync.StateEvent
import screenloop.sync.decide
import screenloop.sync.nowPlaying
import screenloop.sync.reduce

/** TypeScript sync-core 와 같은 벡터(spec/vectors/sync-authority.json)를 읽어, Kotlin 구현이 같은 결과를 내는지 확인한다. */
class SyncVectorsTest {
    private val vectors = Spec.vector("sync-authority.json")

    private fun runScenario(name: String) {
        val scn = vectors["scenarios"].first { it["name"].asText() == name }
        val deviceId = scn["deviceId"].asText()
        var state = DeviceState.initial(deviceId)
        for ((i, step) in scn["steps"].withIndex()) {
            val label = "$name 단계 ${i + 1} ${step["command"]["type"].asText()}"
            val cmd = CommandParser.parse(kotlinx.serialization.json.Json.parseToJsonElement(step["command"].toString())) ?: error("$label: 명령을 읽지 못함")
            val now = step["nowMs"].asLong()
            val expect = step["expect"]
            when (val d = decide(state, cmd, now)) {
                is Accepted -> {
                    assertEquals("accepted", expect["result"].asText(), label)
                    val ev: StateEvent = d.event(deviceId, state.version + 1, now, step["actor"].asText())
                    assertEquals(expect["event"], Spec.norm(ev), "$label 이벤트")
                    state = reduce(state, ev)
                }
                is Rejected -> {
                    assertEquals("rejected", expect["result"].asText(), label)
                    assertEquals(expect["reason"].asText(), d.reason.wire, label)
                }
            }
        }
        assertEquals(scn["finalState"], Spec.norm(state), "$name 끝 상태")
        for (p in scn["probes"]) {
            val np = nowPlaying(state, p["atMs"].asLong())
            val expectedItem: JsonNode = p["itemId"]
            assertEquals(if (expectedItem.isNull) null else expectedItem.asText(), np?.item?.id, "$name 재생 항목 ${p["atMs"]}")
            assertEquals(if (p["offsetInItemMs"].isNull) null else p["offsetInItemMs"].asLong(), np?.offsetInItemMs, "$name 항목 안 위치 ${p["atMs"]}")
        }
    }

    @Test fun basicPlayback() = runScenario("basic-playback")
    @Test fun concurrentOperators() = runScenario("concurrent-operators")
    @Test fun timeWindows() = runScenario("time-windows")
    @Test fun invalidInputs() = runScenario("invalid-inputs")
    @Test fun emptySchedule() = runScenario("empty-schedule")
    @Test fun windowBoundary() = runScenario("window-boundary")
}
