package screenloop.api

import com.fasterxml.jackson.annotation.JsonInclude
import com.fasterxml.jackson.databind.JsonNode
import jakarta.servlet.http.HttpServletRequest
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.*
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter
import screenloop.AppProps
import screenloop.auth.Access
import screenloop.auth.DevicePrincipal
import screenloop.auth.Forbidden
import screenloop.auth.Tokens
import screenloop.auth.UserPrincipal
import screenloop.store.*
import screenloop.sync.*
import java.time.Clock

data class ErrorDto(val error: String, val message: String)
data class LoginReq(val username: String?, val password: String?)
data class LoginRes(val token: String, val role: String, val username: String)
data class NowPlayingDto(val itemId: String, val title: String)
data class DeviceSummary(
    val id: String, val name: String, val groupId: String, val online: Boolean, val lastSeenMs: Long?, val version: Long,
    val nowPlaying: NowPlayingDto?, val paused: Boolean, val volume: Int, val overrideActive: Boolean,
)
data class SnapshotDto(val state: DeviceState, val serverTimeMs: Long)
data class GroupDto(val id: String, val name: String, val deviceIds: List<String>)
data class DeviceOutcome(val deviceId: String, val outcome: CommandResultDto)
data class GroupResult(val groupId: String, val results: List<DeviceOutcome>)
data class CloseReq(val accountId: String?, val month: String?)
data class VersionDto(val version: String)

