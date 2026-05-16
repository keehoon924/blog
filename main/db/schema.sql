CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  keyword TEXT,
  style TEXT,
  category TEXT DEFAULT 'other',
  image_style TEXT,
  title TEXT,
  content TEXT,
  processed_content TEXT,
  hashtags TEXT,
  image_path TEXT,
  naver_url TEXT,
  status TEXT DEFAULT 'draft',
  scheduled_at DATETIME,
  published_at DATETIME,
  views INTEGER DEFAULT 0,
  likes INTEGER DEFAULT 0,
  performance_score REAL DEFAULT 0,
  performance_checked_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS learning_data (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT,
  keyword TEXT,
  title TEXT,
  title_pattern TEXT,
  style TEXT,
  views INTEGER DEFAULT 0,
  likes INTEGER DEFAULT 0,
  score REAL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
