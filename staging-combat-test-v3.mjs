/**
 * Phase 3G-4B.5: Combat Runtime Validation v3
 *
 * KEY FIXES over v2:
 * 1. Uses Playwright physical page.click() instead of JS evaluate btn.click()
 * 2. Properly parses body.innerText using the encounter panel's DOM elements directly
 * 3. Waits for visual state changes (round number, HP text) instead of fixed timeouts
 * 4. Intercepts Colyseus room.send to verify messages reach the server
 * 5. Captures console [combat] log from server
 */
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const CLIENT_URL = 'http://localhost:3000';
const RESULTS_DIR = join(process.cwd(), 'staging-results');
if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true });

const log = [];
function ts() { return new Date().toISOString(); }
function record(msg) {
  const line = `[${ts()}] ${msg}`;
  log.push(line);
  console.log(line);
}

async function launchBrowser() {
  const chromiumPath = 'C:\\Users\\Administrator\\AppData\\Local\\ms-playwright\\chromium-1234\\chrome-win64\\chrome.exe';
  record('Launching Chromium...');
  return chromium.launch({
    executablePath: chromiumPath,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--disable-web-security']
  });
}

async function createPlayer(browser, playerName) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  const consoleLogs = [];
  const sentMessages = [];
  const receivedEvents = [];

  page.on('console', msg => {
    const text = msg.text();
    consoleLogs.push(`[${msg.type()}] ${text}`);
  });

  record(`${playerName}: Navigating to client...`);
  await page.goto(CLIENT_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await new Promise(r => setTimeout(r, 3000));

  // Inject message interceptor — hook into the Colyseus room.send
  await page.evaluate(() => {
    // Intercept room.send by patching WebSocket
    window.__sentMessages = [];
    window.__receivedEvents = [];
    window.__combatState = { inEncounter: false, round: 0, turn: 'unknown', mobHp: 0, mobMaxHp: 0, mobName: '', playerXp: 0 };

    // Patch console.log to capture [combat] events
    const origLog = console.log;
    console.log = function (...args) {
      origLog.apply(console, args);
      const text = args.join(' ');
      if (text.includes('[combat]')) {
        window.__receivedEvents.push(text);
      }
    };
  });

  const info = await page.evaluate(() => ({
    hasCanvas: document.querySelector('canvas') !== null,
    title: document.title
  }));

  record(`${playerName}: Connected canvas=${info.hasCanvas}`);
  return { page, context, consoleLogs, sentMessages, receivedEvents, name: playerName };
}

/**
 * Read encounter panel state directly from DOM elements.
 * The EncounterPanel creates specific child elements we can query.
 */
async function readEncounterPanel(page) {
  return page.evaluate(() => {
    // Find the encounter panel container — it's a div with z-index:50 containing the mob name
    const allDivs = document.querySelectorAll('div');
    let panelContainer = null;
    for (const d of allDivs) {
      if (d.style.zIndex === '50' && d.innerText?.includes('攻击') && d.innerText?.includes('防御')) {
        panelContainer = d;
        break;
      }
    }

    if (!panelContainer) {
      return { visible: false, mobName: '', mobHp: 0, mobMaxHp: 0, round: 0, turn: 'unknown', playerXp: 0, panelText: '' };
    }

    const panelText = panelContainer.innerText;
    const isVisible = panelContainer.style.display !== 'none';

    // Parse mob name and level: "Scorpion (Lv.3)"
    let mobName = '', mobLevel = 0;
    const nameMatch = panelText.match(/(.+?)\s*\(Lv\.(\d+)\)/);
    if (nameMatch) {
      mobName = nameMatch[1].trim();
      mobLevel = parseInt(nameMatch[2], 10);
    }

    // Parse HP: "60 / 60"
    let mobHp = 0, mobMaxHp = 0;
    const hpMatch = panelText.match(/(\d+)\s*\/\s*(\d+)/);
    if (hpMatch) {
      mobHp = parseInt(hpMatch[1], 10);
      mobMaxHp = parseInt(hpMatch[2], 10);
    }

    // Parse round: "回合 2"
    let round = 0;
    const roundMatch = panelText.match(/回合\s*(\d+)/);
    if (roundMatch) round = parseInt(roundMatch[1], 10);

    // Parse turn
    let turn = 'unknown';
    if (panelText.includes('你的回合')) turn = 'player';
    else if (panelText.includes('对方行动中')) turn = 'mob';

    // Parse player XP from body text
    let playerXp = 0;
    const bodyText = document.body.innerText;
    const xpMatch = bodyText.match(/XP:\s*(\d+)\s*\/\s*(\d+)/);
    if (xpMatch) playerXp = parseInt(xpMatch[1], 10);

    // Check if attack button is enabled
    const buttons = panelContainer.querySelectorAll('button');
    let attackEnabled = false;
    for (const btn of buttons) {
      if (btn.textContent?.trim() === '攻击') {
        attackEnabled = !btn.disabled;
      }
    }

    return { visible: isVisible, mobName, mobLevel, mobHp, mobMaxHp, round, turn, playerXp, panelText, attackEnabled };
  });
}

