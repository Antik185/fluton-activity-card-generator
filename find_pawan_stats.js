const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath);

const timeDbPath = path.join(__dirname, 'database_time.sqlite');
const timeDb = new sqlite3.Database(timeDbPath);

const username = 'pawan429';

db.all(`SELECT * FROM users WHERE username LIKE ? OR nickname LIKE ?`, [`%${username}%`, `%${username}%`], (err, users) => {
    if (err) {
        console.error(err);
        return;
    }
    if (users.length === 0) {
        console.log(`User ${username} not found.`);
        return;
    }
    console.log(`Found users:`, users);
    const userId = users[0].id;
    console.log(`Querying time database for userID: ${userId}`);

    // February is 02. The year is 2026.
    timeDb.all(`SELECT date, discord_messages FROM user_daily_activity WHERE user_id = ? AND date LIKE '2026-02-%'`, [userId], (err, rows) => {
        if (err) {
            console.error(err);
            return;
        }
        let total = 0;
        rows.forEach(row => {
            total += row.discord_messages || 0;
        });
        console.log(`User ${username} messages in February 2026: ${total}`);
        if (rows.length > 0) {
            console.log(`Data rows:`, rows);
        }
    });

    db.close();
    timeDb.close();
});