@RestController
@RequestMapping("/api")
class Api(
    private val props: AppProps,
    private val tokens: Tokens,
    private val repo: DeviceRepo,
    private val commands: CommandService,
    private val hub: SseHub,
    private val records: RecordService,
    private val billing: BillingService,
    private val clock: Clock,
) {
    private fun err(status: Int, code: String, msg: String) = ResponseEntity.status(status).body(ErrorDto(code, msg))

    @PostMapping("/auth/login")
    fun login(@RequestBody req: LoginReq): ResponseEntity<Any> {
        val u = props.users[req.username ?: ""]
        if (u == null || u.password != req.password) return err(401, "unauthorized", "계정 정보가 맞지 않습니다").let { ResponseEntity.status(401).body(it.body) }
        return ResponseEntity.ok(LoginRes(tokens.issue(req.username!!, u.role), u.role, req.username))
    }

    @GetMapping("/version")
    fun version() = VersionDto(props.version)

    @GetMapping("/devices")
    fun devices(req: HttpServletRequest): List<DeviceSummary> {
        Access.requireUser(req)
        val now = clock.millis()
        return repo.devices().map { d ->
            val s = repo.state(d.id)!!
            val np = nowPlaying(s, now)
            DeviceSummary(
                d.id, d.name, d.groupId, hub.playerCount(d.id) > 0, d.lastSeenMs, s.version,
                np?.let { NowPlayingDto(it.item.id, it.item.title) }, s.playback.paused, s.volume, overrideActive(s, now),
            )
        }
    }

    @GetMapping("/devices/{id}/snapshot")
    fun snapshot(@PathVariable id: String, req: HttpServletRequest): ResponseEntity<Any> {
        Access.requireDeviceReader(req, id)
        // 기기가 스냅샷을 받아 가는 것도 살아 있다는 신호로 본다
        val s = repo.state(id) ?: return ResponseEntity.status(404).body(ErrorDto("not_found", "없는 화면입니다"))
        if (Access.principal(req) is DevicePrincipal) repo.touch(id, clock.millis())
        return ResponseEntity.ok(SnapshotDto(s, clock.millis()))
    }

    @GetMapping("/devices/{id}/events")
    fun events(@PathVariable id: String, @RequestParam after: Long, req: HttpServletRequest): List<StateEvent> {
        Access.requireDeviceReader(req, id)
        return repo.eventsAfter(id, after)
    }

    @GetMapping("/devices/{id}/stream", produces = [MediaType.TEXT_EVENT_STREAM_VALUE])
    fun stream(
        @PathVariable id: String,
        @RequestHeader(value = "Last-Event-ID", required = false) lastEventId: String?,
        @RequestParam(required = false) after: Long?,
        req: HttpServletRequest,
    ): SseEmitter {
        Access.requireDeviceReader(req, id)
        if (repo.device(id) == null) throw NoSuchElementException("없는 화면입니다")
        val cursor = lastEventId?.toLongOrNull() ?: after ?: 0L
        return hub.subscribe(id, cursor, Access.principal(req) is DevicePrincipal)
    }

    @PostMapping("/devices/{id}/commands")
    fun command(@PathVariable id: String, @RequestBody body: JsonNode, req: HttpServletRequest): ResponseEntity<Any> {
        val user = Access.requireOperator(req)
        if (repo.device(id) == null) return ResponseEntity.status(404).body(ErrorDto("not_found", "없는 화면입니다"))
        val cmd = CommandParser.parse(body) ?: return ResponseEntity.badRequest().body(ErrorDto("bad_request", "commandId 와 알려진 type 이 필요합니다"))
        return ResponseEntity.ok(commands.submit(id, cmd, user.username))
    }

    @GetMapping("/groups")
    fun groups(req: HttpServletRequest): List<GroupDto> {
        Access.requireUser(req)
        return repo.groups().map { GroupDto(it.id, it.name, it.deviceIds) }
    }

    @PostMapping("/groups/{gid}/commands")
    fun groupCommand(@PathVariable gid: String, @RequestBody body: JsonNode, req: HttpServletRequest): ResponseEntity<Any> {
        val user = Access.requireOperator(req)
        val g = repo.group(gid) ?: return ResponseEntity.status(404).body(ErrorDto("not_found", "없는 묶음입니다"))
        val base = CommandParser.parse(body) ?: return ResponseEntity.badRequest().body(ErrorDto("bad_request", "commandId 와 알려진 type 이 필요합니다"))
        // 화면마다 따로 판정한다. commandId 는 화면마다 달라야 하므로 뒤에 화면 ID 를 붙인다.
        val results = g.deviceIds.map { d ->
            val node = (body.deepCopy<JsonNode>() as com.fasterxml.jackson.databind.node.ObjectNode).put("commandId", "${base.commandId}@$d")
            DeviceOutcome(d, commands.submit(d, CommandParser.parse(node)!!, user.username))
        }
        return ResponseEntity.ok(GroupResult(gid, results))
    }

    @PostMapping("/devices/{id}/play-records")
    fun upload(@PathVariable id: String, @RequestBody batch: RecordBatch, req: HttpServletRequest): ResponseEntity<Any> {
        Access.requireDevice(req, id)
        if (batch.records.size > 500) return ResponseEntity.badRequest().body(ErrorDto("bad_request", "한 번에 500건까지 보낼 수 있습니다"))
        if (batch.records.any { it.seq < 1 || it.itemId.isEmpty() }) return ResponseEntity.badRequest().body(ErrorDto("bad_request", "seq 는 1 이상, itemId 는 비어 있으면 안 됩니다"))
        return ResponseEntity.ok(records.ingest(id, batch))
    }

    @GetMapping("/devices/{id}/play-records")
    fun listRecords(@PathVariable id: String, req: HttpServletRequest): List<RecordRow> {
        Access.requireUser(req)
        return records.list(id)
    }

    private val monthRe = Regex("""^\d{4}-(0[1-9]|1[0-2])$""")

    @GetMapping("/billing/preview")
    fun preview(@RequestParam accountId: String, @RequestParam month: String, req: HttpServletRequest): ResponseEntity<Any> {
        Access.requireUser(req)
        if (!monthRe.matches(month)) return ResponseEntity.badRequest().body(ErrorDto("bad_request", "month 는 YYYY-MM 형식이어야 합니다"))
        return ResponseEntity.ok(billing.preview(accountId, month))
    }

    @PostMapping("/billing/close")
    fun close(@RequestBody body: CloseReq, req: HttpServletRequest): ResponseEntity<Any> {
        Access.requireOperator(req)
        val month = body.month ?: ""
        if (body.accountId == null || !monthRe.matches(month)) return ResponseEntity.badRequest().body(ErrorDto("bad_request", "accountId 와 YYYY-MM 형식의 month 가 필요합니다"))
        return ResponseEntity.ok(billing.close(body.accountId, month))
    }

    @GetMapping("/invoices/{id}")
    fun invoice(@PathVariable id: Long, req: HttpServletRequest): ResponseEntity<Any> {
        Access.requireUser(req)
        val inv = billing.invoice(id) ?: return ResponseEntity.status(404).body(ErrorDto("not_found", "없는 정산서입니다"))
        return ResponseEntity.ok(inv)
    }

    @GetMapping("/invoice-lines/{id}/trace")
    fun trace(@PathVariable id: Long, req: HttpServletRequest): ResponseEntity<Any> {
        Access.requireUser(req)
        val t = billing.trace(id) ?: return ResponseEntity.status(404).body(ErrorDto("not_found", "없는 정산 항목입니다"))
        return ResponseEntity.ok(t)
    }
}

@RestControllerAdvice
class Errors {
    @ExceptionHandler(Forbidden::class)
    fun forbidden(e: Forbidden) = ResponseEntity.status(403).body(ErrorDto("forbidden", e.message ?: "권한이 없습니다"))

    @ExceptionHandler(NoSuchElementException::class)
    fun notFound(e: NoSuchElementException) = ResponseEntity.status(404).body(ErrorDto("not_found", e.message ?: "없습니다"))

    @ExceptionHandler(AlreadyClosed::class)
    fun conflict(e: AlreadyClosed) = ResponseEntity.status(409).body(ErrorDto("already_closed", e.message ?: "이미 마감했습니다"))

    @ExceptionHandler(org.springframework.http.converter.HttpMessageNotReadableException::class)
    fun unreadable(e: Exception) = ResponseEntity.badRequest().body(ErrorDto("bad_request", "요청 본문을 읽을 수 없습니다"))
}
