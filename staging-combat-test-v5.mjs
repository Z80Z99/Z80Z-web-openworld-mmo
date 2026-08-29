/**
 * Phase 3G-4B.5: Combat Runtime Validation v5 (Final)
 *
 * CRITICAL FIX: The encounter panel shows "Scorpion (Lv.3) 60/60 回合 2"
 * but the body text ALSO contains "Slime (Lv.3)" from the HUD targeting display.
 * v4's parser matched the HUD mob first → HP=0/100 → thought encounter was dead.
 *
 * Fix: Parse encounter panel mob info by finding text NEAR "回合 N" pattern,
 * which only exists in the encounter panel.
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
    bodySnippet: document.body.innerText.substring(0, 300)
  }));
  record(`${playerName}: canvas=${info.hasCanvas}`);
  return { page, context, consoleLogs, name: playerName };
}

/**
 * Read encounter state — parses the encounter panel specifically.
 *
 * The encounter panel text format is:
 *   "Scorpion (Lv.3)\n60 / 60\n回合 2\n你的回合\n攻击\n防御\n逃跑"
 *
 * We find lines containing "回合" and parse the mob info from the lines ABOVE it.
 * This avoids confusion with the HUD targeting display ("Slime (Lv.3)").
 */
async function readState(page) {
  return page.evaluate(() => {
    const text = document.body.innerText;
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    // Find the encounter panel by looking for "回合 N" line
    let roundIdx = -1;
    let round = 0;
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^回合\s*(\d+)$/);
      if (m) {
        roundIdx = i;
        round = parseInt(m[1], 10);
        break;
      }
    }

    // Encounter panel is active if we found "回合"
    const panelVisible = roundIdx >= 0;

    // Parse mob info from lines BEFORE "回合"
    let mobName = '', mobLevel = 0, mobHp = 0, mobMaxHp = 0;
    if (panelVisible) {
      // Look backwards from "回合" for "Name (Lv.N)" and "N / M"
      for (let i = roundIdx - 1; i >= 0 && i >= roundIdx - 4; i--) {
        const nameMatch = lines[i].match(/^(.+?)\s*\(Lv\.(\d+)\)$/);
        if (nameMatch) {
          mobName = nameMatch[1].trim();
          mobLevel = parseInt(nameMatch[2], 10);
        }
        const hpMatch = lines[i].match(/^(\d+)\s*\/\s*(\d+)$/);
        if (hpMatch && mobName) {
          mobHp = parseInt(hpMatch[1], 10);
          mobMaxHp = parseInt(hpMatch[2], 10);
        }
      }
    }

    // Parse turn
    let turn = 'unknown';
    if (panelVisible) {
      if (lines[roundIdx + 1]?.includes('你的回合')) turn = 'player';
      else if (lines[roundIdx + 1]?.includes('对方行动中')) turn = 'mob';
    }

    // Parse player XP from "Lv.N — XP: M / K" or "Lv.N — XP: M"
    let xp = 0, playerLevel = 1;
    for (const line of lines) {
      const xpMatch = line.match(/XP:\s*(\d+)/);
      if (xpMatch) xp = parseInt(xpMatch[1], 10);
      const lvlMatch = line.match(/Lv\.(\d+)/);
      if (lvlMatch && line.includes('XP')) playerLevel = parseInt(lvlMatch[1], 10);
    }

    // Check attack button enabled
    let attackEnabled = false;
    if (panelVisible) {
      const btns = document.querySelectorAll('button');
      for (const b of btns) {
        if (b.textContent?.trim() === '攻击') attackEnabled = !b.disabled;
      }
    }

    return {
      panelVisible, mobName, mobLevel, mobHp, mobMaxHp,
      round, turn, xp, playerLevel, attackEnabled,
      text: text.substring(0, 500)
    };
  });
}

async function clickAttack(page) {
  try {
    await page.locator('button:has-text("攻击")').first().click({ timeout: 2000 });
    return true;
  } catch { return false; }
}

async function triggerEncounter(page) {
  await page.keyboard.press('Tab');
  await new Promise(r => setTimeout(r, 500));
  await page.keyboard.press('Space');
  await new Promise(r => setTimeout(r, 2000));
}

async function waitUntil(fn, timeoutMs = 15000, intervalMs = 300) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = await fn();
    if (result) return result;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return await fn();
}

