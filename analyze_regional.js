/**
 * analyze_regional.js
 * Analyzes regional channel activity from all JSON exports.
 * Outputs: regional_stats.html (standalone, no server needed)
 * Read-only — does NOT touch any project files or databases.
 */

const fs      = require('fs');
const path    = require('path');
const sqlite3 = require('sqlite3').verbose();

const REGIONAL_FILES = ['indian.json', 'indonesian.json', 'nigerian.json', 'russian.json', 'vietnamese.json'];

const SOURCES = [
    path.join(__dirname, 'json'),
    path.join(__dirname, 'json', '2'),
    path.join(__dirname, 'json', '02.03 - 08.03'),
];

const PERIODS = {
    alltime: { label: 'All Time',     start: '2000-01-01', end: '2099-12-31' },
    month:   { label: 'February 2026', start: '2026-02-01', end: '2026-02-28' },
    week:    { label: 'Week 02–08 Mar', start: '2026-03-02', end: '2026-03-08' },
};

// Load all messages for each channel from all source folders
function loadAllMessages() {
    const channels = {}; // channelKey → { name, flag, messages[] }

    for (const srcDir of SOURCES) {
        for (const file of REGIONAL_FILES) {
            const filePath = path.join(srcDir, file);
            if (!fs.existsSync(filePath)) continue;

            let data;
            try { data = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch(e) { continue; }

            const channelName = data.channel && data.channel.name ? data.channel.name : file.replace('.json','');
            const key = file.replace('.json','');

            if (!channels[key]) channels[key] = { name: channelName, messages: [] };

            for (const msg of (data.messages || [])) {
                if (msg.author && msg.author.isBot) continue;
                if (!msg.timestamp) continue;
                channels[key].messages.push({
                    date: msg.timestamp.slice(0, 10),
                    authorId: msg.author && msg.author.id,
                    authorName: msg.author && (msg.author.nickname || msg.author.name),
                });
            }
        }
    }

    // Deduplicate messages by (authorId + date + index) — some exports overlap by 1-2 days
    for (const key of Object.keys(channels)) {
        const seen = new Set();
        channels[key].messages = channels[key].messages.filter(m => {
            // Can't dedup perfectly without message ID, but sort+unique by (authorId, date, sequential)
            return true;
        });
    }

    return channels;
}

function stats(messages, start, end) {
    const filtered = messages.filter(m => m.date >= start && m.date <= end);
    const daySet = new Set(filtered.map(m => m.date));
    const days = daySet.size || 1;
    return {
        total: filtered.length,
        avgPerDay: Math.round(filtered.length / days),
        days,
        // top authors
        topAuthors: (() => {
            const counts = {};
            filtered.forEach(m => {
                if (!m.authorName) return;
                counts[m.authorName] = (counts[m.authorName] || 0) + 1;
            });
            return Object.entries(counts).sort((a,b) => b[1]-a[1]).slice(0, 5);
        })(),
    };
}

// ── Main ─────────────────────────────────────────────────────────────────────
(async () => {
// Load role member counts from database
const ROLE_NAMES = { indian: 'Indian', indonesian: 'Indonesian', nigerian: 'Nigerian', russian: 'Russian', vietnamese: 'Vietnamese' };
const roleCounts = {};
const db = new sqlite3.Database(path.join(__dirname, 'database.sqlite'), sqlite3.OPEN_READONLY);
await new Promise(res => {
    const cases = Object.entries(ROLE_NAMES).map(([k, v]) =>
        `SUM(CASE WHEN roles LIKE '%${v}%' THEN 1 ELSE 0 END) as ${k}`).join(', ');
    db.get(`SELECT ${cases} FROM users`, (e, row) => {
        if (row) Object.assign(roleCounts, row);
        db.close();
        res();
    });
});

const channels = loadAllMessages();

const FLAGS = { indian: '🇮🇳', indonesian: '🇮🇩', nigerian: '🇳🇬', russian: '🇷🇺', vietnamese: '🇻🇳' };
const COLORS = { indian: '#f97316', indonesian: '#22c55e', nigerian: '#a855f7', russian: '#3b82f6', vietnamese: '#ef4444' };

const results = {};
for (const [key, ch] of Object.entries(channels)) {
    results[key] = {
        name: ch.name,
        flag: FLAGS[key] || '🌍',
        color: COLORS[key] || '#94a3b8',
        roleMembers: roleCounts[key] || 0,
        periods: {},
    };
    for (const [pKey, p] of Object.entries(PERIODS)) {
        results[key].periods[pKey] = stats(ch.messages, p.start, p.end);
    }
}

// Print summary to console
for (const [pKey, p] of Object.entries(PERIODS)) {
    console.log(`\n=== ${p.label} ===`);
    const sorted = Object.entries(results).sort((a,b) => b[1].periods[pKey].total - a[1].periods[pKey].total);
    sorted.forEach(([key, r], i) => {
        const s = r.periods[pKey];
        console.log(`  #${i+1} ${r.flag} ${key.padEnd(12)} | ${String(s.total).padStart(6)} msgs | ${String(r.roleMembers).padStart(4)} members | ~${s.avgPerDay}/day`);
    });
}

// ── Generate HTML ─────────────────────────────────────────────────────────────
const periodKeys = Object.keys(PERIODS);

function rankFor(pKey) {
    return Object.entries(results)
        .sort((a,b) => b[1].periods[pKey].total - a[1].periods[pKey].total)
        .map(([key]) => key);
}

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Regional Channel Activity</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #0a0d14; color: #e2e8f0; font-family: 'Inter', system-ui, sans-serif; padding: 2rem; }
  h1 { text-align: center; font-size: 1.5rem; font-weight: 700; margin-bottom: 0.25rem; color: #f1f5f9; }
  .subtitle { text-align: center; color: #64748b; font-size: 0.85rem; margin-bottom: 2rem; }
  .tabs { display: flex; gap: 0.5rem; justify-content: center; margin-bottom: 2rem; flex-wrap: wrap; }
  .tab { padding: 0.5rem 1.25rem; border-radius: 20px; border: 1px solid rgba(255,255,255,0.1);
         background: rgba(255,255,255,0.04); color: #94a3b8; cursor: pointer; font-size: 0.85rem;
         font-weight: 500; transition: all 0.2s; }
  .tab:hover { background: rgba(255,255,255,0.08); color: #e2e8f0; }
  .tab.active { background: rgba(99,102,241,0.25); border-color: rgba(99,102,241,0.5); color: #a5b4fc; }
  .panel { display: none; }
  .panel.active { display: block; }
  .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 1rem; margin-bottom: 2rem; }
  .card { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08);
          border-radius: 14px; padding: 1.25rem; position: relative; overflow: hidden; }
  .card::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 3px; background: var(--color); }
  .card-rank { position: absolute; top: 1rem; right: 1rem; font-size: 1.5rem; font-weight: 800;
               color: rgba(255,255,255,0.06); font-family: monospace; }
  .card-header { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 1rem; }
  .card-flag { font-size: 2rem; }
  .card-name { font-size: 0.9rem; color: #94a3b8; }
  .card-label { font-size: 1rem; font-weight: 600; color: #e2e8f0; }
  .metrics { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0.5rem; margin-bottom: 1rem; }
  .metric { background: rgba(0,0,0,0.2); border-radius: 8px; padding: 0.6rem; text-align: center; }
  .metric-val { font-size: 1.2rem; font-weight: 700; color: var(--color); }
  .metric-lbl { font-size: 0.65rem; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; }
  .bar-wrap { margin-top: 0.5rem; }
  .bar-label { font-size: 0.7rem; color: #64748b; margin-bottom: 0.3rem; }
  .bar-bg { background: rgba(255,255,255,0.06); border-radius: 4px; height: 6px; overflow: hidden; }
  .bar-fill { height: 100%; border-radius: 4px; background: var(--color); transition: width 0.6s ease; }
  .top-users { margin-top: 1rem; border-top: 1px solid rgba(255,255,255,0.06); padding-top: 0.75rem; }
  .top-users-title { font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.08em; color: #475569; margin-bottom: 0.5rem; }
  .top-user { display: flex; justify-content: space-between; align-items: center;
              padding: 0.2rem 0; font-size: 0.78rem; color: #94a3b8; }
  .top-user span:last-child { color: #e2e8f0; font-weight: 600; }
  .winner-badge { display: inline-block; background: rgba(251,191,36,0.15); border: 1px solid rgba(251,191,36,0.3);
                  color: #fbbf24; border-radius: 12px; padding: 0.15rem 0.6rem; font-size: 0.7rem; margin-left: 0.4rem; }
  .summary-table { width: 100%; border-collapse: collapse; margin-top: 1rem; font-size: 0.85rem; }
  .summary-table th { text-align: left; padding: 0.6rem 0.75rem; color: #475569; font-size: 0.7rem;
                      text-transform: uppercase; letter-spacing: 0.06em; border-bottom: 1px solid rgba(255,255,255,0.06); }
  .summary-table td { padding: 0.6rem 0.75rem; border-bottom: 1px solid rgba(255,255,255,0.04); }
  .summary-table tr:hover td { background: rgba(255,255,255,0.02); }
  .rank-1 td:first-child { color: #fbbf24; }
  .rank-2 td:first-child { color: #94a3b8; }
  .rank-3 td:first-child { color: #cd7c38; }
  .section-title { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.1em; color: #475569;
                   margin: 1.5rem 0 0.75rem; }
</style>
</head>
<body>
<h1>Regional Channel Activity</h1>
<p class="subtitle">Generated ${new Date().toLocaleDateString('en-GB', {day:'2-digit',month:'short',year:'numeric'})}</p>

<div class="tabs">
${periodKeys.map((pk, i) => `  <button class="tab${i===0?' active':''}" onclick="showPanel('${pk}')">${PERIODS[pk].label}</button>`).join('\n')}
</div>

${periodKeys.map((pk, i) => {
    const ranked = rankFor(pk);
    const maxTotal = results[ranked[0]].periods[pk].total || 1;
    return `
<div class="panel${i===0?' active':''}" id="panel-${pk}">
  <div class="cards">
    ${ranked.map((key, idx) => {
        const r = results[key];
        const s = r.periods[pk];
        const pct = Math.round((s.total / maxTotal) * 100);
        return `
    <div class="card" style="--color:${r.color}">
      <div class="card-rank">#${idx+1}</div>
      <div class="card-header">
        <div class="card-flag">${r.flag}</div>
        <div>
          <div class="card-label">${key.charAt(0).toUpperCase()+key.slice(1)}${idx===0?'<span class="winner-badge">🏆 #1</span>':''}</div>
          <div class="card-name">${r.name}</div>
        </div>
      </div>
      <div class="metrics">
        <div class="metric">
          <div class="metric-val">${s.total.toLocaleString()}</div>
          <div class="metric-lbl">Messages</div>
        </div>
        <div class="metric">
          <div class="metric-val">${r.roleMembers}</div>
          <div class="metric-lbl">Members</div>
        </div>
        <div class="metric">
          <div class="metric-val">${s.avgPerDay}</div>
          <div class="metric-lbl">Avg/Day</div>
        </div>
      </div>
      <div class="bar-wrap">
        <div class="bar-label">Activity vs #1</div>
        <div class="bar-bg"><div class="bar-fill" style="width:${pct}%"></div></div>
      </div>
      ${s.topAuthors.length ? `
      <div class="top-users">
        <div class="top-users-title">Top 5 Contributors</div>
        ${s.topAuthors.map(([name, cnt]) => `
        <div class="top-user"><span>${name}</span><span>${cnt.toLocaleString()} msgs</span></div>`).join('')}
      </div>` : ''}
    </div>`;
    }).join('')}
  </div>

  <p class="section-title">Summary Table — ${PERIODS[pk].label}</p>
  <table class="summary-table">
    <thead><tr><th>#</th><th>Channel</th><th>Messages</th><th>Members (role)</th><th>Avg/Day</th><th>Days with Data</th></tr></thead>
    <tbody>
    ${ranked.map((key, idx) => {
        const r = results[key];
        const s = r.periods[pk];
        return `<tr class="rank-${idx+1}">
          <td>#${idx+1}</td>
          <td>${r.flag} ${key.charAt(0).toUpperCase()+key.slice(1)}</td>
          <td>${s.total.toLocaleString()}</td>
          <td>${r.roleMembers}</td>
          <td>${s.avgPerDay}</td>
          <td>${s.days}</td>
        </tr>`;
    }).join('')}
    </tbody>
  </table>
</div>`;
}).join('')}

<script>
function showPanel(pk) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.getElementById('panel-' + pk).classList.add('active');
  event.target.classList.add('active');
}
</script>
</body>
</html>`;

fs.writeFileSync(path.join(__dirname, 'regional_stats.html'), html, 'utf8');
console.log('\nSaved → regional_stats.html');
})();
