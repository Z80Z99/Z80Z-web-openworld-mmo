# Phase 3H.1 — Guard Legacy Encounter Tick

## 1. Current HEAD

- Commit: `8ba612f`
- Branch: `main`
- Date: 2026-08-29

## 2. Guard Implementation

**File:** `packages/server/src/server/GameLoop.ts` (L95-100)

```ts
this.tickMobAI(dt, now);
// Phase 3H.1: Skip Legacy encounter tick when New Combat is active.
// When flag ON, all encounter processing flows through tickCombatSessions.
// When flag OFF, Legacy encounters run normally for emergency rollback.
if (!isBattleCombatEnabled()) {
  this.tickEncounters(now);
}
this.tickCombatSessions(now);
```

**Mechanism:**
- `isBattleCombatEnabled()` is imported from `./CombatSystem.js`
- Default: `true` (when `ENABLE_BATTLE_COMBAT` env var is unset or not `"false"`)
- `tickEncounters()` — private method, Legacy encounter processing (L412-493)
- `tickCombatSessions()` — private method, New Combat turn/timeout processing (L500-508)

## 3. Flag=true Behavior

| Component | Behavior |
|-----------|----------|
| `tickEncounters()` | **SKIPPED** — no Legacy encounter tick runs |
| `tickCombatSessions()` | **RUNS** — New Combat turns + timeout evaluation |
| `CombatManager.evaluateTurnTimeout()` | **RUNS** — evaluates all active sessions |
| `tickCombatEnemyTurns()` | **RUNS** — auto-resolves enemy turns |
| `EncounterSystem.*` | No calls from tick path |

## 4. Flag=false Behavior

| Component | Behavior |
|-----------|----------|
| `tickEncounters()` | **RUNS** — full Legacy encounter tick |
| `getActiveEncounters()` | **RUNS** — iterates active encounters |
| `resolveMobTurn()` | **RUNS** — auto-resolves mob turns |
| `tickTimeouts()` | **RUNS** — expires stale encounters |
| `tickCombatSessions()` | **RUNS** — evaluates turn timeouts (no enemy auto-resolve) |

## 5. Tests

| Test | Description | Result |
|------|-------------|--------|
| LEG-001 | flag=true → tickEncounters skipped | ✅ GREEN |
| LEG-002 | flag=false → tickEncounters runs | ✅ GREEN |
| LEG-003 | flag=true → New Combat tick still runs | ✅ GREEN |
| LEG-004 | flag=true → no Legacy combat turn | ✅ GREEN |
| LEG-005 | flag=false → Legacy timeout still works | ✅ GREEN |
| LEG-006 | flag=true → no double turn | ✅ GREEN |
| LEG-007 | flag=false → Legacy regression | ✅ GREEN |

**File:** `packages/server/src/server/GameLoopTickGuard.test.ts`

## 6. Full Regression

| Suite | Result |
|-------|--------|
| Total tests | **1365/1365 GREEN** |
| Test files | **52/52 GREEN** |
| New tests | +7 (LEG-001..007) |
| Pre-existing failures | 0 |

## 7. TypeScript Compilation

| Package | Result |
|---------|--------|
| shared | ✅ clean |
| server | ✅ clean |
| client | ✅ clean |

## 8. Build

| Package | Result |
|---------|--------|
| shared (`tsc --project tsconfig.json`) | ✅ clean |

## 9. Confirmation: No New Combat Behavior Changed

| Check | Result |
|-------|--------|
| `tickCombatSessions()` path unchanged | ✅ |
| `CombatManager.evaluateTurnTimeout()` still called | ✅ |
| `tickCombatEnemyTurns()` still called (flag ON) | ✅ |
| No new code paths added to New Combat | ✅ |
| No EncounterSystem methods called from New Combat | ✅ |

## 10. Remaining Phase 3H.2 Work

| Task | Description |
|------|-------------|
| Phase 3H.2 | Implement Flee action in New Combat system |
| Phase 3H.3 | Extract EncounterSystem constants (TURN_TIMEOUT_MS, MOB_TURN_DELAY_MS, ENCOUNTER_ENGAGE_RANGE) to shared location |
| Phase 3I | Remove Legacy code (EncounterSystem class, legacy paths, encounter.test.ts) |

---

**STATUS: PHASE 3H.1 COMPLETE ✅**
