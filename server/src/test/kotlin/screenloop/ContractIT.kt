package screenloop

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.node.JsonNodeFactory
import com.fasterxml.jackson.dataformat.yaml.YAMLMapper
import com.networknt.schema.JsonSchemaFactory
import com.networknt.schema.SpecVersion
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.File
import java.net.URI
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit

/** spec/openapi.yaml 의 components.schemas 로 서버의 실제 응답을 검증한다. 명세와 서버 중 한쪽만 바뀌면 여기서 실패한다. */
object OpenApi {
    val doc: JsonNode = YAMLMapper().readTree(File(Spec.dir, "openapi.yaml"))
    private val factory = JsonSchemaFactory.getInstance(SpecVersion.VersionFlag.V202012)

    /** 명세에 정의된 (메서드, 경로) 전부 */
    val operations: Set<String> = doc["paths"].properties().flatMap { (path, item) ->
        item.properties().filter { it.key in setOf("get", "post", "put", "delete") }.map { "${it.key.uppercase()} $path" }
    }.toSet()

    fun errors(schemaName: String, value: JsonNode): List<String> {
        val root = JsonNodeFactory.instance.objectNode()
        root.put("\$schema", "https://json-schema.org/draft/2020-12/schema")
        root.set<JsonNode>("components", doc["components"])
        root.put("\$ref", "#/components/schemas/$schemaName")
        return factory.getSchema(root).validate(value).map { "${it.instanceLocation}: ${it.message}" }
    }
}

class ContractIT : IntegrationBase() {
    @AfterEach fun resetClock() = clock.reset()

    private val covered = LinkedHashSet<String>()

    private fun check(op: String, res: Res, expectStatus: Int, schema: String, array: Boolean = false): JsonNode {
        covered.add(op)
        assertEquals(expectStatus, res.status, "$op 응답 코드: ${res.raw}")
        val body = res.body!!
        val errs = if (array) { assertTrue(body.isArray, "$op 는 배열이어야 함"); body.flatMap { OpenApi.errors(schema, it) } } else OpenApi.errors(schema, body)
        assertEquals(emptyList<String>(), errs, "$op 응답이 명세($schema)와 다름: ${res.raw.take(300)}")
        return body
    }

