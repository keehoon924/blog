/**
 * click-recorder.js — 사용자 클릭 전체 기록기
 * 실행: node main/playwright/click-recorder.js
 *
 * 에디터를 열고 "시작하세요!" 출력 후 대기.
 * 사용자가 클릭할 때마다 태그·클래스·aria·텍스트·좌표·부모 정보를 콘솔에 출력.
 * 브라우저를 직접 닫을 때까지 계속 기록 (발행 후에도 종료 안 함).
 * 종료 시 click-record.json 저장.
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
      '--start-maximized',   // 창 최대화 — 스크롤 제한 없음
    ],
  });

  const ctxOpts = {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: null,           // null = 실제 창 크기 그대로 (스크롤 제한 없음)
    extraHTTPHeaders: { 'Accept-Language': 'ko-KR,ko;q=0.9' },
  };
  if (fs.existsSync(SESSION_FILE)) ctxOpts.storageState = SESSION_FILE;

  const context = await browser.newContext(ctxOpts);
  const page    = await context.newPage();
  const homeUrl  = `https://blog.naver.com/${naverID}`;

  // ── 로그인 ──
  log('[0] 로그인 시도...');
  await page.goto('https://nid.naver.com/nidlogin.login', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(1500);

  if (page.url().includes('nid.naver.com')) {
    log('  로그인 중...');
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

  // ── 블로그 홈으로 이동 ──
  log('[1] 블로그 홈으로 이동...');
  await page.goto(homeUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(2000);

  // ── 클릭 기록기 ──
  const clicks = [];
  let postCount = 0;

  const recordClick = (info) => {
    const n = clicks.length + 1;
    clicks.push(info);
    log(`\n[클릭 ${n}] ${info.tag}#${info.id || '-'} | cls="${info.cls}" | aria="${info.aria}" | text="${info.text}"`);
    log(`  부모: <${info.parentTag}> cls="${info.parentCls}"`);
    log(`  조부: <${info.grandTag}> cls="${info.grandCls}"`);
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
        text:      el.textContent.trim().slice(0, 40),
        x: Math.round(r.x), y: Math.round(r.y),
        w: Math.round(r.width), h: Math.round(r.height),
        parentTag: p?.tagName || '',
        parentCls: (p?.className || '').toString().slice(0, 120),
        grandTag:  g?.tagName || '',
        grandCls:  (g?.className || '').toString().slice(0, 120),
      });
    }, true);
  };

  // 블로그 홈 탭에 기록기 주입
  await page.exposeFunction('__recordClick__', recordClick);
  await page.evaluate(clickListenerScript);

  // 새 탭(에디터 등) 열릴 때마다 자동으로 기록기 부착
  context.on('page', async (newPage) => {
    log(`\n[새 탭] 열림 감지`);

    try { await newPage.exposeFunction('__recordClick__', recordClick); } catch (_) {}
    await newPage.addInitScript(clickListenerScript);   // 페이지 이동해도 유지
    await newPage.waitForLoadState('domcontentloaded').catch(() => {});
    try { await newPage.evaluate(clickListenerScript); } catch (_) {}

    await sleep(4000);
    const url = newPage.url();
    if (url.includes('PostWriteForm') || url.includes('Redirect=Write')) {
      postCount++;
      log(`[새 탭] 에디터 감지 — 글 ${postCount}번째`);
    } else {
      log(`[새 탭] URL: ${url}`);
    }
    log('[새 탭] 기록기 부착 완료 ✅ — 이제 에디터에서 클릭하세요!');
  });

  log('\n========================================');
  log('✅ 기록기 준비 완료! (블로그 홈)');
  log('지금 시작하세요! →');
  log('  ① 글쓰기 버튼 클릭');
  log('  ② 도움말 X 버튼 클릭');
  log('  ③ 제목 클릭 후 작성');
  log('  ④ 본문 클릭 → 가운데정렬 → 본문 작성');
  log('  ⑤ 발행 버튼 → 카테고리 → 예약 → 날짜/시간 → 발행');
  log('  ⑥ 다음 글도 동일하게 반복');
  log('  ⑦ 모두 끝나면 브라우저 직접 닫기 → 자동 저장');
  log('  (모든 클릭이 콘솔에 즉시 출력됩니다)');
  log('========================================\n');

  // ── 브라우저가 닫힐 때까지 대기 (발행 완료해도 종료 안 함) ──
  const TIMEOUT_MS = 60 * 60 * 1000; // 최대 60분
  const deadline   = Date.now() + TIMEOUT_MS;
  let browserClosed = false;

  browser.on('disconnected', () => {
    browserClosed = true;
  });

  while (Date.now() < deadline && !browserClosed) {
    await sleep(1000);

    // 모든 탭이 닫혔으면 종료
    try {
      const pages = context.pages();
      if (pages.length === 0) {
        log('\n✅ 모든 탭 닫힘 — 종료');
        break;
      }
    } catch (e) {
      log('\n✅ 브라우저 닫힘 — 종료');
      break;
    }
  }

  if (browserClosed) {
    log('\n✅ 브라우저 닫힘 감지 — 종료');
  }

  // ── 결과 저장 ──
  const outPath = path.join(process.cwd(), 'click-record.json');
  try {
    fs.writeFileSync(outPath, JSON.stringify(clicks, null, 2), 'utf8');
    log('\n========================================');
    log(`총 ${clicks.length}개 클릭 기록됨 (글 ${postCount}개) → click-record.json`);
    log('========================================');
  } catch (e) {
    log('저장 오류: ' + e.message);
  }

  try { await browser.close(); } catch (_) {}
  log('완료.');
})();