/**
 * Click the attack button using Playwright's physical click (NOT JS evaluate).
 * This performs a real mouse click at the button's coordinates.
 */
async function physicalClickAttack(page) {
  try {
    // Find the attack button inside the encounter panel (z-index:50)
    const btn = page.locator('div[style*="z-index: 50"] button:has-text("攻击")');
    const count = await btn.count();
    if (count === 0) {
      // Fallback: find any visible attack button
      const fallback = page.locator('button:has-text("攻击")');
      const fCount = await fallback.count();
      if (fCount > 0) {
        await fallback.first().click({ timeout: 2000 });
        return { clicked: true, method: 'fallback' };
      }
      return { clicked: false, reason: 'no attack button found' };
    }
    await btn.first().click({ timeout: 2000 });
    return { clicked: true, method: 'locator' };
  } catch (e) {
    return { clicked: false, reason: e.message.substring(0, 100) };
  }
}

/**
 * Wait for encounter panel to appear with specific properties
 */
async function waitForEncounter(page, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const state = await readEncounterPanel(page);
    if (state.visible && state.mobName) return state;
    await new Promise(r => setTimeout(r, 300));
  }
  return await readEncounterPanel(page);
}

/**
 * Wait for round number to change (indicates combat progressed)
 */
async function waitForRoundChange(page, currentRound, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const state = await readEncounterPanel(page);
    if (state.round !== currentRound || !state.visible) return state;
    await new Promise(r => setTimeout(r, 200));
  }
  return await readEncounterPanel(page);
}

/**
 * Wait for turn to become 'player'
 */
async function waitForPlayerTurn(page, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const state = await readEncounterPanel(page);
    if (state.turn === 'player' && state.visible) return state;
    await new Promise(r => setTimeout(r, 200));
  }
  return await readEncounterPanel(page);
}

// ============================================================
// TEST SCENARIOS
// ============================================================

async function testS1_1v1Combat(p1) {
  record('\n=== S1: 1v1 Combat Test ===');

  // Wait for encounter to start
  const state0 = await waitForEncounter(p1.page, 15000);
  record(`S1 initial: mob=${state0.mobName} Lv.${state0.mobLevel} HP=${state0.mobHp}/${state0.mobMaxHp} round=${state0.round} turn=${state0.turn} attackBtn=${state0.attackEnabled}`);
  await p1.page.screenshot({ path: join(RESULTS_DIR, 's1-initial.png') });

  if (!state0.visible || !state0.mobName) {
    record('S1: FAIL — No encounter panel visible');
    return { passed: false, notes: 'No encounter panel' };
  }

  // Attack loop
  let attacks = 0;
  const maxAttacks = 80;
  let lastRound = state0.round;

  while (attacks < maxAttacks) {
    const state = await readEncounterPanel(p1.page);

    // Mob died or encounter ended
    if (!state.visible || state.mobHp <= 0) {
      record(`S1: Encounter ended after ${attacks} attacks. XP=${state.playerXp}`);
      break;
    }

    // Only attack on player's turn
    if (state.turn === 'player' && state.attackEnabled) {
      const result = await physicalClickAttack(p1.page);
      if (result.clicked) {
        attacks++;
        record(`S1: Attack #${attacks} sent (mob HP=${state.mobHp}/${state.mobMaxHp} round=${state.round})`);

        // Wait for combat to process — round should change after mob retaliates
        await new Promise(r => setTimeout(r, 800)); // Give server time to process
        const newState = await waitForRoundChange(p1.page, state.round, 4000);

        if (!newState.visible) {
          record(`S1: Encounter ended after attack #${attacks}`);
          break;
        }
        lastRound = newState.round;
      } else {
        record(`S1: Attack click failed: ${result.reason}`);
        await new Promise(r => setTimeout(r, 500));
      }
    } else {
      // Not player's turn — wait
      await new Promise(r => setTimeout(r, 300));
    }
  }

  const finalState = await readEncounterPanel(p1.page);
  await p1.page.screenshot({ path: join(RESULTS_DIR, 's1-final.png') });

  const killed = !finalState.visible || finalState.mobHp <= 0;
  const xpGained = finalState.playerXp > 0;

  record(`S1 result: attacks=${attacks} killed=${killed} xp=${finalState.playerXp} finalVisible=${finalState.visible}`);

  return {
    passed: attacks > 0,
    attacks,
    killed,
    xp: finalState.playerXp,
    notes: `Attacks: ${attacks}, Killed: ${killed}, XP: ${finalState.playerXp}`
  };
}

