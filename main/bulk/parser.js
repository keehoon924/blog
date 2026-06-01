/**
 * parser.js — ===글시작=== / ===글끝=== 형식 파일 파서
 *
 * 입력: 파일 전체 텍스트
 * 출력: 글 배열 [ { date, time, category, title, tags, content, scheduledAt } ]
 */

function parsePostFile(text) {
  const posts = [];
  // 공백 유무 모두 허용: ===글시작=== / ===글 시작===
  const blocks = text.split(/===\s*글\s*끝\s*===/);

  for (const block of blocks) {
    const startMatch = block.match(/===\s*글\s*시작\s*===/);
    if (!startMatch) continue;

    const inner = block.slice(startMatch.index + startMatch[0].length);
    // 첫 빈 줄 기준으로 메타데이터 / 본문 분리
    const blankLine = inner.search(/\n\s*\n/);
    if (blankLine === -1) continue;

    const metaRaw = inner.slice(0, blankLine).trim();
    const contentRaw = inner.slice(blankLine).trim();

    const meta = {};
    for (const line of metaRaw.split('\n')) {
      const colonIdx = line.indexOf(':');
      if (colonIdx === -1) continue;
      const key = line.slice(0, colonIdx).trim();
      const val = line.slice(colonIdx + 1).trim();
      switch (key) {
        case '날짜': meta.date = val; break;       // YYYY-MM-DD
        case '시간': meta.time = val; break;       // HH:MM
        case '카테고리': meta.category = val; break;
        case '제목': meta.title = val; break;
        case '태그': meta.tags = val; break;
      }
    }

    // 필수값 체크
    if (!meta.date || !meta.time || !meta.title) continue;

    // scheduledAt: Date 객체 (예약 발행에 사용)
    const [y, m, d] = meta.date.split('-').map(Number);
    const [hh, mm] = meta.time.split(':').map(Number);
    meta.scheduledAt = new Date(y, m - 1, d, hh, mm, 0);

    meta.content = contentRaw;
    meta.tags    = meta.tags || '';
    meta.category = meta.category || '';

    posts.push(meta);
  }

  // 날짜/시간 오름차순 정렬
  posts.sort((a, b) => a.scheduledAt - b.scheduledAt);
  return posts;
}

module.exports = { parsePostFile };
