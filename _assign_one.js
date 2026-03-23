const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('database.sqlite');
const encryptedRole = { id: '1462782665777217630', name: 'Encrypted', color: '#965F7F', position: 25 };

db.get("SELECT id, username, roles FROM users WHERE username = 'kyzia772'", (e, r) => {
    if (!r) { console.log('NOT FOUND'); db.close(); return; }
    let roles = [];
    try { roles = JSON.parse(r.roles) || []; } catch (_) {}
    if (roles.some(x => x.id === '1462782665777217630')) {
        console.log('already has Encrypted'); db.close(); return;
    }
    roles.unshift(encryptedRole);
    db.run('UPDATE users SET roles = ? WHERE id = ?', [JSON.stringify(roles), r.id], function (err) {
        if (err) console.error(err.message);
        else console.log('kyzia772: assigned Encrypted (' + roles.length + ' roles total)');
        db.close();
    });
});
