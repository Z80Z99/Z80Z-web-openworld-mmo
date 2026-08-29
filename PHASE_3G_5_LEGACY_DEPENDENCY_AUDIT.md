# Phase 3G-5: Legacy Dependency Audit

## 1. Current HEAD

| Item | Value |
|------|-------|
| Commit | `c2ca0d0` |
| Branch | `main` |
| Tests | 1358/1358 GREEN |
| tsc×3 | Clean |
| Code modified | NONE (read-only audit) |

---

## 2. Legacy Production Dependencies

These are EncounterSystem references that execute **even when `ENABLE_BATTLE_COMBAT=true`**.

### 2.1 Unguarded Legacy Production Calls (CONFIRMED)

| # | File | Line | Code | Risk |
|---|------|------|------|------|
| 1 | `GameLoop.ts` | 96 | `this.tickEncounters(now)` | **HIGH** — runs every tick, not flag-gated |
| 2 | `GameLoop.ts` | 372 | `this.encounterSystem.beginEncounter(...)` | **HIGH** — mob-initiated encounter creation (ownership guards only) |
| 3 | `GameLoop.ts` | 409 | `this.encounterSystem.getActiveEncounters()` | MEDIUM — iterates Legacy encounters |
| 4 | `GameLoop.ts` | 419 | `this.encounterSystem.endEncounterForMob(enc.mobId)` | MEDIUM — cleanup |
| 5 | `GameLoop.ts` | 435 | `this.encounterSystem.resolveMobTurn(...)` | **HIGH** — resolves mob turns |
| 6 | `GameLoop.ts` | 479 | `this.encounterSystem.tickTimeouts(now)` | MEDIUM — timeout handling |
| 7 | `GameRoom.ts` | 140 | `this.encounterSystem.endEncounterForMob(mobId)` | MEDIUM — mob despawn cleanup |
| 8 | `GameRoom.ts` | 402-405 | `hasEncounter / getEncounter / endEncounter` | MEDIUM — player disconnect cleanup |
| 9 | `GameRoom.ts` | 773 | `if (this.encounterSystem.hasEncounter(...)) return` | MEDIUM — attack guard |

### 2.2 Ownership Guards (Partial Protection)

GameLoop.ts lines 349-358: `isMobOwnedByCombat` + `isPlayerOwnedByCombat` prevent Legacy encounter creation when combat owns the mob/player. However, this is **not** the same as `isBattleCombatEnabled()` — it's an ownership check that works regardless of flag.

### 2.3 Flag-Guarded (Safe)

| File | Lines | Code |
|------|-------|------|
| `GameRoom.ts` | 780-795 | `routeRealtimeAttack` + fallback block |
| `GameRoom.ts` | 890-922 | `routeEncounterAction` / `routeEncounterDefend` + fallback block |
| `GameLoop.ts` | 223-228 | `notifyCombatJoinedPlayers` |
| `GameLoop.ts` | 243-250 | `syncFleeingState` / `syncRejoinState` |
| `GameLoop.ts` | 264-277 | `releaseMobCombatState` + `encounter_fled` compat |

---

## 3. Rollback Dependencies (`ENABLE_BATTLE_COMBAT=false`)

When flag is OFF, these Legacy paths execute:

| # | Component | File | Lines | What it does |
|---|-----------|------|-------|-------------|
| 1 | Attack handler | `GameRoom.ts` | 802-873 | `processPlayerAttack` + aggro + `beginEncounter` |
| 2 | Encounter action handler | `GameRoom.ts` | 924-1001 | `getEncounter` + `playerAction` + event loop + end |
| 3 | Flee action | `GameRoom.ts` | 924+ | Always uses Legacy `playerAction("flee")` regardless of flag |
| 4 | tickEncounters | `GameLoop.ts` | 407-488 | Full Legacy tick loop |
| 5 | Mob AI encounter | `GameLoop.ts` | 346-399 | `pendingEncounterTarget` → `beginEncounter` |

**Verdict**: Legacy rollback is FULLY FUNCTIONAL when flag is OFF. All 5 attack → encounter → turn → damage → death → XP → loot → respawn paths work.

