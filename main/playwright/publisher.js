const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const SESSION_FILE = path.join(process.cwd(), 'naver-session.json');

async function typeSlowly(page, text) {
  for (const char of text) {
    await page.keyboard.type(char);
    await page.waitForTimeout(30 + Math.floor(Math.random() * 70));
  }
}

async function isLoggedIn(page) {
  try {
    await page.goto('https://www.naver.com', { waitUntil: 'domcontentloaded', timeout: 10000 });
    const loginLink = await page.$('.link_login');
    return !loginLink;
  } catch {
    return false;
  }
}

async function doLogin(page, id, pw) {
  await page.goto('https://nid.naver.com/nidlogin.login', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#id', { timeout: 10000 });

  await page.click('#id');
  await page.waitForTimeout(300);
  await typeSlowly(page, id);

  await page.click('#pw');
  await page.waitForTimeout(300);
  await typeSlowly(page, pw);

  await page.waitForTimeout(500);
  await page.click('.btn_login');
  await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 15000 });
}

async function publishToNaver({ title, content, config }) {
  const { naverID, naverPW } = config;

  if (!naverID || !naverPW) {
    throw new Error('네이버 아이디/비밀번호가 설정되지 않았습니다.');
  }

  const browser = await chromium.launch({
    headless: false,
    slowMo: 30,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
  });

  const contextOptions = {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 900 },
    extraHTTPHeaders: { 'Accept-Language': 'ko-KR,ko;q=0.9' },
  };

  // Restore session if available
  if (fs.existsSync(SESSION_FILE)) {
    contextOptions.storageState = SESSION_FILE;
  }

  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();

  try {
    const loggedIn = await isLoggedIn(page);

    if (!loggedIn) {
      await doLogin(page, naverID, naverPW);
      await context.storageState({ path: SESSION_FILE });
    }

    // Navigate to blog write page
    const writeUrl = `https://blog.naver.com/PostWriteForm.naver?blogId=${naverID}`;
    await page.goto(writeUrl, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);

    // Type title
    const titleSelectors = [
      '.se-documentTitle-inputArea',
      '.se-title-text',
      '[placeholder*="제목"]',
    ];
    for (const sel of titleSelectors) {
      const el = await page.$(sel);
      if (el) {
        await el.click();
        await page.waitForTimeout(500);
        await typeSlowly(page, title);
        break;
      }
    }

    await page.waitForTimeout(1000);
    await page.keyboard.press('Tab');
    await page.waitForTimeout(500);

    // Type content — try direct contenteditable, then iframe
    let typed = false;

    const contentSelectors = [
      '.se-content-area',
      '.se-main-container .se-text',
      '[contenteditable="true"]:not([class*="title"])',
    ];
    for (const sel of contentSelectors) {
      const el = await page.$(sel);
      if (el) {
        await el.click();
        await page.waitForTimeout(500);
        // Type in chunks to prevent timeout
        const chunks = content.match(/[\s\S]{1,200}/g) || [content];
        for (const chunk of chunks) {
          await page.keyboard.type(chunk, { delay: 25 });
          await page.waitForTimeout(200);
        }
        typed = true;
        break;
      }
    }

    // Fallback: search iframe for contenteditable body
    if (!typed) {
      for (const frame of page.frames()) {
        try {
          const body = await frame.$('body[contenteditable="true"]');
          if (body) {
            await body.click();
            await page.waitForTimeout(500);
            const chunks = content.match(/[\s\S]{1,200}/g) || [content];
            for (const chunk of chunks) {
              await page.keyboard.type(chunk, { delay: 25 });
              await page.waitForTimeout(200);
            }
            break;
          }
        } catch {
          // skip frame
        }
      }
    }

    // Browser stays open — user adds images and clicks publish manually

  } catch (err) {
    await browser.close();
    throw err;
  }
}

module.exports = { publishToNaver };
