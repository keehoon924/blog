const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
require('dotenv').config(); // dev용 — 패키징 후엔 config.json에서 로드

const { initDB, savePost, getPosts, getPost, updatePostStatus, updatePostNaverUrl, getPostsToCheck } = require('./db/database');
const { generatePost } = require('./ai/writer');
const { humanizePost } = require('./ai/humanizer');
const { getLearningBoost } = require('./ai/learner');
const { analyzeKeyword } = require('./keywords/analyzer');
const { publishToNaver } = require('./playwright/publisher');
const { loadConfig, saveConfig } = require('./config');
const { startScheduler, startAutoPublish, stopAutoPublish, runAutoPublish, runPerformanceCheck, getSchedulerStatus } = require('./scheduler');
const { generateImage } = require('./ai/imageGen');
const { fetchTrendingKeywords } = require('./keywords/trending');
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

ipcMain.handle('post:generate', async (event, { subject, perspective, style, category }) => {
  try {
    const learningBoost = getLearningBoost(category || 'other');
    const { lsi, longtail } = await analyzeKeyword(subject);
    const relatedKeywords = [...longtail, ...lsi].slice(0, 6);
    const result = await generatePost(subject, perspective || '', style, category || 'other', learningBoost, relatedKeywords);
    return { success: true, data: result, relatedKeywords };
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
