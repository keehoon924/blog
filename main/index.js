const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
require('dotenv').config();

const { initDB, savePost, getPosts, getPost, updatePostStatus, updatePostNaverUrl, getPostsToCheck } = require('./db/database');
const { generatePost } = require('./ai/writer');
const { humanizePost } = require('./ai/humanizer');
const { getLearningBoost } = require('./ai/learner');
const { publishToNaver } = require('./playwright/publisher');
const { loadConfig, saveConfig } = require('./config');
const { startScheduler, runPerformanceCheck } = require('./scheduler');

let mainWindow;

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

ipcMain.handle('post:generate', async (event, { keyword, style, category }) => {
  try {
    const learningBoost = getLearningBoost(category || 'other');
    const result = await generatePost(keyword, style, category || 'other', learningBoost);
    return { success: true, data: result };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('post:humanize', async (event, { title, content }) => {
  try {
    const result = await humanizePost(title, content);
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
    await publishToNaver({ title, content, hashtags, relatedPosts, config });
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

ipcMain.handle('performance:check-now', async () => {
  try {
    await runPerformanceCheck();
    return { success: true };
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
