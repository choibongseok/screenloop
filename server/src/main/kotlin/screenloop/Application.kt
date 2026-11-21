package screenloop

import org.springframework.boot.autoconfigure.SpringBootApplication
import org.springframework.boot.context.properties.ConfigurationProperties
import org.springframework.boot.context.properties.EnableConfigurationProperties
import org.springframework.boot.runApplication
import org.springframework.context.annotation.Bean
import java.time.Clock

@ConfigurationProperties("screenloop")
data class AppProps(val version: String, val tokenSecret: String, val users: Map<String, UserProps>) {
    data class UserProps(val password: String, val role: String)
}

@SpringBootApplication
@EnableConfigurationProperties(AppProps::class)
class Application {
    @Bean fun clock(): Clock = Clock.systemUTC()
}

fun main(args: Array<String>) {
    runApplication<Application>(*args)
}
