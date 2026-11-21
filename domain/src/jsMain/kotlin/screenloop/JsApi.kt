@file:OptIn(ExperimentalJsExport::class)

package screenloop

import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import screenloop.billing.BillRecord
import screenloop.billing.BillingBook
import screenloop.billing.InvoiceView
import screenloop.billing.Plan
import screenloop.billing.Tier
import screenloop.billing.toView
import screenloop.records.RecordBatch
import screenloop.records.RecordIntake
import screenloop.records.StoredRecord
import screenloop.sync.CommandOutcome
import screenloop.sync.DeviceServer
import screenloop.sync.DomainJson
import screenloop.sync.StateEvent
import screenloop.sync.nowPlaying

/** 이 파일이 JS 로 내보내는 것이 데모 사이트가 부르는 "서버" 의 전부다. 값은 JSON 글자로 주고받는다(Long 을 JS 로 안전하게 넘기려고). */
@JsExport
fun engineName(): String = "kotlin-js"

/** 서버 한 대 흉내: 화면 하나의 상태·이벤트 로그, 재생 기록 수집, 정산 장부. 규칙은 전부 JVM 서버와 같은 도메인 코드다. */
@JsExport
class KotlinServer(deviceId: String) {
    private val device = DeviceServer(deviceId)
    private val intake = RecordIntake()
    private val book = BillingBook()
    private var seenRows = 0

    /** 명령 JSON → CommandResult JSON. 요청이 잘못됐으면 빈 문자열. */
    fun submit(commandJson: String, actor: String, nowMs: Double): String {
        val o: CommandOutcome = device.submitJson(commandJson, nowMs.toLong(), actor) ?: return ""
        return DomainJson.encodeToString(CommandOutcome.serializer(), o)
    }

    fun snapshot(nowMs: Double): String = """{"state":${DomainJson.encodeToString(device.state)},"serverTimeMs":${nowMs.toLong()}}"""

    fun state(): String = DomainJson.encodeToString(device.state)

    fun version(): Int = device.state.version.toInt()

    fun eventsAfter(version: Int): String = DomainJson.encodeToString(ListSerializer(StateEvent.serializer()), device.eventsAfter(version.toLong()))

    /** 서버 시각 nowMs 의 재생 항목과 위치: {"itemId","offsetInItemMs","loopPositionMs","loopLengthMs"} 또는 null */
    fun nowPlaying(nowMs: Double): String {
        val np = nowPlaying(device.state, nowMs.toLong()) ?: return "null"
        return """{"itemId":"${np.item.id}","offsetInItemMs":${np.offsetInItemMs},"loopPositionMs":${np.loopPositionMs},"loopLengthMs":${np.loopLengthMs}}"""
    }

    /** 재생 기록 묶음 JSON → 수집 결과 JSON. 받아들인 기록은 정산 장부에도 들어간다. */
    fun ingest(deviceId: String, batchJson: String, receivedAtMs: Double): String {
        val batch = DomainJson.decodeFromString<RecordBatch>(batchJson)
        val r = intake.ingest(deviceId, batch, receivedAtMs.toLong())
        while (seenRows < intake.rows.size) {
            val s = intake.rows[seenRows++]
            if (s.status == "accepted") book.add(BillRecord(s.id, s.deviceId, s.serverStartedAtMs, s.serverEndedAtMs, s.receivedAtMs))
        }
        return DomainJson.encodeToString(r)
    }

    fun duplicatesTotal(): Int = intake.duplicatesTotal

    fun records(): String = DomainJson.encodeToString(ListSerializer(StoredRecord.serializer()), intake.rows)

    /** 정산서 JSON(명세의 Invoice 모양 + 줄의 근거 날짜). close 가 true 면 마감한다. 이미 마감한 달을 다시 마감하면 빈 문자열. */
    fun invoice(month: String, nowMs: Double, close: Boolean): String {
        if (close && book.isClosed(month)) return ""
        val c = if (close) book.close(month, nowMs.toLong()) else book.calc(month, nowMs.toLong())
        return DomainJson.encodeToString(InvoiceView.serializer(), c.toView("acct-demo", if (close) "closed" else "preview"))
    }

    fun isClosed(month: String): Boolean = book.isClosed(month)
}

/**
 * 정산 시험 한 사례를 그대로 돌린다(spec/vectors/billing.json 의 한 사례 JSON → 단계별 결과 JSON).
 * 사이트 시험이 JVM 시험과 같은 입력으로 같은 결과가 나오는지 볼 때 쓴다.
 */
@JsExport
fun runBillingScenario(scenarioJson: String): String {
    val scn = Json.parseToJsonElement(scenarioJson).jsonObject
    val p = scn["plan"]!!.jsonObject
    val plan = Plan(p["screenFeeWon"]!!.jsonPrimitive.content.toLong(), p["tiers"]!!.jsonArray.map {
        val t = it.jsonObject
        Tier(t["upToHours"]!!.jsonPrimitive.let { v -> if (v.content == "null") null else v.content.toLong() }, t["rateWonPerHour"]!!.jsonPrimitive.content.toLong())
    })
    val book = BillingBook(plan)
    for (r in scn["records"]!!.jsonArray) {
        val o = r.jsonObject
        book.add(BillRecord(o["id"]!!.jsonPrimitive.content.toLong(), o["deviceId"]!!.jsonPrimitive.content, o["startMs"]!!.jsonPrimitive.content.toLong(), o["endMs"]!!.jsonPrimitive.content.toLong(), o["receivedAtMs"]!!.jsonPrimitive.content.toLong()))
    }
    val out = JsonArray(
        scn["steps"]!!.jsonArray.map { st ->
            val s: JsonObject = st.jsonObject
            val month = s["month"]!!.jsonPrimitive.content
            val now = s["nowMs"]!!.jsonPrimitive.content.toLong()
            val calc = if (s["op"]!!.jsonPrimitive.content == "close") book.close(month, now) else book.calc(month, now)
            buildJsonObject {
                put("totalWon", calc.totalWon)
                put("lines", Json.parseToJsonElement(DomainJson.encodeToString(InvoiceView.serializer(), calc.toView("acct", "x")))
                    .jsonObject["lines"]!!)
                put("usage", JsonArray(calc.usage.filter { u -> u.day.startsWith(month) }.map { u ->
                    buildJsonObject {
                        put("deviceId", u.deviceId); put("day", u.day); put("billedSeconds", u.billedSeconds)
                        put("recordIds", JsonArray(u.recordIds.map { id -> JsonPrimitive(id) }))
                    }
                }))
            }
        },
    )
    return out.toString()
}
