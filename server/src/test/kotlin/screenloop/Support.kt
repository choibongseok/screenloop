package screenloop

import com.fasterxml.jackson.databind.JsonNode
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.context.TestConfiguration
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Primary
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.test.context.DynamicPropertyRegistry
import org.springframework.test.context.DynamicPropertySource
import org.testcontainers.containers.GenericContainer
import org.testcontainers.lifecycle.Startables
import org.testcontainers.postgresql.PostgreSQLContainer
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Clock
import java.time.Instant
import java.time.ZoneId
import java.util.concurrent.atomic.AtomicLong

/** 실제 PostgreSQL 과 Redis 를 JVM 하나에서 한 번만 띄운다. */
object Infra {
    val pg: PostgreSQLContainer = PostgreSQLContainer("postgres:16-alpine").withDatabaseName("screenloop").withUsername("screenloop").withPassword("screenloop")
    val redis: GenericContainer<*> = GenericContainer("redis:7-alpine").withExposedPorts(6379)

    init {
        Startables.deepStart(pg, redis).join()
    }
}

/** 평소에는 실제 시계, 시험에서 set 하면 그 시각에 멈춘 시계. 월 마감과 늦게 도착한 기록 시험에서 날짜를 정해 쓴다. */
class TestClock : Clock() {
    private val fixed = AtomicLong(-1)
    fun set(ms: Long) = fixed.set(ms)
    fun reset() = fixed.set(-1)
    override fun getZone(): ZoneId = ZoneId.of("UTC")
    override fun withZone(zone: ZoneId?): Clock = this
    override fun instant(): Instant = Instant.ofEpochMilli(millis())
    override fun millis(): Long = fixed.get().takeIf { it >= 0 } ?: System.currentTimeMillis()
}

@TestConfiguration
class TestClockConfig {
    @Bean @Primary fun testClock(): TestClock = TestClock()
}

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, classes = [Application::class, TestClockConfig::class])
abstract class IntegrationBase {
    companion object {
        @JvmStatic
        @DynamicPropertySource
        fun props(r: DynamicPropertyRegistry) {
            r.add("spring.datasource.url") { Infra.pg.jdbcUrl }
            r.add("spring.datasource.username") { "screenloop" }
            r.add("spring.datasource.password") { "screenloop" }
            r.add("spring.data.redis.host") { Infra.redis.host }
            r.add("spring.data.redis.port") { Infra.redis.getMappedPort(6379) }
        }
    }

    @LocalServerPort protected var port: Int = 0
    @Autowired protected lateinit var jdbc: JdbcTemplate
    @Autowired protected lateinit var clock: TestClock

    protected val http: HttpClient = HttpClient.newHttpClient()
    protected val json = Spec.mapper

    data class Res(val status: Int, val body: JsonNode?, val raw: String)

    protected fun call(method: String, path: String, token: String? = null, body: Any? = null, deviceKey: String? = null): Res {
        val b = HttpRequest.newBuilder(URI("http://127.0.0.1:$port$path")).header("Content-Type", "application/json")
        token?.let { b.header("Authorization", "Bearer $it") }
        deviceKey?.let { b.header("X-Device-Key", it) }
        b.method(method, if (body == null) HttpRequest.BodyPublishers.noBody() else HttpRequest.BodyPublishers.ofString(if (body is String) body else json.writeValueAsString(body)))
        val r = http.send(b.build(), HttpResponse.BodyHandlers.ofString())
        return Res(r.statusCode(), runCatching { json.readTree(r.body()) }.getOrNull(), r.body())
    }

    protected fun login(user: String, password: String): String = call("POST", "/api/auth/login", body = mapOf("username" to user, "password" to password)).body!!["token"].asText()
    // 시험에서 시계를 옮겨도 토큰이 만료되지 않도록 쓸 때마다 그 시각의 토큰을 새로 받는다
    protected val operator: String get() = login("operator", "operator-demo")
    protected val viewer: String get() = login("viewer", "viewer-demo")

    protected var cmdSeq = 0
    protected fun cmd(type: String, vararg kv: Pair<String, Any?>): Map<String, Any?> = mapOf("commandId" to "t-${System.nanoTime()}-${++cmdSeq}", "type" to type) + kv
}
