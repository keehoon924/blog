const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const SESSION_FILE = path.join(process.cwd(), 'naver-session.json');

// Parse content into segments: [{text, bold}]
function parseSegments(content) {
  const segments = [];
  const regex = /\*\*([^*\n]+)\*\*/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ text: content.slice(lastIndex, match.index), bold: false });
    }
    segments.push({ text: match[1], bold: true });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < content.length) {
    segments.push({ text: content.slice(lastIndex), bold: false });
  }
  return segments;
}

// Remove image placeholders from typed content
function stripImagePlaceholders(content) {
  return content.replace(/\[이미지:[^\]]*\]/g, '\n').replace(/\n{3,}/g, '\n\n');
}

async function typeWithFormatting(page, content) {
  const cleaned = stripImagePlaceholders(content);
  const segments = parseSegments(cleaned);
  let isBold = false;

  for (const segment of segments) {
    if (segment.bold !== isBold) {
      await page.keyboard.press('Control+b');
      isBold = segment.bold;
      await page.waitForTimeout(80);
    }
    const chunks = segment.text.match(/[\s\S]{1,150}/g) || [segment.text];
    for (const chunk of chunks) {
      await page.keyboard.type(chunk, { delay: 20 });
      await page.waitForTimeout(100);
    }
  }

  if (isBold) {
    await page.keyboard.press('Control+b');
    await page.waitForTimeout(80);
  }
}

async function typeHashtags(page, hashtags) {
  if (!hashtags) return;
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type(hashtags, { delay: 15 });
}

async function typeRelatedPosts(page, relatedPosts) {
  if (!relatedPosts || relatedPosts.length === 0) return;

  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Control+b');
  await page.keyboard.type('▼ 함께 읽으면 좋은 글', { delay: 20 });
  await page.keyboard.press('Control+b');
  await page.keyboard.press('Enter');

  for (const post of relatedPosts) {
    await page.keyboard.type(`• ${post.title}`, { delay: 20 });
    await page.keyboard.press('Enter');
  }
}

async function doLogin(page, id, pw) {
  await page.goto('https://nid.naver.com/nidlogin.login', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#id', { timeout: 10000 });

  await page.click('#id');
  await page.waitForTimeout(300);
  for (const char of id) {
    await page.keyboard.type(char);
    await page.waitForTimeout(30 + Math.floor(Math.random() * 70));
  }

  await page.click('#pw');
  await page.waitForTimeout(300);
  for (const char of pw) {
    await page.keyboard.type(char);
    await page.waitForTimeout(30 + Math.floor(Math.random() * 70));
  }

  await page.waitForTimeout(500);
  await page.click('.btn_login');

  // Wait until fully out of nid.naver.com (handles 2FA — up to 120s)
  await page.waitForFunction(
    () => !window.location.hostname.includes('nid.naver.com'),
    { timeout: 120000 }
  );
}

async function publishToNaver({ title, content, hashtags, relatedPosts, config }) {
  const naverID = config.naverID || process.env.NAVER_ID;
  const naverPW = config.naverPW || process.env.NAVER_PW;

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

  if (fs.existsSync(SESSION_FILE)) {
    contextOptions.storageState = SESSION_FILE;
  }

  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  const writeUrl = `https://blog.naver.com/PostWriteForm.naver?blogId=${naverID}`;

  await page.goto(writeUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(1500);

  if (page.url().includes('nid.naver.com')) {
    await doLogin(page, naverID, naverPW);
    await context.storageState({ path: SESSION_FILE });
    await page.goto(writeUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  }

  await page.waitForTimeout(2000);

  // Type title
  const titleSelectors = ['.se-documentTitle-inputArea', '.se-title-text', '[placeholder*="제목"]'];
  for (const sel of titleSelectors) {
    const el = await page.$(sel);
    if (el) {
      await el.scrollIntoViewIfNeeded();
      await el.click();
      await page.waitForTimeout(500);
      for (const char of title) {
        await page.keyboard.type(char);
        await page.waitForTimeout(30 + Math.floor(Math.random() * 50));
      }
      break;
    }
  }

  await page.waitForTimeout(800);
  await page.keyboard.press('Tab');
  await page.waitForTimeout(800);

  // Verify focus moved to content area
  let typed = false;
  try {
    await page.keyboard.type('ㄱ', { delay: 50 });
    await page.waitForTimeout(150);
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(150);
    typed = true;
  } catch { /* continue */ }

  if (!typed) {
    const contentSelectors = [
      '.se-text-paragraph', '.se-content-area', '.se-main-container',
      '[contenteditable="true"]:not([class*="title"])',
    ];
    for (const sel of contentSelectors) {
      const el = await page.$(sel);
      if (el) {
        await el.scrollIntoViewIfNeeded();
        await page.waitForTimeout(400);
        await el.click({ force: true });
        await page.waitForTimeout(400);
        typed = true;
        break;
      }
    }
  }

  if (!typed) {
    for (const frame of page.frames()) {
      try {
        const body = await frame.$('body[contenteditable="true"]');
        if (body) { await body.click(); typed = true; break; }
      } catch { /* skip */ }
    }
  }

  // Type content with bold formatting
  await typeWithFormatting(page, content);

  // Add hashtags
  await typeHashtags(page, hashtags);

  // Add related posts section
  await typeRelatedPosts(page, relatedPosts);

  // Browser stays open — user adds images and clicks publish manually
}

module.exports = { publishToNaver };
