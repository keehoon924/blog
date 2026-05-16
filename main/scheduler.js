const cron = require('node-cron');
const { loadConfig } = require('./config');
const { getPostsToCheck, updatePostPerformance, saveLearningData } = require('./db/database');
const { checkPostPerformance } = require('./playwright/tracker');
const { detectTitlePattern, calculatePerformanceScore } = require('./ai/learner');

let scheduledPublishJobs = [];

function startScheduler() {
  // Check performance of posts published 3+ days ago — runs daily at 10am
  cron.schedule('0 10 * * *', async () => {
    console.log('[Scheduler] Running daily performance check...');
    await runPerformanceCheck();
  });

  console.log('[Scheduler] Started. Daily performance check at 10:00 AM.');
}

async function runPerformanceCheck() {
  const config = loadConfig();
  const postsToCheck = getPostsToCheck();

  if (postsToCheck.length === 0) {
    console.log('[Scheduler] No posts to check.');
    return;
  }

  console.log(`[Scheduler] Checking performance for ${postsToCheck.length} post(s)...`);

  for (const post of postsToCheck) {
    try {
      const { views, likes } = await checkPostPerformance(post.naver_url, config);
      const score = calculatePerformanceScore(views, likes);

      updatePostPerformance(post.id, views, likes, score);

      saveLearningData({
        category: post.category || 'other',
        keyword: post.keyword,
        title: post.title,
        titlePattern: detectTitlePattern(post.title),
        style: post.style,
        views,
        likes,
        score,
      });

      console.log(`[Scheduler] Post ${post.id} — views: ${views}, likes: ${likes}, score: ${score}`);
    } catch (err) {
      console.error(`[Scheduler] Failed to check post ${post.id}:`, err.message);
    }
  }
}

// Schedule a one-time publish job (for fully-automatic mode, Stage 3)
function schedulePublish(postId, publishAt, publishFn) {
  const delay = new Date(publishAt).getTime() - Date.now();
  if (delay <= 0) return;

  const randomOffset = (Math.random() - 0.5) * 20 * 60 * 1000; // ±10 minutes
  const finalDelay = Math.max(delay + randomOffset, 60000);

  const timer = setTimeout(() => publishFn(postId), finalDelay);
  scheduledPublishJobs.push({ postId, timer });
  console.log(`[Scheduler] Post ${postId} scheduled in ${Math.round(finalDelay / 60000)} minutes.`);
}

function cancelScheduledPublish(postId) {
  scheduledPublishJobs = scheduledPublishJobs.filter(job => {
    if (job.postId === postId) {
      clearTimeout(job.timer);
      return false;
    }
    return true;
  });
}

module.exports = { startScheduler, runPerformanceCheck, schedulePublish, cancelScheduledPublish };