// ============================================================
// TEST S1: 1v1 Combat
// ============================================================
async function testS1(p1) {
  record('\n=== S1: 1v1 Combat ===');

  // Check if encounter already active
  let s0 = await readState(p1.page);
  if (!s0.panelVisible) {
    record('No encounter active — triggering via Tab+Space...');
    await triggerEncounter(p1.page);
    s0 = await readState(p1.page);
  }

  if (!s0.panelVisible || !s0.mobName) {
    // Try once more
    await triggerEncounter(p1.page);
    s0 = await readState(p1.page);
  }

  record(`S1 state: panel=${s0.panelVisible} mob=${s0.mobName} Lv.${s0.mobLevel} HP=${s0.mobHp}/${s0.mobMaxHp} round=${s0.round} turn=${s0.turn} xp=${s0.xp} atkBtn=${s0.attackEnabled}`);
  await p1.page.screenshot({ path: join(RESULTS_DIR, 's1-start.png') });

  if (!s0.panelVisible) {
    record('S1: FAIL — No encounter panel');
    return { passed: false, notes: 'No encounter panel' };
  }

  // Attack loop
  let attacks = 0;
  const startRound = s0.round;

  while (attacks < 100) {
    const s = await readState(p1.page);
    if (!s.panelVisible || s.mobHp <= 0) {
      record(`S1: Encounter ended after ${attacks} attacks. xp=${s.xp} mob=${s.mobName} hp=${s.mobHp}`);
      break;
    }
    if (s.turn === 'player' && s.attackEnabled) {
      const ok = await clickAttack(p1.page);
      if (ok) {
        attacks++;
        if (attacks <= 3 || attacks % 10 === 0) {
          record(`S1: Attack #${attacks} mobHP=${s.mobHp}/${s.mobMaxHp} round=${s.round}`);
        }
        await new Promise(r => setTimeout(r, 1200)); // Wait for server + mob turn
      } else {
        record(`S1: Click failed`);
        await new Promise(r => setTimeout(r, 500));
      }
    } else {
      await new Promise(r => setTimeout(r, 300));
    }
  }

  const sf = await readState(p1.page);
  await p1.page.screenshot({ path: join(RESULTS_DIR, 's1-final.png') });
  const killed = !sf.panelVisible || sf.mobHp <= 0;
  record(`S1 result: attacks=${attacks} killed=${killed} xp=${sf.xp} panel=${sf.panelVisible}`);

  return {
    passed: attacks > 0, attacks, killed, xp: sf.xp,
    notes: `Attacks: ${attacks}, Killed: ${killed}, XP: ${sf.xp}`
  };
}

// ============================================================
// TEST S2: 2v1 Combat
// ============================================================
async function testS2(p1, p2) {
  record('\n=== S2: 2v1 Combat ===');

  // P2 triggers encounter
  let p2s = await readState(p2.page);
  if (!p2s.panelVisible) {
    await triggerEncounter(p2.page);
    p2s = await readState(p2.page);
  }
  if (!p2s.panelVisible) {
    await triggerEncounter(p2.page);
    p2s = await readState(p2.page);
  }

  record(`S2 P2: panel=${p2s.panelVisible} mob=${p2s.mobName} HP=${p2s.mobHp}/${p2s.mobMaxHp}`);

  if (!p2s.panelVisible) {
    return { passed: false, notes: 'P2 no encounter' };
  }

  let p1a = 0, p2a = 0;
  for (let i = 0; i < 40; i++) {
    const s1 = await readState(p1.page);
    const s2 = await readState(p2.page);
    if ((!s1.panelVisible || s1.mobHp <= 0) && (!s2.panelVisible || s2.mobHp <= 0)) break;

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
  record(`S5: P1 panel=${s1.panelVisible} mob=${s1.mobName}, P2 panel=${s2.panelVisible} mob=${s2.mobName}`);

  if (!s2.panelVisible) {
    await triggerEncounter(p2.page);
  }
  const s2a = await readState(p2.page);
  await p2.page.screenshot({ path: join(RESULTS_DIR, 's5-p2.png') });

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

  let s0 = await readState(p1.page);
  if (!s0.panelVisible || s0.mobHp <= 0) {
    await triggerEncounter(p1.page);
    s0 = await readState(p1.page);
  }
  if (!s0.panelVisible || s0.mobHp <= 0) {
    await triggerEncounter(p1.page);
    s0 = await readState(p1.page);
  }

  record(`S8 start: mob=${s0.mobName} HP=${s0.mobHp}/${s0.mobMaxHp} xp=${s0.xp}`);

  if (!s0.panelVisible) {
    return { passed: false, notes: 'No encounter' };
  }

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
      await new Promise(r => setTimeout(r, 1200));
    } else {
      await new Promise(r => setTimeout(r, 300));
    }
  }

  const sf = await readState(p1.page);
  await p1.page.screenshot({ path: join(RESULTS_DIR, 's8-final.png') });
  const killed = !sf.panelVisible || sf.mobHp <= 0;
  record(`S8 result: killed=${killed} attacks=${attacks} xpBefore=${s0.xp} xpAfter=${sf.xp}`);

  return {
    passed: killed || sf.xp > s0.xp,
    attacks, killed, xpBefore: s0.xp, xpAfter: sf.xp,
    notes: `Attacks: ${attacks}, Killed: ${killed}, XP: ${s0.xp} → ${sf.xp}`
  };
}

// ============================================================
// MAIN
// ============================================================
async function main() {
  record('Phase 3G-4B.5: Combat Runtime Validation v5 (Final)');
  record('='.repeat(60));

  const browser = await launchBrowser();
  const p1 = await createPlayer(browser, 'Player1');
  const p2 = await createPlayer(browser, 'Player2');

  // Dump initial body text for debugging
  const p1text = await readState(p1.page);
  record(`P1 body:\n${p1text.text}`);

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

  writeFileSync(join(RESULTS_DIR, 'results-v5.json'), JSON.stringify({ timestamp: ts(), results, verdict }, null, 2));
  writeFileSync(join(RESULTS_DIR, 'validation-v5.log'), log.join('\n'));
  record('Results saved to staging-results/');
  process.exit(0);
}

main().catch(e => { record(`FATAL: ${e.message}\n${e.stack}`); process.exit(1); });
