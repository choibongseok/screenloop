package screenloop.store

import com.fasterxml.jackson.databind.ObjectMapper
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.stereotype.Repository
import screenloop.sync.DeviceState
import screenloop.sync.StateEvent

data class DeviceRow(val id: String, val name: String, val groupId: String, val accountId: String, val lastSeenMs: Long?)
data class GroupRow(val id: String, val name: String, val deviceIds: List<String>)

@Repository
class DeviceRepo(private val jdbc: JdbcTemplate, private val mapper: ObjectMapper) {
    fun deviceIdForKey(key: String): String? = jdbc.query("select id from device where device_key = ?", { rs, _ -> rs.getString(1) }, key).firstOrNull()

    fun devices(): List<DeviceRow> = jdbc.query("select id, name, group_id, account_id, last_seen_ms from device order by id") { rs, _ ->
        DeviceRow(rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4), rs.getLong(5).takeUnless { rs.wasNull() })
    }

    fun device(id: String): DeviceRow? = devices().firstOrNull { it.id == id }

    fun groups(): List<GroupRow> {
        val devs = devices()
        return jdbc.query("select id, name from device_group order by id") { rs, _ ->
            GroupRow(rs.getString(1), rs.getString(2), devs.filter { it.groupId == rs.getString(1) }.map { it.id })
        }
    }

    fun group(id: String): GroupRow? = groups().firstOrNull { it.id == id }

    fun touch(deviceId: String, nowMs: Long) {
        jdbc.update("update device set last_seen_ms = ? where id = ?", nowMs, deviceId)
    }

    fun state(deviceId: String): DeviceState? =
        jdbc.query("select state::text from device_state where device_id = ?", { rs, _ -> mapper.readValue(rs.getString(1), DeviceState::class.java) }, deviceId).firstOrNull()

    fun stateForUpdate(deviceId: String): DeviceState? =
        jdbc.query("select state::text from device_state where device_id = ? for update", { rs, _ -> mapper.readValue(rs.getString(1), DeviceState::class.java) }, deviceId).firstOrNull()

    fun insertState(state: DeviceState) {
        jdbc.update("insert into device_state (device_id, version, state) values (?, ?, ?::jsonb)", state.deviceId, state.version, mapper.writeValueAsString(state))
    }

    fun updateState(state: DeviceState) {
        jdbc.update("update device_state set version = ?, state = ?::jsonb where device_id = ?", state.version, mapper.writeValueAsString(state), state.deviceId)
    }

    fun appendEvent(ev: StateEvent) {
        jdbc.update("insert into device_event (device_id, version, server_time_ms, payload) values (?, ?, ?, ?::jsonb)", ev.deviceId, ev.version, ev.serverTimeMs, mapper.writeValueAsString(ev))
    }

    fun eventsAfter(deviceId: String, after: Long, limit: Int = 500): List<StateEvent> =
        jdbc.query("select payload::text from device_event where device_id = ? and version > ? order by version limit ?", { rs, _ -> mapper.readValue(rs.getString(1), StateEvent::class.java) }, deviceId, after, limit)

    fun commandResult(deviceId: String, commandId: String): String? =
        jdbc.query("select result::text from command_log where device_id = ? and command_id = ?", { rs, _ -> rs.getString(1) }, deviceId, commandId).firstOrNull()

    fun saveCommandResult(deviceId: String, commandId: String, json: String) {
        jdbc.update("insert into command_log (device_id, command_id, result) values (?, ?, ?::jsonb) on conflict do nothing", deviceId, commandId, json)
    }
}
