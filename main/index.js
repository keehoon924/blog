const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
require('dotenv').config(); // dev용 — 패키징 후엔 config.json에서 로드

const { initDB, savePost, getPosts, getPost, updatePostStatus, updatePostNaverUrl, getPostsToCheck } = require('./db/database');
const { generatePost, generatePostFreeform } = require('./ai/writer');
const { fetchNaverNews } = require('./keywords/newssearch');
const { fetchNaverContext } = require('./keywords/naversearch');
const { humanizePost } = require('./ai/humanizer');
const { getLearningBoost } = require('./ai/learner');
const { analyzeKeyword } = require('./keywords/analyzer');
const { publishToNaver } = require('./playwright/publisher');
const { loadConfig, saveConfig } = require('./config');
const { startScheduler, startAutoPublish, stopAutoPublish, runAutoPublish, runPerformanceCheck, getSchedulerStatus } = require('./scheduler');
const { generateImage } = require('./ai/imageGen');
const { fetchTrendingKeywords } = require('./keywords/trending');
const { parseContent: parseManualContent } = require('./manual/fileParser');
const { shell } = require('electron');

let mainWindow;

// 설정 파일의 API 키를 process.env로 동기화 (패키징 후 .env 없을 때 필요)
function syncEnvFromConfig() {
  const config = loadConfig();
  if (config.openaiKey)           process.env.OPENAI_API_KEY              = config.openaiKey;
  if (config.datalabClientId)     process.env.NAVER_DATALAB_CLIENT_ID     = config.datalabClientId;
  if (config.datalabClientSecret) process.env.NAVER_DATALAB_CLIENT_SECRET = config.datalabClientSecret;
  if (config.naverID)             process.env.NAVER_ID                    = config.naverID;
  if (config.naverPW)             process.env.NAVER_PW                    = config.naverPW;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: '네이버 블로그 자동화',
    backgroundColor: '#0f172a',
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'dashboard.html'));
}

app.whenReady().then(async () => {
  await initDB();
  syncEnvFromConfig();
  createWindow();
  startScheduler();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('navigate', (event, page) => {
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', `${page}.html`));
  return { success: true };
});

ipcMain.handle('post:generate', async (event, { subject, keyword, userPrompt, perspective, style, category }) => {
  try {
    const learningBoost = getLearningBoost(category || 'other');
    const effectiveKeyword = keyword || subject || '';
    let result;

    const searchContext = effectiveKeyword ? await fetchNaverContext(effectiveKeyword, category || 'other') : '';
    if (userPrompt) {
      result = await generatePostFreeform(userPrompt, category || 'other', searchContext, effectiveKeyword, learningBoost);
    } else {
      const { lsi, longtail } = await analyzeKeyword(effectiveKeyword);
      const relatedKeywords = [...longtail, ...lsi].slice(0, 6);
      result = await generatePost(effectiveKeyword, perspective || '', style, category || 'other', learningBoost, relatedKeywords, searchContext);
    }

    return { success: true, data: result };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('post:humanize', async (event, { title, content, subject }) => {
  try {
    const result = await humanizePost(title, content, subject || '');
    return { success: true, data: result };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('post:save', async (event, postData) => {
  try {
    const id = savePost(postData);
    return { success: true, id };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('post:publish-now', async (event, { postId, title, content, hashtags, category }) => {
  try {
    const config = loadConfig();
    const { getRelatedPosts } = require('./db/database');
    const relatedPosts = postId ? getRelatedPosts(category || 'other', postId) : [];
    await publishToNaver({ title, content, hashtags, relatedPosts, config, category });
    if (postId) updatePostStatus(postId, 'published');
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('post:update-url', (event, { postId, naverUrl }) => {
  try {
    updatePostNaverUrl(postId, naverUrl);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('history:get', () => {
  try {
    const posts = getPosts();
    return { success: true, data: posts };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('settings:save', (event, settings) => {
  try {
    saveConfig(settings);
    syncEnvFromConfig(); // API 키 즉시 반영
    const config = loadConfig();
    if (config.autoMode) startAutoPublish();
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('settings:get', () => {
  try {
    const config = loadConfig();
    return { success: true, data: config };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('scheduler:get-status', () => {
  try {
    return { success: true, data: getSchedulerStatus() };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('scheduler:set-auto-mode', (event, enabled) => {
  try {
    saveConfig({ autoMode: enabled });
    if (enabled) startAutoPublish(); else stopAutoPublish();
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('scheduler:run-now', async (event, { category, style }) => {
  try {
    await runAutoPublish(category || 'daily', style || 'emotional');
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('performance:check-now', async () => {
  try {
    await runPerformanceCheck();
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('image:generate', async (event, { subject, category, style }) => {
  try {
    const result = await generateImage(subject, category || 'other', style || 'blog');
    return { success: true, data: result };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('image:open-folder', () => {
  const dir = path.join(app.getPath('userData'), 'generated-images');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  shell.openPath(dir);
  return { success: true };
});

ipcMain.handle('url:open-external', (event, url) => {
  if (url && (url.startsWith('https://') || url.startsWith('http://'))) {
    shell.openExternal(url);
  }
  return { success: true };
});

ipcMain.handle('keywords:fetch', async (event, { forceRefresh = false } = {}) => {
  try {
    const result = await fetchTrendingKeywords(forceRefresh);
    return { success: true, ...result };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('performance:pending-count', () => {
  try {
    const posts = getPostsToCheck();
    return { success: true, count: posts.length };
  } catch (err) {
    return { success: false, count: 0 };
  }
});

// ── 수동 예약 발행 (manual) ───────────────────────────────────────────────
ipcMain.handle('manual:parse-content', (event, { text, filename }) => {
  try {
    const parsed = parseManualContent(text, filename || '');
    return { success: true, data: parsed };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('manual:select-image', async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '이미지 파일 선택',
      properties: ['openFile'],
      filters: [{ name: '이미지', extensions: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'heic', 'heif', 'webp'] }],
    });
    if (result.canceled || !result.filePaths.length) return { success: false, canceled: true };
    return { success: true, path: result.filePaths[0] };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('manual:publish-all', async (event, { posts }) => {
  const config = loadConfig();
  const results = [];
  for (let i = 0; i < posts.length; i++) {
    const post = posts[i];
    const label = post.filename || `글 ${i + 1}`;
    try {
      // 진행 상황 알림
      event.sender.send('manual:progress', { index: i, total: posts.length, label, status: 'publishing' });
      await publishToNaver({
        title: post.title,
        content: post.body,
        hashtags: post.hashtags,
        relatedPosts: [],
        config,
        category: 'other',
        autoPublish: false,
        images: post.images || [],
        scheduledAt: post.scheduledAt,
      });
      results.push({ filename: label, success: true });
      event.sender.send('manual:progress', { index: i, total: posts.length, label, status: 'done' });
    } catch (err) {
      results.push({ filename: label, success: false, error: err.message });
      event.sender.send('manual:progress', { index: i, total: posts.length, label, status: 'failed', error: err.message });
    }
  }
  return { success: true, results };
});