---

## 4. Client Dependencies

### 4.1 Legacy-Only Client Components

| # | File | Lines | What | Classification |
|---|------|-------|------|---------------|
| 1 | `EncounterPanel.ts` | 1-191 (all) | Turn-based encounter UI (single-mob, single-HP) | **Legacy-only** |
| 2 | `main.ts` | 9 | `import { EncounterPanel }` | **Legacy-only** |
| 3 | `main.ts` | 182-185 | `new EncounterPanel()` + `onAction` wiring | **Legacy-only** |
| 4 | `main.ts` | 240-262 | `encounter_started` handler | **Legacy-only** |
| 5 | `main.ts` | 265-294 | Encounter state mutations (`inEncounter`, `encounterMobHp`, etc.) | **Legacy-only** |
| 6 | `main.ts` | 288 | `encounter_fled` terminal handler | **Legacy-only** |
| 7 | `GameState.ts` | 86-92 | 6 encounter fields | **Legacy-only** |
| 8 | `NetworkManager.ts` | 112-115 | `sendEncounterAction()` | **Legacy-only** |
| 9 | `ui/index.ts` | 25-26 | EncounterPanel re-export | **Legacy-only** |

### 4.2 Shared Client Components

| # | File | Lines | What | Classification |
|---|------|-------|------|---------------|
| 1 | `main.ts` | 297-335 | Floating damage numbers | **Shared** (works for both combat modes) |
| 2 | `NetworkManager.ts` | 277-279 | `combat_event` listener | **Shared** (carries both Legacy + real-time) |
| 3 | `NetworkManager.ts` | 37 | `onCombatEvent` callback | **Shared** (untyped `any`) |

### 4.3 Client Migration Scope

**To delete after migration:**
- `EncounterPanel.ts` (191 lines)
- `GameState.ts` lines 86-92 (6 fields)
- `main.ts` lines 9, 182-185, 240-294 (import + instantiation + event handlers)
- `NetworkManager.ts` lines 112-115 (`sendEncounterAction`)
- `ui/index.ts` lines 25-26 (re-export)

**To preserve:**
- `main.ts` lines 297-335 (floating damage — shared)
- `NetworkManager.ts` lines 277-279 (`combat_event` listener — shared)

---

## 5. Network Dependencies

### 5.1 Protocol Events

| Event | Direction | Legacy | New Combat | Can Remove? |
|-------|-----------|--------|------------|-------------|
| `encounter_started` | Server→Client | ✅ | ✅ (compat payload) | **NO** — New Combat sends this |
| `encounter_fled` | Server→Client | ✅ | ✅ (compat payload for disengagement) | **NO** — New Combat sends this |
| `encounter_timeout` | Server→Client | ✅ | ❌ | YES (after client migration) |
| `defend` | Server→Client | ✅ | ❌ | YES (after client migration) |
| `encounter_action` | Client→Server | ✅ | ❌ (routed through `routeEncounterAction`) | YES (after client migration) |

### 5.2 Shared Channel

| Channel | Direction | Use |
|---------|-----------|-----|
| `combat_event` | Server→Client | Carries ALL combat events (Legacy + real-time + New Combat). **MUST KEEP.** |

### 5.3 `encounter_started` Compatibility Payload

The New Combat system emits `encounter_started` as a **compatibility payload** so the existing client EncounterPanel opens. This is emitted by:
- `ProductionMultiParticipantCombat.ts` line 113 (`buildCombatStartedPayload`)
- `GameRoom.ts` line 860 (Legacy path)
- `GameLoop.ts` line 389 (mob-initiated Legacy path)
- `GameLoop.ts` line 222-228 (New Combat `notifyCombatJoinedPlayers`)

**Critical**: `encounter_started` is NOT Legacy-only. It's the bridge between New Combat and the Legacy client UI. Removing it requires client migration first.

---

## 6. HP Dependencies

### 6.1 EncounterSystem HP Mirrors

