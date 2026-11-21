package screenloop

import org.flywaydb.core.Flyway
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.File
import java.sql.DriverManager

/** 데이터베이스 변경 규칙: 모든 마이그레이션에는 되돌리는 스크립트가 있고, 실제로 되돌린 뒤 다시 올릴 수 있다. */
class MigrationTest {
    private val rollbackDir = File(Spec.dir.parentFile, "db/rollback")
    private val migrationDir = File("src/main/resources/db/migration")

    @Test
    fun everyMigrationHasARollbackScript() {
        val ups = migrationDir.listFiles()!!.map { Regex("""V(\d+)__(.+)\.sql""").matchEntire(it.name)!!.destructured }.map { (v, n) -> v to n }
        assertTrue(ups.isNotEmpty())
        for ((v, name) in ups) assertTrue(File(rollbackDir, "U${v}__$name.sql").exists(), "V${v}__$name 에 대응하는 db/rollback/U${v}__$name.sql 이 없다")
        val downs = rollbackDir.listFiles()!!.map { it.name.removePrefix("U").substringBefore("__") }.toSet()
        assertEquals(ups.map { it.first }.toSet(), downs, "되돌리는 스크립트가 마이그레이션과 1:1 이어야 한다")
    }

    @Test
    fun rollbackScriptsUndoTheMigrationsAndTheyCanBeAppliedAgain() {
        val admin = DriverManager.getConnection(Infra.pg.jdbcUrl, "screenloop", "screenloop")
        admin.autoCommit = true
        admin.createStatement().use { it.execute("create database rollbacktest") }
        val url = Infra.pg.jdbcUrl.replaceAfterLast('/', "rollbacktest")
        fun flyway() = Flyway.configure().dataSource(url, "screenloop", "screenloop").load()
        fun tables(): Set<String> = DriverManager.getConnection(url, "screenloop", "screenloop").use { c ->
            c.createStatement().executeQuery("select table_name from information_schema.tables where table_schema='public' and table_name <> 'flyway_schema_history'").use { rs -> buildSet { while (rs.next()) add(rs.getString(1)) } }
        }
        flyway().migrate()
        val full = tables()
        assertTrue("invoice_line" in full && "play_record" in full && "device" in full)
        // 새 쪽부터 한 단계씩 되돌린다
        val scripts = rollbackDir.listFiles()!!.sortedByDescending { it.name.removePrefix("U").substringBefore("__").toInt() }
        var left = full
        for (s in scripts) {
            DriverManager.getConnection(url, "screenloop", "screenloop").use { c -> c.createStatement().use { it.execute(s.readText()) } }
            val now = tables()
            assertTrue(now.size < left.size, "${s.name} 가 아무것도 되돌리지 못했다")
            left = now
        }
        assertEquals(emptySet<String>(), left, "모든 되돌림 뒤에는 테이블이 남지 않는다")
        // 되돌린 뒤 기록 테이블을 지우고 같은 마이그레이션을 처음부터 다시 적용할 수 있다
        DriverManager.getConnection(url, "screenloop", "screenloop").use { c -> c.createStatement().use { it.execute("drop table flyway_schema_history") } }
        flyway().migrate()
        assertEquals(full, tables())
    }
}
