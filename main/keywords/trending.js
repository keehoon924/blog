const axios = require('axios');

const KEYWORD_POOL = [
  { name: '아침루틴', category: 'daily' },
  { name: '번아웃극복', category: 'daily' },
  { name: '워라밸', category: 'daily' },
  { name: '미니멀라이프', category: 'daily' },
  { name: '혼자만의시간', category: 'daily' },
  { name: '에어프라이어요리', category: 'recipe' },
  { name: '다이어트식단', category: 'recipe' },
  { name: '간단요리', category: 'recipe' },
  { name: '밀프렙', category: 'recipe' },
  { name: '성수동맛집', category: 'restaurant' },
  { name: '홍대맛집', category: 'restaurant' },
  { name: '강남맛집', category: 'restaurant' },
  { name: '재테크입문', category: 'economy' },
  { name: '주식초보', category: 'economy' },
  { name: '적금추천', category: 'economy' },
  { name: '자기계발책', category: 'book' },
  { name: '베스트셀러', category: 'book' },
  { name: '전기차추천', category: 'car' },
  { name: '중고차구매', category: 'car' },
  { name: '강아지훈련', category: 'pet' },
  { name: '고양이음식', category: 'pet' },
  { name: '손흥민', category: 'sports' },
  { name: '헬스루틴', category: 'sports' },
  { name: '혼자여행', category: 'other' },
  { name: '절약생활', category: 'other' },
];

const SAMPLE_KEYWORDS = [
  { keyword: '아침루틴', category: 'daily' },
  { keyword: '번아웃극복', category: 'daily' },
  { keyword: '워라밸', category: 'daily' },
  { keyword: '재테크입문', category: 'economy' },
  { keyword: '적금추천', category: 'economy' },
  { keyword: '에어프라이어요리', category: 'recipe' },
  { keyword: '다이어트식단', category: 'recipe' },
  { keyword: '강남맛집', category: 'restaurant' },
  { keyword: '자기계발책', category: 'book' },
  { keyword: '전기차추천', category: 'car' },
  { keyword: '강아지훈련', category: 'pet' },
  { keyword: '손흥민', category: 'sports' },
  { keyword: '헬스루틴', category: 'sports' },
  { keyword: '혼자여행', category: 'other' },
  { keyword: '절약생활', category: 'other' },
];

// 메모리 캐시 (2시간)
let cache = null;
let cacheTime = 0;
const CACHE_TTL = 2 * 60 * 60 * 1000;

async function fetchTrendingKeywords(forceRefresh = false) {
  const clientId = process.env.NAVER_DATALAB_CLIENT_ID;
  const clientSecret = process.env.NAVER_DATALAB_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return { keywords: SAMPLE_KEYWORDS, source: 'sample' };
  }

  if (!forceRefresh && cache && Date.now() - cacheTime < CACHE_TTL) {
    return { keywords: cache, source: 'cache' };
  }

  const today = new Date();
  const endDate = today.toISOString().slice(0, 10);
  const startDate = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const results = [];
  const BATCH_SIZE = 5;

  for (let i = 0; i < KEYWORD_POOL.length; i += BATCH_SIZE) {
    const batch = KEYWORD_POOL.slice(i, i + BATCH_SIZE);
    try {
      const res = await axios.post(
        'https://openapi.naver.com/v1/datalab/search',
        {
          startDate,
          endDate,
          timeUnit: 'date',
          keywordGroups: batch.map(k => ({ groupName: k.name, keywords: [k.name] })),
        },
        {
          headers: {
            'X-Naver-Client-Id': clientId,
            'X-Naver-Client-Secret': clientSecret,
            'Content-Type': 'application/json',
          },
          timeout: 10000,
        }
      );

      (res.data.results || []).forEach((item, j) => {
        const kw = batch[j];
        if (!kw) return;
        const data = item?.data || [];
        const recent = data.slice(-3).reduce((s, d) => s + (d.ratio || 0), 0) / 3;
        const overall = data.reduce((s, d) => s + (d.ratio || 0), 0) / (data.length || 1);
        results.push({
          keyword: kw.name,
          category: kw.category,
          score: recent,
          trend: overall > 0 ? recent / overall : 0,
        });
      });
    } catch (err) {
      console.error(`DataLab 배치 실패 (${i}):`, err.message);
    }

    if (i + BATCH_SIZE < KEYWORD_POOL.length) {
      await new Promise(r => setTimeout(r, 300));
    }
  }

  if (results.length === 0) {
    return { keywords: SAMPLE_KEYWORDS, source: 'sample' };
  }

  const keywords = results
    .sort((a, b) => b.trend - a.trend)
    .slice(0, 15)
    .map(r => ({ keyword: r.keyword, category: r.category }));

  cache = keywords;
  cacheTime = Date.now();
  return { keywords, source: 'datalab' };
}

module.exports = { fetchTrendingKeywords };
