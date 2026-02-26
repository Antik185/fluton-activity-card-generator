const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'database_time.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error connecting to time database', err.message);
    } else {
        console.log('Connected to the SQLite time database.');
        initDb();
    }
});

function initDb() {
    db.serialize(() => {
        // Add column if not exists
        db.run("ALTER TABLE user_daily_activity ADD COLUMN x_replies INTEGER DEFAULT 0", () => { });
        // Daily Activity Table
        db.run(`
            CREATE TABLE IF NOT EXISTS user_daily_activity (
                user_id TEXT,
                date TEXT,
                discord_messages INTEGER DEFAULT 0,
                x_posts INTEGER DEFAULT 0,
                x_likes INTEGER DEFAULT 0,
                x_reposts INTEGER DEFAULT 0,
                x_views INTEGER DEFAULT 0,
                x_replies INTEGER DEFAULT 0,
                PRIMARY KEY (user_id, date)
            )
        `);

        db.run(`CREATE INDEX IF NOT EXISTS idx_date ON user_daily_activity(date)`);

        console.log('Time database schema initialized.');
    });
}

module.exports = db;
