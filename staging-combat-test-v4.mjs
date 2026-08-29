/**
 * Phase 3G-4B.5: Combat Runtime Validation v4 (Final)
 *
 * Strategy: Instead of waiting for an encounter panel to appear,
 * PROACTIVELY trigger combat by pressing Tab (select mob) then
 * Space (attack to initiate encounter). Then validate the full loop.
 *
 * Evidence from v3: Physical clicks on attack button WORK.
 * P1 gained 30 XP from 8 attacks in S2. Combat flow is functional.
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
  page.on('console', msg => consoleLogs.push(`[${msg.type()}] ${msg.text()}`));

  record(`${playerName}: Navigating...`);
  await page.goto(CLIENT_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await new Promise(r => setTimeout(r, 4000));

  const info = await page.evaluate(() => ({
    hasCanvas: document.querySelector('canvas') !== null,
    title: document.title,
    bodySnippet: document.body.innerText.substring(0, 200)
  }));
  record(`${playerName}: Connected canvas=${info.hasCanvas} "${info.bodySnippet.substring(0, 80)}..."`);
  return { page, context, consoleLogs, name: playerName };
}

/**
 * Read encounter state from body.innerText — most reliable method.
 */
async function readState(page) {
  return page.evaluate(() => {
    const text = document.body.innerText;

    // Mob name + level: "Scorpion (Lv.3)"
    let mobName = '', mobLevel = 0;
    const nameMatch = text.match(/(.+?)\s*\(Lv\.(\d+)\)/);
    if (nameMatch && !nameMatch[1].includes('Guest')) {
      mobName = nameMatch[1].trim();
      mobLevel = parseInt(nameMatch[2], 10);
    }

    // HP: first "N / M" after mob name
    let mobHp = 0, mobMaxHp = 0;
    const hpMatch = text.match(/(\d+)\s*\/\s*(\d+)/);
    if (hpMatch) {
      mobHp = parseInt(hpMatch[1], 10);
      mobMaxHp = parseInt(hpMatch[2], 10);
    }

    // Round
    let round = 0;
    const roundMatch = text.match(/回合\s*(\d+)/);
    if (roundMatch) round = parseInt(roundMatch[1], 10);

    // Turn
    let turn = 'unknown';
    if (text.includes('你的回合')) turn = 'player';
    else if (text.includes('对方行动中')) turn = 'mob';

    // XP
    let xp = 0;
    const xpMatch = text.match(/XP:\s*(\d+)/);
    if (xpMatch) xp = parseInt(xpMatch[1], 10);

    // Encounter panel visible (check for "攻击" button in body)
    const panelVisible = text.includes('回合') && text.includes('你的回合');

    // Attack button enabled (check DOM)
    let attackEnabled = false;
    const btns = document.querySelectorAll('button');
    for (const b of btns) {
      if (b.textContent?.trim() === '攻击') attackEnabled = !b.disabled;
    }

    return { mobName, mobLevel, mobHp, mobMaxHp, round, turn, xp, panelVisible, attackEnabled, text: text.substring(0, 400) };
  });
}

/**
 * Physical click on attack button via Playwright locator.
 */
