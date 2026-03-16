const Database = require('better-sqlite3');
const path = require('path');

const dbPath = process.env.DATABASE_PATH || path.join(__dirname, 'data.db');
const db = new Database(dbPath, { verbose: console.log });

// Initialize database schema
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    is_pro BOOLEAN DEFAULT 0,
    email_verified BOOLEAN DEFAULT 0,
    verification_token TEXT,
    batch_processes INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// Migration: add new columns if they don't exist (for existing databases)
try { db.exec(`ALTER TABLE users ADD COLUMN email_verified BOOLEAN DEFAULT 0`); } catch(e) { /* column already exists */ }
try { db.exec(`ALTER TABLE users ADD COLUMN verification_token TEXT`); } catch(e) { /* column already exists */ }

// Auto-verify existing users
db.exec(`UPDATE users SET email_verified = 1 WHERE email_verified = 0 AND is_pro = 1`);

module.exports = db;
