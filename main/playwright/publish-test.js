/**
 * publish-test.js — 전체 발행 흐름 직접 테스트
 * 실행: node main/playwright/publish-test.js
 *
 * 흐름:
 *   1) 에디터 접속
 *   2) 도움말 패널 닫기 버튼 클릭 (Playwright force click, 닫힐 때까지 확인)
 *   3) 제목/본문 입력
 *   4) 상단 발행 버튼 클릭
 *   5) 카테고리 "여행" 선택
 *   6) 예약 라디오 → 날짜 2026-05-27 → 시간 20:20
 *   7) 발행 버튼 클릭
 *   8) 브라우저 닫기
 */

require('dotenv').config();
const { chromium } = require('playwright');
const fs   = require('fs');
const path = require('path');

const SESSION_FILE = path.join(process.cwd(), 'naver-session.json');

function log(msg) { console.log(msg); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── 도움말 패널 닫기 ─────────────────────────────────────────────────────────
// 클릭 기록으로 확인된 정확한 셀렉터: button.se-help-panel-close-button
async function dismissHelpPanel(page) {
  log('\n[1] 도움말 패널 닫기...');

  const panelVisible = await page.evaluate(() => {
    const el = document.querySelector('.se-help-title, h1.se-help-title, [class*="help_title"]');
    return el ? el.getBoundingClientRect().height > 0 : false;
  });
  if (!panelVisible) { log('  도움말 패널 없음 — 건너뜀'); return; }

  // 클릭 기록으로 확인된 정확한 클래스 (cls="se-help-panel-close-button")
  const closeBtn = await page.$('button.se-help-panel-close-button');
  if (!closeBtn) {
    log('  ❌ se-help-panel-close-button 못 찾음 — 강제 숨김');
    await page.evaluate(() => {
      const el = document.querySelector('.se-help-container, [class*="help_container"]');
      if (el) el.style.setProperty('display', 'none', 'important');
    });
    await sleep(300);
    return;
  }

  await closeBtn.click({ force: true });
  log('  닫기 버튼 클릭됨 — 패널 사라질 때까지 대기...');

  for (let i = 0; i < 10; i++) {
    await sleep(500);
    const stillVisible = await page.evaluate(() => {
      const el = document.querySelector('.se-help-title, h1.se-help-title, [class*="help_title"]');
      if (!el) return false;
      return el.getBoundingClientRect().height > 0;
    });
    if (!stillVisible) { log(`  ✅ 도움말 패널 닫힘 (${(i + 1) * 0.5}초)`); return; }
  }

  log('  ⚠ 5초 후에도 패널 남아있음 — 강제 숨김');
  await page.evaluate(() => {
    const el = document.querySelector('.se-help-container, [class*="help_container"]');
    if (el) el.style.setProperty('display', 'none', 'important');
  });
  await sleep(300);
}

// ── 카테고리 선택 ─────────────────────────────────────────────────────────────
// 클릭 기록 확인: 드롭다운=button.selectbox_button__jb1Dt, 옵션=label.radio_label__mB6ia
async function selectCategory(page, categoryName) {
  log(`\n[5] 카테고리 "${categoryName}" 선택...`);

  // 드롭다운 열기 — 클릭 기록 cls="selectbox_button__jb1Dt"
  const catBtn = await page.$('button.selectbox_button__jb1Dt');
  if (!catBtn) { log('  ❌ 카테고리 드롭다운 버튼 없음'); return false; }

  await catBtn.click({ force: true });
  await sleep(1200);

  // 카테고리 옵션 — 클릭 기록 cls="radio_label__mB6ia"
  const labels = await page.$$('label.radio_label__mB6ia');
  log(`  label.radio_label__mB6ia 개수: ${labels.length}`);

  let target = null;
  for (const lbl of labels) {
    const txt = await lbl.evaluate(el => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 ? el.textContent.trim() : '';
    });
    if (txt === categoryName) { target = lbl; break; }
  }
  // 포함 매칭 fallback
  if (!target) {
    for (const lbl of labels) {
      const txt = await lbl.evaluate(el => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 ? el.textContent.trim() : '';
      });
      if (txt && txt.includes(categoryName)) { target = lbl; break; }
    }
  }

  if (!target) {
    const available = [];
    for (const lbl of labels) {
      const txt = await lbl.evaluate(el => el.textContent.trim());
      if (txt) available.push(txt);
    }
    log(`  ❌ "${categoryName}" 없음. 사용 가능: ${available.slice(0, 20).join(', ')}`);
    await page.keyboard.press('Escape');
    await sleep(500);
    return false;
  }

  await target.click({ force: true });
  log(`  ✅ 카테고리 "${categoryName}" 클릭됨`);
  await sleep(800);
  return true;
}

