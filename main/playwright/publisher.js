const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const SESSION_FILE = path.join(process.cwd(), 'naver-session.json');

// Parse bold segments: [{text, bold}]
function parseSegments(text) {
  const segments = [];
  const regex = /\*\*([^*\n]+)\*\*/g;
  let lastIndex = 0;
  let match;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) segments.push({ text: text.slice(lastIndex, match.index), bold: false });
    segments.push({ text: match[1], bold: true });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) segments.push({ text: text.slice(lastIndex), bold: false });
  return segments;
}

// Remove image placeholders
function stripImagePlaceholders(content) {
  return content.replace(/\[이미지:[^\]]*\]/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

async function slowType(page, text) {
  const chunks = text.match(/[\s\S]{1,100}/g) || [text];
  for (const chunk of chunks) {
    await page.keyboard.type(chunk, { delay: 18 });
    await page.waitForTimeout(80);
  }
}

async function typeWithFormatting(page, text) {
  const segments = parseSegments(text);
  let isBold = false;
  for (const seg of segments) {
    if (seg.bold !== isBold) {
      await page.keyboard.press('Control+b');
      isBold = seg.bold;
      await page.waitForTimeout(80);
    }
    await slowType(page, seg.text);
  }
  if (isBold) {
    await page.keyboard.press('Control+b');
    await page.waitForTimeout(80);
  }
}

// Click toolbar button by label text
async function clickToolbarButton(page, label) {
  const selectors = [
    `[title="${label}"]`,
    `[aria-label="${label}"]`,
    `.se-toolbar button:has-text("${label}")`,
    `button[data-type="${label}"]`,
  ];
  for (const sel of selectors) {
    try {
      const el = await page.$(sel);
      if (el) {
        await el.click();
        await page.waitForTimeout(400);
        return true;
      }
    } catch { /* try next */ }
  }
  return false;
}

// Insert 인용구 (blockquote) via toolbar
// quoteRaw 형식: "인용문 | – 출처명" 또는 "인용문" (출처 없는 경우)
async function insertQuote(page, quoteRaw) {
  const pipeIdx = quoteRaw.indexOf(' | ');
  const quoteText = pipeIdx !== -1 ? quoteRaw.slice(0, pipeIdx).trim() : quoteRaw.trim();
  const attribution = pipeIdx !== -1 ? quoteRaw.slice(pipeIdx + 3).trim() : '';

  const clicked = await clickToolbarButton(page, '인용구');
  if (clicked) {
    await page.waitForTimeout(300);
    await slowType(page, quoteText);
    if (attribution) {
      // SE5 인용구 블록의 출처 필드로 이동 (Tab)
      await page.keyboard.press('Tab');
      await page.waitForTimeout(200);
      await slowType(page, attribution);
    }
    // 인용구 블록 탈출: Escape → ArrowDown → Enter
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(200);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
  } else {
    // Fallback: 텍스트 형태
    const full = attribution ? `${quoteText}\n${attribution}` : quoteText;
    await page.keyboard.type(`❝ ${full} ❞`);
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
  }
}

// Insert 구분선 (divider) via toolbar — 항상 긴 구분선
async function insertDivider(page) {
  const clicked = await clickToolbarButton(page, '구분선');
  if (!clicked) {
    await page.keyboard.type('─────────────────────────');
    await page.keyboard.press('Enter');
  }
  await page.waitForTimeout(200);
}

// Parse and type content with [구분선] and [인용구: text | 출처] markers
async function typeContentWithMarkers(page, content) {
  const cleaned = stripImagePlaceholders(content);
  const markerRegex = /\[구분선\]|\[짧은구분선\]|\[인용구:([^\]]+)\]/g;
  let lastIndex = 0;
  let match;

  while ((match = markerRegex.exec(cleaned)) !== null) {
    if (match.index > lastIndex) {
      await typeWithFormatting(page, cleaned.slice(lastIndex, match.index));
    }
    if (match[0] === '[구분선]' || match[0] === '[짧은구분선]') {
      await insertDivider(page);
    } else {
      await insertQuote(page, match[1].trim());
    }
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < cleaned.length) {
    await typeWithFormatting(page, cleaned.slice(lastIndex));
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
  await insertDivider(page);
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

  // Wait for 2FA / full login (up to 120s)
  await page.waitForFunction(
    () => !window.location.hostname.includes('nid.naver.com'),
    { timeout: 120000 }
  );
}

async function focusContentArea(page) {
  // Strategy 1: Enter from title naturally moves SE5 focus to first body paragraph
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);

  const leftTitle = await page.evaluate(() => {
    const el = document.activeElement;
    if (!el) return false;
    const titleEl = document.querySelector('.se-documentTitle');
    return !(titleEl && titleEl.contains(el));
  });
  if (leftTitle) return;

  // Strategy 2: click known content-area selectors
  const contentSelectors = [
    '.se-section-text [contenteditable]',
    '.se-text-paragraph [contenteditable]',
    '.se-text-paragraph',
    '.se-main-section [contenteditable]',
  ];
  for (const sel of contentSelectors) {
    const el = await page.$(sel);
    if (el) {
      await el.scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      await el.click({ force: true });
      await page.waitForTimeout(200);
      return;
    }
  }

  // Strategy 3: first contenteditable NOT inside title container
  await page.evaluate(() => {
    const titleEl = document.querySelector('.se-documentTitle');
    const editables = Array.from(document.querySelectorAll('[contenteditable="true"]'));
    for (const el of editables) {
      if (titleEl && titleEl.contains(el)) continue;
      el.click();
      el.focus();
      return;
    }
  });
  await page.waitForTimeout(200);
}

