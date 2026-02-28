/**
 * build_daily_snapshots.js
 * Generates public/data/snapshots_daily.json
 * Format: { meta: {maxDate, weekStart, monthStart}, users: {username: [{d, m}]} }
 * Only the last 60 days are included; only days with messages > 0.
 */

const sqlite3 = require('sqlite3').verbose();
const fs      = require('fs');
const path    = require('path');

const dbTimePath = path.join(__dirname, 'database_time.sqlite');
const dbTime     = new sqlite3.Database(dbTimePath, sqlite3.OPEN_READONLY);
const outPath    = path.join(__dirname, 'public', 'data', 'snapshots_daily.json');

function addDays(dateStr, days) {
    const d = new Date(dateStr + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().split('T')[0];
}

dbTime.run("ATTACH DATABASE 'database.sqlite' AS mainDb", (err) => {
    if (err) { console.error('ATTACH failed:', err); process.exit(1); }

    dbTime.get('SELECT MAX(date) as maxDate FROM user_daily_activity', (err, row) => {
        if (err) { console.error(err); process.exit(1); }

        const maxDate    = row.maxDate;
        const startDate  = addDays(maxDate, -59); // last 60 days
        const weekStart  = addDays(maxDate, -6);  // 7-day window ending maxDate
        const monthStart = maxDate.substring(0, 7) + '-01';

        console.log(`Max date: ${maxDate}, start: ${startDate}`);

        dbTime.all(`
            SELECT u.username, uda.date, uda.discord_messages AS m
            FROM user_daily_activity uda
            LEFT JOIN mainDb.users u ON u.id = uda.user_id
            WHERE uda.date >= ? AND uda.discord_messages > 0
            ORDER BY uda.date ASC
        `, [startDate], (err, rows) => {
            if (err) { console.error(err); process.exit(1); }

            const users = {};
            rows.forEach(r => {
                if (!r.username) return;
                if (!users[r.username]) users[r.username] = [];
                users[r.username].push({ d: r.date, m: r.m });
            });

            const output = {
                meta: { maxDate, weekStart, monthStart },
                users
            };

            fs.writeFileSync(outPath, JSON.stringify(output));
            const userCount = Object.keys(users).length;
            console.log(`Daily snapshots written: ${userCount} users, ${rows.length} records.`);
            process.exit(0);
        });
    });
});
