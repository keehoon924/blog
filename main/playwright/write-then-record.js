/**
 * write-then-record.js — 글 자동 작성 후 발행 클릭 기록기
 * 실행: node main/playwright/write-then-record.js
 *
 * 1. 로그인 → 글쓰기 페이지 열기
 * 2. 도움말 닫기 → 폰트 19 → 가운데 정렬 → 제목 입력 → 본문 입력
 * 3. "이제 발행버튼을 클릭 해주세요." 출력 후 클릭 기록 시작
 * 4. 브라우저 닫을 때까지 모든 클릭 기록 → click-record.json 저장
 */

require('dotenv').config();
const { chromium } = require('playwright');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

const SESSION_FILE = path.join(process.cwd(), 'naver-session.json');
const CONFIG_FILE  = path.join(os.homedir(), 'AppData', 'Roaming', 'naver-blog-auto', 'config.json');

function log(msg) { console.log(msg); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function slowType(page, text) {
  const parts = text.split('\n');
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part.length > 0) {
      const chunks = part.match(/[\s\S]{1,80}/g) || [part];
      for (const chunk of chunks) {
        await page.keyboard.type(chunk, { delay: 18 });
        await sleep(60);
      }
    }
    if (i < parts.length - 1) {
      await page.keyboard.press('Enter');
      await sleep(90);
    }
  }
}

// 모든 frame 탐색하며 evaluate
async function evalInFrames(page, fn) {
  for (const frame of page.frames()) {
    try {
      const result = await frame.evaluate(fn);
      if (result && result !== false) return result;
    } catch (_) {}
  }
  return null;
}

// 모든 frame 탐색하며 selector 대기
async function waitInFrames(page, selector, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      try {
        const el = await frame.$(selector);
        if (el) return { el, frame };
      } catch (_) {}
    }
    await sleep(300);
  }
  throw new Error(`Timeout: "${selector}" not found`);
}

