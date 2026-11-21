package screenloop.sync

import com.fasterxml.jackson.databind.JsonNode

/** JSON 으로 받은 명령을 도메인 명령으로 바꾼다. 알 수 없는 type 이나 commandId 가 없으면 null(요청 자체가 잘못됨). */
object CommandParser {
    private fun JsonNode.longOrNull(name: String): Long? = get(name)?.takeIf { it.isIntegralNumber && it.canConvertToLong() }?.asLong()
    private fun JsonNode.textOrNull(name: String): String? = get(name)?.takeIf { it.isTextual }?.asText()

    private fun parseWindow(n: JsonNode?): Window? {
        if (n == null || n.isNull) return null
        val f = n.get("fromMin"); val t = n.get("toMin")
        if (f == null || t == null || !f.isInt || !t.isInt) return Window(-1, -1) // 형태가 틀렸으면 범위 밖 값으로 만들어 invalid 로 거절되게 한다
        return Window(f.asInt(), t.asInt())
    }

    fun parseItems(arr: JsonNode?): List<ScheduleItem>? {
        if (arr == null || !arr.isArray) return null
        val out = ArrayList<ScheduleItem>()
        for (n in arr) {
            if (!n.isObject) return null
            val dur = n.get("durationSec")
            out.add(
                ScheduleItem(
                    id = n.textOrNull("id") ?: "",
                    title = n.textOrNull("title") ?: "",
                    sceneId = n.textOrNull("sceneId") ?: "",
                    durationSec = if (dur != null && dur.isInt) dur.asInt() else 0,
                    window = parseWindow(n.get("window")),
                ),
            )
        }
        return out
    }

    fun parse(n: JsonNode): Command? {
        val id = n.textOrNull("commandId")?.takeIf { it.isNotEmpty() && it.length <= 64 } ?: return null
        return when (n.textOrNull("type")) {
            "schedule.replace" -> ScheduleReplace(id, n.longOrNull("baseScheduleVersion"), parseItems(n.get("items")))
            "playback.next" -> PlaybackNext(id, n.textOrNull("fromItemId"))
            "playback.jump" -> PlaybackJump(id, n.textOrNull("itemId"))
            "playback.pause" -> PlaybackPause(id)
            "playback.resume" -> PlaybackResume(id)
            "playback.seek" -> PlaybackSeek(id, n.longOrNull("positionMs"))
            "volume.set" -> VolumeSet(id, n.longOrNull("volume"))
            "override.set" -> {
                val d = n.get("durationSec")
                val bad = d != null && !d.isNull && !(d.isIntegralNumber && d.canConvertToLong())
                OverrideSetCmd(id, n.textOrNull("text"), if (d != null && !bad && !d.isNull) d.asLong() else null, bad)
            }
            "override.clear" -> OverrideClear(id)
            else -> null
        }
    }
}
