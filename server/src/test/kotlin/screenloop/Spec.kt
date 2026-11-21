package screenloop

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import java.io.File

/** 저장소 루트 spec/ 의 명세와 공유 시험 벡터를 읽는다. */
object Spec {
    val dir: File = File(System.getProperty("screenloop.specDir") ?: "../spec")
    val mapper: ObjectMapper = jacksonObjectMapper()
    fun vector(name: String): JsonNode = mapper.readTree(File(dir, "vectors/$name"))

    /** 값을 JSON 글자로 바꿨다가 다시 읽어, 파일에서 읽은 JSON 과 숫자 형식까지 같은 모양으로 맞춘다. */
    fun norm(value: Any): JsonNode = mapper.readTree(mapper.writeValueAsString(value))
}