// ── layer_popup 강제 닫기 ─────────────────────────────────────────────────────
async function forceCloseLayerPopup(page) {
  await page.evaluate(() => {
    document.querySelectorAll('[class*="layer_popup"]').forEach(el => {
      if (el.className.includes('layer_publish')) return;
      [...el.classList].filter(c => c.includes('is_show')).forEach(c => el.classList.remove(c));
      el.style.display = 'none';
    });
  });
  await sleep(400);
}

// ── 메인 ─────────────────────────────────────────────────────────────────────
(async () => {
  const naverID  = process.env.NAVER_ID;
  const naverPW  = process.env.NAVER_PW;
  if (!naverID || !naverPW) { log('❌ NAVER_ID / NAVER_PW 없음'); process.exit(1); }

  const browser = await chromium.launch({
    headless: false,
    slowMo: 30,
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

  // 작성 중 글 팝업 닫기
  await page.evaluate(() => {
    document.querySelectorAll('button').forEach(b => {
      if (b.textContent.trim() === '취소' && b.closest('.se-popup-container')) b.click();
    });
  });
  await sleep(500);

  // ── 1단계: 도움말 패널 닫기 ──
  await dismissHelpPanel(page);

  // ── 2단계: 제목 입력 ──
  log('\n[2] 제목 입력...');
  const titleEl = await page.$('.se-title-text');
  if (titleEl) {
    await titleEl.click({ force: true });
    await sleep(400);
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Backspace');
    await page.keyboard.type('자동화 발행 테스트 글', { delay: 40 });
    log('  ✅ 제목 입력 완료');
  }

  // ── 3단계: 본문 입력 ──
  log('\n[3] 본문 입력...');
  await page.keyboard.press('Enter');
  await sleep(300);
  await page.keyboard.type('자동화 테스트입니다. 카테고리, 예약 날짜/시간, 발행 버튼까지 전부 자동으로 진행됩니다.', { delay: 25 });
  await sleep(600);
  log('  ✅ 본문 입력 완료');

  // ── 4단계: 상단 발행 버튼 클릭 ──
  log('\n[4] 상단 발행 버튼 클릭...');
  const topBtn = await page.$('button.publish_btn__m9KHH');
  if (!topBtn) { log('  ❌ 발행 버튼 못 찾음'); await browser.close(); return; }
  await topBtn.click();
  log('  발행 버튼 클릭됨 — 다이얼로그 대기...');
  try {
    await page.waitForSelector('input#radio_time2, input[name="radio_time"]', { timeout: 15000 });
    log('  ✅ 발행 다이얼로그 열림');
  } catch {
    log('  ❌ 다이얼로그 15초 내 미오픈 — 계속 진행');
  }
  await sleep(1500);

  // ── 5단계: 카테고리 "여행" 선택 ──
  await selectCategory(page, '여행');
  await sleep(500);

  // ── 6단계: 예약 라디오 클릭 ──
  log('\n[6] 예약 라디오 선택...');
  const reserveLabel = await page.$('label[for="radio_time2"]');
  if (reserveLabel) {
    await reserveLabel.click({ force: true });
    log('  ✅ 예약 라디오 클릭됨');
    await sleep(1000);
  } else {
    log('  ❌ 예약 라디오 없음');
  }

  // ── 7단계: 날짜 설정 (2026-05-27) ──
  log('\n[7] 날짜 설정 (2026-05-27)...');
  const dateInput = await page.$('input.input_date__QmA0s');
  if (dateInput) {
    await dateInput.click({ force: true });
    await sleep(1000);

    // 2026년 5월까지 달력 이동
    const targetYear = 2026, targetMonth = 5, targetDay = 27;
    for (let i = 0; i < 24; i++) {
      const cur = await page.evaluate(() => {
        const y = document.querySelector('.ui-datepicker-year');
        const m = document.querySelector('.ui-datepicker-month');
        if (!y || !m) return null;
        return { year: +y.textContent, month: +m.textContent.replace('월', '') };
      });
      if (!cur) { log('  ❌ 달력 못 읽음'); break; }
      log(`  달력 현재: ${cur.year}-${cur.month}`);
      if (cur.year === targetYear && cur.month === targetMonth) break;
      const nxt = await page.$('button.ui-datepicker-next:not(.ui-state-disabled)');
      if (!nxt) { log('  ❌ 다음달 버튼 없음'); break; }
      await nxt.click({ force: true });
      await sleep(400);
    }

    // 27일 클릭
    const dayBtns = await page.$$('.ui-datepicker td:not(.ui-state-disabled) > button.ui-state-default');
    let dayClicked = false;
    for (const btn of dayBtns) {
      const txt = await btn.evaluate(el => el.textContent.trim());
      if (txt === String(targetDay)) {
        await btn.click({ force: true });
        dayClicked = true;
        log(`  ✅ ${targetDay}일 클릭됨`);
        break;
      }
    }
    if (!dayClicked) log(`  ❌ ${targetDay}일 버튼 못 찾음`);
    await sleep(800);
  } else {
    log('  ❌ 날짜 입력 필드 없음');
  }

  // ── 8단계: 시간/분 선택 (20시 20분) ──
  log('\n[8] 시간 설정 (20:20)...');
  try {
    await page.selectOption('select.hour_option__J_heO', '20');
    log('  ✅ 20시 선택');
    await sleep(300);
    await page.selectOption('select.minute_option__Vb3xB', '20');
    log('  ✅ 20분 선택');
    await sleep(400);
  } catch (e) {
    log(`  ❌ 시간 설정 실패: ${e.message}`);
  }

  // ── 9단계: 발행 버튼 클릭 ──
  log('\n[9] 발행 버튼 클릭...');

  // 클릭 기록 확인: 최종 발행 버튼 cls="confirm_btn__WEaBq" (다이얼로그 하단)
  // forceCloseLayerPopup 없이 dispatchEvent 직접 사용 — 포인터/가시성 체크 완전 우회
  const clickResult = await page.evaluate(() => {
    const btn = document.querySelector('button.confirm_btn__WEaBq');
    if (!btn) return { ok: false, reason: '버튼 없음' };
    const r = btn.getBoundingClientRect();
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    return { ok: true, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  });
  log(`  confirm_btn__WEaBq dispatchEvent → ${JSON.stringify(clickResult)}`);

  log('  발행 버튼 클릭 완료 — 처리 대기 (5초)...');
  await sleep(5000);

  // ── 10단계: 결과 확인 ──
  log('\n[10] 결과 확인...');
  const dialogStillOpen = await page.evaluate(() => {
    const el = document.querySelector('input#radio_time2');
    return el ? el.getBoundingClientRect().width > 0 : false;
  });

  if (!dialogStillOpen) {
    log('  ✅ 다이얼로그 닫힘 → 발행 성공!');
  } else {
    log('  ❌ 다이얼로그 여전히 열림 → 발행 실패');
  }

  log('\n[완료] 브라우저 닫는 중...');
  await sleep(2000);
  await browser.close();
  log('브라우저 닫힘. 종료.');
})();