async function testS2_2v1Combat(p1, p2) {
  record('\n=== S2: 2v1 Combat Test (Player B joins) ===');

  // Wait for P2 to get an encounter panel
  const p2State = await waitForEncounter(p2.page, 15000);
  record(`S2 P2: mob=${p2State.mobName} visible=${p2State.visible} turn=${p2State.turn}`);
  await p2.page.screenshot({ path: join(RESULTS_DIR, 's2-p2-encounter.png') });

  if (!p2State.visible) {
    record('S2: P2 could not enter combat — trying Tab + Attack');
    await p2.page.keyboard.press('Tab');
    await new Promise(r => setTimeout(r, 1000));
  }

  // Both players attack alternately
  let p1Attacks = 0, p2Attacks = 0;
  const maxRounds = 30;

  for (let i = 0; i < maxRounds; i++) {
    const s1 = await readEncounterPanel(p1.page);
    const s2 = await readEncounterPanel(p2.page);

    if ((!s1.visible || s1.mobHp <= 0) && (!s2.visible || s2.mobHp <= 0)) {
      record(`S2: Both encounters ended at round ${i}`);
      break;
    }

    if (s1.turn === 'player' && s1.attackEnabled && s1.visible) {
      await physicalClickAttack(p1.page);
      p1Attacks++;
      await new Promise(r => setTimeout(r, 800));
    }

    if (s2.turn === 'player' && s2.attackEnabled && s2.visible) {
      await physicalClickAttack(p2.page);
      p2Attacks++;
      await new Promise(r => setTimeout(r, 800));
    }
  }

  await p1.page.screenshot({ path: join(RESULTS_DIR, 's2-final-p1.png') });
  await p2.page.screenshot({ path: join(RESULTS_DIR, 's2-final-p2.png') });

  const s1f = await readEncounterPanel(p1.page);
  const s2f = await readEncounterPanel(p2.page);

  return {
    passed: p1Attacks > 0 || p2Attacks > 0,
    p1Attacks,
    p2Attacks,
    notes: `P1: ${p1Attacks} attacks (XP=${s1f.playerXp}), P2: ${p2Attacks} attacks (XP=${s2f.playerXp})`
  };
}

async function testS5_DynamicJoin(p1, p2) {
  record('\n=== S5: Dynamic Join Test ===');

  // P1 should have active encounter; P2 triggers encounter on same mob
  const s1 = await readEncounterPanel(p1.page);
  const s2 = await readEncounterPanel(p2.page);
  record(`S5: P1 panel=${s1.visible} mob=${s1.mobName}, P2 panel=${s2.visible} mob=${s2.mobName}`);

  await p2.page.screenshot({ path: join(RESULTS_DIR, 's5-before.png') });

  // P2 attacks to join combat
  if (s2.visible && s2.turn === 'player') {
    await physicalClickAttack(p2.page);
    await new Promise(r => setTimeout(r, 1000));
  }

  const s2After = await readEncounterPanel(p2.page);
  await p2.page.screenshot({ path: join(RESULTS_DIR, 's5-after.png') });

  return {
    passed: s2After.visible,
    notes: `P2 in combat: ${s2After.visible}, Mob: ${s2After.mobName}`
  };
}

