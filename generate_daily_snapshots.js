const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

const dbTimePath = path.join(__dirname, 'database_time.sqlite');
const dbTime = new sqlite3.Database(dbTimePath, sqlite3.OPEN_READONLY);
const outPath = path.join(__dirname, 'public', 'data');

async function run() {
    console.log("Generating daily snapshots...");

    dbTime.run("ATTACH DATABASE 'database.sqlite' AS mainDb", async (err) => {
        if (err) throw err;

        dbTime.get("SELECT MIN(date) as minDate, MAX(date) as maxDate FROM user_daily_activity", (err, meta) => {
            if (err) throw err;

            const maxDate = meta.maxDate;
            const weekStart = addDays(maxDate, -6);
            const monthStart = maxDate.substring(0, 7) + '-01';

            const output = {
                meta: {
                    maxDate,
                    weekStart,
                    monthStart
                },
                users: {}
            };

            // Only include activity for users that exist in the main database
            // and have some activity in the last 60 days to keep it small
            const sixtyDaysAgo = addDays(maxDate, -60);

            dbTime.all(`
                SELECT u.username, uda.date as d, uda.discord_messages as m
                FROM user_daily_activity uda
                JOIN mainDb.users u ON u.id = uda.user_id
                WHERE uda.date >= ? AND uda.discord_messages > 0
                ORDER BY u.username, uda.date ASC
            `, [sixtyDaysAgo], (err, rows) => {
                if (err) throw err;

                rows.forEach(r => {
                    if (!output.users[r.username]) output.users[r.username] = [];
                    output.users[r.username].push({ d: r.d, m: r.m });
                });

                fs.writeFileSync(path.join(outPath, 'snapshots_daily.json'), JSON.stringify(output));
                console.log(`Generated daily snapshots for ${Object.keys(output.users).length} users.`);
                process.exit(0);
            });
        });
    });
}

function addDays(dateStr, days) {
    const d = new Date(dateStr + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().split('T')[0];
}

run();
