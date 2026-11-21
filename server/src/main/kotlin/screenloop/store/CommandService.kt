package screenloop.store

import com.fasterxml.jackson.annotation.JsonInclude
import com.fasterxml.jackson.databind.ObjectMapper
import org.springframework.data.redis.core.StringRedisTemplate
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import org.springframework.transaction.support.TransactionSynchronization
import org.springframework.transaction.support.TransactionSynchronizationManager
import screenloop.sync.Accepted
import screenloop.sync.Command
import screenloop.sync.DeviceState
import screenloop.sync.Rejected
import screenloop.sync.StateEvent
import screenloop.sync.decide
import screenloop.sync.reduce
import java.time.Clock

@JsonInclude(JsonInclude.Include.NON_NULL)
data class CommandResultDto(val result: String, val reason: String?, val version: Long, val replayed: Boolean, val event: StateEvent?)

const val CHANNEL_PREFIX = "screenloop:dev:"

/**
 * 명령 처리. 화면 상태 행을 잠그고(for update) 판정 → 이벤트 기록 → 상태 갱신을 한 트랜잭션으로 한다.
 * 같은 화면에 동시에 들어온 명령은 이 잠금으로 한 줄로 서고, 이벤트 버전이 곧 처리 순서다.
 * 이벤트는 커밋된 뒤에 Redis 로 알린다(롤백된 이벤트가 나가지 않게).
 */
@Service
class CommandService(private val repo: DeviceRepo, private val mapper: ObjectMapper, private val redis: StringRedisTemplate, private val clock: Clock) {
    @Transactional
    fun submit(deviceId: String, cmd: Command, actor: String): CommandResultDto {
        val state: DeviceState = repo.stateForUpdate(deviceId) ?: throw NoSuchElementException("없는 화면: $deviceId")
        repo.commandResult(deviceId, cmd.commandId)?.let { return mapper.readValue(it, CommandResultDto::class.java).copy(replayed = true) }
        val now = clock.millis()
        val out = when (val d = decide(state, cmd, now)) {
            is Accepted -> {
                val ev = d.event(deviceId, state.version + 1, now, actor)
                val next = reduce(state, ev)
                repo.appendEvent(ev)
                repo.updateState(next)
                publishAfterCommit(deviceId, ev)
                CommandResultDto("accepted", null, next.version, false, ev)
            }
            is Rejected -> CommandResultDto("rejected", d.reason.wire, state.version, false, null)
        }
        repo.saveCommandResult(deviceId, cmd.commandId, mapper.writeValueAsString(out))
        return out
    }

    private fun publishAfterCommit(deviceId: String, ev: StateEvent) {
        val json = mapper.writeValueAsString(ev)
        val send = { redis.convertAndSend(CHANNEL_PREFIX + deviceId, json); Unit }
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(object : TransactionSynchronization {
                override fun afterCommit() = send()
            })
        } else send()
    }
}