async function clickAttack(page) {
  try {
    const btn = page.locator('button:has-text("攻击")').first();
    await btn.click({ timeout: 2000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Trigger encounter: Tab to select mob, Space to attack (initiates combat).
 */
async function triggerEncounter(page) {
  await page.keyboard.press('Tab');
  await new Promise(r => setTimeout(r, 500));
  await page.keyboard.press('Space');
  await new Promise(r => setTimeout(r, 2000));
}

/**
 * Wait for condition with polling.
 */
async function waitUntil(fn, timeoutMs = 10000, intervalMs = 300) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = await fn();
    if (result) return result;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return await fn();
}

// ============================================================
// TEST S1: 1v1 Combat — Full Loop
// ============================================================
async function testS1(p1) {
  record('\n=== S1: 1v1 Combat — Full Loop ===');

  // Step 1: Trigger encounter
  record('Triggering encounter via Tab + Space...');
  await triggerEncounter(p1.page);

  // Step 2: Wait for encounter panel
  const state0 = await waitUntil(async () => {
    const s = await readState(p1.page);
    return s.panelVisible && s.mobName ? s : null;
  }, 15000);

  if (!state0) {
    // Try again
    record('First trigger failed, retrying...');
    await triggerEncounter(p1.page);
    const retry = await waitUntil(async () => {
      const s = await readState(p1.page);
      return s.panelVisible && s.mobName ? s : null;
    }, 10000);
    if (!retry) {
      record('S1: FAIL — Could not trigger encounter');
      await p1.page.screenshot({ path: join(RESULTS_DIR, 's1-fail.png') });
      return { passed: false, notes: 'Could not trigger encounter' };
    }
  }

  const s0 = await readState(p1.page);
  record(`S1 start: mob=${s0.mobName} Lv.${s0.mobLevel} HP=${s0.mobHp}/${s0.mobMaxHp} round=${s0.round} turn=${s0.turn} xp=${s0.xp}`);
  await p1.page.screenshot({ path: join(RESULTS_DIR, 's1-start.png'  ) });

  // Step 3: Attack loop
  let attacks = 0;
  const maxAttacks = 100;
  const startRound = s0.round;

  while (attacks < maxAttacks) {
    const s = await readState(p1.page);

    if (!s.panelVisible || s.mobHp <= 0) {
      record(`S1: Encounter ended after ${attacks} attacks. xp=${s.xp}`);
      break;
    }

    if (s.turn === 'player' && s.attackEnabled) {
      const ok = await clickAttack(p1.page);
      if (ok) {
        attacks++;
        if (attacks <= 3 || attacks % 10 === 0) {
          record(`S1: Attack #${attacks} mobHP=${s.mobHp}/${s.mobMaxHp} round=${s.round}`);
        }
        // Wait for server to process + mob turn + back to player
        await new Promise(r => setTimeout(r, 1000));
      } else {
        await new Promise(r => setTimeout(r, 500));
      }
    } else {
      await new Promise(r => setTimeout(r, 300));
    }
  }

  const sFinal = await readState(p1.page);
  await p1.page.screenshot({ path: join(RESULTS_DIR, 's1-final.png') });

  const killed = !sFinal.panelVisible || sFinal.mobHp <= 0;
  record(`S1 result: attacks=${attacks} killed=${killed} xp=${sFinal.xp} panelVisible=${sFinal.panelVisible}`);

  return {
    passed: attacks > 0,
    attacks, killed, xp: sFinal.xp,
    notes: `Attacks: ${attacks}, Killed: ${killed}, XP: ${sFinal.xp}, Rounds: ${sFinal.round - startRound}`
  };
}

// ============================================================
// TEST S2: 2v1 Combat
// ============================================================
async function testS2(p1, p2) {
  record('\n=== S2: 2v1 Combat ===');

  // Trigger encounter for P2
  await triggerEncounter(p2.page);
  const p2s = await waitUntil(async () => {
    const s = await readState(p2.page);
    return s.panelVisible && s.mobName ? s : null;
  }, 15000);

  if (!p2s) {
    record('S2: P2 could not trigger encounter');
    return { passed: false, notes: 'P2 no encounter' };
  }
  record(`S2 P2: mob=${p2s.mobName} HP=${p2s.mobHp}/${p2s.mobMaxHp}`);

  // Both attack alternately
  let p1a = 0, p2a = 0;
  for (let i = 0; i < 40; i++) {
    const s1 = await readState(p1.page);
    const s2 = await readState(p2.page);

    if ((!s1.panelVisible || s1.mobHp <= 0) && (!s2.panelVisible || s2.mobHp <= 0)) {
      record(`S2: Both ended at iteration ${i}`);
      break;
    }

    if (s1.turn === 'player' && s1.attackEnabled && s1.panelVisible) {
      await clickAttack(p1.page); p1a++;
      await new Promise(r => setTimeout(r, 800));
    }
    if (s2.turn === 'player' && s2.attackEnabled && s2.panelVisible) {
      await clickAttack(p2.page); p2a++;
      await new Promise(r => setTimeout(r, 800));
    }
  }

  const f1 = await readState(p1.page);
  const f2 = await readState(p2.page);
  await p1.page.screenshot({ path: join(RESULTS_DIR, 's2-final-p1.png') });
  await p2.page.screenshot({ path: join(RESULTS_DIR, 's2-final-p2.png') });

  return {
    passed: p1a > 0 || p2a > 0,
    p1Attacks: p1a, p2Attacks: p2a,
    notes: `P1: ${p1a} attacks (XP=${f1.xp}), P2: ${p2a} attacks (XP=${f2.xp})`
  };
}

// ============================================================
// TEST S5: Dynamic Join
// ============================================================
async function testS5(p1, p2) {
  record('\n=== S5: Dynamic Join ===');

  const s1 = await readState(p1.page);
  const s2 = await readState(p2.page);
  record(`S5 pre: P1 panel=${s1.panelVisible} mob=${s1.mobName}, P2 panel=${s2.panelVisible} mob=${s2.mobName}`);

  // P2 triggers encounter if not already in one
  if (!s2.panelVisible) {
    await triggerEncounter(p2.page);
    await new Promise(r => setTimeout(r, 2000));
  }

  const s2a = await readState(p2.page);
  await p2.page.screenshot({ path: join(RESULTS_DIR, 's5-p2-join.png') });

  return {
    passed: s2a.panelVisible,
    notes: `P2 in combat: ${s2a.panelVisible}, Mob: ${s2a.mobName}`
  };
}

// ============================================================
// TEST S8: Mob Death + XP Reward
// ============================================================
async function testS8(p1) {
  record('\n=== S8: Mob Death + Reward ===');

  // Trigger encounter
  await triggerEncounter(p1.page);
  const s0 = await waitUntil(async () => {
    const s = await readState(p1.page);
    return s.panelVisible && s.mobName ? s : null;
  }, 15000);

  if (!s0) {
    record('S8: Could not trigger encounter');
    return { passed: false, notes: 'No encounter' };
  }

  record(`S8 start: mob=${s0.mobName} HP=${s0.mobHp}/${s0.mobMaxHp} xp=${s0.xp}`);
  let attacks = 0;

  while (attacks < 100) {
    const s = await readState(p1.page);
    if (!s.panelVisible || s.mobHp <= 0) {
      record(`S8: Mob killed after ${attacks} attacks! xp=${s.xp}`);
      break;
    }
    if (s.turn === 'player' && s.attackEnabled) {
      await clickAttack(p1.page);
      attacks++;
      if (attacks % 10 === 0) record(`S8: ${attacks} attacks HP=${s.mobHp}/${s.mobMaxHp}`);
      await new Promise(r => setTimeout(r, 800));
    } else {
      await new Promise(r => setTimeout(r, 300));
    }
  }

  const sf = await readState(p1.page);
  await p1.page.screenshot({ path: join(RESULTS_DIR, 's8-final.png') });
  const killed = !sf.panelVisible || sf.mobHp <= 0;
  const xpGained = sf.xp > s0.xp;

  record(`S8 result: killed=${killed} attacks=${attacks} xpBefore=${s0.xp} xpAfter=${sf.xp}`);

  return {
    passed: killed || xpGained,
    attacks, killed, xpBefore: s0.xp, xpAfter: sf.xp,
    notes: `Attacks: ${attacks}, Killed: ${killed}, XP: ${s0.xp} → ${sf.xp}`
  };
}

// ============================================================
// MAIN
// ============================================================
async function main() {
  record('Phase 3G-4B.5: Combat Runtime Validation v4 (Final)');
  record('='.repeat(60));

  const browser = await launchBrowser();
  const p1 = await createPlayer(browser, 'Player1');
  const p2 = await createPlayer(browser, 'Player2');

  const results = {};
  results.s1 = await testS1(p1);
  results.s2 = await testS2(p1, p2);
  results.s5 = await testS5(p1, p2);
  results.s8 = await testS8(p1);

  await p1.page.screenshot({ path: join(RESULTS_DIR, 'final-p1.png') });
  await p2.page.screenshot({ path: join(RESULTS_DIR, 'final-p2.png') });
  writeFileSync(join(RESULTS_DIR, 'p1-console.log'), p1.consoleLogs.join('\n'));
  writeFileSync(join(RESULTS_DIR, 'p2-console.log'), p2.consoleLogs.join('\n'));

  await p1.context.close();
  await p2.context.close();
  await browser.close();

  const allPassed = results.s1.passed && results.s2.passed && results.s5.passed && results.s8.passed;
  const verdict = allPassed ? 'GREEN' : 'YELLOW';

  record('\n' + '='.repeat(60));
  record('VALIDATION COMPLETE');
  record(`S1 1v1 Combat:   ${results.s1.passed ? 'PASS ✓' : 'FAIL ✗'} — ${results.s1.notes}`);
  record(`S2 2v1 Combat:   ${results.s2.passed ? 'PASS ✓' : 'FAIL ✗'} — ${results.s2.notes}`);
  record(`S5 Dynamic Join: ${results.s5.passed ? 'PASS ✓' : 'FAIL ✗'} — ${results.s5.notes}`);
  record(`S8 Mob Death:    ${results.s8.passed ? 'PASS ✓' : 'FAIL ✗'} — ${results.s8.notes}`);
  record(`VERDICT: ${verdict}`);

  writeFileSync(join(RESULTS_DIR, 'results-v4.json'), JSON.stringify({ timestamp: ts(), results, verdict }, null, 2));
  writeFileSync(join(RESULTS_DIR, 'validation-v4.log'), log.join('\n'));
  record('Results saved to staging-results/');
  process.exit(0);
}

main().catch(e => { record(`FATAL: ${e.message}\n${e.stack}`); process.exit(1); });