`ActiveEncounter` (EncounterSystem.ts lines 18-32):
```typescript
mobHp: number;    // Authoritative mirror during encounter
playerHp: number; // Authoritative mirror during encounter
```

These mirrors are **written** by:
- `beginEncounter()` (line 127-128): snapshot from `view.mobHp` / `view.playerHp`
- `playerAction()` → `resolvePlayerAttack()` (line 193): `encounter.mobHp -= damage`
- `resolveMobTurn()` (line 260): `encounter.playerHp -= damage`

These mirrors are **read back** by:
- `GameRoom.ts` lines 944-956: syncs `mob.currentHp` / `player.health` from encounter results
- `GameLoop.ts` lines 446-454: syncs `player.health` from `resolveMobTurn` results

### 6.2 World HP Authority

| Authority | Used By | Scope |
|-----------|---------|-------|
| `mob.currentHp` | Both Legacy + New Combat | Source of truth for mob HP |
| `player.health` | Both Legacy + New Combat | Source of truth for player HP |
| `entity.health` | Both Legacy + New Combat | Colyseus schema sync |
| `ActiveEncounter.mobHp` | Legacy only | Mirror during encounter |
| `ActiveEncounter.playerHp` | Legacy only | Mirror during encounter |

**Verdict**: World HP (`mob.currentHp` / `player.health`) is the single authority. EncounterSystem HP mirrors are transient copies that sync back after each action. No dual authority conflict.

### 6.3 Shared Protocol HP Fields

`CombatEventPayload` (messages.ts lines 95-98):
```typescript
mobHp?: number;
mobMaxHp?: number;
playerHp?: number;
playerMaxHp?: number;
```

Used by both Legacy and New Combat events. These are **optional** fields on the shared type.

---

## 7. Movement Dependencies

### 7.1 `inEncounter` (Mob State)

| File | Line | Usage | Guarded? |
|------|------|-------|----------|
| `CombatSystem.ts` | 216 | Type definition (`Mob.inEncounter: boolean`) | N/A |
| `MobSpawner.ts` | 147 | `if (mob.aiState === "fighting" \|\| mob.inEncounter)` — blocks mob movement | **NOT guarded** |
| `MobSpawner.ts` | 233 | Default: `inEncounter: false` | N/A |
| `MobSpawner.ts` | 322 | Reset: `mob.inEncounter = false` | N/A |
| `GameRoom.ts` | 765 | `if (mob.inEncounter) return` — blocks attack | **NOT guarded** |
| `GameRoom.ts` | 858 | Set: `mob.inEncounter = true` | Legacy only |
| `GameRoom.ts` | 975 | Reset: `mob.inEncounter = false` | Legacy only |
| `GameLoop.ts` | 347 | `if (!mob.pendingEncounterTarget \|\| mob.inEncounter) continue` | Ownership guards only |
| `GameLoop.ts` | 382 | Set: `mob.inEncounter = true` | Legacy only |
| `GameLoop.ts` | 459 | Reset: `mob.inEncounter = false` | Legacy only |
| `ProductionMultiParticipantCombat.ts` | 341 | Reset: `mob.inEncounter = false` | New Combat cleanup |

**Verdict**: `inEncounter` affects mob movement (MobSpawner line 147) and attack eligibility (GameRoom line 765). Both are **NOT flag-gated**. When flag is ON, if a mob somehow has `inEncounter = true` from a Legacy path, it would block movement. In practice, New Combat never sets `inEncounter = true` (confirmed by comment at ProductionMultiParticipantCombat.ts line 331).

### 7.2 `fighting` (AI State)

| File | Line | Usage | Guarded? |
|------|------|-------|----------|
| `CombatSystem.ts` | 214 | Type definition | N/A |
| `MobSpawner.ts` | 147 | `if (mob.aiState === "fighting" \|\| mob.inEncounter)` — blocks movement | **NOT guarded** |
| `GameRoom.ts` | 857 | Set: `mob.aiState = "fighting"` | Legacy only |
| `GameLoop.ts` | 383 | Set: `mob.aiState = "fighting"` | Legacy only |

**Verdict**: `fighting` AI state blocks mob movement. Only set by Legacy paths. New Combat never sets this.

