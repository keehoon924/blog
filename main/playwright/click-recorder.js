/**
 * click-recorder.js — 사용자 클릭 전체 기록기
 * 실행: node main/playwright/click-recorder.js
 *
 * 에디터를 열고 "시작하세요!" 출력 후 대기.
 * 사용자가 클릭할 때마다 태그·클래스·aria·텍스트·좌표·부모 정보를 콘솔에 출력.
 * 발행 후 페이지 이동 감지 or 3분 대기 후 click-record.json 저장.
 */

require('dotenv').config();
const { chromium } = require('playwright');
const fs   = require('fs');
const path = require('path');

const SESSION_FILE = path.join(process.cwd(), 'naver-session.json');

function log(msg) { console.log(msg); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const naverID = process.env.NAVER_ID;
  const naverPW = process.env.NAVER_PW;
  if (!naverID || !naverPW) { log('❌ NAVER_ID / NAVER_PW 없음'); process.exit(1); }

  const browser = await chromium.launch({
    headless: false,
    slowMo: 0,
    channel: 'chrome',
    args: ['--disable-blink-features=AutomationControlled'],
  });

  const ctxOpts = {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 900 },
    extraHTTPHeaders: { 'Accept-Language': 'ko-KR,ko;q=0.9' },
  };
  if (fs.existsSync(SESSION_FILE)) ctxOpts.storageState = SESSION_FILE;

  const context = await browser.newContext(ctxOpts);
  const page    = await context.newPage();
  const writeUrl = `https://blog.naver.com/PostWriteForm.naver?blogId=${naverID}`;

  // ── 에디터 접속 ──
  log('[0] 에디터 접속...');
  await page.goto(writeUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
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
    await page.goto(writeUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(3000);
  } else {
    await sleep(2500);
  }

  // ── 클릭 기록기 주입 ──
  const clicks = [];

  await page.exposeFunction('__recordClick__', (info) => {
    const n = clicks.length + 1;
    clicks.push(info);
    log(`\n[클릭 ${n}] ${info.tag}#${info.id || '-'} | cls="${info.cls}" | aria="${info.aria}" | text="${info.text}"`);
    log(`  부모: <${info.parentTag}> cls="${info.parentCls}"`);
    log(`  조부: <${info.grandTag}> cls="${info.grandCls}"`);
    log(`  좌표: x=${info.x} y=${info.y} | w=${info.w} h=${info.h}`);
  });

  await page.evaluate(() => {
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
    }, true); // capture phase — 모든 클릭 감지
  });

  log('\n========================================');
  log('✅ 기록기 준비 완료!');
  log('지금 시작하세요! →');
  log('  ① 오른쪽 도움말 패널 X버튼');
  log('  ② (제목/본문은 건너뜀)');
  log('  ③ 상단 발행 버튼');
  log('  ④ 카테고리 선택');
  log('  ⑤ 예약 라디오');
  log('  ⑥ 날짜/시간');
  log('  ⑦ 발행 버튼');
  log('========================================\n');

  // 발행 후 URL 바뀌거나 3분 경과 시 종료
  const TIMEOUT_MS = 3 * 60 * 1000;
  const startUrl   = page.url();
  const deadline   = Date.now() + TIMEOUT_MS;

  while (Date.now() < deadline) {
    await sleep(500);
    const curUrl = page.url();
    if (curUrl !== startUrl && !curUrl.includes('PostWriteForm')) {
      log(`\n✅ 페이지 이동 감지: ${curUrl}`);
      break;
    }
  }

  // ── 결과 저장 ──
  const outPath = path.join(process.cwd(), 'click-record.json');
  fs.writeFileSync(outPath, JSON.stringify(clicks, null, 2), 'utf8');

  log('\n========================================');
  log(`총 ${clicks.length}개 클릭 기록됨 → click-record.json`);
  log('========================================');

  await sleep(2000);
  await browser.close();
  log('완료.');
})();
