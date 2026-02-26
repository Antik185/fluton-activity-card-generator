const sqlite3 = require('sqlite3').verbose();
const dbTime = new sqlite3.Database('database_time.sqlite');

dbTime.serialize(() => {
    console.log("Cleaning up user_daily_activity to prevent doubled data...");
    dbTime.run("DELETE FROM user_daily_activity", (err) => {
        if (err) console.error(err);
        else console.log("✅ Daily activity table cleared.");
        dbTime.close();
    });
});
