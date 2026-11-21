package screenloop.sync

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.longOrNull

/** JSON 으로 받은 명령을 도메인 명령으로 바꾼다. 알 수 없는 type 이나 commandId 가 없으면 null(요청 자체가 잘못됨). */
object CommandParser {
    private fun JsonObject.long(name: String): Long? = (this[name] as? JsonPrimitive)?.takeIf { !it.isString }?.longOrNull
    private fun JsonObject.text(name: String): String? = (this[name] as? JsonPrimitive)?.takeIf { it.isString }?.content

    private fun parseWindow(n: JsonElement?): Window? {
        if (n == null || n is JsonNull) return null
        val o = n as? JsonObject ?: return Window(-1, -1)
        val f = (o["fromMin"] as? JsonPrimitive)?.takeIf { !it.isString }?.intOrNull
        val t = (o["toMin"] as? JsonPrimitive)?.takeIf { !it.isString }?.intOrNull
        if (f == null || t == null) return Window(-1, -1) // 형태가 틀렸으면 범위 밖 값으로 만들어 invalid 로 거절되게 한다
        return Window(f, t)
    }

    fun parseItems(arr: JsonElement?): List<ScheduleItem>? {
        if (arr !is JsonArray) return null
        val out = ArrayList<ScheduleItem>()
        for (n in arr) {
            if (n !is JsonObject) return null
            val dur = (n["durationSec"] as? JsonPrimitive)?.takeIf { !it.isString }?.intOrNull
            out.add(ScheduleItem(n.text("id") ?: "", n.text("title") ?: "", n.text("sceneId") ?: "", dur ?: 0, parseWindow(n["window"])))
        }
        return out
    }

    fun parse(n: JsonElement): Command? {
        val o = n as? JsonObject ?: return null
        val id = o.text("commandId")?.takeIf { it.isNotEmpty() && it.length <= 64 } ?: return null
        return when (o.text("type")) {
            "schedule.replace" -> ScheduleReplace(id, o.long("baseScheduleVersion"), parseItems(o["items"]))
            "playback.next" -> PlaybackNext(id, o.text("fromItemId"))
            "playback.jump" -> PlaybackJump(id, o.text("itemId"))
            "playback.pause" -> PlaybackPause(id)
            "playback.resume" -> PlaybackResume(id)
            "playback.seek" -> PlaybackSeek(id, o.long("positionMs"))
            "volume.set" -> VolumeSet(id, o.long("volume"))
            "override.set" -> {
                val d = o["durationSec"]
                val absent = d == null || d is JsonNull
                val asLong = (d as? JsonPrimitive)?.takeIf { !it.isString }?.longOrNull
                val bad = !absent && asLong == null
                OverrideSetCmd(id, o.text("text"), if (absent || bad) null else asLong, bad)
            }
            "override.clear" -> OverrideClear(id)
            else -> null
        }
    }
}