### 7.3 `pendingEncounterTarget` (Mob State)

| File | Line | Usage | Guarded? |
|------|------|-------|----------|
| `CombatSystem.ts` | 218 | Type definition | N/A |
| `MobSpawner.ts` | 234 | Default: `null` | N/A |
| `MobSpawner.ts` | 289 | Set: `mob.pendingEncounterTarget = mob.aggroTarget` | **NOT guarded** |
| `MobSpawner.ts` | 323 | Reset: `null` | N/A |
| `GameLoop.ts` | 347 | Read: `if (!mob.pendingEncounterTarget \|\| mob.inEncounter) continue` | Ownership guards only |
| `GameLoop.ts` | 354-381 | Read/clear in encounter creation | Ownership guards only |

**Verdict**: `pendingEncounterTarget` is set by MobSpawner (NOT flag-gated) and consumed by GameLoop (ownership guards only). When flag is ON, ownership guards prevent Legacy encounter creation from this path.

---

## 8. Reward Dependencies

### 8.1 Single Reward Authority

All 3 kill paths converge on `CombatEffects.resolveMobKill`:

| # | Entry Point | File | Line | Path |
|---|-------------|------|------|------|
| 1 | Legacy encounter victory | `GameRoom.ts` | 981 | `encounter_action` → `playerAction` → `resolveMobKill` |
| 2 | New Combat realtime kill | `GameRoom.ts` | 1160 | `resolveNewCombatKill` |
| 3 | New Combat turn-based kill | `ProductionCombatRouter.ts` | 268/304 | `deps.resolveKill` → `resolveNewCombatKill` |

**No dual reward system exists.** XP/Loot flows through `CombatEffects.resolveMobKill` in all cases.

### 8.2 XP Grant Paths

| Path | System | Function |
|------|--------|----------|
| Combat XP | `CombatEffects.ts` | `resolveMobKill` → `calculateXpGain` → `applyLevelUps` |
| Quest XP | `QuestSystem.ts` | `reportEvent` → `def.xpReward` → `.run()` |

These are independent. No overlap.

### 8.3 Legacy Reward Under Flag ON

When `ENABLE_BATTLE_COMBAT=true`:
- Legacy `encounter_action` handler is blocked (lines 890-922)
- Legacy `resolveMobKill` at line 981 is unreachable
- **No Legacy reward path executes when flag is ON**

**Verdict**: CLEAN. No blocker.

---

## 9. Respawn Dependencies

### 9.1 Player Respawn

| File | Line | Code | Dependency |
|------|------|------|-----------|
| `GameRoom.ts` | 1106-1129 | `respawnPlayer()` | Uses `sendEncounterEvent` (thin wrapper) — NOT EncounterSystem |

**Verdict**: Player respawn is independent of EncounterSystem. Uses `sendEncounterEvent` which is just `client.send`.

### 9.2 Mob Respawn

| File | Line | Code | Dependency |
|------|------|------|-----------|
| `MobSpawner.ts` | Various | Mob spawn/despawn/respawn | Independent of EncounterSystem |

**Verdict**: Mob respawn is independent of EncounterSystem.

---

## 10. Cleanup Dependencies

### 10.1 `tickEncounters` (GameLoop.ts)

| Property | Value |
|----------|-------|
| Line | 96 (call), 407-488 (definition) |
| Flag-gated? | **NO** |
| Called | Every tick |
| Purpose | Resolve mob turns, handle timeouts, cleanup dead encounters |

**This is the PRIMARY unguarded Legacy production dependency.**

### 10.2 `endEncounterForMob`

| Caller | File | Line | Guarded? |
|--------|------|------|----------|
| MobSpawner removal hook | `GameRoom.ts` | 140 | **NO** |
| tickEncounters (dead mob) | `GameLoop.ts` | 419 | **NO** |

### 10.3 `endEncounter`

| Caller | File | Line | Guarded? |
|--------|------|------|----------|
| Player disconnect | `GameRoom.ts` | 405 | **NO** |

---

## 11. Dead Code

