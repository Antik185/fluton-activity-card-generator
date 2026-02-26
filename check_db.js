const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('database.sqlite', sqlite3.OPEN_READONLY);

db.all("SELECT name FROM sqlite_master WHERE type='table'", (err, rows) => {
    if (err) console.error(err);
    else console.log("Tables:", rows.map(r => r.name).join(', '));
    db.close();
});
