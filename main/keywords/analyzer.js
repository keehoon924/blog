const https = require('https');

function fetchJSON(url) {
  return new Promise((resolve) => {
    const req = https.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      timeout: 5000,
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

// 네이버 자동완성 API — 인증 불필요, 무료
async function fetchNaverAutoComplete(keyword) {
  const encoded = encodeURIComponent(keyword);
  const url = `https://ac.search.naver.com/nx/auto-complete?query=${encoded}&target=nv&_callback=&lang=ko`;
  const data = await fetchJSON(url);
  if (!data || !data.items || !data.items[0]) return [];
  return data.items[0].slice(0, 8).map((item) => item[0]);
}

// 연관 키워드를 LSI 키워드로 분류
function classifyKeywords(mainKeyword, relatedList) {
  const main = mainKeyword.toLowerCase();
  const lsi = [];
  const longtail = [];

  for (const kw of relatedList) {
    const lower = kw.toLowerCase();
    if (lower.includes(main) && lower !== main) {
      longtail.push(kw); // 롱테일: 메인 키워드 포함 + 추가 단어
    } else {
      lsi.push(kw); // LSI: 연관 키워드
    }
  }
  return { lsi: lsi.slice(0, 4), longtail: longtail.slice(0, 4) };
}

async function analyzeKeyword(keyword) {
  try {
    const related = await fetchNaverAutoComplete(keyword);
    const { lsi, longtail } = classifyKeywords(keyword, related);
    return { relatedKeywords: related, lsi, longtail };
  } catch {
    return { relatedKeywords: [], lsi: [], longtail: [] };
  }
}

module.exports = { analyzeKeyword };
