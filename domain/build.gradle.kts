plugins {
    alias(libs.plugins.kotlin.multiplatform)
    alias(libs.plugins.kotlin.serialization)
}

// 서버의 순수 도메인(명령 판정·상태 전이·재생 기록 기준·정산 계산). JVM 은 Spring 서버가 쓰고, JS 는 데모 사이트가 브라우저에서 부른다.
kotlin {
    jvmToolchain(21)
    jvm()
    js(IR) {
        nodejs()
        useEsModules()
        binaries.executable()
    }
    sourceSets {
        commonMain.dependencies {
            api(libs.kotlinx.serialization.json)
        }
        commonTest.dependencies {
            implementation(kotlin("test"))
        }
        jvmTest.dependencies {
            implementation(libs.jackson.module.kotlin)
            implementation("org.junit.jupiter:junit-jupiter:5.13.4")
            runtimeOnly("org.junit.platform:junit-platform-launcher")
        }
    }
}

tasks.withType<Test>().configureEach {
    useJUnitPlatform()
    systemProperty("screenloop.specDir", rootProject.layout.projectDirectory.dir("spec").asFile.absolutePath)
    testLogging { events("passed", "failed", "skipped"); exceptionFormat = org.gradle.api.tasks.testing.logging.TestExceptionFormat.FULL }
}
