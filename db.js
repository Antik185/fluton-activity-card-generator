const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error connecting to database', err.message);
    } else {
        console.log('Connected to the SQLite database.');
        initDb();
    }
});

function initDb() {
    db.serialize(() => {
        // Users table
        db.run(`
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                username TEXT,
                nickname TEXT,
                avatar_url TEXT,
                roles TEXT,
                discord_messages INTEGER DEFAULT 0,
                x_posts INTEGER DEFAULT 0,
                total_points INTEGER DEFAULT 0
            )
        `);

        // Known X posts to avoid duplicates
        // We will store the full URL or just the status ID.
        db.run(`
            CREATE TABLE IF NOT EXISTS x_posts (
                url TEXT PRIMARY KEY,
                user_id TEXT,
                timestamp TEXT,
                FOREIGN KEY(user_id) REFERENCES users(id)
            )
        `);
        
        console.log('Database schema initialized.');
    });
}

module.exports = db;
