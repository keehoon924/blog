const { getLearningData, getTopPerformingPosts } = require('../db/database');

function detectTitlePattern(title) {
  if (/\d+가지|\d+개|\d+번/.test(title)) return 'number';
  if (/인 줄|인줄|알았는데|줄 알았/.test(title)) return 'reversal';
  if (/저도|몰랐는데|알고 나서/.test(title)) return 'empathy';
  if (/왜|어떻게|알아봤/.test(title)) return 'question';
  if (/해봤는데|했는데|결과/.test(title)) return 'result';
  return 'other';
}

function calculatePerformanceScore(views, likes) {
  // Weighted score: likes count more than views
  return views * 1 + likes * 10;
}

function getLearningBoost(category) {
  try {
    const topPosts = getTopPerformingPosts(category, 5);
    if (!topPosts || topPosts.length < 2) return '';

    const insights = [];

    // Analyze title patterns
    const patternCounts = {};
    topPosts.forEach(p => {
      const pattern = p.title_pattern || 'other';
      patternCounts[pattern] = (patternCounts[pattern] || 0) + p.score;
    });
    const topPattern = Object.entries(patternCounts).sort((a, b) => b[1] - a[1])[0];
    if (topPattern && topPattern[0] !== 'other') {
      const patternNames = {
        number: '숫자형 ("N가지", "N개")',
        reversal: '반전형 ("인 줄 알았는데")',
        empathy: '공감형 ("저도 몰랐는데")',
        question: '의문형 ("왜", "어떻게")',
        result: '결과형 ("해봤는데")',
      };
      insights.push(`이 카테고리에서 ${patternNames[topPattern[0]] || topPattern[0]} 제목이 가장 높은 성과를 냈습니다. 이 패턴을 우선 사용하세요.`);
    }

    // Analyze style preference
    const styleCounts = { emotional: 0, informative: 0 };
    topPosts.forEach(p => {
      if (p.style) styleCounts[p.style] = (styleCounts[p.style] || 0) + p.score;
    });
    const topStyle = Object.entries(styleCounts).sort((a, b) => b[1] - a[1])[0];
    if (topStyle && topStyle[1] > 0) {
      const styleName = topStyle[0] === 'emotional' ? '감성적 문체' : '정보 전달형 문체';
      insights.push(`이 카테고리에서 ${styleName}가 더 좋은 반응을 얻었습니다.`);
    }

    // Top keywords
    const keywordScores = {};
    topPosts.forEach(p => {
      if (p.keyword) {
        keywordScores[p.keyword] = (keywordScores[p.keyword] || 0) + p.score;
      }
    });
    const topKeywords = Object.entries(keywordScores).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k);
    if (topKeywords.length > 0) {
      insights.push(`잘 된 글의 키워드: "${topKeywords.join('", "')}" — 이런 주제와 연관지어 쓰면 좋습니다.`);
    }

    return insights.length > 0 ? insights.join('\n') : '';
  } catch {
    return '';
  }
}

module.exports = { detectTitlePattern, calculatePerformanceScore, getLearningBoost };