async function publishToNaver({ title, content, hashtags, relatedPosts, config }) {
  const naverID = config.naverID || process.env.NAVER_ID;
  const naverPW = config.naverPW || process.env.NAVER_PW;

  if (!naverID || !naverPW) throw new Error('네이버 아이디/비밀번호가 설정되지 않았습니다.');

  const browser = await chromium.launch({
    headless: false,
    slowMo: 20,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
  });

  const contextOptions = {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 900 },
    extraHTTPHeaders: { 'Accept-Language': 'ko-KR,ko;q=0.9' },
  };
  if (fs.existsSync(SESSION_FILE)) contextOptions.storageState = SESSION_FILE;

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

  await page.waitForTimeout(2500);

  // ── Step 1: Type title ──────────────────────────────────────────
  const titleSelectors = ['.se-documentTitle-inputArea', '.se-title-text', '[placeholder*="제목"]'];
  for (const sel of titleSelectors) {
    const el = await page.$(sel);
    if (el) {
      await el.scrollIntoViewIfNeeded();
      await page.waitForTimeout(400);
      await el.click();
      await page.waitForTimeout(500);
      // Clear existing
      await page.keyboard.press('Control+a');
      await page.keyboard.press('Backspace');
      await page.waitForTimeout(200);
      for (const char of title) {
        await page.keyboard.type(char);
        await page.waitForTimeout(20 + Math.floor(Math.random() * 30));
      }
      break;
    }
  }

  await page.waitForTimeout(800);

  // ── Step 2: Move to content area (Enter from title → SE5 body) ──
  await focusContentArea(page);
  await page.waitForTimeout(400);

  // ── Step 2-1: 가운데 맞춤 설정 ────────────────────────────────
  await page.keyboard.press('Control+e');
  await page.waitForTimeout(200);

  // ── Step 3: Type content with markers ──────────────────────────
  await typeContentWithMarkers(page, content);

  // ── Step 4: Hashtags ───────────────────────────────────────────
  await typeHashtags(page, hashtags);

  // ── Step 5: Related posts ──────────────────────────────────────
  await typeRelatedPosts(page, relatedPosts);

  // Browser stays open — user adds images and clicks publish
}

module.exports = { publishToNaver };
