const cron = require('node-cron');
const { Notification } = require('electron');
const { loadConfig } = require('./config');
const {
  getPostsToCheck, updatePostPerformance, saveLearningData,
  savePost, updatePostStatus, getRelatedPosts,
} = require('./db/database');
const { checkPostPerformance } = require('./playwright/tracker');
const { detectTitlePattern, calculatePerformanceScore, getLearningBoost } = require('./ai/learner');
const { fetchTrendingKeywords } = require('./keywords/trending');
const { generatePost } = require('./ai/writer');
const { analyzeKeyword } = require('./keywords/analyzer');
const { publishToNaver } = require('./playwright/publisher');

const SLOT_DEFAULTS = {
  morning: { category: 'daily',   style: 'emotional' },
  lunch:   { category: 'economy', style: 'informative' },
  evening: { category: 'recipe',  style: 'emotional' },
};

let performanceJob = null;
let autoPublishJobs = [];
let autoModeEnabled = false;

function parseTime(timeStr) {
  const parts = (timeStr || '').split(':').map(Number);
  const hour   = isNaN(parts[0]) ? 9  : parts[0];
  const minute = isNaN(parts[1]) ? 0  : parts[1];
  return { hour, minute };
}

function notify(title, body) {
  try { new Notification({ title, body }).show(); } catch (_) {}
}

// ─── Public API ─────────────────────────────────────────────────────────────

function startScheduler() {
  // Performance check at 10:00 AM daily
  performanceJob = cron.schedule('0 10 * * *', async () => {
    console.log('[Scheduler] Running daily performance check...');
    await runPerformanceCheck();
  });

  const config = loadConfig();
  if (config.autoMode) startAutoPublish();

  console.log('[Scheduler] Started.');
}

function startAutoPublish() {
  stopAutoPublish();

  const config = loadConfig();
  const slots = [
    {
      name: 'morning',
      time: config.morningTime || '09:00',
      category: config.morningCategory || SLOT_DEFAULTS.morning.category,
      style:    SLOT_DEFAULTS.morning.style,
    },
    {
      name: 'lunch',
      time: config.lunchTime || '12:00',
      category: config.lunchCategory || SLOT_DEFAULTS.lunch.category,
      style:    SLOT_DEFAULTS.lunch.style,
    },
    {
      name: 'evening',
      time: config.eveningTime || '18:00',
      category: config.eveningCategory || SLOT_DEFAULTS.evening.category,
      style:    SLOT_DEFAULTS.evening.style,
    },
  ];

  for (const slot of slots) {
    const { hour, minute } = parseTime(slot.time);
    const job = cron.schedule(`${minute} ${hour} * * *`, async () => {
      // Random delay 0–20 min to avoid robot-like exact timing
      const delayMs = Math.floor(Math.random() * 20 * 60 * 1000);
      console.log(`[Scheduler] ${slot.name} triggered — waiting ${Math.round(delayMs / 60000)}min`);
      await new Promise(r => setTimeout(r, delayMs));
      await runAutoPublish(slot.category, slot.style);
    });
    autoPublishJobs.push(job);
    console.log(`[Scheduler] Auto-publish set: ${slot.name} ${slot.time} → ${slot.category}`);
  }

  autoModeEnabled = true;
}

function stopAutoPublish() {
  autoPublishJobs.forEach(j => j.stop());
  autoPublishJobs = [];
  autoModeEnabled = false;
}

function getSchedulerStatus() {
  const config = loadConfig();
  return {
    autoMode:        autoModeEnabled,
    morningTime:     config.morningTime     || '09:00',
    lunchTime:       config.lunchTime       || '12:00',
    eveningTime:     config.eveningTime     || '18:00',
    morningCategory: config.morningCategory || SLOT_DEFAULTS.morning.category,
    lunchCategory:   config.lunchCategory   || SLOT_DEFAULTS.lunch.category,
    eveningCategory: config.eveningCategory || SLOT_DEFAULTS.evening.category,
  };
}

// ─── Auto-publish core ───────────────────────────────────────────────────────

async function runAutoPublish(category, style = 'emotional') {
  console.log(`[Scheduler] Auto-publishing — category:${category} style:${style}`);
  let postId = null;

  try {
    const config = loadConfig();

    // 1. Trending keyword
    const { keywords } = await fetchTrendingKeywords();
    const catKeywords = keywords.filter(k => k.category === category);
    const picked = catKeywords[0] || keywords[0];
    const subject = picked?.keyword || '오늘의 이야기';

    // 2. Related keyword analysis
    const { lsi, longtail } = await analyzeKeyword(subject);
    const relatedKeywords = [...longtail, ...lsi].slice(0, 6);
    const learningBoost = getLearningBoost(category);

    // 3. Generate post
    const { title, content, hashtags } = await generatePost(
      subject, '', style, category, learningBoost, relatedKeywords
    );

    // 4. Save → 'scheduled'
    postId = savePost({ subject, style, category, title, content, hashtags, status: 'scheduled' });

    // 5. Publish (완전자동 모드 — autoPublish: true로 발행 버튼까지 자동 클릭)
    const relatedPosts = getRelatedPosts(category, postId);
    await publishToNaver({ title, content, hashtags, relatedPosts, config, category, autoPublish: true });

    // 6. Done
    updatePostStatus(postId, 'published');
    console.log(`[Scheduler] ✅ Published: "${title}"`);
    notify('블로그 자동 발행 완료', `"${title}" 발행되었습니다.`);

  } catch (err) {
    console.error('[Scheduler] ❌ Auto-publish failed:', err.message);
    if (postId) updatePostStatus(postId, 'failed');
    notify('블로그 자동 발행 실패', err.message.slice(0, 80));
  }
}

// ─── Performance check ───────────────────────────────────────────────────────

async function runPerformanceCheck() {
  const config = loadConfig();
  const posts = getPostsToCheck();
  if (!posts.length) { console.log('[Scheduler] No posts to check.'); return; }

  console.log(`[Scheduler] Checking ${posts.length} post(s)...`);
  for (const post of posts) {
    try {
      const { views, likes } = await checkPostPerformance(post.naver_url, config);
      const score = calculatePerformanceScore(views, likes);
      updatePostPerformance(post.id, views, likes, score);
      saveLearningData({
        category: post.category || 'other',
        subject: post.subject,
        title: post.title,
        titlePattern: detectTitlePattern(post.title),
        style: post.style,
        views, likes, score,
      });
      console.log(`[Scheduler] Post ${post.id} — views:${views} likes:${likes} score:${score}`);
    } catch (err) {
      console.error(`[Scheduler] Check failed for post ${post.id}:`, err.message);
    }
  }
}

module.exports = {
  startScheduler,
  startAutoPublish,
  stopAutoPublish,
  runAutoPublish,
  runPerformanceCheck,
  getSchedulerStatus,
};