    @Test
    fun everyOperationResponseMatchesTheSpec() {
        val tok = operator
        check("POST /api/auth/login", call("POST", "/api/auth/login", body = mapOf("username" to "operator", "password" to "operator-demo")), 200, "LoginResponse")
        check("GET /api/version", call("GET", "/api/version"), 200, "VersionInfo")
        check("GET /api/devices", call("GET", "/api/devices", tok), 200, "DeviceSummary", array = true)
        check("GET /api/groups", call("GET", "/api/groups", tok), 200, "Group", array = true)
        val snap = check("GET /api/devices/{deviceId}/snapshot", call("GET", "/api/devices/d-001/snapshot", tok), 200, "Snapshot")
        val v = snap["state"]["version"].asLong()

        // 명령: 받아들여진 것, 거절된 것, 다시 보낸 것 모두 CommandResult
        val items = listOf(mapOf("id" to "c1", "title" to "계약 시험", "sceneId" to "dusk", "durationSec" to 7, "window" to mapOf("fromMin" to 0, "toMin" to 1440)))
        val accepted = check("POST /api/devices/{deviceId}/commands", call("POST", "/api/devices/d-001/commands", tok, cmd("schedule.replace", "baseScheduleVersion" to snap["state"]["scheduleVersion"].asLong(), "items" to items)), 200, "CommandResult")
        assertEquals("accepted", accepted["result"].asText())
        assertEquals(emptyList<String>(), OpenApi.errors("StateEvent", accepted["event"]))
        val rejected = check("POST /api/devices/{deviceId}/commands", call("POST", "/api/devices/d-001/commands", tok, cmd("playback.next", "fromItemId" to "nope")), 200, "CommandResult")
        assertEquals("stale", rejected["reason"].asText())
        val same = cmd("override.set", "text" to "계약 공지", "durationSec" to 30)
        call("POST", "/api/devices/d-001/commands", tok, same)
        val replay = check("POST /api/devices/{deviceId}/commands", call("POST", "/api/devices/d-001/commands", tok, same), 200, "CommandResult")
        assertTrue(replay["replayed"].asBoolean())
        // 요청 본문도 명세의 Command 스키마를 따른다
        for (c in listOf(cmd("playback.pause"), cmd("playback.resume"), cmd("playback.jump", "itemId" to "c1"), cmd("playback.seek", "positionMs" to 1000), cmd("volume.set", "volume" to 20), cmd("override.clear"))) {
            assertEquals(emptyList<String>(), OpenApi.errors("Command", json.valueToTree(c)), "요청 ${c["type"]}")
            check("POST /api/devices/{deviceId}/commands", call("POST", "/api/devices/d-001/commands", tok, c), 200, "CommandResult")
        }
        check("GET /api/devices/{deviceId}/events", call("GET", "/api/devices/d-001/events?after=$v", tok), 200, "StateEvent", array = true)
        val grp = check("POST /api/groups/{groupId}/commands", call("POST", "/api/groups/g-1/commands", tok, cmd("volume.set", "volume" to 44)), 200, "GroupCommandResult")
        assertEquals(2, grp["results"].size())

        // 재생 기록과 정산
        clock.set(java.time.OffsetDateTime.parse("2034-05-10T13:00:00+09:00").toInstant().toEpochMilli())
        val start = java.time.OffsetDateTime.parse("2034-05-10T12:00:00+09:00").toInstant().toEpochMilli()
        val up = call("POST", "/api/devices/d-002/play-records", body = mapOf("clockOffsetMs" to 0, "records" to listOf(mapOf("seq" to 301, "itemId" to "c1", "startedAtMs" to start, "endedAtMs" to start + 3_600_000))), deviceKey = "dk-d-002")
        check("POST /api/devices/{deviceId}/play-records", up, 200, "PlayRecordResult")
        check("GET /api/devices/{deviceId}/play-records", call("GET", "/api/devices/d-002/play-records", operator), 200, "PlayRecordRow", array = true)
        check("GET /api/billing/preview", call("GET", "/api/billing/preview?accountId=acct-1&month=2034-05", operator), 200, "Invoice")
        clock.set(java.time.OffsetDateTime.parse("2034-06-01T00:00:00+09:00").toInstant().toEpochMilli())
        val closed = check("POST /api/billing/close", call("POST", "/api/billing/close", operator, mapOf("accountId" to "acct-1", "month" to "2034-05")), 200, "Invoice")
        check("GET /api/invoices/{invoiceId}", call("GET", "/api/invoices/${closed["id"].asLong()}", operator), 200, "Invoice")
        check("GET /api/invoice-lines/{lineId}/trace", call("GET", "/api/invoice-lines/${closed["lines"][0]["id"].asLong()}/trace", operator), 200, "Trace")

        // 스트림: 첫 이벤트가 StateEvent 스키마를 따른다
        val q = LinkedBlockingQueue<String>()
        val req = HttpRequest.newBuilder(URI("http://127.0.0.1:$port/api/devices/d-001/stream")).header("Authorization", "Bearer $operator").header("Last-Event-ID", "0").build()
        val f = http.sendAsync(req, HttpResponse.BodyHandlers.ofLines()).thenAccept { r -> r.body().forEach { q.add(it) } }
        var data: String? = null
        val end = System.nanoTime() + TimeUnit.SECONDS.toNanos(10)
        while (data == null && System.nanoTime() < end) q.poll(200, TimeUnit.MILLISECONDS)?.takeIf { it.startsWith("data:") }?.let { data = it }
        f.cancel(true)
        assertEquals(emptyList<String>(), OpenApi.errors("StateEvent", json.readTree(data!!.removePrefix("data:").trim())))
        covered.add("GET /api/devices/{deviceId}/stream")

        assertEquals(OpenApi.operations, covered, "명세에 있는데 계약 테스트가 호출하지 않은 작업이 있다")
    }

    @Test
    fun errorResponsesFollowTheErrorSchema() {
        check("GET /api/devices", call("GET", "/api/devices"), 401, "Error")
        check("POST /api/devices/{deviceId}/commands", call("POST", "/api/devices/d-001/commands", viewer, cmd("playback.pause")), 403, "Error")
        check("GET /api/devices/{deviceId}/snapshot", call("GET", "/api/devices/d-999/snapshot", operator), 404, "Error")
        check("GET /api/invoices/{invoiceId}", call("GET", "/api/invoices/99999999", operator), 404, "Error")
        check("POST /api/auth/login", call("POST", "/api/auth/login", body = mapOf("username" to "x", "password" to "y")), 401, "Error")
        check("POST /api/billing/close", call("POST", "/api/billing/close", operator, mapOf("accountId" to "acct-1", "month" to "bad")), 400, "Error")
    }

    @Test
    fun theValidatorRejectsPayloadsThatDifferFromTheSpec() {
        val ok = json.readTree("""{"state":{"deviceId":"d","version":1,"scheduleVersion":1,"schedule":{"items":[]},"playback":{"anchorMs":0,"positionMs":0,"paused":false},"volume":50,"override":null},"serverTimeMs":5}""")
        assertEquals(emptyList<String>(), OpenApi.errors("Snapshot", ok))
        val missing = ok.deepCopy<com.fasterxml.jackson.databind.node.ObjectNode>().also { it.remove("serverTimeMs") }
        assertFalse(OpenApi.errors("Snapshot", missing).isEmpty(), "필수 필드가 빠지면 실패해야 한다")
        val extra = ok.deepCopy<com.fasterxml.jackson.databind.node.ObjectNode>().also { it.put("surprise", 1) }
        assertFalse(OpenApi.errors("Snapshot", extra).isEmpty(), "명세에 없는 필드가 있으면 실패해야 한다")
        val wrongType = ok.deepCopy<com.fasterxml.jackson.databind.node.ObjectNode>().also { it.put("serverTimeMs", "5") }
        assertFalse(OpenApi.errors("Snapshot", wrongType).isEmpty(), "타입이 다르면 실패해야 한다")
    }
}
