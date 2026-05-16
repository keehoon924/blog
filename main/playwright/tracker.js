const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const SESSION_FILE = path.join(process.cwd(), 'naver-session.json');

async function checkPostPerformance(naverUrl, config) {
  const naverID = config.naverID || process.env.NAVER_ID;
  if (!naverID || !naverUrl) return { views: 0, likes: 0 };

  const browser = await chromium.launch({ headless: true });
  const contextOptions = {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  };

  if (fs.existsSync(SESSION_FILE)) {
    contextOptions.storageState = SESSION_FILE;
  }

  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();

  let views = 0;
  let likes = 0;

  try {
    await page.goto(naverUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(2000);

    // Try to get view count (blog owner view — shown in post footer)
    const viewSelectors = [
      '.blog_view_count', '.se_viewThumbnailInfo', '.view_count',
      '[data-clk="cnt.view"]', '.cnt_view',
    ];
    for (const sel of viewSelectors) {
      const el = await page.$(sel);
      if (el) {
        const text = await el.textContent();
        const num = parseInt(text.replace(/[^0-9]/g, ''), 10);
        if (!isNaN(num)) { views = num; break; }
      }
    }

    // Try to get likes count (공감수)
    const likeSelectors = [
      '.u_likeit_text', '.sympathy_count', '.u_cnt_like',
      '[data-clk="cnt.like"]', '.cnt_like',
    ];
    for (const sel of likeSelectors) {
      const el = await page.$(sel);
      if (el) {
        const text = await el.textContent();
        const num = parseInt(text.replace(/[^0-9]/g, ''), 10);
        if (!isNaN(num)) { likes = num; break; }
      }
    }
  } catch {
    // Silently fail — return 0s
  } finally {
    await browser.close();
  }

  return { views, likes };
}

module.exports = { checkPostPerformance };
