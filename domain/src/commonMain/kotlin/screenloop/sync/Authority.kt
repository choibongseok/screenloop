package screenloop.sync

private val SCENES = setOf("aurora", "waves", "grid", "pulse", "dusk")

fun validItems(items: List<ScheduleItem>?): Boolean {
    if (items == null || items.isEmpty() || items.size > 50) return false
    val ids = HashSet<String>()
    for (it in items) {
        if (it.id.isEmpty() || it.id.length > 40 || !ids.add(it.id)) return false
        if (it.title.isBlank() || it.title.length > 60) return false
        if (it.sceneId !in SCENES) return false
        if (it.durationSec < 1 || it.durationSec > 3600) return false
        val w = it.window
        if (w != null && (w.fromMin !in 0..1440 || w.toMin !in 0..1440)) return false
    }
    return true
}

private fun reject(r: Reject): Decision = Rejected(r)

/**
 * 명령 한 건을 지금 상태에서 판정한다(순수 함수). 충돌 규칙은 TypeScript sync-core 의 decide 와 같고,
 * 같은 시험 벡터(spec/vectors/sync-authority.json)로 두 구현이 같은 결과를 내는지 확인한다.
 */
fun decide(state: DeviceState, cmd: Command, nowMs: Long): Decision {
    when (cmd) {
        is ScheduleReplace -> {
            if (cmd.baseScheduleVersion != state.scheduleVersion) return reject(Reject.CONFLICT)
            if (!validItems(cmd.items)) return reject(Reject.INVALID)
            val items = cmd.items!!
            val nextVersion = state.scheduleVersion + 1
            return Accepted { d, v, t, a -> ScheduleReplaced(d, v, t, a, Schedule(items), nextVersion) }
        }
        is PlaybackNext -> {
            val np = nowPlaying(state, nowMs) ?: return reject(Reject.INVALID)
            if (np.item.id != cmd.fromItemId) return reject(Reject.STALE)
            val items = playableItems(state.schedule, nowMs)
            val pos = startOfIndex(items, (np.index + 1) % items.size)
            return Accepted { d, v, t, a -> PlaybackChanged(d, v, t, a, "next", pos, state.playback.paused) }
        }
        is PlaybackJump -> {
            val items = playableItems(state.schedule, nowMs)
            val idx = items.indexOfFirst { it.id == cmd.itemId }
            if (idx < 0) return reject(Reject.INVALID)
            val pos = startOfIndex(items, idx)
            return Accepted { d, v, t, a -> PlaybackChanged(d, v, t, a, "jump", pos, state.playback.paused) }
        }
        is PlaybackPause -> {
            if (state.playback.paused) return reject(Reject.UNCHANGED)
            val pos = nowPlaying(state, nowMs)?.loopPositionMs ?: 0L
            return Accepted { d, v, t, a -> PlaybackChanged(d, v, t, a, "pause", pos, true) }
        }
        is PlaybackResume -> {
            if (!state.playback.paused) return reject(Reject.UNCHANGED)
            val pos = state.playback.positionMs
            return Accepted { d, v, t, a -> PlaybackChanged(d, v, t, a, "resume", pos, false) }
        }
        is PlaybackSeek -> {
            val np = nowPlaying(state, nowMs)
            val p = cmd.positionMs
            if (np == null || p == null || p < 0 || p >= np.loopLengthMs) return reject(Reject.INVALID)
            return Accepted { d, v, t, a -> PlaybackChanged(d, v, t, a, "seek", p, state.playback.paused) }
        }
        is VolumeSet -> {
            val v0 = cmd.volume
            if (v0 == null || v0 < 0 || v0 > 100) return reject(Reject.INVALID)
            if (v0.toInt() == state.volume) return reject(Reject.UNCHANGED)
            return Accepted { d, v, t, a -> VolumeChanged(d, v, t, a, v0.toInt()) }
        }
        is OverrideSetCmd -> {
            val text = cmd.text ?: ""
            if (text.isBlank() || text.length > 80) return reject(Reject.INVALID)
            val d0 = cmd.durationSec
            if (cmd.durationBad || (d0 != null && (d0 < 1 || d0 > 86400))) return reject(Reject.INVALID)
            val until = if (d0 == null) null else nowMs + d0 * 1000
            return Accepted { d, v, t, a -> OverrideSet(d, v, t, a, text, until) }
        }
        is OverrideClear -> {
            if (state.override == null) return reject(Reject.UNCHANGED)
            return Accepted { d, v, t, a -> OverrideCleared(d, v, t, a) }
        }
    }
}

/** 이벤트를 상태에 적용한다. 시각은 이벤트의 serverTimeMs 만 쓴다. */
fun reduce(state: DeviceState, ev: StateEvent): DeviceState = when (ev) {
    is ScheduleReplaced -> state.copy(
        version = ev.version,
        schedule = ev.schedule,
        scheduleVersion = ev.scheduleVersion,
        playback = Playback(ev.serverTimeMs, 0, state.playback.paused),
    )
    is PlaybackChanged -> state.copy(version = ev.version, playback = Playback(ev.serverTimeMs, ev.positionMs, ev.paused))
    is VolumeChanged -> state.copy(version = ev.version, volume = ev.volume)
    is OverrideSet -> state.copy(version = ev.version, override = Override(ev.text, ev.untilMs))
    is OverrideCleared -> state.copy(version = ev.version, override = null)
}

/**
 * 명령 한 건을 처리한다: 판정 → 이벤트 만들기(버전은 지금 상태 + 1) → 새 상태. 서버(DB 저장)와 데모(메모리)가 같은 이 함수를 쓴다.
 * 같은 commandId 를 다시 받았을 때 처음 결과를 돌려주는 일은 저장소가 다르므로 호출하는 쪽이 한다.
 */
fun step(state: DeviceState, cmd: Command, nowMs: Long, actor: String): Step = when (val d = decide(state, cmd, nowMs)) {
    is Accepted -> {
        val ev = d.event(state.deviceId, state.version + 1, nowMs, actor)
        val next = reduce(state, ev)
        Step(CommandOutcome("accepted", null, next.version, false, ev), next)
    }
    is Rejected -> Step(CommandOutcome("rejected", d.reason.wire, state.version, false, null), state)
}
