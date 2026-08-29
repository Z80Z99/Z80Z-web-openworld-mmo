/**
 * Diagnostic: Dump full page state to understand the DOM structure
 * and how the encounter panel differs from the default UI.
 */
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const CLIENT_URL = 'http://localhost:3000';
const RESULTS_DIR = join(process.cwd(), 'staging-results');
if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true });

const log = [];
function record(msg) { const line = `[${new Date().toISOString()}] ${msg}`; log.push(line); console.log(line); }

async function main() {
  const chromiumPath = 'C:\\Users\\Administrator\\AppData\\Local\\ms-playwright\\chromium-1234\\chrome-win64\\chrome.exe';
  const browser = await chromium.launch({ executablePath: chromiumPath, headless: true, args: ['--no-sandbox', '--disable-gpu'] });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  const consoleLogs = [];
  page.on('console', msg => consoleLogs.push(`[${msg.type()}] ${msg.text()}`));
  
  record('Navigating...');
  await page.goto(CLIENT_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await new Promise(r => setTimeout(r, 5000));
  
  // Dump full body text
  const bodyText = await page.evaluate(() => document.body.innerText);
  record('=== BODY TEXT ===');
  record(bodyText);
  
  // Dump ALL divs with their style.display and innerText
  const divState = await page.evaluate(() => {
    const results = [];
    const allDivs = document.querySelectorAll('div');
    for (const d of allDivs) {
      const display = d.style.display;
      const text = d.innerText?.substring(0, 100) || '';
      const id = d.id || '';
      const classes = d.className || '';
      if (display && display !== 'none' && display !== '' && text.length > 0) {
        results.push({ id, classes: classes.substring(0, 50), display, text });
      }
    }
    return results;
  });
  record('=== DIVS WITH INLINE DISPLAY ===');
  for (const d of divState) {
    record(`  [${d.display}] id="${d.id}" class="${d.classes}" text="${d.text}"`);
  }
  
  // Dump ALL buttons
  const buttons = await page.evaluate(() => {
    const results = [];
    const allBtns = document.querySelectorAll('button');
    for (const btn of allBtns) {
      results.push({
        text: btn.textContent?.trim(),
        disabled: btn.disabled,
        opacity: btn.style.opacity,
        cursor: btn.style.cursor,
        visible: btn.offsetParent !== null
      });
    }
    return results;
  });
  record('=== ALL BUTTONS ===');
  for (const b of buttons) {
    record(`  text="${b.text}" disabled=${b.disabled} opacity=${b.opacity} visible=${b.visible}`);
  }
  
  // Dump canvas dimensions
  const canvasInfo = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    if (!c) return null;
    return { width: c.width, height: c.height, clientWidth: c.clientWidth, clientHeight: c.clientHeight };
  });
  record(`=== CANVAS === ${JSON.stringify(canvasInfo)}`);
  
  // Save console logs
  writeFileSync(join(RESULTS_DIR, 'diagnostic-console.log'), consoleLogs.join('\n'));
  
  // Now try to trigger a mob encounter by Tab
  record('\n=== PRESSING TAB ===');
  await page.keyboard.press('Tab');
  await new Promise(r => setTimeout(r, 2000));
  
  const bodyTextAfterTab = await page.evaluate(() => document.body.innerText);
  record('=== BODY TEXT AFTER TAB ===');
  record(bodyTextAfterTab);
  
  // Check buttons again after Tab
  const buttonsAfterTab = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('button')).map(b => ({
      text: b.textContent?.trim(),
      disabled: b.disabled,
      visible: b.offsetParent !== null
    }));
  });
  record('=== BUTTONS AFTER TAB ===');
  for (const b of buttonsAfterTab) {
    record(`  text="${b.text}" disabled=${b.disabled} visible=${b.visible}`);
  }
  
  await page.screenshot({ path: join(RESULTS_DIR, 'diagnostic-after-tab.png') });
  
  // Try pressing Space (attack)
  record('\n=== PRESSING SPACE ===');
  await page.keyboard.press('Space');
  await new Promise(r => setTimeout(r, 2000));
  
  const bodyTextAfterSpace = await page.evaluate(() => document.body.innerText);
  record('=== BODY TEXT AFTER SPACE ===');
  record(bodyTextAfterSpace);
  
  await page.screenshot({ path: join(RESULTS_DIR, 'diagnostic-after-space.png') });
  
  // Dump all console logs
  writeFileSync(join(RESULTS_DIR, 'diagnostic-console-full.log'), consoleLogs.join('\n'));
  
  await browser.close();
  
  writeFileSync(join(RESULTS_DIR, 'diagnostic.log'), log.join('\n'));
  record('Diagnostic complete.');
  process.exit(0);
}

main().catch(e => { record(`FATAL: ${e.message}`); process.exit(1); });