| # | File | Lines | What | Status |
|---|------|-------|------|--------|
| 1 | `GameRoom.ts` | 802-873 | Legacy attack path | Dead when flag ON (3G-4C blocks fallback) |
| 2 | `GameRoom.ts` | 924-1001 | Legacy encounter_action path | Dead when flag ON (3G-4C blocks fallback) |
| 3 | `GameRoom.ts` | 924+ | Flee action handler | **ALIVE** — always uses Legacy regardless of flag |

**Note**: Lines 802-873 and 924-1001 are dead when flag is ON, but preserved for emergency rollback. The flee action (line 924+) is ALWAYS active — it's the one Legacy path that executes even when flag is ON.

---

## 12. Safe-to-Delete Components

After Legacy removal (with flag permanently ON + client migrated):

| # | Component | File | Lines | Dependencies |
|---|-----------|------|-------|-------------|
| 1 | `EncounterSystem` class | `EncounterSystem.ts` | 79-327 | Only constants needed by New Combat |
| 2 | `encounter.test.ts` | `encounter.test.ts` | All | Unit tests for deleted class |
| 3 | Legacy attack path | `GameRoom.ts` | 802-873 | Self-contained |
| 4 | Legacy encounter_action path | `GameRoom.ts` | 924-1001 | Self-contained |
| 5 | `tickEncounters` | `GameLoop.ts` | 407-488 | Self-contained |
| 6 | Mob AI encounter creation | `GameLoop.ts` | 346-399 | Requires ownership guard migration |

**Before deletion, must extract constants:**
- `TURN_TIMEOUT_MS` (12000) — used by `ProductionCombatRouter.ts`
- `MOB_TURN_DELAY_MS` (800) — used by `ProductionMultiParticipantCombat.ts`
- `ENCOUNTER_ENGAGE_RANGE` (1.6) — used by `GameRoom.ts`
- `FLEE_CHANCE`, `DEFEND_DAMAGE_MULTIPLIER`, `MAX_ENCOUNTER_ROUNDS` — internal only

---

## 13. Components Requiring Client Migration

| # | Component | File | Lines | Migration Action |
|---|-----------|------|-------|-----------------|
| 1 | `EncounterPanel` | `EncounterPanel.ts` | 1-191 | Delete (or redesign for multi-participant) |
| 2 | Encounter state | `GameState.ts` | 86-92 | Delete 6 fields |
| 3 | Encounter event handlers | `main.ts` | 240-294 | Delete `encounter_started`/`encounter_fled` handlers |
| 4 | EncounterPanel wiring | `main.ts` | 182-185 | Delete instantiation |
| 5 | `sendEncounterAction` | `NetworkManager.ts` | 112-115 | Delete method |
| 6 | EncounterPanel export | `ui/index.ts` | 25-26 | Delete re-export |

**Preserve:**
- `combat_event` listener (shared channel)
- Floating damage numbers (shared)

---

## 14. Components Requiring Protocol Migration

| # | Protocol | Type | Migration Action |
|---|----------|------|-----------------|
| 1 | `encounter_action` | Client→Server | Remove after client migration |
| 2 | `encounter_timeout` | Server→Client | Remove after client migration |
| 3 | `defend` | Server→Client | Remove after client migration |
| 4 | `encounter_started` | Server→Client | **KEEP** — New Combat compat payload |
| 5 | `encounter_fled` | Server→Client | **KEEP** — New Combat compat payload |

---

## 15. Legacy Removal Blockers

