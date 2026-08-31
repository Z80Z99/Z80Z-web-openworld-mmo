import { Application, Container } from "pixi.js";
import { MOVE_SPEED, CHUNK_SIZE, DEFAULT_SEED, type CombatEventPayload } from "@mmo/shared";

import { Camera, TileRenderer, EntityRenderer, MobRenderer, TILE_PX, textureManager } from "./renderer/index.js";
import { NetworkManager } from "./network/index.js";
import { InputManager, TouchControls } from "./input/index.js";
import type { InputVector } from "./input/index.js";
import { GameState } from "./game/index.js";
import { HUD, CombatUI, IdleUI, MobileUI, QuestUI, CraftingUI, ShopUI, TradeUI, MountUI, TitleUI, TutorialOverlay, ResponsiveLayout, BattlePanel, CombatPanel } from "./ui/index.js";
import type { CombatPanelActionPayload } from "./ui/index.js";
import { normalizeCombatEvent } from "./combat/CombatEventNormalizer.js";

/* ── Configuration ── */
const SEED = DEFAULT_SEED;
const BACKGROUND_COLOR = 0x1a1a2e;
const SERVER_URL = "ws://localhost:2567";

/* ── Bootstrap ── */
async function main() {
  // PixiJS application
  const app = new Application();
  await app.init({
    background: BACKGROUND_COLOR,
    resizeTo: window,
    antialias: false,
    resolution: window.devicePixelRatio || 1,
    autoDensity: true,
  });

  const container = document.getElementById("game-container");
  if (!container) throw new Error("Missing #game-container element");
  container.appendChild(app.canvas);

  // Game state
  const gameState = new GameState(SEED);

  // Load character sprites (Kenney roguelikeChar_transparent.png)
  await textureManager.load();

  // World stage (all game world rendering happens here)
  const worldStage = new Container();
  app.stage.addChild(worldStage);

  // Zoom in for closer view
  worldStage.scale.set(1.5);

  // Camera
  const camera = new Camera(
    worldStage,
    app.screen.width,
    app.screen.height,
    0.1,
  );

  // Tile renderer
  const tileRenderer = new TileRenderer(worldStage, camera);
  // Wire cross-chunk tile lookup for deterministic shore bitmask rendering
  tileRenderer.setWorldTileQuery((wx, wy) => gameState.getTileAt(wx, wy));

  // Debug handles for headless QA / console inspection (harmless in production)
  (window as unknown as Record<string, unknown>).__PIXI_APP__ = app;
  (window as unknown as Record<string, unknown>).__GAME_DEBUG__ = { tileRenderer, gameState, camera, textureManager };

  // Entity renderer (players)
  const entityRenderer = new EntityRenderer(worldStage, gameState);

  // Mob renderer
  const mobRenderer = new MobRenderer(worldStage);

  // Input — use TouchControls on mobile, InputManager on desktop
  const isMobile = navigator.maxTouchPoints > 0;
  let input: InputManager | TouchControls;

  let mobileUI: MobileUI | null = null;

  if (isMobile) {
    const touchControls = new TouchControls(document.body);
    input = touchControls;

    // Mobile HUD (separate from desktop HUD)
    mobileUI = new MobileUI(container);
    mobileUI.onChatToggle(() => {
      chatOpen = !chatOpen;
      hud.toggleChat(chatOpen);
    });

    // Wire action buttons
    touchControls.onAction((action) => {
      switch (action) {
        case "attack": {
          // Auto-target nearest mob if none targeted
          if (!gameState.targetedMobId) {
            const mobs = Array.from(gameState.mobs.values());
            if (mobs.length > 0) {
              const local = gameState.localPlayer;
              if (local) {
                let nearest = mobs[0];
                let nearestDist = Infinity;
                for (const mob of mobs) {
                  const dx = mob.x - local.x;
                  const dy = mob.y - local.y;
                  const dist = dx * dx + dy * dy;
                  if (dist < nearestDist) {
                    nearestDist = dist;
                    nearest = mob;
                  }
                }
                gameState.targetedMobId = nearest.id;
              }
            }
          }
          if (gameState.targetedMobId) {
            network.sendAttack(gameState.targetedMobId);
          }
          break;
        }
        case "interact":
          break;
        case "mount":
          // Toggle mount/dismount
          network.sendMountAction("mount", "default_mount");
          break;
        case "inventory":
          break;
      }
    });
  } else {
    input = new InputManager(document.body);
  }

  let chatOpen = false;

  // HUD (DOM overlay)
  const hud = new HUD(container);
  hud.onChatSubmit((msg) => {
    network.sendChat(msg);
  });

  // Combat UI (DOM overlay)
  const combatUI = new CombatUI(container);

  // Idle reward UI (DOM overlay)
  const idleUI = new IdleUI(container);
  idleUI.onClaim(() => {
    network.sendIdleClaim();
  });

  // Quest tracker UI (DOM overlay)
  const questUI = new QuestUI(container);

  // Crafting menu UI (DOM overlay)
  const craftingUI = new CraftingUI(container);
  craftingUI.setCraftHandler((recipeId) => {
    network.sendCraftRequest(recipeId);
  });

  // Shop UI (DOM overlay)
  const shopUI = new ShopUI(container);
  shopUI.onBuy((shopId, itemId, count) => {
    network.sendShopBuy(shopId, itemId, count);
  });
  shopUI.onSell((itemId, count) => {
    network.sendShopSell(itemId, count);
  });

  // Trade UI (DOM overlay)
  const tradeUI = new TradeUI(container);
  tradeUI.onConfirm((tradeId) => {
    network.sendTradeConfirm(tradeId);
  });
  tradeUI.onCancel((tradeId) => {
    network.sendTradeCancel(tradeId);
  });

  // Mount indicator UI (DOM overlay)
  const mountUI = new MountUI(container);
  mountUI.onMountAction((action, mountId) => {
    if (action === "dismount") {
      network.sendMountAction("dismount", mountId);
    }
  });

  // Battle panel UI (DOM overlay — spatial battle state)
  const battlePanel = new BattlePanel(container);

  // Combat panel UI (DOM overlay — turn-based combat with actions)
  const combatPanel = new CombatPanel(container);
  combatPanel.onAction((payload: CombatPanelActionPayload) => {
    network.sendEncounterAction(payload.action, payload.targetId);
  });

  // Title display UI (DOM overlay)
  const titleUI = new TitleUI(container);

  // Tutorial overlay
  const tutorialOverlay = new TutorialOverlay(container);

  // Responsive layout (auto-detects breakpoints)
  const responsive = new ResponsiveLayout();
  responsive.onBreakpointChange((_bp) => {});
  responsive.init();

  // FPS tracking
  let frameCount = 0;
  let lastFpsTime = performance.now();

  // Damage number counter for unique IDs
  let damageCounter = 0;

  /* ── Network ── */
  const network = new NetworkManager(SERVER_URL, gameState, {
    onRoomJoin(roomId) {
      console.log(`[net] Joined room ${roomId}`);
    },
    onLocalPlayerReady(playerId, state) {
      const cx = Math.floor(state.x / CHUNK_SIZE);
      const cy = Math.floor(state.y / CHUNK_SIZE);
      loadChunksAround(cx, cy, 2);
      camera.snapTo(state.x * TILE_PX, state.y * TILE_PX);
    },
    onPlayerMove(_playerId, _state) {
      // Server reconciliation is handled by GameState
    },
    onTileUpdate(_chunkKey, _tiles) {
      // Server tile data would override prediction if needed
    },
    onEntityAdd(_entityId, _entity) {},
    onEntityUpdate(entityId, entity) {
      // Update mob renderer with new state
      const mob = gameState.mobs.get(entityId);
      if (mob) {
        mobRenderer.updateMobState(entityId, {
          ...mob,
          x: entity.x,
          y: entity.y,
          health: entity.health,
        });
      }
    },
    onEntityRemove(entityId) {
      mobRenderer.removeMob(entityId);
    },
    onCombatEvent(event) {
      // Normalize raw server event → strongly-typed event
      const normalized = normalizeCombatEvent(event as any);
      if (!normalized) return;

      // ── Update structured state model (sole mutation path) ──
      gameState.updateCombatFromEvent(normalized);
      gameState.updateBattleFromEvent(normalized);

      // ── Update BattlePanel ──
      if (gameState.battle && gameState.localPlayer) {
        const playerParticipants = gameState.battle.playerSide.participants.map((p) => ({
          id: p.id,
          name: p.id === gameState.localPlayer!.id ? "You" : p.id.slice(0, 8),
          currentHp: 100,
          maxHp: 100,
          alive: p.state !== "ELIMINATED",
          fleeing: p.state === "FLEEING",
          isLeader: gameState.battle!.playerSide.leaderId === p.id,
        }));
        const enemyParticipants = gameState.battle.enemySide.participants.map((p) => ({
          id: p.id,
          name: p.id.slice(0, 8),
          currentHp: 100,
          maxHp: 100,
          alive: p.state !== "ELIMINATED",
          fleeing: p.state === "FLEEING",
          isLeader: gameState.battle!.enemySide.leaderId === p.id,
        }));
        battlePanel.show({
          battleState: gameState.battle.playerSide.state,
          playerParticipants,
          enemyParticipants,
        });
      }

      // ── Update CombatPanel ──
      if (gameState.combat && gameState.localPlayer) {
        const localId = gameState.localPlayer.id;
        const participants = gameState.combat.participants.map((p) => {
          const mob = gameState.mobs.get(p.participantId);
          return {
            participantId: p.participantId,
            name: p.participantId === localId ? "You" : (mob?.typeId ?? p.participantId).slice(0, 8),
            currentHp: p.currentHp,
            maxHp: p.maxHp,
            alive: p.alive,
            defending: p.defending,
            fleeing: p.fleeing,
            side: p.side,
          };
        });
        combatPanel.show({
          combatState: gameState.combat.state,
          round: gameState.combat.round,
          currentActorId: gameState.combat.currentActorId,
          turnOrder: [...gameState.combat.turnOrder],
          participants,
          localPlayerId: localId,
        });

        // Combat log entries from events
        if (normalized.type === "damage_dealt" || normalized.type === "player_damaged") {
          const sourceName = normalized.sourceId === localId ? "You" : normalized.sourceId.slice(0, 8);
          const targetName = normalized.targetId === localId ? "You" : normalized.targetId.slice(0, 8);
          combatPanel.addLogEntry({
            text: `${sourceName} dealt ${normalized.damage} to ${targetName}`,
            timestamp: Date.now(),
          });
        }
        if (normalized.type === "mob_killed") {
          combatPanel.addLogEntry({ text: `${normalized.targetId.slice(0, 8)} was slain!`, timestamp: Date.now() });
        }
        if (normalized.type === "player_died") {
          combatPanel.addLogEntry({ text: `${normalized.targetId === localId ? "You" : normalized.targetId.slice(0, 8)} have fallen!`, timestamp: Date.now() });
        }
        if (normalized.type === "encounter_fled") {
          combatPanel.addLogEntry({ text: `${normalized.sourceId.slice(0, 8)} fled!`, timestamp: Date.now() });
        }
        if (normalized.type === "player_damaged") {
          combatPanel.addLogEntry({ text: `Round ${gameState.combat.round} begins`, timestamp: Date.now() });
        }
      }

      // Hide panels when combat/battle ends
      if (!gameState.combat) {
        combatPanel.hide();
      }
      if (!gameState.battle) {
        battlePanel.hide();
      }

      // ── UI effects (kept as-is, not state mutations) ──

      // Floating damage numbers
      if (normalized.type === "damage_dealt" || normalized.type === "player_damaged") {
        const targetId = normalized.targetId;
        const isPlayerDamage = normalized.type === "player_damaged";
        let screenPos: { x: number; y: number } | null = null;

        if (isPlayerDamage) {
          const local = gameState.localPlayer;
          if (local) {
            screenPos = {
              x: local.x * 16 - camera.x + camera.viewportWidth / 2,
              y: local.y * 16 - camera.y + camera.viewportHeight / 2,
            };
          }
        } else {
          screenPos = mobRenderer.getMobScreenPosition(targetId);
          if (screenPos) {
            screenPos = {
              x: screenPos.x - camera.x + camera.viewportWidth / 2,
              y: screenPos.y - camera.y + camera.viewportHeight / 2,
            };
          }
        }

        if (screenPos) {
          combatUI.addDamageNumber(
            `dmg_${damageCounter++}`,
            `-${normalized.damage}`,
            screenPos.x,
            screenPos.y,
            false,
          );
        }
      }

      // XP display
      if (normalized.type === "xp_gained" && normalized.xp) {
        const local = gameState.localPlayer;
        if (local) {
          const screenX = local.x * 16 - camera.x + camera.viewportWidth / 2;
          const screenY = local.y * 16 - camera.y + camera.viewportHeight / 2 - 20;
          combatUI.addDamageNumber(
            `xp_${damageCounter++}`,
            `+${normalized.xp} XP`,
            screenX,
            screenY,
            true,
          );
        }
      }

      // Quest event on mob kill
      if (normalized.type === "mob_killed") {
        network.sendQuestEvent("kill", event.mobType as string);
      }

      // Level up display
      if (normalized.type === "level_up") {
        const local = gameState.localPlayer;
        const screenX = (local?.x ?? 0) * 16 - camera.x + camera.viewportWidth / 2;
        const screenY = (local?.y ?? 0) * 16 - camera.y + camera.viewportHeight / 2 - 40;
        combatUI.addDamageNumber(
          `lvl_${damageCounter++}`,
          `LEVEL UP! ${normalized.level}`,
          screenX,
          screenY,
          true,
        );
      }
    },
    onChat(sender, content) {
      hud.addChatMessage(sender, content);
    },
    onError(_msg) {},
    onIdleSummary(summary) {
      idleUI.show(summary);
    },
    onIdleClaimResult(result) {
      idleUI.hide();
    },
    onQuestUpdate(data) {
      questUI.update(data);
    },
    onCraftResult(data) {
      if (data.success) {
        network.sendQuestEvent("craft", data.itemId);
      }
    },
    onShopResult(_data) {},
    onTradeStarted(data) {
      tradeUI.show({
        tradeId: data.tradeId,
        playerName: "",
        otherPlayerName: data.otherPlayerName,
        myItems: [],
        theirItems: [],
        myConfirmed: false,
        theirConfirmed: false,
        status: "pending",
      });
    },
    onTradeUpdate(data) {
      tradeUI.update({
        tradeId: data.tradeId,
        playerName: "",
        otherPlayerName: "",
        myItems: data.myItems,
        theirItems: data.theirItems,
        myConfirmed: data.myConfirmed,
        theirConfirmed: data.theirConfirmed,
        status: data.status,
      });
    },
    onTradeCancelled(_data) {
      tradeUI.hide();
    },
    onTradeComplete(_data) {
      tradeUI.hide();
      network.sendQuestEvent("trade");
    },
    onTradeError(_error) {},
    onTitleUpdate(data) {
      titleUI.update(data);
    },
  });

  /* ── Chunk loading ── */
  const loadedChunks = new Set<string>();

  function loadChunksAround(cx: number, cy: number, radius: number): void {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const chunkCx = cx + dx;
        const chunkCy = cy + dy;
        const key = `${chunkCx},${chunkCy}`;
        if (loadedChunks.has(key)) continue;

        // Client-side prediction: generate chunk locally. On generation
        // failure skip WITHOUT marking loaded, so a later frame retries.
        const chunk = gameState.predictChunk(chunkCx, chunkCy);
        if (!chunk) continue;
        tileRenderer.renderChunk(chunk);
        loadedChunks.add(key);
      }
    }
  }

  /* ── Handle resize ── */
  window.addEventListener("resize", () => {
    camera.resize(app.screen.width, app.screen.height);
  });

  /* ── Keyboard handlers ── */
  window.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !chatOpen) {
      chatOpen = true;
      hud.toggleChat(true);
      e.preventDefault();
    }

    // Tab key — cycle targeted mob
    if (e.key === "Tab" && !chatOpen) {
      e.preventDefault();
      const mobs = Array.from(gameState.mobs.values());
      if (mobs.length === 0) {
        gameState.targetedMobId = null;
        return;
      }

      const currentIdx = gameState.targetedMobId
        ? mobs.findIndex((m) => m.id === gameState.targetedMobId)
        : -1;
      const nextIdx = (currentIdx + 1) % mobs.length;
      gameState.targetedMobId = mobs[nextIdx].id;
    }

    // Space key — attack targeted mob
    if (e.key === " " && !chatOpen) {
      e.preventDefault();
      if (gameState.targetedMobId) {
        network.sendAttack(gameState.targetedMobId);
      }
    }
  });

  /* ── Mouse click — target mob ── */
  app.canvas.addEventListener("click", (e) => {
    if (chatOpen) return;

    // Convert click to world coords
    const rect = app.canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const worldX = (screenX + camera.x - camera.viewportWidth / 2) / 16;
    const worldY = (screenY + camera.y - camera.viewportHeight / 2) / 16;

    // Check if clicked on a mob
    const clickedMobId = mobRenderer.getMobAtPosition(worldX, worldY, 1);
    if (clickedMobId) {
      gameState.targetedMobId = clickedMobId;
    } else {
      gameState.targetedMobId = null;
    }
  });

  /* ── Game loop ── */
  app.ticker.add((ticker) => {
    const dt = ticker.deltaMS / 1000; // seconds

    // Input
    if (!chatOpen) {
      const dir = input.getDirection();
      if (dir.dx !== 0 || dir.dy !== 0) {
        // Client-side prediction + server send (handled by MovementManager)
        network.sendMovement(dir.dx, dir.dy, MOVE_SPEED, dt);
      }
    }

    // Smooth interpolation toward server position
    network.updateMovement(dt);

    // Camera follow local player
    const local = gameState.localPlayer;
    if (local) {
      camera.follow(local.x * TILE_PX, local.y * TILE_PX, dt);

      // Load chunks around player
      const { cx, cy } = GameState.worldToChunk(local.x, local.y);
      loadChunksAround(cx, cy, 2);
    }

    // Update entities (players)
    entityRenderer.update(camera.getVisibleBounds());

    // Update mob renderer
    // Set aggro state for mobs near the local player
    if (local) {
      for (const [id, mob] of gameState.mobs) {
        const dx = mob.x - local.x;
        const dy = mob.y - local.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        // Simple aggro heuristic: mobs within 5 tiles (matches server AGGRO_RANGE)
        const isAggro = dist <= 5;
        mobRenderer.updateMobState(id, { ...mob, isAggro });
      }
    }
    mobRenderer.update(camera.getVisibleBounds());

    // Update combat UI — damage numbers
    combatUI.update();

    // Update mob health bar for targeted mob
    if (gameState.targetedMobId) {
      const mob = gameState.mobs.get(gameState.targetedMobId);
      if (mob) {
        const screenPos = mobRenderer.getMobScreenPosition(mob.id);
        if (screenPos) {
          combatUI.updateMobHealthBar({
            mobId: mob.id,
            name: mob.typeId.charAt(0).toUpperCase() + mob.typeId.slice(1),
            currentHp: mob.health,
            maxHp: mob.maxHealth,
            x: screenPos.x - camera.x + camera.viewportWidth / 2,
            y: screenPos.y - camera.y + camera.viewportHeight / 2,
          });
        }
      } else {
        combatUI.updateMobHealthBar(null);
      }
    } else {
      combatUI.updateMobHealthBar(null);
    }

    // HUD updates
    if (local) {
      hud.updateHealth(local.health, local.maxHealth);
      hud.updatePlayerInfo(local.name, local.level);
      if (mobileUI) {
        mobileUI.updateHealth(local.health, local.maxHealth);
        mobileUI.updatePlayerInfo(local.name, local.level);
      }
      combatUI.updateXp(gameState.xp, gameState.xpToNextLevel, local.level);
    }

    // FPS
    frameCount++;
    const now = performance.now();
    if (now - lastFpsTime >= 1000) {
      hud.updateFPS(frameCount);
      frameCount = 0;
      lastFpsTime = now;
    }
  });

  /* ── Connect to server ── */
  await network.connect();

  // Input poll (attach to ticker for per-frame events)
  app.ticker.add(() => {
    input.poll();
  });
}

main().catch(console.error);
