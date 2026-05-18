const { chromium } = require('playwright');
const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const SESSION_FILE = path.join(app.getPath('userData'), 'naver-session.json');

// Bold 마커 파싱: [{text, bold}]
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

function stripImagePlaceholders(content) {
  return content.replace(/\[이미지:[^\]]*\]/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function stripDividerMarkers(content) {
  return content.replace(/\[구분선\]|\[짧은구분선\]/g, '').replace(/\n{3,}/g, '\n\n');
}

function stripContentArtifacts(text) {
  return text
    .replace(/\n*\**\s*HASHTAGS\s*:?[\s\S]*$/i, '')
    .replace(/\n*\**\s*TAGS\s*:?[\s\S]*$/i, '')
    .replace(/\n*\**\s*해시\s*태그\s*:?[\s\S]*$/i, '')
    .trim();
}

// 문장 종료 부호 뒤에 줄바꿈 강제 (1문장 1줄)
function makeReadable(text) {
  const lines = text.split('\n');
  const out = [];
  for (const line of lines) {
    if (/^\s*\[(인용구:|이미지)/.test(line)) {
      out.push(line);
      continue;
    }
    let processed = line.replace(/([.!?…。])\s+(?=\S)/g, '$1\n');
    const sentences = processed.split('\n');
    const grouped = [];
    sentences.forEach((s, i) => {
      grouped.push(s);
      if ((i + 1) % 2 === 0 && i < sentences.length - 1) grouped.push('');
    });
    out.push(grouped.join('\n'));
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// \n을 Enter 키로 변환해서 입력
async function slowType(page, text) {
  const parts = text.split('\n');
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part.length > 0) {
      const chunks = part.match(/[\s\S]{1,80}/g) || [part];
      for (const chunk of chunks) {
        await page.keyboard.type(chunk, { delay: 18 });
        await page.waitForTimeout(60);
      }
    }
    if (i < parts.length - 1) {
      await page.keyboard.press('Enter');
      await page.waitForTimeout(90);
    }
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

// SE5 툴바 버튼 클릭 — data-name 속성 기반
async function clickToolbarBtn(page, dataName, dataType = null) {
  let selector = `button[data-name="${dataName}"]`;
  if (dataType) selector += `[data-type="${dataType}"]`;
  const el = await page.$(selector);
  if (el) {
    await el.scrollIntoViewIfNeeded();
    await el.click();
    await page.waitForTimeout(400);
    return true;
  }
  return false;
}

// 정렬 적용 (center | left | right)
async function applyAlign(page, alignType) {
  await clickToolbarBtn(page, 'align-drop-down-with-justify', 'drop-down');
  await page.waitForTimeout(300);
  const btn = await page.$(`button[data-name="align-drop-down-with-justify"][data-value="${alignType}"]`);
  if (btn) {
    await btn.click();
    await page.waitForTimeout(300);
    return true;
  }
  return false;
}

// 이미지 업로드 — 사진 추가 버튼 클릭 → filechooser → 업로드 완료 확인
async function insertImage(page, imagePath) {
  if (!imagePath) throw new Error('이미지 경로 없음');

  const photoBtn = await page.$('button[data-name="image"]');
  if (!photoBtn) throw new Error('사진 추가 버튼 (data-name="image") 못 찾음');

  // 업로드 전 본문 이미지 개수
  const beforeCount = await page.evaluate(() =>
    document.querySelectorAll('.se-component-image img, .se-image-resource img, .se-component-content img').length
  );

  const fcPromise = page.waitForEvent('filechooser', { timeout: 8000 });
  await photoBtn.click();
  const fileChooser = await fcPromise.catch(() => null);
  if (!fileChooser) throw new Error('파일 선택 다이얼로그 안 열림 (사진 버튼 클릭 후)');

  await fileChooser.setFiles(imagePath);
  console.log(`[insertImage] 업로드 시작: ${imagePath.split(/[\\/]/).pop()}`);

  // 업로드 완료 대기 — 이미지 개수 증가까지 (최대 20초)
  let uploaded = false;
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(1000);
    const afterCount = await page.evaluate(() =>
      document.querySelectorAll('.se-component-image img, .se-image-resource img, .se-component-content img').length
    );
    if (afterCount > beforeCount) {
      uploaded = true;
      console.log(`[insertImage] ✓ 업로드 완료 (${i + 1}초)`);
      break;
    }
  }
  if (!uploaded) throw new Error(`이미지 업로드 시간 초과 (20초): ${imagePath}`);

  // 커서를 이미지 다음 줄로 (ArrowDown + End)
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(200);
  await page.keyboard.press('End');
  await page.waitForTimeout(300);
  return true;
}

// 인용구 삽입 — 모든 이동은 클릭으로 (Enter/ArrowDown 사용 금지)
// quoteRaw 형식: "인용문 | – 출처명" 또는 "인용문"
async function insertQuote(page, quoteRaw) {
  const pipeIdx = quoteRaw.indexOf(' | ');
  const quoteText = pipeIdx !== -1 ? quoteRaw.slice(0, pipeIdx).trim() : quoteRaw.trim();
  const attribution = pipeIdx !== -1 ? quoteRaw.slice(pipeIdx + 3).trim() : '';

  const clicked = await clickToolbarBtn(page, 'quotation', 'icon-select');
  if (!clicked) {
    // 툴바 버튼 없을 때 대체 텍스트로 삽입
    const full = attribution ? `❝ ${quoteText} ❞\n— ${attribution}` : `❝ ${quoteText} ❞`;
    await slowType(page, full);
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    return;
  }

  // 인용구 블록이 생성될 때까지 대기
  await page.waitForTimeout(800);

  // ── 1단계: 인용구 내용 영역 클릭 후 입력 ──
  await page.evaluate(() => {
    const mods = document.querySelectorAll('.se-module-quotation');
    const last = mods[mods.length - 1];
    if (!last) return;
    // 첫 번째 텍스트 단락 (내용 입력 영역)
    const para = last.querySelector('.se-text-paragraph');
    if (para) para.click();
  });
  await page.waitForTimeout(400);
  await page.keyboard.type(quoteText, { delay: 18 });

  // ── 2단계: 출처 영역 클릭 후 입력 ──
  if (attribution) {
    await page.evaluate(() => {
      const mods = document.querySelectorAll('.se-module-quotation');
      const last = mods[mods.length - 1];
      if (!last) return;
      // 출처는 cite 태그 안 또는 두 번째 텍스트 단락
      const cite = last.querySelector('cite .se-text-paragraph')
        || last.querySelector('cite')
        || last.querySelectorAll('.se-text-paragraph')[1];
      if (cite) cite.click();
    });
    await page.waitForTimeout(400);
    await page.keyboard.type(attribution, { delay: 18 });
  }

  // ── 3단계: 인용구 블록 바깥 본문 영역 클릭으로 탈출 ──
  await page.waitForTimeout(400);
  const exited = await page.evaluate(() => {
    const mods = document.querySelectorAll('.se-module-quotation');
    const last = mods[mods.length - 1];
    if (!last) return false;

    // 인용구 블록 다음 형제 요소에서 클릭 가능한 단락 찾기
    let sibling = last.nextElementSibling;
    while (sibling) {
      const para = sibling.querySelector
        ? (sibling.querySelector('.se-text-paragraph') ||
           (sibling.classList && sibling.classList.contains('se-text-paragraph') ? sibling : null))
        : null;
      if (para) {
        para.click();
        return true;
      }
      sibling = sibling.nextElementSibling;
    }
    return false;
  });

  if (!exited) {
    // 다음 형제가 없으면 메인 섹션 끝 부분 클릭
    const box = await page.evaluate(() => {
      const main = document.querySelector('.se-main-section');
      if (!main) return null;
      const rect = main.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height - 40 };
    });
    if (box) {
      await page.mouse.click(box.x, box.y);
    }
  }
  await page.waitForTimeout(500);
}

// 본문 마커([인용구:...], [이미지]) 파싱 후 타이핑
// images: 사용자 [이미지] 마커 순서대로 매칭할 로컬 파일 경로 배열
async function typeContentWithMarkers(page, content, images = []) {
  const stage1 = stripContentArtifacts(content);
  const stage2 = stripDividerMarkers(stage1);
  const stage3 = stripImagePlaceholders(stage2);  // AI [이미지:hint] 제거, 사용자 [이미지]는 보존
  const cleaned = makeReadable(stage3);
  // 인용구(콜론 있음) + 이미지(콜론 없음, 단독) 통합 매칭
  const markerRegex = /\[(인용구:[^\]]+|이미지)\]/g;
  let lastIndex = 0;
  let imageIndex = 0;
  let match;

  while ((match = markerRegex.exec(cleaned)) !== null) {
    if (match.index > lastIndex) {
      await typeWithFormatting(page, cleaned.slice(lastIndex, match.index));
    }

    const marker = match[1];
    if (marker.startsWith('인용구:')) {
      await insertQuote(page, marker.slice(3).trim());
      // 인용구 탈출 후 가운데 정렬 재적용
      await applyAlign(page, 'center');
      await page.waitForTimeout(300);
    } else if (marker === '이미지') {
      if (imageIndex < images.length) {
        await insertImage(page, images[imageIndex]);
        imageIndex++;
      } else {
        console.warn(`[이미지] 마커 ${imageIndex + 1}번째이지만 업로드할 이미지 부족 — 건너뜀`);
      }
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
  await page.keyboard.press('Control+b');
  await page.keyboard.type('▼ 함께 읽으면 좋은 글', { delay: 20 });
  await page.keyboard.press('Control+b');
  await page.keyboard.press('Enter');
  for (const post of relatedPosts) {
    await page.keyboard.type(`• ${post.title}`, { delay: 20 });
    await page.keyboard.press('Enter');
    if (post.naver_url) {
      await page.keyboard.type(`  ${post.naver_url}`, { delay: 15 });
      await page.keyboard.press('Enter');
    }
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

  await page.waitForFunction(
    () => !window.location.hostname.includes('nid.naver.com'),
    { timeout: 120000 }
  );
}

// 자동 발행 — 발행 다이얼로그 진입 후 다이얼로그 내 '발행' 버튼 클릭
async function autoFinalizePublish(page) {
  const topBtn = await page.$('button.publish_btn__m9KHH');
  if (!topBtn) throw new Error('우상단 발행 버튼을 찾을 수 없습니다.');
  await topBtn.click({ force: true });

  // 다이얼로그 열림 확인 — 라디오 또는 컨테이너 둘 다 허용
  await page.waitForSelector('input[name="radio_time"], [class*="layer_publish"], [class*="publish_layer"]', { timeout: 10000 });
  await page.waitForTimeout(1800);

  // robust selector로 다이얼로그 내 발행 버튼 클릭
  await clickDialogPublishBtn(page);

  await page.waitForTimeout(5000);
}

// layer_popup 드롭다운 강제 닫기 (layer_publish 다이얼로그 제외)
async function forceCloseLayerPopup(page) {
  await page.evaluate(() => {
    document.querySelectorAll('[class*="layer_popup"]').forEach(el => {
      if (el.className.includes('layer_publish')) return;
      [...el.classList].filter(c => c.includes('is_show')).forEach(c => el.classList.remove(c));
      el.style.display = 'none';
    });
  });
  await page.waitForTimeout(400);
}

// 다이얼로그 내 발행 버튼 클릭
// 클릭 기록 확인: cls="confirm_btn__WEaBq" (다이얼로그 하단 확인 버튼)
// dispatchEvent 직접 사용 — Playwright 포인터/가시성 체크 완전 우회 (테스트 검증됨)
async function clickDialogPublishBtn(page) {
  const result = await page.evaluate(() => {
    const btn = document.querySelector('button.confirm_btn__WEaBq');
    if (!btn) return { ok: false, reason: '버튼 없음' };
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    return { ok: true };
  });
  console.log(`[발행 버튼] confirm_btn__WEaBq dispatchEvent → ${JSON.stringify(result)}`);
  if (!result.ok) throw new Error('발행 버튼 클릭 실패: ' + result.reason);

  await page.waitForTimeout(3000);

  const stillOpen = await page.evaluate(() => {
    const r = document.querySelector('input#radio_time2');
    if (!r) return false;
    return r.getBoundingClientRect().width > 0;
  });
  if (stillOpen) {
    console.warn('[발행 버튼] 다이얼로그 여전히 열림 — dispatchEvent 재시도');
    await page.evaluate(() => {
      const btn = document.querySelector('button.confirm_btn__WEaBq');
      if (btn) btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    });
    await page.waitForTimeout(3000);
  }
  return { clicked: true };
}

// 카테고리 설정 — 클릭 기록으로 확인된 정확한 셀렉터 사용
// 드롭다운: button.selectbox_button__jb1Dt / 옵션: label.radio_label__mB6ia
async function selectNaverCategory(page, categoryName) {
  if (!categoryName || !categoryName.trim()) return { skipped: true };
  const name = categoryName.trim();
  try {
    const catBtn = await page.$('button.selectbox_button__jb1Dt');
    if (!catBtn) return { error: '카테고리 드롭다운 버튼 없음' };
    await catBtn.click({ force: true });
    await page.waitForTimeout(1200);

    // 클릭 기록 확인: 카테고리 옵션은 label.radio_label__mB6ia
    const labels = await page.$$('label.radio_label__mB6ia');
    let target = null;

    for (const lbl of labels) {
      const txt = await lbl.evaluate(el => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 ? el.textContent.trim() : '';
      });
      if (txt === name) { target = lbl; break; }
    }
    if (!target) {
      for (const lbl of labels) {
        const txt = await lbl.evaluate(el => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0 ? el.textContent.trim() : '';
        });
        if (txt && txt.includes(name)) { target = lbl; break; }
      }
    }

    if (!target) {
      const available = [];
      for (const lbl of labels) {
        const txt = await lbl.evaluate(el => el.textContent.trim());
        if (txt) available.push(txt);
      }
      console.warn(`[카테고리] "${name}" 없음. 사용 가능: ${available.slice(0, 20).join(', ')}`);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
      return { error: `"${name}" 없음` };
    }

    await target.click({ force: true });
    console.log(`[카테고리] "${name}" 클릭됨`);
    await page.waitForTimeout(800);
    await forceCloseLayerPopup(page);
    return { clicked: name };
  } catch (err) {
    return { error: err.message };
  }
}

// 예약 발행 — scheduledAt: Date 객체 또는 ISO 문자열
// 네이버 제약: 분은 10분 단위 (00/10/20/30/40/50), 과거 시간 불가
async function autoFinalizeScheduledPublish(page, scheduledAt, naverCategory = '') {
  const target = scheduledAt instanceof Date ? scheduledAt : new Date(scheduledAt);
  if (isNaN(target.getTime())) throw new Error('예약 시간 형식 오류: ' + scheduledAt);

  const targetYear  = target.getFullYear();
  const targetMonth = target.getMonth() + 1;
  const targetDay   = target.getDate();
  const targetHour  = target.getHours();
  const rawMinute   = target.getMinutes();
  // 분 10분 단위 반올림 (네이버 제약), 최대 50
  const targetMinute = Math.min(Math.round(rawMinute / 10) * 10, 50);

  // 1) 우상단 발행 버튼 → 다이얼로그 열림 (force:true — 도움말 패널이 겹쳐도 통과)
  const topBtn = await page.$('button.publish_btn__m9KHH');
  if (!topBtn) throw new Error('우상단 발행 버튼을 찾을 수 없습니다.');
  await topBtn.click({ force: true });
  // 다이얼로그 열림 확인 — 예약 라디오로
  await page.waitForSelector('input#radio_time2, input[name="radio_time"]', { timeout: 10000 });
  await page.waitForTimeout(1800);

  // 2) 카테고리 선택 (옵션) — 다이얼로그 열린 직후
  if (naverCategory) {
    const catResult = await selectNaverCategory(page, naverCategory);
    if (catResult.error) console.warn('[카테고리 설정] ' + catResult.error);
    else if (catResult.clicked) console.log('[카테고리 설정] "' + naverCategory + '" 선택됨');
    // selectNaverCategory 내부에서 forceCloseLayerPopup 이미 호출됨
    await page.waitForTimeout(500);
  }

  // 3) "예약" 라디오 라벨 클릭 (radio_time2)
  const reserveLabel = await page.$('label[for="radio_time2"]');
  if (!reserveLabel) throw new Error('예약 라디오 라벨을 찾을 수 없습니다.');
  await reserveLabel.click();
  await page.waitForTimeout(1000);

  // 4) 날짜 input 클릭 → jQuery UI datepicker 열림
  const dateInput = await page.$('input.input_date__QmA0s');
  if (!dateInput) throw new Error('날짜 input을 찾을 수 없습니다.');
  await dateInput.click();
  await page.waitForTimeout(800);

  // 5) 목표 달까지 next 버튼으로 이동 (최대 24개월)
  for (let i = 0; i < 24; i++) {
    const current = await page.evaluate(() => {
      const y = document.querySelector('.ui-datepicker-year');
      const m = document.querySelector('.ui-datepicker-month');
      if (!y || !m) return null;
      return {
        year:  parseInt(y.textContent.trim(), 10),
        month: parseInt(m.textContent.replace('월', '').trim(), 10),
      };
    });
    if (!current) throw new Error('캘린더 헤더(년/월)를 읽을 수 없습니다.');
    if (current.year === targetYear && current.month === targetMonth) break;
    if (current.year > targetYear || (current.year === targetYear && current.month > targetMonth)) {
      throw new Error(`목표 ${targetYear}-${targetMonth}이(가) 현재 표시 ${current.year}-${current.month}보다 과거 — 예약 불가`);
    }
    const nextBtn = await page.$('button.ui-datepicker-next:not(.ui-state-disabled)');
    if (!nextBtn) throw new Error('다음달 버튼이 비활성화되어 더 이상 진행 불가');
    await nextBtn.click();
    await page.waitForTimeout(400);
  }

  // 6) 목표 날짜 버튼 클릭
  const dayResult = await page.evaluate((day) => {
    const buttons = Array.from(document.querySelectorAll('.ui-datepicker td:not(.ui-state-disabled) > button.ui-state-default'));
    const btn = buttons.find(b => b.textContent.trim() === String(day));
    if (!btn) return { error: `${day}일 클릭 불가 (이미 지났거나 비활성)` };
    btn.click();
    return { clicked: true };
  }, targetDay);
  if (dayResult.error) throw new Error(dayResult.error);
  await page.waitForTimeout(800);

  // 7) 시간 select
  await page.selectOption('select.hour_option__J_heO', String(targetHour).padStart(2, '0'));
  await page.waitForTimeout(400);

  // 8) 분 select (10분 단위)
  await page.selectOption('select.minute_option__Vb3xB', String(targetMinute).padStart(2, '0'));
  await page.waitForTimeout(400);

  // 9) 다이얼로그 내 "발행" 버튼 클릭 (robust)
  await clickDialogPublishBtn(page);

  // 예약 등록 완료 대기
  await page.waitForTimeout(5000);
}

// '작성 중인 글이 있습니다' 팝업이 뜨면 '취소' 클릭 (새 글로 시작)
async function dismissDraftPopup(page) {
  try {
    await page.evaluate(() => {
      document.querySelectorAll('button').forEach(b => {
        if (b.textContent.trim() === '취소' && b.closest('.se-popup-container')) b.click();
      });
    });
  } catch (_) {}
}

// 네이버 에디터 우측 '도움말' 패널 닫기 (테스트 검증됨)
// 닫기 버튼 클릭 시도 → 5초 안에 안 사라지면 CSS 강제 숨김
async function dismissHelpPanel(page) {
  try {
    // 패널이 없으면 건너뜀
    const hasPanel = await page.evaluate(() => {
      const el = document.querySelector('.se-help-title, h1.se-help-title, [class*="help_title"]');
      return el ? el.getBoundingClientRect().height > 0 : false;
    });
    if (!hasPanel) return;

    // 클릭 기록으로 확인된 정확한 닫기 버튼 클래스
    const closeBtn = await page.$('button.se-help-panel-close-button');
    if (closeBtn) {
      await closeBtn.click({ force: true });
    }
    await page.waitForTimeout(600);

    // 패널 사라질 때까지 최대 5초 대기
    for (let i = 0; i < 10; i++) {
      await page.waitForTimeout(500);
      const still = await page.evaluate(() => {
        const el = document.querySelector('.se-help-title, h1.se-help-title, [class*="help_title"]');
        return el ? el.getBoundingClientRect().height > 0 : false;
      });
      if (!still) { console.log('[도움말] 패널 닫힘 확인'); return; }
    }

    // 5초 후에도 남아있으면 CSS 강제 숨김 (se-help-title 부모 컨테이너)
    await page.evaluate(() => {
      const title = document.querySelector('.se-help-title, h1.se-help-title, [class*="help_title"]');
      if (!title) return;
      let el = title.parentElement;
      while (el && el !== document.body) {
        const r = el.getBoundingClientRect();
        if (r.width > 200 && r.height > 200) {
          el.style.setProperty('display', 'none', 'important');
          console.log('[도움말] 강제 숨김:', el.className.slice(0, 60));
          break;
        }
        el = el.parentElement;
      }
    });
    await page.waitForTimeout(300);
  } catch (_) {}
}

async function publishToNaver({ title, content, hashtags, relatedPosts, config, category = 'other', autoPublish = false, images = [], scheduledAt = null, naverCategory = '' }) {
  const naverID = config.naverID || process.env.NAVER_ID;
  const naverPW = config.naverPW || process.env.NAVER_PW;

  if (!naverID || !naverPW) throw new Error('네이버 아이디/비밀번호가 설정되지 않았습니다.');

  const browser = await chromium.launch({
    headless: false,
    slowMo: 20,
    channel: 'chrome',
    args: ['--disable-blink-features=AutomationControlled'],
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

  // ── Step 0: 도움말 패널 + 작성 중인 글 팝업 닫기 ──
  await dismissHelpPanel(page);
  await dismissDraftPopup(page);
  await page.waitForTimeout(800);

  // ── Step 1: 제목 입력 ──
  const titleEl = await page.$('.se-title-text');
  if (titleEl) {
    await titleEl.scrollIntoViewIfNeeded();
    await titleEl.click();
    await page.waitForTimeout(500);
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(200);
    for (const char of title) {
      await page.keyboard.type(char);
      await page.waitForTimeout(20 + Math.floor(Math.random() * 30));
    }
  }

  await page.waitForTimeout(800);

  // ── Step 2: 본문 영역으로 이동 ──
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);

  // ── Step 2-1: 본문 가운데 정렬 — 항상 적용 (1회 설정으로 이후 전체 본문 자동 적용) ──
  await applyAlign(page, 'center');
  await page.waitForTimeout(400);

  // ── Step 3: 본문 입력 (이미지 마커 포함) ──
  await typeContentWithMarkers(page, content, images);

  // ── Step 4: 커서를 끝으로 ──
  await page.keyboard.press('Control+End');
  await page.waitForTimeout(200);

  // ── Step 5: 해시태그 ──
  await typeHashtags(page, hashtags);

  // ── Step 6: 관련 글 ──
  await typeRelatedPosts(page, relatedPosts);

  // ── Step 7: 발행 분기 — 예약 발행 / 즉시 자동 발행 / 수동 (브라우저 열린 채로) ──
  if (scheduledAt) {
    await page.waitForTimeout(1500);
    await autoFinalizeScheduledPublish(page, scheduledAt, naverCategory);
  } else if (autoPublish) {
    await page.waitForTimeout(1500);
    await autoFinalizePublish(page);
  }
}

module.exports = { publishToNaver };
