plugins {
    alias(libs.plugins.kotlin.multiplatform) apply false
    alias(libs.plugins.kotlin.serialization) apply false
    alias(libs.plugins.kotlin.jvm) apply false
    alias(libs.plugins.kotlin.spring) apply false
    alias(libs.plugins.spring.boot) apply false
    alias(libs.plugins.spring.dependency.management) apply false
}

// 테스트는 항상 다시 실행한다(결과 파일이 최신이어야 테스트 케이스 문서 대조가 맞는다)
subprojects {
    tasks.withType<AbstractTestTask>().configureEach {
        outputs.upToDateWhen { false }
    }
}