| # | Blocker | Severity | File | Lines | Resolution |
|---|---------|----------|------|-------|------------|
| 1 | `tickEncounters` not flag-gated | **CRITICAL** | `GameLoop.ts` | 96, 407-488 | Add `if (!isBattleCombatEnabled())` guard OR delete after client migration |
| 2 | Mob AI encounter creation not flag-gated | **HIGH** | `GameLoop.ts` | 346-399 | Ownership guards are partial protection; add explicit flag guard |
| 3 | `hasEncounter` guard not flag-gated | **MEDIUM** | `GameRoom.ts` | 773 | Cleanup code — safe to keep for rollback |
| 4 | Flee action always uses Legacy | **HIGH** | `GameRoom.ts` | 924+ | New Combat must implement flee OR keep Legacy flee for rollback |
| 5 | `encounter_started` used by New Combat | **MEDIUM** | Multiple | — | Keep as compat payload until client migrates |
| 6 | `encounter_fled` used by New Combat | **MEDIUM** | Multiple | — | Keep as compat payload until client migrates |
| 7 | Client not migrated | **CRITICAL** | `client/` | — | Phase 3H client migration required |
| 8 | `inEncounter`/`fighting` affect movement | **MEDIUM** | `MobSpawner.ts` | 147 | New Combat never sets these; safe but verify |

---

## 16. Non-Blockers

| # | Item | Why Not a Blocker |
|---|------|-------------------|
| 1 | `sendEncounterEvent` usage | Thin wrapper over `client.send` — no EncounterSystem dependency |
| 2 | `respawnPlayer` | Uses `sendEncounterEvent` — independent of EncounterSystem |
| 3 | `CombatEffects.ts` | `resolveMobKill` / `applyLevelUps` / `applyCombatEvents` — no EncounterSystem dependency |
| 4 | `CombatSystem.ts` type defs | `inEncounter` / `pendingEncounterTarget` on Mob interface — type-only, safe to keep |
| 5 | Shared protocol types | `CombatEventType` union — optional fields, safe to keep |
| 6 | `mob.currentHp` / `player.health` | World HP is single authority — no dual HP conflict |
| 7 | XP/Loot reward | Single authority via `CombatEffects.resolveMobKill` — no dual reward |
| 8 | Player respawn | Independent of EncounterSystem |
| 9 | Mob respawn | Independent of EncounterSystem |

---

## 17. Full Tests

| Metric | Value |
|--------|-------|
| Test files | 51 |
| Tests | 1358/1358 GREEN |
| Duration | ~10s |

---

## 18. tsc

| Package | Result |
|---------|--------|
| `@mmo/shared` | Clean |
| `@mmo/server` | Clean |
| `@mmo/client` | Clean |

---

## 19. Build

| Command | Result |
|---------|--------|
| `tsc --noEmit -p packages/shared` | Clean |
| `tsc --noEmit -p packages/server` | Clean |
| `tsc --noEmit -p packages/client` | Clean |

---

## 20. Legacy Removal Readiness Grade

### Grade: **YELLOW** — 先完成 Client/Protocol Migration

**GREEN 条件 (已满足):**
- [x] No normal production `EncounterSystem` caller when flag ON (except tickEncounters + cleanup)
- [x] No normal production `beginEncounter` caller when flag ON (ownership guards prevent)
- [x] No normal production encounter reward when flag ON
- [x] No normal production encounter HP authority conflict
- [x] Rollback path fully functional
- [x] New Battle/Combat has independent reward/HP/respawn
- [x] EncounterSystem constants extractable (TURN_TIMEOUT_MS, MOB_TURN_DELAY_MS, ENCOUNTER_ENGAGE_RANGE)

**YELLOW 条件 (未满足):**
- [ ] `tickEncounters` not flag-gated (CRITICAL — runs every tick when flag ON)
- [ ] Client not migrated (Phase 3H required)
- [ ] Flee action not implemented in New Combat
- [ ] `encounter_started`/`encounter_fled` still needed as New Combat compat payloads
- [ ] `inEncounter`/`fighting`/`pendingEncounterTarget` still affect MobSpawner movement

**RED 条件 (不存在):**
- No normal production dependency that prevents removal (tickEncounters is the closest, but can be guarded)

### Recommended Next Steps

1. **Phase 3H**: Client migration (delete EncounterPanel, encounter state, encounter handlers)
2. **Phase 3H.1**: Guard `tickEncounters` with `if (!isBattleCombatEnabled())`
3. **Phase 3H.2**: Implement flee in New Combat system
4. **Phase 3H.3**: Extract EncounterSystem constants to shared location
5. **Phase 3I**: Remove Legacy code (EncounterSystem class, legacy paths, encounter.test.ts)
6. **Phase 3I.1**: Remove `encounter_action` / `encounter_timeout` / `defend` from protocol
7. **Phase 3I.2**: Remove `inEncounter` / `fighting` / `pendingEncounterTarget` from Mob interface

