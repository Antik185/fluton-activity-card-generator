const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const db = new sqlite3.Database('database.sqlite');
const dbTime = new sqlite3.Database('database_time.sqlite');

async function debugData() {
    console.log("Checking Top 5 Users in database.sqlite (users table):");
    db.all("SELECT id, username, nickname, discord_messages, x_posts FROM users ORDER BY discord_messages DESC LIMIT 5", (err, rows) => {
        if (err) console.error(err);
        else console.table(rows);

        console.log("\nChecking same Users in database_time.sqlite (user_daily_activity table - SUM):");
        const ids = rows.map(r => `'${r.id}'`).join(',');
        dbTime.all(`SELECT user_id, SUM(discord_messages) as total_dc, SUM(x_posts) as total_x FROM user_daily_activity WHERE user_id IN (${ids}) GROUP BY user_id`, (err, timeRows) => {
            if (err) console.error(err);
            else console.table(timeRows);

            console.log("\nChecking Monthly (30 days) for these users in database_time.sqlite:");
            dbTime.all(`SELECT user_id, SUM(discord_messages) as month_dc, SUM(x_posts) as month_x FROM user_daily_activity WHERE user_id IN (${ids}) AND date >= DATE('now', '-30 days') GROUP BY user_id`, (err, monthRows) => {
                if (err) console.error(err);
                else console.table(monthRows);

                db.close();
                dbTime.close();
            });
        });
    });
}

debugData();
