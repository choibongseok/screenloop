package screenloop.store

import org.springframework.boot.ApplicationArguments
import org.springframework.boot.ApplicationRunner
import org.springframework.stereotype.Component
import org.springframework.transaction.support.TransactionTemplate
import screenloop.sync.DeviceState
import screenloop.sync.PlaybackNext
import screenloop.sync.ScheduleItem
import screenloop.sync.ScheduleReplace
import java.time.Clock

/** 시작할 때 화면마다 기본 편성표를 이벤트 1번으로 넣는다(이미 있으면 건너뜀). 이벤트 로그가 1번부터 빠짐없이 이어지게 하려는 것이다. */
@Component
class Seeder(private val repo: DeviceRepo, private val commands: CommandService, private val tx: TransactionTemplate, private val clock: Clock) : ApplicationRunner {
    override fun run(args: ApplicationArguments) {
        val items = listOf(
            ScheduleItem("welcome", "환영 인사", "aurora", 8),
            ScheduleItem("menu", "오늘의 메뉴", "waves", 12),
            ScheduleItem("event", "이벤트 안내", "grid", 10),
        )
        for (d in repo.devices()) {
            val inserted = tx.execute { repo.state(d.id) ?: run { repo.insertState(DeviceState.initial(d.id)); null } } == null
            if (inserted || repo.state(d.id)!!.version == 0L) commands.submit(d.id, ScheduleReplace("seed-${d.id}", 0, items), "system")
        }
    }
}