---

## Full Dependency Map

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    LEGACY ENCOUNTER DEPENDENCY MAP                       │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  EncounterSystem.ts ──────────────────────────────────────────────┐    │
│  │  class: beginEncounter, hasEncounter, getEncounter,            │    │
│  │         playerAction, resolveMobTurn, endEncounter,            │    │
│  │         endEncounterForMob, getActiveEncounters, tickTimeouts  │    │
│  │  constants: TURN_TIMEOUT_MS, MOB_TURN_DELAY_MS,               │    │
│  │             ENCOUNTER_ENGAGE_RANGE, FLEE_CHANCE,               │    │
│  │             DEFEND_DAMAGE_MULTIPLIER, MAX_ENCOUNTER_ROUNDS     │    │
│  │  types: ActiveEncounter, EncounterTurn, etc.                   │    │
│  └────────────────────────────────────────────────────────────────┘    │
│       │                           │                    │                │
│       ▼                           ▼                    ▼                │
│  ┌─────────────┐  ┌──────────────────────┐  ┌──────────────────┐     │
│  │ GameRoom.ts │  │ GameLoop.ts          │  │ New Combat       │     │
│  │             │  │                      │  │                  │     │
│  │ Attack:     │  │ tickEncounters:      │  │ TURN_TIMEOUT_MS  │     │
│  │ L773 guard  │  │ L96 (UNGUARDED!)     │  │ MOB_TURN_DELAY_MS│     │
│  │ L780 flag   │  │ L407-488             │  │ ENCOUNTER_ENGAGE │     │
│  │ L802 legacy │  │                      │  │ _RANGE           │     │
│  │ L849 begin  │  │ Mob AI:              │  │                  │     │
│  │             │  │ L346-399             │  │ buildCombat      │     │
│  │ Encounter:  │  │ (ownership guards)   │  │ StartedPayload   │     │
│  │ L878 msg    │  │                      │  │ (compat)         │     │
│  │ L890 flag   │  │ Disengage:           │  │                  │     │
│  │ L924 legacy │  │ L269 encounter_fled  │  │ encounter_started│     │
│  │             │  │ (compat)             │  │ (compat)         │     │
│  │ Cleanup:    │  │                      │  │                  │     │
│  │ L140 despawn│  │                      │  │                  │     │
│  │ L402 leave  │  │                      │  │                  │     │
│  └──────┬──────┘  └──────────┬───────────┘  └────────┬─────────┘     │
│         │                    │                        │                │
│         ▼                    ▼                        ▼                │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │                    CLIENT                                       │  │
│  │  EncounterPanel.ts (191 lines) — Legacy-only UI                │  │
│  │  main.ts L240-294 — encounter handlers                         │  │
│  │  GameState.ts L86-92 — encounter state                         │  │
│  │  NetworkManager.ts L112-115 — sendEncounterAction              │  │
│  │                                                                 │  │
│  │  SHARED:                                                        │  │
│  │  combat_event listener — carries both Legacy + New Combat       │  │
│  │  floating damage numbers — shared                               │  │
│  └─────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │                    SHARED PROTOCOL                               │  │
│  │  messages.ts:                                                   │  │
│  │    EncounterActionMessage (Legacy-only)                         │  │
│  │    encounter_started (Legacy + New Combat compat)               │  │
│  │    encounter_fled (Legacy + New Combat compat)                  │  │
│  │    encounter_timeout (Legacy-only)                              │  │
│  │    defend (Legacy-only)                                         │  │
│  │    combat_event (shared channel)                                │  │
│  └─────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

---

**Audit completed**: Phase 3G-5 Legacy Dependency Audit
**Agent**: Sisyphus
**Date**: 2026-08-29
**Head**: `c2ca0d0`
**Tests**: 1358/1358 GREEN
**tsc×3**: Clean
