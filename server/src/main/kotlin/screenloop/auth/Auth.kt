package screenloop.auth

import jakarta.servlet.FilterChain
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.springframework.stereotype.Component
import org.springframework.web.filter.OncePerRequestFilter
import screenloop.AppProps
import java.security.MessageDigest
import java.time.Clock
import java.util.Base64
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

sealed interface Principal
data class UserPrincipal(val username: String, val role: String) : Principal
data class DevicePrincipal(val deviceId: String) : Principal

/** 서명한 토큰: base64url("사용자|역할|만료ms") + "." + HMAC-SHA256. 권한 검사는 항상 서버에서 이 토큰을 읽어 한다. */
@Component
class Tokens(private val props: AppProps, private val clock: Clock) {
    private fun mac(data: String): String {
        val m = Mac.getInstance("HmacSHA256")
        m.init(SecretKeySpec(props.tokenSecret.toByteArray(), "HmacSHA256"))
        return Base64.getUrlEncoder().withoutPadding().encodeToString(m.doFinal(data.toByteArray()))
    }

    fun issue(username: String, role: String, ttlMs: Long = 12 * 3600_000L): String {
        val body = Base64.getUrlEncoder().withoutPadding().encodeToString("$username|$role|${clock.millis() + ttlMs}".toByteArray())
        return "$body.${mac(body)}"
    }

    fun verify(token: String): UserPrincipal? {
        val parts = token.split('.')
        if (parts.size != 2) return null
        if (!MessageDigest.isEqual(mac(parts[0]).toByteArray(), parts[1].toByteArray())) return null
        val f = runCatching { String(Base64.getUrlDecoder().decode(parts[0])).split('|') }.getOrNull() ?: return null
        if (f.size != 3 || f[2].toLongOrNull()?.let { it < clock.millis() } != false) return null
        return UserPrincipal(f[0], f[1])
    }
}

/**
 * 요청의 신원을 읽는다. 사용자 토큰(Authorization: Bearer)이거나 화면 기기 키(X-Device-Key 또는 stream 의 deviceKey 쿼리)다.
 * 열려 있는 경로는 로그인·버전·헬스 체크뿐이다. 세부 권한(운영자만 가능한 쓰기, 기기는 자기 화면만)은 컨트롤러가 Access 로 판정한다.
 */
@Component
class AuthFilter(private val tokens: Tokens, private val devices: screenloop.store.DeviceRepo) : OncePerRequestFilter() {
    override fun shouldNotFilter(request: HttpServletRequest): Boolean {
        val p = request.requestURI
        return !p.startsWith("/api/") || p == "/api/auth/login" || p == "/api/version"
    }

    override fun doFilterInternal(request: HttpServletRequest, response: HttpServletResponse, chain: FilterChain) {
        var principal: Principal? = null
        val bearer = request.getHeader("Authorization")?.removePrefix("Bearer ")?.takeIf { request.getHeader("Authorization")!!.startsWith("Bearer ") }
        if (bearer != null) principal = tokens.verify(bearer)
        if (principal == null) {
            val key = request.getHeader("X-Device-Key") ?: request.getParameter("deviceKey")
            if (key != null) devices.deviceIdForKey(key)?.let { principal = DevicePrincipal(it) }
        }
        if (principal == null) {
            response.status = 401
            response.contentType = "application/json"
            response.writer.write("""{"error":"unauthorized","message":"로그인이 필요합니다"}""")
            return
        }
        request.setAttribute("principal", principal)
        chain.doFilter(request, response)
    }
}

class Forbidden(message: String) : RuntimeException(message)

object Access {
    fun principal(req: HttpServletRequest): Principal = req.getAttribute("principal") as Principal

    /** 운영자만 */
    fun requireOperator(req: HttpServletRequest): UserPrincipal {
        val p = principal(req)
        if (p is UserPrincipal && p.role == "operator") return p
        throw Forbidden("운영자 권한이 필요합니다")
    }

    /** 사용자(운영자·보기 전용) 또는 그 화면의 기기 */
    fun requireDeviceReader(req: HttpServletRequest, deviceId: String) {
        val p = principal(req)
        if (p is UserPrincipal) return
        if (p is DevicePrincipal && p.deviceId == deviceId) return
        throw Forbidden("이 화면에 접근할 수 없습니다")
    }

    /** 사용자만(기기 키는 안 됨) */
    fun requireUser(req: HttpServletRequest): UserPrincipal = principal(req) as? UserPrincipal ?: throw Forbidden("사용자 로그인이 필요합니다")

    /** 그 화면의 기기만 */
    fun requireDevice(req: HttpServletRequest, deviceId: String) {
        val p = principal(req)
        if (p is DevicePrincipal && p.deviceId == deviceId) return
        throw Forbidden("이 화면의 기기 키가 필요합니다")
    }
}
