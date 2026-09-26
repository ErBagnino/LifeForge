/**
 * Mobile QA audit: onboards a fresh player, then visits every route and reports
 * horizontal overflow, controls clipped by their container, touch targets under
 * 44×44 px and console errors. Simulates iPhone safe areas (59/34 px).
 *
 *   npm run build && npm run preview      # in one terminal
 *   npm run qa                            # 393×852 (iPhone 15 Pro)
 *   W=375 H=812 npm run qa                # any other viewport
 *
 * Needs Playwright with Chromium (npx playwright install chromium).
 */
const { chromium, devices } = require('playwright');
const fs = require('fs');
const W = Number(process.env.W || 393), H = Number(process.env.H || 852);
const ROUTES = (process.env.ROUTES || '/,/quests,/quests/routines,/train,/train/exercises,/train/exercise/chest_press,/train/plan,/train/cardio,/world,/world/shop,/world/avatar,/stats,/stats/calendar,/stats/advanced,/stats/records,/review/day,/review/week,/profile,/achievements,/play,/search,/coach,/nutrition,/nutrition/scan,/settings,/settings/profile,/settings/appearance,/settings/game,/settings/schedule,/settings/targets,/settings/safety,/settings/notifications,/settings/data,/settings/ai,/admin,/admin/activities,/admin/activities/drink_water,/admin/rules,/admin/economy,/admin/ai,/admin/routines,/train/workout').split(',');
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: W, height: H }, colorScheme: process.env.DARK ? 'dark' : 'light' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('[console] ' + m.text()); });
  await page.addInitScript(() => { document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = ':root{--safe-top:59px!important;--safe-bottom:34px!important}'; document.head.appendChild(s); }); });
  await require('./onboard.cjs')(page, {});
  const report = {};
  for (const r of ROUTES) {
    await page.evaluate((path) => { window.history.pushState({}, '', path); window.dispatchEvent(new PopStateEvent('popstate')); }, r);
    await page.waitForTimeout(700);
    const res = await page.evaluate(() => {
      const overflow = document.documentElement.scrollWidth - window.innerWidth;
      const small = [];
      const els = document.querySelectorAll('button, a[href], [role=button], [role=tab], [role=switch], input:not([type=hidden]), select, textarea, summary');
      for (const el of els) {
        const b = el.getBoundingClientRect();
        if (b.width === 0 || b.height === 0) continue;
        const st = getComputedStyle(el);
        if (st.visibility === 'hidden' || st.display === 'none' || el.closest('[aria-hidden=true]')) continue;
        if (el.closest('.hit-44') || el.classList.contains('hit-44')) continue;
        if (b.width < 44 - 0.5 || b.height < 44 - 0.5) {
          const label = (el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || el.tagName).trim().replace(/\s+/g, ' ').slice(0, 28);
          small.push(`${Math.round(b.width)}x${Math.round(b.height)} ${el.tagName.toLowerCase()} "${label}"`);
        }
      }
      // elements escaping the viewport horizontally
      const escaping = [];
      for (const el of document.querySelectorAll('body *')) {
        const b = el.getBoundingClientRect();
        if (b.width && (b.right > window.innerWidth + 1 || b.left < -1)) {
          let p = el.parentElement, clipped = false;
          while (p) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden') { clipped = true; break; } p = p.parentElement; }
          if (!clipped) escaping.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)}`);
        }
      }
      // interactive elements cut off by an overflow-hidden ancestor
      const clipped = [];
      for (const el of els) {
        const b = el.getBoundingClientRect();
        if (!b.width || !b.height) continue;
        let p = el.parentElement;
        while (p && p !== document.body) {
          const st = getComputedStyle(p);
          if (st.overflowX === 'auto' || st.overflowX === 'scroll') break;
          if (st.overflowX === 'hidden' || st.overflowX === 'clip') {
            const pb = p.getBoundingClientRect();
            if (b.right > pb.right + 1 || b.left < pb.left - 1) clipped.push(`${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 24)}"`);
            break;
          }
          p = p.parentElement;
        }
      }
      return { overflow, small: [...new Set(small)], escaping: [...new Set(escaping)].slice(0, 5), clipped: [...new Set(clipped)].slice(0, 6) };
    });
    report[r] = res;
  }
  fs.mkdirSync('qa-report', { recursive: true });
  fs.writeFileSync(`qa-report/audit-${W}x${H}.json`, JSON.stringify({ errors, report }, null, 1));
  const summary = Object.entries(report).filter(([, x]) => x.overflow > 1 || x.small.length || x.escaping.length || x.clipped.length).map(([r, x]) => `${r}: overflow=${x.overflow} small=${x.small.length} escaping=${x.escaping.length} clipped=${JSON.stringify(x.clipped)}`).join('\n') || 'ALL CLEAN';
  console.log(summary + '\nERRORS: ' + errors.join(' | '));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });

