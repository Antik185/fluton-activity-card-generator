const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./database.sqlite');

const userId = '335358847013224450'; // makssay_crypto

console.log("=== User record ===");
db.get("SELECT * FROM users WHERE id = ?", [userId], (err, row) => {
    if (err) console.error(err);
    else console.log(row);

    console.log("\n=== X Posts in x_posts table ===");
    db.all("SELECT * FROM x_posts WHERE user_id = ?", [userId], (err, rows) => {
        if (err) console.error(err);
        else {
            console.log("Total x_posts records:", rows.length);
            rows.forEach(r => console.log(r));
        }
        db.close();
    });
});
