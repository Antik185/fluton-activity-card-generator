const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('database.sqlite');

const encryptedRole = { id: '1462782665777217630', name: 'Encrypted', color: '#965F7F', position: 25 };
const targets = [
    'lihthooi', 'akashranjan7', 'dwiindro', 'setiawan7925', 'tarasheviuk',
    'nabapu', 'tandung5850', 'kings412.', 'cp.jack', 'hieunguyen173',
    'kadriweee', 'rooh0222', 'nikyshamagicsquare', 'tuongotchinsu1',
    'gunz166', 'frhakii', 'klayfouly0770', 'aicrypto_'
];

const placeholders = targets.map(() => '?').join(',');
db.all('SELECT id, username, roles FROM users WHERE username IN (' + placeholders + ')', targets, (err, rows) => {
    if (err) { console.error(err); return; }

    const found = rows.map(r => r.username);
    const notFound = targets.filter(t => !found.includes(t));
    if (notFound.length) console.log('NOT FOUND:', notFound.join(', '));

    let pending = rows.length;
    if (pending === 0) { db.close(); return; }

    rows.forEach(row => {
        let roles = [];
        try { roles = JSON.parse(row.roles) || []; } catch (e) {}

        const hasEncrypted = roles.some(r => r.id === '1462782665777217630');
        if (hasEncrypted) {
            console.log(row.username + ': already has Encrypted');
            if (--pending === 0) db.close();
            return;
        }

        // Insert at front (position 25 = highest)
        roles.unshift(encryptedRole);
        db.run('UPDATE users SET roles = ? WHERE id = ?', [JSON.stringify(roles), row.id], function (upErr) {
            if (upErr) console.error(row.username, upErr.message);
            else console.log(row.username + ': assigned Encrypted (' + roles.length + ' roles total)');
            if (--pending === 0) db.close();
        });
    });
});
