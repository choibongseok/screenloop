plugins {
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.kotlin.spring)
    alias(libs.plugins.spring.boot)
    alias(libs.plugins.spring.dependency.management)
}

extra["testcontainers.version"] = libs.versions.testcontainers.get()

kotlin {
    jvmToolchain(21)
    compilerOptions { freeCompilerArgs.add("-Xjsr305=strict") }
}

dependencies {
    implementation(project(":domain"))
    implementation("org.springframework.boot:spring-boot-starter-web")
    implementation("org.springframework.boot:spring-boot-starter-jdbc")
    implementation("org.springframework.boot:spring-boot-starter-actuator")
    implementation("org.springframework.boot:spring-boot-starter-data-redis")
    implementation("org.flywaydb:flyway-core")
    implementation("org.flywaydb:flyway-database-postgresql")
    implementation(libs.jackson.module.kotlin)
    implementation("org.jetbrains.kotlin:kotlin-reflect")
    runtimeOnly("org.postgresql:postgresql")

    testImplementation("org.springframework.boot:spring-boot-starter-test")
    testImplementation(libs.testcontainers.junit)
    testImplementation(libs.testcontainers.postgresql)
    testImplementation(libs.jackson.dataformat.yaml)
    testImplementation(libs.json.schema.validator)
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

// Testcontainers 가 쓸 Docker 소켓: DOCKER_HOST 가 없으면 현재 docker context 의 엔드포인트를 쓴다
val dockerHost: String? = System.getenv("DOCKER_HOST") ?: runCatching {
    ProcessBuilder("docker", "context", "inspect", "--format", "{{.Endpoints.docker.Host}}").redirectErrorStream(true).start()
        .inputStream.bufferedReader().readText().trim().takeIf { it.startsWith("unix://") || it.startsWith("tcp://") }
}.getOrNull()

tasks.test {
    dockerHost?.let { environment("DOCKER_HOST", it) }
    // 공유 벡터와 명세는 저장소 루트의 spec/ 에 있다
    systemProperty("screenloop.specDir", rootProject.layout.projectDirectory.dir("spec").asFile.absolutePath)
    useJUnitPlatform()
    testLogging { events("passed", "failed", "skipped"); exceptionFormat = org.gradle.api.tasks.testing.logging.TestExceptionFormat.FULL }
    maxParallelForks = 1
}

tasks.bootJar { archiveFileName.set("screenloop-server.jar") }
