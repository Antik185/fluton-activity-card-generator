/**
 * Remove Early role from all users who appeared in the new JSON export.
 * Server did a global Early role purge; new JSON reflects the post-purge state.
 */
const fs = require('fs'), path = require('path');
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('database.sqlite');
const EARLY_ID = '1460369693725687926';
const folder = 'json/23.03-29.03';

// Collect all user IDs seen in the new JSON
const files = fs.readdirSync(folder).filter(f => f.endsWith('.json'));
const seenIds = new Set();
files.forEach(file => {
    const data = JSON.parse(fs.readFileSync(path.join(folder, file), 'utf8'));
    const msgs = data.messages || data;
    if (Array.isArray(msgs)) msgs.forEach(m => {
        if (m.author && !m.author.isBot) seenIds.add(m.author.id);
    });
});
console.log('Users seen in new JSON:', seenIds.size);

// Fetch their DB rows and remove Early if present
const ids = [...seenIds];
const placeholders = ids.map(() => '?').join(',');
db.all('SELECT id, roles FROM users WHERE id IN (' + placeholders + ')', ids, (err, rows) => {
    const toUpdate = rows.filter(r => {
        try { return JSON.parse(r.roles || '[]').some(x => x.id === EARLY_ID); } catch (_) { return false; }
    });
    console.log('Have Early in DB:', toUpdate.length);
    if (!toUpdate.length) { console.log('Nothing to do.'); db.close(); return; }

    let done = 0;
    db.serialize(() => {
        db.run('BEGIN TRANSACTION');
        toUpdate.forEach(row => {
            let roles = [];
            try { roles = JSON.parse(row.roles); } catch (_) {}
            const newRoles = roles.filter(r => r.id !== EARLY_ID);
            db.run('UPDATE users SET roles = ? WHERE id = ?', [JSON.stringify(newRoles), row.id], () => {
                if (++done === toUpdate.length) {
                    db.run('COMMIT', () => {
                        console.log('Early role removed from', done, 'users.');
                        db.close();
                    });
                }
            });
        });
    });
});