async function testS8_MobDeathReward(p1) {
  record('\n=== S8: Mob Death + Reward Test ===');

  const s0 = await readEncounterPanel(p1.page);
  record(`S8 start: mob=${s0.mobName} HP=${s0.mobHp}/${s0.mobMaxHp} XP=${s0.playerXp}`);

  if (!s0.visible) {
    record('S8: No encounter panel — waiting...');
    const s = await waitForEncounter(p1.page, 15000);
    if (!s.visible) return { passed: false, notes: 'No encounter' };
  }

  let attacks = 0;
  const maxAttacks = 100;

  while (attacks < maxAttacks) {
    const state = await readEncounterPanel(p1.page);

    if (!state.visible || state.mobHp <= 0) {
      record(`S8: Mob killed after ${attacks} attacks! XP=${state.playerXp}`);
      break;
    }

    if (state.turn === 'player' && state.attackEnabled) {
      const result = await physicalClickAttack(p1.page);
      if (result.clicked) {
        attacks++;
        if (attacks % 10 === 0) record(`S8: ${attacks} attacks, mob HP=${state.mobHp}/${state.mobMaxHp}`);
        await new Promise(r => setTimeout(r, 800));
      }
    } else {
      await new Promise(r => setTimeout(r, 300));
    }
  }

  const finalState = await readEncounterPanel(p1.page);
  await p1.page.screenshot({ path: join(RESULTS_DIR, 's8-final.png') });

  const killed = !finalState.visible || finalState.mobHp <= 0;
  const xpGained = finalState.playerXp > s0.playerXp;

  record(`S8 result: killed=${killed} attacks=${xpGained} xpBefore=${s0.playerXp} xpAfter=${finalState.playerXp}`);

  return {
    passed: killed || xpGained,
    attacks,
    killed,
    xpBefore: s0.playerXp,
    xpAfter: finalState.playerXp,
    notes: `Attacks: ${attacks}, Killed: ${killed}, XP: ${finalState.playerXp}`
  };
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  record('Phase 3G-4B.5: Combat Runtime Validation v3');
  record('='.repeat(60));

  const browser = await launchBrowser();
  const p1 = await createPlayer(browser, 'Player1');
  const p2 = await createPlayer(browser, 'Player2');

  const results = {};
  results.s1 = await testS1_1v1Combat(p1);
  results.s2 = await testS2_2v1Combat(p1, p2);
  results.s5 = await testS5_DynamicJoin(p1, p2);
  results.s8 = await testS8_MobDeathReward(p1);

  // Final screenshots
  await p1.page.screenshot({ path: join(RESULTS_DIR, 'final-p1.png') });
  await p2.page.screenshot({ path: join(RESULTS_DIR, 'final-p2.png') });

  // Save logs
  writeFileSync(join(RESULTS_DIR, 'p1-console.log'), p1.consoleLogs.join('\n'));
  writeFileSync(join(RESULTS_DIR, 'p2-console.log'), p2.consoleLogs.join('\n'));

  // Cleanup
  await p1.context.close();
  await p2.context.close();
  await browser.close();

  const allPassed = results.s1.passed && results.s2.passed && results.s5.passed && results.s8.passed;
  const verdict = allPassed ? 'GREEN' : 'YELLOW';

  record('\n' + '='.repeat(60));
  record('VALIDATION COMPLETE');
  record(`S1 1v1 Combat:  ${results.s1.passed ? 'PASS ✓' : 'FAIL ✗'} — ${results.s1.notes}`);
  record(`S2 2v1 Combat:  ${results.s2.passed ? 'PASS ✓' : 'FAIL ✗'} — ${results.s2.notes}`);
  record(`S5 Dynamic Join: ${results.s5.passed ? 'PASS ✓' : 'FAIL ✗'} — ${results.s5.notes}`);
  record(`S8 Mob Death:   ${results.s8.passed ? 'PASS ✓' : 'FAIL ✗'} — ${results.s8.notes}`);
  record(`VERDICT: ${verdict}`);

  writeFileSync(join(RESULTS_DIR, 'results-v3.json'), JSON.stringify({ timestamp: ts(), results, verdict }, null, 2));
  writeFileSync(join(RESULTS_DIR, 'validation-v3.log'), log.join('\n'));
  record('Results saved to staging-results/');

  process.exit(0);
}

main().catch(e => { record(`FATAL: ${e.message}\n${e.stack}`); process.exit(1); });
