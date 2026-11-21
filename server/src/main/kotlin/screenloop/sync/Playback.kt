package screenloop.sync

/** 시간대 편성의 기준: 한국 표준시(UTC+9). TypeScript sync-core 와 같다. */
const val TZ_OFFSET_MIN = 540

fun minuteOfDay(serverMs: Long): Int = (((Math.floorDiv(serverMs, 60000L) + TZ_OFFSET_MIN) % 1440 + 1440) % 1440).toInt()

private fun inWindow(item: ScheduleItem, minute: Int): Boolean {
    val w = item.window ?: return true
    return if (w.fromMin <= w.toMin) minute >= w.fromMin && minute < w.toMin else minute >= w.fromMin || minute < w.toMin
}

fun playableItems(schedule: Schedule, serverMs: Long): List<ScheduleItem> {
    val minute = minuteOfDay(serverMs)
    return schedule.items.filter { inWindow(it, minute) }
}

fun loopLengthMs(items: List<ScheduleItem>): Long = items.sumOf { it.durationSec * 1000L }

data class NowPlaying(val item: ScheduleItem, val index: Int, val startMs: Long, val offsetInItemMs: Long, val loopPositionMs: Long, val loopLengthMs: Long)

/** 서버 시각 기준 지금 재생 위치. 재생 목록이 비면 null. */
fun nowPlaying(state: DeviceState, serverMs: Long): NowPlaying? {
    val items = playableItems(state.schedule, serverMs)
    val total = loopLengthMs(items)
    if (items.isEmpty() || total == 0L) return null
    val p = state.playback
    val elapsed = if (p.paused) p.positionMs else p.positionMs + maxOf(0L, serverMs - p.anchorMs)
    val pos = elapsed % total
    var start = 0L
    for ((i, it) in items.withIndex()) {
        val len = it.durationSec * 1000L
        if (pos < start + len) return NowPlaying(it, i, start, pos - start, pos, total)
        start += len
    }
    error("unreachable")
}

fun startOfIndex(items: List<ScheduleItem>, index: Int): Long = items.take(index).sumOf { it.durationSec * 1000L }

fun overrideActive(state: DeviceState, serverMs: Long): Boolean {
    val o = state.override ?: return false
    return o.untilMs == null || serverMs < o.untilMs
}
