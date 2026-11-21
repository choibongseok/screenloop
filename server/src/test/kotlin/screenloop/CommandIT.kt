package screenloop

import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.net.URI
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.util.concurrent.Callable
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/** 실제 PostgreSQL·Redis 로 명령 처리·이벤트 순서·SSE·권한을 확인한다. */
class CommandIT : IntegrationBase() {
    @AfterEach fun resetClock() = clock.reset()

    private fun snapshot(device: String) = call("GET", "/api/devices/$device/snapshot", operator).body!!["state"]

    @Test
    fun seededDevicesStartWithScheduleAtVersionOne() {
        val devices = call("GET", "/api/devices", viewer).body!!
        assertEquals(4, devices.size())
        val s = snapshot("d-001")
        assertTrue(s["version"].asLong() >= 1)
        assertTrue(s["scheduleVersion"].asInt() >= 1)
        assertEquals(3, s["schedule"]["items"].size())
        val first = call("GET", "/api/devices/d-001/events?after=0", operator).body!!
        assertEquals("schedule.replaced", first[0]["type"].asText())
        assertEquals(1, first[0]["version"].asInt())
    }

    @Test
    fun concurrentCommandsGetContiguousVersionsAndNoGaps() {
        val before = snapshot("d-002")["version"].asLong()
        val pool = Executors.newFixedThreadPool(8)
        val tasks = (1..24).map { i -> Callable { call("POST", "/api/devices/d-002/commands", operator, cmd("volume.set", "volume" to (if (i % 2 == 0) i else 100 - i))) } }
        val results = pool.invokeAll(tasks).map { it.get() }
        pool.shutdown()
        val accepted = results.filter { it.body!!["result"].asText() == "accepted" }
        val versions = accepted.map { it.body!!["version"].asLong() }.sorted()
        assertEquals((before + 1..before + accepted.size).toList(), versions, "버전은 빠짐도 겹침도 없이 이어진다")
        val events = call("GET", "/api/devices/d-002/events?after=$before", operator).body!!
        assertEquals(accepted.size, events.size())
        assertEquals(snapshot("d-002")["version"].asLong(), before + accepted.size)
    }

    @Test
    fun relativeNextIsStaleForTheLaterOfTwoOperatorsAndSameCommandIdIsReplayed() {
        // 한 항목에 머물도록 일시정지 후 이동
        call("POST", "/api/devices/d-003/commands", operator, cmd("playback.jump", "itemId" to "welcome"))
        call("POST", "/api/devices/d-003/commands", operator, cmd("playback.pause"))
        val a = call("POST", "/api/devices/d-003/commands", operator, cmd("playback.next", "fromItemId" to "welcome")).body!!
        val b = call("POST", "/api/devices/d-003/commands", operator, cmd("playback.next", "fromItemId" to "welcome")).body!!
        assertEquals("accepted", a["result"].asText())
        assertEquals("rejected", b["result"].asText())
        assertEquals("stale", b["reason"].asText())
        val same = cmd("volume.set", "volume" to 61)
        val first = call("POST", "/api/devices/d-003/commands", operator, same).body!!
        val v = snapshot("d-003")["version"].asLong()
        val again = call("POST", "/api/devices/d-003/commands", operator, same).body!!
        assertFalse(first["replayed"].asBoolean())
        assertTrue(again["replayed"].asBoolean())
        assertEquals(first["version"], again["version"])
        assertEquals(v, snapshot("d-003")["version"].asLong(), "다시 보내도 새 이벤트가 생기지 않는다")
    }

    @Test
    fun scheduleReplaceUsesFirstWriterWins() {
        val base = snapshot("d-004")["scheduleVersion"].asLong()
        val items = listOf(mapOf("id" to "x1", "title" to "새 편성", "sceneId" to "pulse", "durationSec" to 9))
        val a = call("POST", "/api/devices/d-004/commands", operator, cmd("schedule.replace", "baseScheduleVersion" to base, "items" to items)).body!!
        val b = call("POST", "/api/devices/d-004/commands", operator, cmd("schedule.replace", "baseScheduleVersion" to base, "items" to items.map { it + ("title" to "늦은 저장") })).body!!
        assertEquals("accepted", a["result"].asText())
        assertEquals("conflict", b["reason"].asText())
        assertEquals("새 편성", snapshot("d-004")["schedule"]["items"][0]["title"].asText())
    }

