package screenloop.store

import com.fasterxml.jackson.annotation.JsonInclude
import com.fasterxml.jackson.annotation.JsonSubTypes
import com.fasterxml.jackson.annotation.JsonTypeInfo
import org.springframework.boot.autoconfigure.jackson.Jackson2ObjectMapperBuilderCustomizer
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import screenloop.sync.OverrideCleared
import screenloop.sync.OverrideSet
import screenloop.sync.PlaybackChanged
import screenloop.sync.ScheduleItem
import screenloop.sync.ScheduleReplaced
import screenloop.sync.StateEvent
import screenloop.sync.VolumeChanged

/** 도메인 모듈은 JSON 라이브러리에 묶이지 않게 kotlinx 직렬화를 쓴다. Spring(Jackson)에는 같은 JSON 모양이 나오도록 여기서 맞춘다. */
@JsonTypeInfo(use = JsonTypeInfo.Id.NAME, include = JsonTypeInfo.As.PROPERTY, property = "type")
@JsonSubTypes(
    JsonSubTypes.Type(ScheduleReplaced::class, name = "schedule.replaced"),
    JsonSubTypes.Type(PlaybackChanged::class, name = "playback.changed"),
    JsonSubTypes.Type(VolumeChanged::class, name = "volume.changed"),
    JsonSubTypes.Type(OverrideSet::class, name = "override.set"),
    JsonSubTypes.Type(OverrideCleared::class, name = "override.cleared"),
)
interface StateEventMixin

@JsonInclude(JsonInclude.Include.NON_NULL)
abstract class OmitNullMixin

@Configuration
class JacksonConfig {
    @Bean
    fun domainMixins() = Jackson2ObjectMapperBuilderCustomizer { b ->
        b.mixIn(StateEvent::class.java, StateEventMixin::class.java)
        b.mixIn(ScheduleItem::class.java, OmitNullMixin::class.java)
    }
}
