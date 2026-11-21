package screenloop.sync

import kotlinx.serialization.json.Json

/** 도메인 객체의 JSON 형식(명세와 같다). 기본값은 내보내지 않고(window 생략), null 은 명시한다(override: null). */
val DomainJson: Json = Json {
    classDiscriminator = "type"
    encodeDefaults = false
    explicitNulls = true
    ignoreUnknownKeys = true
}
