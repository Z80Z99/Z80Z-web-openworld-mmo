# Phase 3G-4C: Legacy Fallback Retirement

## Summary

Removed automatic New→Legacy fallback from the combat system. When `ENABLE_BATTLE_COMBAT` is ON (default), creation failures now log structured errors and block the Legacy path entirely. Legacy remains available as emergency rollback via `ENABLE_BATTLE_COMBAT=false`.

## Commits

| Commit | Hash | Description |
|--------|------|-------------|
| A | `7b0f18c` | Remove automatic New→Legacy fallback + structured logging |
| B | `96819cd` | Add LegacyFallbackRetirement test suite (20 tests) |

## Files Changed

### Modified
- **`packages/server/src/server/GameRoom.ts`**
  - Attack handler (line ~788): Added guard to block Legacy path when `isBattleCombatEnabled()` is true and `routeRealtimeAttack` returns `fallback`. Logs `fallback_blocked_attack` event.
  - Encounter action handler (line ~916): Added guard to block Legacy path when flag is ON and route returns `not-in-combat`. Logs `fallback_blocked_encounter` event.
  - Import added: `emitCombatLog` from `ProductionCombatLog.js`.
  - Log event check updated: `"legacy_fallback"` → `"creation_failed"`.

- **`packages/server/src/server/ProductionCombatLog.ts`**
  - Added event types: `"creation_failed"`, `"fallback_blocked_attack"`, `"fallback_blocked_encounter"`.
  - Removed event type: `"legacy_fallback"`.

- **`packages/server/src/server/ProductionCombatRouter.ts`**
  - `ensurePlayerCombat()`: All `emitCombatLog` calls renamed from `"legacy_fallback"` to `"creation_failed"`.
  - Comment updated: "The caller will NOT fall back to Legacy — it will log and block."

- **`packages/server/src/server/ProductionCutover.test.ts`**
  - Updated all `"legacy_fallback"` references to `"creation_failed"`.

- **`packages/server/src/server/ProductionRuntimeValidation.test.ts`**
  - Updated all `"legacy_fallback"` references to `"creation_failed"`.

### Created
- **`packages/server/src/server/LegacyFallbackRetirement.test.ts`**
  - 20 tests (LFR-001..020) across 6 describe blocks.

## Test Results

| Metric | Value |
|--------|-------|
| Total tests | 1358 (1338 baseline + 20 new) |
| Passing | 1358 |
| Failing | 0 |
| tsc×3 | All clean |

## Test Coverage (LFR-001..020)

### Attack Handler Fallback Blocking (LFR-001..005)
- LFR-001: flag ON + missing player → fallback returned, no Legacy combat
- LFR-002: flag ON + missing player → `creation_failed` logged with `player_unavailable`
- LFR-003: flag ON + beginEncounter failure → fallback, battle rolled back, `combat_creation_failed` logged
- LFR-004: flag OFF + missing player → fallback allowed (Legacy available)
- LFR-005: flag ON + successful creation → `combat` kind, no fallback logs

### Encounter Action Handler Fallback Blocking (LFR-006..010)
- LFR-006: flag ON + routeEncounterAction returns not-in-combat → no Legacy
- LFR-007: flag ON + routeEncounterDefend returns not-in-combat → no Legacy
- LFR-008: flag OFF + routeEncounterAction → not-in-combat (Legacy available)
- LFR-009: flag ON + active session → routeEncounterAction returns combat
- LFR-010: flag ON + active session → routeEncounterDefend returns combat

### Emergency Rollback (LFR-011..013)
- LFR-011: `ENABLE_BATTLE_COMBAT=false` → `isBattleCombatEnabled()` returns false
- LFR-012: flag OFF → fallback allowed, no blocking
- LFR-013: flag unset → default ON

### Structured Logging (LFR-014..016)
- LFR-014: `player_unavailable` → `creation_failed` event with reason + IDs
- LFR-015: `battle_creation_failed` → `creation_failed` event with reason + IDs
- LFR-016: `combat_creation_failed` → `creation_failed` event with reason + battleId

### Ownership Integrity (LFR-017..018)
- LFR-017: mob owned by combat → second attack joins as pending (not fallback)
- LFR-018: player owns combat session → encounter_action routes to combat

### Cleanup on Failure (LFR-019..020)
- LFR-019: beginEncounter failure → no combat session, removal attempted
- LFR-020: battle creation failure → no battle, no dangling session

## Behavioral Changes

### Before (3G-4A)
```
Player attacks mob
  → isBattleCombatEnabled() = true
  → routeRealtimeAttack → fallback (creation failed)
  → Falls through to Legacy path (processPlayerAttack + encounterSystem.beginEncounter)
```

### After (3G-4C)
```
Player attacks mob
  → isBattleCombatEnabled() = true
  → routeRealtimeAttack → fallback (creation failed)
  → emitCombatLog("fallback_blocked_attack", { playerId, targetId })
  → RETURN (Legacy path never reached)
```

## Emergency Rollback

To re-enable Legacy combat:
```bash
ENABLE_BATTLE_COMBAT=false
```

This disables the guards in GameRoom.ts, allowing the Legacy path to execute when the New path fails.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    GameRoom.attack                       │
│  ┌──────────────────────────────────────────────────┐   │
│  │ if (isBattleCombatEnabled()) {                   │   │
│  │   routed = routeRealtimeAttack(...)              │   │
│  │   if (blocked/joined/combat) return              │   │
│  │   // fallback: NEW — block + log + return        │   │
│  │   emitCombatLog("fallback_blocked_attack")       │   │
│  │   return  ← Legacy never reached                 │   │
│  │ }                                                 │   │
│  │ // Legacy path (only when flag OFF)              │   │
│  │ processPlayerAttack(...)                          │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

## Validation

- [x] 1358/1358 tests GREEN
- [x] tsc×3 clean
- [x] No type errors
- [x] Legacy preserved for emergency rollback
- [x] Structured logging for all failure paths
- [x] Pushed to GitHub (7b0f18c, 96819cd)
