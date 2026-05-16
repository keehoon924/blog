const path = require('path');
const fs = require('fs');
const { app } = require('electron');

let configPath = null;

function getConfigPath() {
  if (!configPath) {
    configPath = path.join(app.getPath('userData'), 'config.json');
  }
  return configPath;
}

function loadConfig() {
  const file = getConfigPath();
  if (fs.existsSync(file)) {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf-8'));
    } catch {
      return {};
    }
  }
  return {};
}

function saveConfig(data) {
  const file = getConfigPath();
  const current = loadConfig();
  fs.writeFileSync(file, JSON.stringify({ ...current, ...data }, null, 2));
}

module.exports = { loadConfig, saveConfig };
