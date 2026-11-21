package screenloop.sync

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement

/**
 * 한 화면의 서버 쪽 기록 장치(메모리판): 현재 상태, 이벤트 로그, commandId 중복 방지. 판정은 step() 그대로다.
 * 서버(PostgreSQL)는 상태·로그·commandId 를 테이블에 저장하고 행 잠금으로 순서를 세운다는 점만 다르다.
 */
class DeviceServer(val deviceId: String) {
    var state: DeviceState = DeviceState.initial(deviceId)
        private set
    val log = ArrayList<StateEvent>()
    private val seen = HashMap<String, CommandOutcome>()

    /** 명령 JSON 을 받아 처리한다. 알 수 없는 명령이면 null(요청 오류). */
    fun submitJson(commandJson: String, nowMs: Long, actor: String): CommandOutcome? {
        val el: JsonElement = try { Json.parseToJsonElement(commandJson) } catch (e: Exception) { return null }
        val cmd = CommandParser.parse(el) ?: return null
        return submit(cmd, nowMs, actor)
    }

    fun submit(cmd: Command, nowMs: Long, actor: String): CommandOutcome {
        seen[cmd.commandId]?.let { return it.copy(replayed = true) }
        val s = step(state, cmd, nowMs, actor)
        state = s.next
        s.outcome.event?.let { log.add(it) }
        seen[cmd.commandId] = s.outcome
        return s.outcome
    }

    fun eventsAfter(version: Long): List<StateEvent> = log.filter { it.version > version }
}