(async () => {
  // config.json 우선, 없으면 .env 폴백
  let naverID = process.env.NAVER_ID;
  let naverPW = process.env.NAVER_PW;
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      if (cfg.naverID) naverID = cfg.naverID;
      if (cfg.naverPW) naverPW = cfg.naverPW;
    } catch (e) { log('config.json 읽기 오류: ' + e.message); }
  }
  if (!naverID || !naverPW) { log('❌ NAVER_ID / NAVER_PW 없음'); process.exit(1); }
  log(`[계정] ${naverID}`);

  const browser = await chromium.launch({
    headless: false,
    slowMo: 0,
    channel: 'chrome',
    args: [
      '--disable-blink-features=AutomationControlled',
      '--start-maximized',
    ],
  });

  const ctxOpts = {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: null,
    extraHTTPHeaders: { 'Accept-Language': 'ko-KR,ko;q=0.9' },
  };
  if (fs.existsSync(SESSION_FILE)) ctxOpts.storageState = SESSION_FILE;

  const context = await browser.newContext(ctxOpts);
  const page    = await context.newPage();

  // ── 로그인 ──
  log('[1] 로그인 시도...');
  await page.goto('https://nid.naver.com/nidlogin.login', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(1500);

  if (page.url().includes('nid.naver.com')) {
    await page.waitForSelector('#id', { timeout: 15000 });
    await page.click('#id');
    for (const c of naverID) { await page.keyboard.type(c); await sleep(40 + Math.random() * 60); }
    await page.click('#pw');
    for (const c of naverPW) { await page.keyboard.type(c); await sleep(40 + Math.random() * 60); }
    await page.click('.btn_login');
    await page.waitForFunction(() => !window.location.hostname.includes('nid.naver.com'), { timeout: 60000 });
    await context.storageState({ path: SESSION_FILE });
    log('  로그인 완료!');
  }

  // ── 글쓰기 페이지 이동 ──
  log('[2] 글쓰기 페이지 이동...');
  const writeUrl = `https://blog.naver.com/${naverID}/postwrite`;
  await page.goto(writeUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(3000);

  // ── 작성 중인 글 팝업 닫기 ──
  log('[3] 작성 중인 글 팝업 확인...');
  await evalInFrames(page, () => {
    const btns = Array.from(document.querySelectorAll('button'));
    const cancel = btns.find(b => b.textContent.trim() === '취소');
    if (cancel) { cancel.click(); return true; }
    return false;
  });
  await sleep(800);

  // ── 도움말 닫기 ──
  log('[4] 도움말 닫기...');
  for (let attempt = 0; attempt < 5; attempt++) {
    const closed = await evalInFrames(page, () => {
      const btn = document.querySelector('button.se-help-panel-close-button');
      if (btn) { btn.click(); return true; }
      return false;
    });
    if (closed) {
      log('  도움말 닫기 완료');
      await sleep(600);
      break;
    }
    await sleep(400);
  }

  // ── 폰트 사이즈 19 ──
  log('[5] 폰트 사이즈 19 설정...');
  await evalInFrames(page, () => {
    // 드롭다운 버튼 클릭
    const dropBtn = document.querySelector('button.se-fontSize-toolbar-button') ||
                    document.querySelector('button[data-name="font-size"]');
    if (dropBtn) dropBtn.click();
    return !!dropBtn;
  });
  await sleep(400);
  await evalInFrames(page, () => {
    // 19 옵션 찾기
    const items = Array.from(document.querySelectorAll('li[data-value="19"], button[data-value="19"]'));
    if (items.length) { items[0].click(); return true; }
    // 텍스트로 찾기
    const allItems = Array.from(document.querySelectorAll('.se-toolbar-list-item, .se-list-item'));
    const item19 = allItems.find(el => el.textContent.trim() === '19');
    if (item19) { item19.click(); return true; }
    return false;
  });
  await sleep(400);

  // ── 가운데 정렬 ──
  log('[6] 가운데 정렬 적용...');
  await evalInFrames(page, () => {
    const dropBtn = document.querySelector('button.se-align-center-toolbar-button') ||
                    document.querySelector('button[data-name="align-drop-down-with-justify"]');
    if (dropBtn) dropBtn.click();
    return !!dropBtn;
  });
  await sleep(300);
  await evalInFrames(page, () => {
    const btn = document.querySelector('button.se-toolbar-option-align-center-button') ||
                document.querySelector('button[data-name="align-center"]');
    if (btn) { btn.click(); return true; }
    return false;
  });
  await sleep(400);

  // ── 제목 클릭 후 입력 ──
  log('[7] 제목 입력...');
  const titleEl = await waitInFrames(page, '.se-title-text .se-text-paragraph', 10000).catch(() => null);
  if (titleEl) {
    await titleEl.el.click({ force: true });
    await sleep(500);
  } else {
    await evalInFrames(page, () => {
      const el = document.querySelector('.se-title-text .se-text-paragraph') ||
                 document.querySelector('.se-title-text');
      if (el) { el.click(); return true; }
      return false;
    });
    await sleep(500);
  }
  await slowType(page, '테스트 블로그 글 제목입니다');
  await sleep(400);

  // ── 본문 클릭 후 입력 ──
  log('[8] 본문 입력...');
  const bodyFound = await evalInFrames(page, () => {
    // 제목이 아닌 첫 번째 본문 단락 찾기
    const paras = Array.from(document.querySelectorAll('.se-text-paragraph'));
    const body = paras.find(p => !p.closest('.se-title-text'));
    if (body) { body.click(); return true; }
    return false;
  });
  await sleep(500);

  // Playwright click으로 포커스 확실히
  const bodyEl = await evalInFrames(page, () => {
    const paras = Array.from(document.querySelectorAll('.se-text-paragraph'));
    const body = paras.find(p => !p.closest('.se-title-text'));
    return !!body;
  });

  // frame에서 직접 클릭
  for (const frame of page.frames()) {
    try {
      const el = await frame.$('.se-text-paragraph:not(.se-title-text .se-text-paragraph)');
      if (el) {
        await el.click({ force: true });
        break;
      }
    } catch (_) {}
  }
  await sleep(500);

  const bodyContent = `안녕하세요! 오늘은 테스트 글을 작성해보겠습니다.

이 글은 자동화 프로그램 테스트를 위해 작성된 글입니다.
발행 버튼 클릭 방식을 기록하기 위한 샘플 글이에요.

프로그램이 정상적으로 동작하는지 확인하기 위해 다양한 내용을 넣어보겠습니다.

첫 번째 단락: 네이버 블로그 자동화를 통해 효율적으로 글을 발행할 수 있습니다.
두 번째 단락: AI가 생성한 글을 자동으로 업로드하는 시스템입니다.
세 번째 단락: 하루에 여러 편의 글을 예약 발행할 수 있어 매우 편리합니다.

이제 발행버튼을 클릭 해주세요.`;

  await slowType(page, bodyContent);
  await sleep(500);

  log('');
  log('========================================');
  log('✅ 글 작성 완료!');
  log('');
  log('👉 이제 발행 버튼을 클릭해주세요!');
  log('   → 카테고리 선택, 예약 설정, 최종 발행까지 모두 클릭해주세요');
  log('   → 발행 완료 후 다음 글 작성 방식도 보여주시면 기록합니다');
  log('   → 모두 끝나면 브라우저를 직접 닫아주세요 → 자동 저장됩니다');
  log('========================================');
  log('');

  // ── 클릭 기록기 시작 ──
  const clicks = [];

  const recordClick = (info) => {
    const n = clicks.length + 1;
    clicks.push(info);
    log(`[클릭 ${n}] ${info.tag}#${info.id || '-'} | cls="${info.cls}" | text="${info.text}"`);
    log(`  부모: <${info.parentTag}> cls="${info.parentCls}"`);
    log(`  좌표: x=${info.x} y=${info.y} | w=${info.w} h=${info.h}`);
  };

  const clickListenerScript = () => {
    document.addEventListener('click', (e) => {
      const el = e.target;
      const r  = el.getBoundingClientRect();
      const p  = el.parentElement;
      const g  = p?.parentElement;
      window.__recordClick__({
        tag:       el.tagName || '',
        id:        el.id || '',
        cls:       (el.className || '').toString().slice(0, 120),
        aria:      el.getAttribute('aria-label') || '',
        text:      el.textContent.trim().slice(0, 60),
        x: Math.round(r.x), y: Math.round(r.y),
        w: Math.round(r.width), h: Math.round(r.height),
        parentTag: p?.tagName || '',
        parentCls: (p?.className || '').toString().slice(0, 120),
        grandTag:  g?.tagName || '',
        grandCls:  (g?.className || '').toString().slice(0, 120),
      });
    }, true);
  };

  // 현재 페이지에 기록기 주입
  try { await page.exposeFunction('__recordClick__', recordClick); } catch (_) {}
  await page.evaluate(clickListenerScript);

  // 모든 frame에도 주입
  for (const frame of page.frames()) {
    try { await frame.evaluate(clickListenerScript); } catch (_) {}
  }

  // 새 탭 열릴 때 자동 부착
  context.on('page', async (newPage) => {
    log(`\n[새 탭] 열림 감지`);
    try { await newPage.exposeFunction('__recordClick__', recordClick); } catch (_) {}
    await newPage.addInitScript(clickListenerScript);
    await newPage.waitForLoadState('domcontentloaded').catch(() => {});
    try { await newPage.evaluate(clickListenerScript); } catch (_) {}
    log('[새 탭] 기록기 부착 완료');
  });

  // 새 frame 로드될 때도 주입
  page.on('framenavigated', async (frame) => {
    try { await frame.evaluate(clickListenerScript); } catch (_) {}
  });

  // ── 브라우저 닫힐 때까지 대기 ──
  const TIMEOUT_MS = 60 * 60 * 1000;
  const deadline = Date.now() + TIMEOUT_MS;
  let browserClosed = false;
  browser.on('disconnected', () => { browserClosed = true; });

  while (Date.now() < deadline && !browserClosed) {
    await sleep(1000);
    try {
      const pages = context.pages();
      if (pages.length === 0) break;
    } catch (e) { break; }
  }

  // ── 결과 저장 ──
  const outPath = path.join(process.cwd(), 'click-record.json');
  try {
    fs.writeFileSync(outPath, JSON.stringify(clicks, null, 2), 'utf8');
    log('\n========================================');
    log(`총 ${clicks.length}개 클릭 기록됨 → click-record.json`);
    log('========================================');
  } catch (e) {
    log('저장 오류: ' + e.message);
  }

  try { await browser.close(); } catch (_) {}
  log('완료.');
})();
