package screenloop.store

import com.fasterxml.jackson.databind.ObjectMapper
import jakarta.annotation.PreDestroy
import org.slf4j.LoggerFactory
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.data.redis.connection.Message
import org.springframework.data.redis.connection.MessageListener
import org.springframework.data.redis.connection.RedisConnectionFactory
import org.springframework.data.redis.listener.PatternTopic
import org.springframework.data.redis.listener.RedisMessageListenerContainer
import org.springframework.stereotype.Component
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter
import java.time.Clock
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * 화면별 SSE 연결 목록. 이벤트는 Redis pub/sub 으로 들어오므로 서버가 여러 대여도 같은 구조로 동작한다.
 * 연결 직후에는 DB 의 이벤트 로그에서 Last-Event-ID 이후를 먼저 보내고, 이어서 실시간 이벤트를 보낸다.
 * 그 사이에 겹쳐 보낸 이벤트는 클라이언트(Replica)가 버전으로 걸러 낸다.
 */
@Component
class SseHub(private val repo: DeviceRepo, private val mapper: ObjectMapper, private val clock: Clock) {
    private val log = LoggerFactory.getLogger(javaClass)
    private class Conn(val emitter: SseEmitter, val isDevice: Boolean)
    private val conns = ConcurrentHashMap<String, CopyOnWriteArrayList<Conn>>()
    private val heartbeat = Executors.newSingleThreadScheduledExecutor { r -> Thread(r, "sse-heartbeat").apply { isDaemon = true } }

    init {
        heartbeat.scheduleAtFixedRate({ beat() }, 5, 5, TimeUnit.SECONDS)
    }

    @PreDestroy
    fun close() { heartbeat.shutdownNow() }

    fun subscribe(deviceId: String, after: Long, fromDevice: Boolean): SseEmitter {
        val emitter = SseEmitter(0L)
        val c = Conn(emitter, fromDevice)
        val list = conns.computeIfAbsent(deviceId) { CopyOnWriteArrayList() }
        list.add(c)
        val remove = Runnable { list.remove(c); if (fromDevice) repo.touch(deviceId, clock.millis()) }
        emitter.onCompletion(remove)
        emitter.onTimeout(remove)
        emitter.onError { remove.run() }
        if (fromDevice) repo.touch(deviceId, clock.millis())
        runCatching {
            emitter.send(SseEmitter.event().comment("connected"))
            var cursor = after
            while (true) {
                val batch = repo.eventsAfter(deviceId, cursor)
                for (ev in batch) { send(c, ev.version, mapper.writeValueAsString(ev)); cursor = ev.version }
                if (batch.size < 500) break
            }
        }.onFailure { list.remove(c); emitter.completeWithError(it) }
        return emitter
    }

    fun broadcast(deviceId: String, json: String) {
        val version = runCatching { mapper.readTree(json)["version"].asLong() }.getOrNull() ?: return
        conns[deviceId]?.forEach { send(it, version, json) }
    }

    private fun send(c: Conn, version: Long, json: String) {
        try {
            c.emitter.send(SseEmitter.event().id(version.toString()).name("state").data(json))
        } catch (e: Exception) {
            c.emitter.completeWithError(e)
        }
    }

    fun playerCount(deviceId: String): Int = conns[deviceId]?.count { it.isDevice } ?: 0

    private fun beat() {
        for ((deviceId, list) in conns) {
            for (c in list) {
                try { c.emitter.send(SseEmitter.event().comment("hb")) } catch (e: Exception) { c.emitter.completeWithError(e) }
            }
            if (list.any { it.isDevice }) repo.touch(deviceId, clock.millis())
        }
    }
}

@Configuration
class RedisSubscription {
    @Bean
    fun redisListenerContainer(factory: RedisConnectionFactory, hub: SseHub): RedisMessageListenerContainer {
        val c = RedisMessageListenerContainer()
        c.setConnectionFactory(factory)
        c.addMessageListener(MessageListener { message: Message, _: ByteArray? ->
            val channel = String(message.channel)
            hub.broadcast(channel.removePrefix(CHANNEL_PREFIX), String(message.body))
        }, PatternTopic("$CHANNEL_PREFIX*"))
        return c
    }
}
