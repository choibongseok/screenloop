package screenloop.sync

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class Window(val fromMin: Int, val toMin: Int)

/** window 가 없으면 키를 내보내지 않는다(spec 의 선택 필드). 기본값은 직렬화에서 빠진다. */
@Serializable
data class ScheduleItem(val id: String, val title: String, val sceneId: String, val durationSec: Int, val window: Window? = null)

@Serializable
data class Schedule(val items: List<ScheduleItem>)

@Serializable
data class Playback(val anchorMs: Long, val positionMs: Long, val paused: Boolean)

@Serializable
data class Override(val text: String, val untilMs: Long?)

@Serializable
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

/** 상태 변경 이벤트. JSON 에서는 `type` 필드로 종류를 가른다(명세의 StateEvent). */
@Serializable
sealed interface StateEvent {
    val deviceId: String
    val version: Long
    val serverTimeMs: Long
    val actor: String
}

@Serializable
@SerialName("schedule.replaced")
data class ScheduleReplaced(override val deviceId: String, override val version: Long, override val serverTimeMs: Long, override val actor: String, val schedule: Schedule, val scheduleVersion: Long) : StateEvent

@Serializable
@SerialName("playback.changed")
data class PlaybackChanged(override val deviceId: String, override val version: Long, override val serverTimeMs: Long, override val actor: String, val reason: String, val positionMs: Long, val paused: Boolean) : StateEvent

@Serializable
@SerialName("volume.changed")
data class VolumeChanged(override val deviceId: String, override val version: Long, override val serverTimeMs: Long, override val actor: String, val volume: Int) : StateEvent

@Serializable
@SerialName("override.set")
data class OverrideSet(override val deviceId: String, override val version: Long, override val serverTimeMs: Long, override val actor: String, val text: String, val untilMs: Long?) : StateEvent

@Serializable
@SerialName("override.cleared")
data class OverrideCleared(override val deviceId: String, override val version: Long, override val serverTimeMs: Long, override val actor: String) : StateEvent

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

/** 명령 처리 결과(명세의 CommandResult). reason·event 는 없으면 JSON 에서 빠진다. */
@Serializable
data class CommandOutcome(val result: String, val reason: String? = null, val version: Long, val replayed: Boolean, val event: StateEvent? = null)

/** 한 번 처리한 뒤의 결과와 새 상태 */
data class Step(val outcome: CommandOutcome, val next: DeviceState)
