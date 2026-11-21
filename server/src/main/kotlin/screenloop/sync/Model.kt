package screenloop.sync

import com.fasterxml.jackson.annotation.JsonInclude
import com.fasterxml.jackson.annotation.JsonSubTypes
import com.fasterxml.jackson.annotation.JsonTypeInfo

data class Window(val fromMin: Int, val toMin: Int)

/** window 가 없으면 키를 내보내지 않는다(spec 의 선택 필드, TypeScript 쪽 저장 형태와 같다). */
@JsonInclude(JsonInclude.Include.NON_NULL)
data class ScheduleItem(val id: String, val title: String, val sceneId: String, val durationSec: Int, val window: Window? = null)

data class Schedule(val items: List<ScheduleItem>)
data class Playback(val anchorMs: Long, val positionMs: Long, val paused: Boolean)
data class Override(val text: String, val untilMs: Long?)

data class DeviceState(
    val deviceId: String,
    val version: Long,
    val scheduleVersion: Long,
    val schedule: Schedule,
    val playback: Playback,
    val volume: Int,
    val override: Override?,
) {
    companion object {
        fun initial(deviceId: String) = DeviceState(deviceId, 0, 0, Schedule(emptyList()), Playback(0, 0, false), 50, null)
    }
}

@JsonTypeInfo(use = JsonTypeInfo.Id.NAME, include = JsonTypeInfo.As.EXISTING_PROPERTY, property = "type")
@JsonSubTypes(
    JsonSubTypes.Type(ScheduleReplaced::class, name = "schedule.replaced"),
    JsonSubTypes.Type(PlaybackChanged::class, name = "playback.changed"),
    JsonSubTypes.Type(VolumeChanged::class, name = "volume.changed"),
    JsonSubTypes.Type(OverrideSet::class, name = "override.set"),
    JsonSubTypes.Type(OverrideCleared::class, name = "override.cleared"),
)
sealed interface StateEvent {
    val type: String
    val deviceId: String
    val version: Long
    val serverTimeMs: Long
    val actor: String
}

data class ScheduleReplaced(override val deviceId: String, override val version: Long, override val serverTimeMs: Long, override val actor: String, val schedule: Schedule, val scheduleVersion: Long) : StateEvent {
    override val type get() = "schedule.replaced"
}
data class PlaybackChanged(override val deviceId: String, override val version: Long, override val serverTimeMs: Long, override val actor: String, val reason: String, val positionMs: Long, val paused: Boolean) : StateEvent {
    override val type get() = "playback.changed"
}
data class VolumeChanged(override val deviceId: String, override val version: Long, override val serverTimeMs: Long, override val actor: String, val volume: Int) : StateEvent {
    override val type get() = "volume.changed"
}
data class OverrideSet(override val deviceId: String, override val version: Long, override val serverTimeMs: Long, override val actor: String, val text: String, val untilMs: Long?) : StateEvent {
    override val type get() = "override.set"
}
data class OverrideCleared(override val deviceId: String, override val version: Long, override val serverTimeMs: Long, override val actor: String) : StateEvent {
    override val type get() = "override.cleared"
}

/** 명령. 필드가 잘못된 형태로 오면 null 로 받고 판정에서 invalid 로 거절한다(400 이 아니라 거절 결과로 알려 준다). */
sealed interface Command {
    val commandId: String
}
data class ScheduleReplace(override val commandId: String, val baseScheduleVersion: Long?, val items: List<ScheduleItem>?) : Command
data class PlaybackNext(override val commandId: String, val fromItemId: String?) : Command
data class PlaybackJump(override val commandId: String, val itemId: String?) : Command
data class PlaybackPause(override val commandId: String) : Command
data class PlaybackResume(override val commandId: String) : Command
data class PlaybackSeek(override val commandId: String, val positionMs: Long?) : Command
data class VolumeSet(override val commandId: String, val volume: Long?) : Command
data class OverrideSetCmd(override val commandId: String, val text: String?, val durationSec: Long?, val durationBad: Boolean) : Command
data class OverrideClear(override val commandId: String) : Command

enum class Reject(val wire: String) { STALE("stale"), CONFLICT("conflict"), INVALID("invalid"), UNCHANGED("unchanged") }

sealed interface Decision
data class Accepted(val event: (deviceId: String, version: Long, serverTimeMs: Long, actor: String) -> StateEvent) : Decision
data class Rejected(val reason: Reject) : Decision
