const sqlite3 = require('sqlite3').verbose();
const dbMain = new sqlite3.Database('database.sqlite', sqlite3.OPEN_READONLY);
const dbTime = new sqlite3.Database('database_time.sqlite', sqlite3.OPEN_READONLY);

const search = 'nata159';

dbMain.get("SELECT id, username, nickname FROM users WHERE username = ?", [search], (err, user) => {
    if (err) { console.error(err); process.exit(1); }
    if (!user) {
        console.log(`User ${search} not found. Searching for similar...`);
        dbMain.all("SELECT username, id FROM users WHERE username LIKE ?", [`%${search}%`], (err, rows) => {
            console.log('Suggestions:', rows);
            process.exit(0);
        });
        return;
    }

    console.log(`Found User: ${user.username} (ID: ${user.id})`);

    const startDate = '2026-02-11';
    const endDate = '2026-02-18';

    dbTime.all(`
        SELECT date, discord_messages 
        FROM user_daily_activity 
        WHERE user_id = ? AND date >= ? AND date <= ?
        ORDER BY date ASC
    `, [user.id, startDate, endDate], (err, rows) => {
        if (err) { console.error(err); process.exit(1); }

        console.log(`Activity for ${user.username} from ${startDate} to ${endDate}:`);
        let total = 0;
        rows.forEach(r => {
            console.log(`${r.date}: ${r.discord_messages}`);
            total += (r.discord_messages || 0);
        });
        console.log(`---`);
        console.log(`TOTAL: ${total}`);
        process.exit(0);
    });
});