    @Test
    fun sseStreamDeliversEventsThroughRedisAndReplaysAfterLastEventId() {
        val v0 = snapshot("d-001")["version"].asLong()
        val lines = java.util.concurrent.LinkedBlockingQueue<String>()
        val req = HttpRequest.newBuilder(URI("http://127.0.0.1:$port/api/devices/d-001/stream")).header("Authorization", "Bearer $operator").header("Last-Event-ID", v0.toString()).build()
        val future = http.sendAsync(req, HttpResponse.BodyHandlers.ofLines()).thenAccept { r -> r.body().forEach { lines.add(it) } }
        assertEquals("connected", awaitLine(lines) { it.startsWith(":") }.removePrefix(":").trim())
        val sent = call("POST", "/api/devices/d-001/commands", operator, cmd("volume.set", "volume" to (30 + (System.nanoTime() % 40).toInt()))).body!!
        if (sent["result"].asText() == "accepted") {
            val data = awaitLine(lines) { it.startsWith("data:{") }
            assertEquals(sent["version"].asLong(), json.readTree(data.removePrefix("data:").trim())["version"].asLong())
        }
        future.cancel(true)
        // 끊겼다 다시 붙기: 그 사이에 쌓인 이벤트를 Last-Event-ID 이후부터 받는다
        val latest = snapshot("d-001")["version"].asLong()
        call("POST", "/api/devices/d-001/commands", operator, cmd("override.set", "text" to "점검 안내"))
        call("POST", "/api/devices/d-001/commands", operator, cmd("override.clear"))
        val replay = java.util.concurrent.LinkedBlockingQueue<String>()
        val req2 = HttpRequest.newBuilder(URI("http://127.0.0.1:$port/api/devices/d-001/stream")).header("Authorization", "Bearer $operator").header("Last-Event-ID", latest.toString()).build()
        val f2 = http.sendAsync(req2, HttpResponse.BodyHandlers.ofLines()).thenAccept { r -> r.body().forEach { replay.add(it) } }
        val got = (1..2).map { json.readTree(awaitLine(replay) { it.startsWith("data:{") }.removePrefix("data:").trim())["type"].asText() }
        f2.cancel(true)
        assertEquals(listOf("override.set", "override.cleared"), got)
    }

    private fun awaitLine(q: java.util.concurrent.LinkedBlockingQueue<String>, match: (String) -> Boolean): String {
        val end = System.nanoTime() + TimeUnit.SECONDS.toNanos(10)
        while (System.nanoTime() < end) {
            val l = q.poll(200, TimeUnit.MILLISECONDS) ?: continue
            if (match(l)) return l
        }
        error("10초 안에 기대한 줄이 오지 않음")
    }

    @Test
    fun permissionsAreCheckedOnTheServer() {
        assertEquals(401, call("GET", "/api/devices").status)
        assertEquals(401, call("GET", "/api/devices", "garbage.token").status)
        assertEquals(403, call("POST", "/api/devices/d-001/commands", viewer, cmd("playback.pause")).status)
        assertEquals(200, call("GET", "/api/devices/d-001/snapshot", viewer).status)
        assertEquals(403, call("POST", "/api/billing/close", viewer, mapOf("accountId" to "acct-1", "month" to "2031-01")).status)
        // 기기 키: 자기 화면의 스냅샷은 읽지만 다른 화면은 못 읽고, 명령은 못 보낸다
        assertEquals(200, call("GET", "/api/devices/d-001/snapshot", deviceKey = "dk-d-001").status)
        assertEquals(403, call("GET", "/api/devices/d-002/snapshot", deviceKey = "dk-d-001").status)
        assertEquals(403, call("POST", "/api/devices/d-001/commands", body = cmd("playback.pause"), deviceKey = "dk-d-001").status)
        assertEquals(401, call("GET", "/api/devices/d-001/snapshot", deviceKey = "dk-wrong").status)
        assertEquals(401, call("POST", "/api/auth/login", body = mapOf("username" to "operator", "password" to "x")).status)
    }

    @Test
    fun groupCommandAppliesToEveryDeviceWithSeparateOutcomes() {
        call("POST", "/api/devices/d-004/commands", operator, cmd("volume.set", "volume" to 11))
        val r = call("POST", "/api/groups/g-2/commands", operator, cmd("volume.set", "volume" to 11)).body!!
        val byDevice = r["results"].associate { it["deviceId"].asText() to it["outcome"]["result"].asText() }
        assertEquals(mapOf("d-003" to "accepted", "d-004" to "rejected"), byDevice)
        assertEquals("unchanged", r["results"].first { it["deviceId"].asText() == "d-004" }["outcome"]["reason"].asText())
        assertEquals(11, snapshot("d-003")["volume"].asInt())
    }
}
