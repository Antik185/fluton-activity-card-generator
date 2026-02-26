const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');

async function backupAndReset() {
    const db = new sqlite3.Database('database.sqlite');

    console.log("Backing up X metrics...");
    db.all("SELECT * FROM x_posts", (err, rows) => {
        if (err || !rows) {
            console.log("No X data to backup or error:", err);
            return;
        }
        fs.writeFileSync('x_metrics_backup.json', JSON.stringify(rows));
        console.log(`Saved ${rows.length} X posts metrics.`);
        db.close();
    });
}

backupAndReset();
