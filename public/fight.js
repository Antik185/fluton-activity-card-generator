// ===================== FIGHT CARD GENERATOR =====================
// Standalone fight module — reads from existing JSON data files

(function () {
    'use strict';

    // ---- State ----
    let allPlayers = [];
    let dailyData = null;
    let dailyMeta = null;
    let selected = { 1: null, 2: null };
    let score1 = 0, score2 = 0, catIdx = 0, cats = [];
    let p1data = {}, p2data = {};
    let fightInProgress = false;

    // ---- Tier → Color mapping ----
    const TIER_COLORS = {
        gold: { main: '#FFD700', dim: 'rgba(255,200,0,0.08)' },
        purple: { main: '#A855F7', dim: 'rgba(168,85,247,0.08)' },
        cyan: { main: '#06b6d4', dim: 'rgba(6,182,212,0.08)' },
        silver: { main: '#A8B2C0', dim: 'rgba(168,178,192,0.08)' },
        white: { main: 'rgba(255,255,255,0.35)', dim: 'rgba(255,255,255,0.04)' }
    };

    function tierFromBadge(tierBadge) {
        if (!tierBadge) return 'white';
        if (tierBadge === '0.1%') return 'gold';
        if (tierBadge === '1%') return 'purple';
        if (tierBadge === '5%') return 'cyan';
        if (tierBadge === '10%') return 'silver';
        return 'white';
    }

    function getTierColor(player) {
        if (!player) return TIER_COLORS.white;
        const t = player.tier || tierFromBadge(player.tierBadge);
        return TIER_COLORS[t] || TIER_COLORS.white;
    }

    function getTierLabel(player) {
        if (!player) return '';
        if (player.tierBadge) return `Top ${player.tierBadge}`;
        return '';
    }

    function getTierCssClass(player) {
        if (!player) return '';
        const t = player.tier || tierFromBadge(player.tierBadge);
        return `tier-${t}`;
    }

    // ---- Update CSS custom properties for dynamic colors ----
    function updateSlotColors() {
        const c1 = getTierColor(selected[1]);
        const c2 = getTierColor(selected[2]);
        document.documentElement.style.setProperty('--p1-color', c1.main);
        document.documentElement.style.setProperty('--p1-color-dim', c1.dim);
        document.documentElement.style.setProperty('--p2-color', c2.main);
        document.documentElement.style.setProperty('--p2-color-dim', c2.dim);
        // Update slot labels to fighter's color
        const lbl1 = document.querySelector('.slot-p1 .slot-label');
        const lbl2 = document.querySelector('.slot-p2 .slot-label');
        if (lbl1) lbl1.style.color = selected[1] ? c1.main : '';
        if (lbl2) lbl2.style.color = selected[2] ? c2.main : '';
    }

    // ---- Formatting ----
    function fmt(n) {
        if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
        if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
        return n.toLocaleString();
    }

    // ---- Date helpers ----
    function addDays(dateStr, days) {
        const d = new Date(dateStr + 'T00:00:00Z');
        d.setUTCDate(d.getUTCDate() + days);
        return d.toISOString().split('T')[0];
    }

    // ---- Load data ----
    async function loadData() {
        try {
            const [lbRes, dailyRes] = await Promise.all([
                fetch('data/leaderboard_week.json?t=' + Date.now()),
                fetch('data/snapshots_daily.json?t=' + Date.now())
            ]);
            if (lbRes.ok) {
                const lb = await lbRes.json();
                allPlayers = lb.leaderboard || [];
            }
            if (dailyRes.ok) {
                dailyData = await dailyRes.json();
                dailyMeta = dailyData ? dailyData.meta : null;
            }
        } catch (e) {
            console.error('Error loading data:', e);
        }
    }

    // ---- DC stats from daily data ----
    function getDcStats(username) {
        if (!dailyData || !dailyMeta) return { streak: 0, activeDays: 0 };
        const days = (dailyData.users && dailyData.users[username]) || [];

        const start = dailyMeta.weekStart;
        const end = dailyMeta.maxDate;

        const periodMap = {};
        days.filter(d => d.d >= start && d.d <= end)
            .forEach(d => { periodMap[d.d] = d.m; });

        let maxStreak = 0, run = 0, active = 0;
        let curr = new Date(start + 'T00:00:00Z');
        const last = new Date(end + 'T00:00:00Z');
        while (curr <= last) {
            const ds = curr.toISOString().split('T')[0];
            if ((periodMap[ds] || 0) > 0) { active++; run++; if (run > maxStreak) maxStreak = run; }
            else run = 0;
            curr.setUTCDate(curr.getUTCDate() + 1);
        }
        return { streak: maxStreak, activeDays: active };
    }

    // ---- Search ----
    function searchPlayers(q) {
        if (!q || q.length < 2) return [];
        const lower = q.toLowerCase();
        return allPlayers
            .filter(p => (p.nickname && p.nickname.toLowerCase().includes(lower)) ||
                (p.username && p.username.toLowerCase().includes(lower)))
            .slice(0, 8);
    }

    // ---- Dropdown rendering ----
    function renderDropdown(slot, results) {
        const dd = document.getElementById(`dropdown${slot}`);
        if (results.length === 0) { dd.classList.remove('open'); return; }
        dd.innerHTML = results.map((p, i) => {
            const tierCls = getTierCssClass(p);
            const avaHtml = p.avatarUrl
                ? `<img src="${p.avatarUrl}" alt="" onerror="this.parentElement.textContent='👤'">`
                : '👤';
            return `<div class="dd-item" data-idx="${i}" data-slot="${slot}">
                <div class="dd-ava">${avaHtml}</div>
                <div class="dd-name">${p.nickname || p.username}</div>
                <div class="dd-rank ${tierCls}">#${p.rank} · ${getTierLabel(p)}</div>
            </div>`;
        }).join('');
        dd.classList.add('open');

        // store results for click
        dd._results = results;
        dd.querySelectorAll('.dd-item').forEach(item => {
            item.addEventListener('click', () => {
                const idx = parseInt(item.dataset.idx);
                const s = parseInt(item.dataset.slot);
                selectPlayer(s, dd._results[idx]);
                dd.classList.remove('open');
            });
        });
    }

    function selectPlayer(slot, player) {
        selected[slot] = player;
        const input = document.getElementById(`input${slot}`);
        input.value = player.nickname || player.username;
        updatePreview(slot);
        updateSlotColors();
        updateFightBtn();
    }

    function updatePreview(slot) {
        const preview = document.getElementById(`preview${slot}`);
        const p = selected[slot];
        if (!p) {
            preview.innerHTML = `<div class="preview-empty">Enter nickname to search</div>`;
            return;
        }
        const avaHtml = p.avatarUrl
            ? `<img src="${p.avatarUrl}" alt="" onerror="this.parentElement.textContent='👤'">`
            : '👤';
        const isP2 = slot === 2;
        const metaHtml = isP2
            ? `<span class="preview-score">${fmt(p.totalPoints)} ⚡</span>
               <span class="preview-rank">#${p.rank} · ${getTierLabel(p)}</span>`
            : `<span class="preview-rank">#${p.rank} · ${getTierLabel(p)}</span>
               <span class="preview-score">${fmt(p.totalPoints)} ⚡</span>`;
        preview.innerHTML = `
            <div class="preview-ava">${avaHtml}</div>
            <div class="preview-info">
                <div class="preview-name">${p.nickname || p.username}</div>
                <div class="preview-meta">
                    ${metaHtml}
                </div>
            </div>
        `;
    }

    function updateFightBtn() {
        const btn = document.getElementById('fightBtn');
        const hint = document.querySelector('.btn-hint');
        if (selected[1] && selected[2]) {
            btn.classList.remove('disabled');
            hint.textContent = '⚡ ready to fight!';
            hint.style.color = 'rgba(255,68,68,0.5)';
        } else {
            btn.classList.add('disabled');
            hint.textContent = 'select both players to begin';
            hint.style.color = '';
        }
    }

    // ---- Fight data preparation ----
    function prepareFightData(player) {
        const dc = getDcStats(player.username);
        const xViews = player.xViews || 0;
        const xLikes = player.xLikes || 0;
        const xReposts = player.xReposts || 0;
        const xReplies = player.xReplies || 0;
        const er = xViews > 0 ? ((xLikes + xReposts + xReplies) / xViews * 100) : 0;
        return {
            ...player,
            dc: player.discordMessages || 0,
            streak: dc.streak,
            active: dc.activeDays,
            er: parseFloat(er.toFixed(1)),
            views: xViews,
            posts: player.xPosts || 0,
            name: player.nickname || player.username,
            handle: '@' + player.username,
            total: player.totalPoints || 0
        };
    }

    // ---- Random opponent ----
    window.randomOpponent = function () {
        const top350 = allPlayers.filter(p => p.rank && p.rank <= 350);
        if (top350.length === 0) return;
        // Exclude already-selected P1
        const pool = selected[1]
            ? top350.filter(p => p.username !== selected[1].username)
            : top350;
        const pick = pool[Math.floor(Math.random() * pool.length)];
        if (pick) selectPlayer(2, pick);
    };

    // ---- FIGHT TRANSITION ----
    window.startFight = function () {
        if (!selected[1] || !selected[2]) {
            const btn = document.getElementById('fightBtn');
            btn.animate([
                { transform: 'translateX(0)' }, { transform: 'translateX(-8px)' },
                { transform: 'translateX(8px)' }, { transform: 'translateX(-6px)' },
                { transform: 'translateX(6px)' }, { transform: 'translateX(0)' },
            ], { duration: 350, easing: 'ease-out' });
            return;
        }
        // Prevent same player
        if (selected[1].username === selected[2].username) {
            const hint = document.querySelector('.btn-hint');
            hint.textContent = '⚠ choose different players!';
            hint.style.color = 'rgba(239,68,68,0.7)';
            return;
        }

        cats = buildCats();
        const overlay = document.getElementById('transitionOverlay');
        overlay.animate([
            { opacity: 0 }, { opacity: 1 }, { opacity: 1 }, { opacity: 0 }
        ], { duration: 600, easing: 'ease-in-out', fill: 'forwards' }).onfinish = () => {
            overlay.style.opacity = '0';
            showFightScreen();
        };
    };

    function showFightScreen() {
        const intro = document.getElementById('screenIntro');
        const fight = document.getElementById('screenFight');
        loadFightData();
        cats = buildCats();
        intro.style.display = 'none';
        fight.style.display = 'flex';
        setTimeout(() => fight.classList.add('visible'), 10);
        resetFightState();
        fightInProgress = true;
        document.getElementById('backBtn').classList.add('locked');
        setTimeout(runCat, 1200);
    }

    window.goBack = function () {
        if (fightInProgress) return;
        const intro = document.getElementById('screenIntro');
        const fight = document.getElementById('screenFight');
        fight.classList.remove('visible');
        setTimeout(() => {
            fight.style.display = 'none';
            intro.style.display = 'flex';
        }, 400);
    };

    function loadFightData() {
        p1data = prepareFightData(selected[1]);
        p2data = prepareFightData(selected[2]);

        const ava = (url) => url ? `<img src="${url}" alt="" onerror="this.textContent='👤'">` : '👤';

        document.getElementById('fava1').innerHTML = ava(p1data.avatarUrl);
        document.getElementById('frank1').innerHTML = `#${p1data.rank}<br>${getTierLabel(p1data)}`;
        document.getElementById('fname1').textContent = p1data.name;
        document.getElementById('fhandle1').textContent = p1data.handle;
        document.getElementById('ftotal1').textContent = `⚡ ${fmt(p1data.total)} pts`;

        document.getElementById('v-p1-dc').textContent = p1data.dc.toLocaleString();
        document.getElementById('v-p1-streak').textContent = `${p1data.streak} days`;
        document.getElementById('v-p1-active').textContent = `${p1data.active}`;
        document.getElementById('v-p1-er').textContent = `${p1data.er}%`;
        document.getElementById('v-p1-views').textContent = fmt(p1data.views);
        document.getElementById('v-p1-posts').textContent = `${p1data.posts}`;

        document.getElementById('fava2').innerHTML = ava(p2data.avatarUrl);
        document.getElementById('frank2').innerHTML = `#${p2data.rank}<br>${getTierLabel(p2data)}`;
        document.getElementById('fname2').textContent = p2data.name;
        document.getElementById('fhandle2').textContent = p2data.handle;
        document.getElementById('ftotal2').textContent = `⚡ ${fmt(p2data.total)} pts`;

        document.getElementById('v-p2-dc').textContent = p2data.dc.toLocaleString();
        document.getElementById('v-p2-streak').textContent = `${p2data.streak} days`;
        document.getElementById('v-p2-active').textContent = `${p2data.active}`;
        document.getElementById('v-p2-er').textContent = `${p2data.er}%`;
        document.getElementById('v-p2-views').textContent = fmt(p2data.views);
        document.getElementById('v-p2-posts').textContent = `${p2data.posts}`;
    }

    function resetFightState() {
        score1 = 0; score2 = 0; catIdx = 0;
        document.getElementById('sc1').textContent = '0';
        document.getElementById('sc2').textContent = '0';
        // Reset arena
        document.getElementById('arena').classList.remove('reveal');
        const vsCol = document.querySelector('.vs-col');
        if (vsCol) { vsCol.style.transition = ''; vsCol.style.opacity = '1'; }
        // Reset winner-center
        const wc = document.getElementById('winnerCenter');
        wc.className = 'winner-center'; wc.style.opacity = '0';
        // Remove confetti
        wc.querySelectorAll('.confetti-piece').forEach(c => c.remove());

        document.getElementById('btnRow').style.animation = 'none';
        document.getElementById('btnRow').style.opacity = '0';

        ['dc', 'streak', 'active', 'er', 'views', 'posts'].forEach(k => {
            ['p1', 'p2'].forEach(p => {
                const r = document.getElementById(`${p}-${k}`);
                if (r) r.className = 'mrow';
                const pp = document.getElementById(`pp-${p}-${k}`);
                if (pp) { pp.style.opacity = '0'; pp.style.animation = 'none'; }
                const chk = document.getElementById(`chk-${p}-${k}`);
                if (chk) chk.textContent = '';
            });
        });
        ['p1', 'p2'].forEach(p => {
            ['dc', 'x'].forEach(s => {
                const el = document.getElementById(`lbl-${p}-${s}`);
                if (el) { el.style.animation = 'none'; el.style.opacity = '0'; }
            });
        });

        const fc1 = document.getElementById('fightCard1');
        const fc2 = document.getElementById('fightCard2');
        fc1.classList.remove('dimmed'); fc2.classList.remove('dimmed');
        fc1.style.animation = 'none'; fc2.style.animation = 'none';
        setTimeout(() => { fc1.style.animation = ''; fc2.style.animation = ''; }, 20);
    }

    function buildCats() {
        function bin(a, b) { if (a > b) return [1, 0]; if (b > a) return [0, 1]; return [0, 0]; }
        return [
            { key: 'dc', r: bin(p1data.dc, p2data.dc) },
            { key: 'streak', r: bin(p1data.streak, p2data.streak) },
            { key: 'active', r: bin(p1data.active, p2data.active) },
            { key: 'er', r: bin(p1data.er, p2data.er) },
            { key: 'views', r: bin(p1data.views, p2data.views) },
            { key: 'posts', r: bin(p1data.posts, p2data.posts) },
        ].map(c => ({ key: c.key, pts1: c.r[0], pts2: c.r[1] }));
    }

    // ---- Sword animation ----
    function getCenter(el) {
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }

    function animateSwords(r1, r2, cb) {
        const c1 = getCenter(r1), c2 = getCenter(r2);
        const sl = document.getElementById('swL'), sr = document.getElementById('swR');
        const cl = document.getElementById('clash');
        const sps = ['sp1', 'sp2', 'sp3', 'sp4'].map(id => document.getElementById(id));
        const dur = 650;

        const isMobile = window.innerWidth <= 700;
        const sb = document.querySelector('.score-board');
        const mx = window.innerWidth / 2, my = (c1.y + c2.y) / 2;
        const c_sb = sb ? getCenter(sb) : { x: mx, y: my };

        const clashX = mx;
        const clashY = isMobile ? c_sb.y : my;

        const dx1 = clashX - c1.x, dy1 = clashY - c1.y;
        const dx2 = clashX - c2.x, dy2 = clashY - c2.y;

        sl.style.cssText = `left:${c1.x - 13}px;top:${c1.y - 13}px;opacity:0`;
        sr.style.cssText = `left:${c2.x - 13}px;top:${c2.y - 13}px;opacity:0`;

        sl.animate([
            { opacity: 0, transform: 'translate(0, 0) rotate(-35deg) scale(0.5)' },
            { opacity: 1, transform: `translate(${dx1 * 0.5}px, ${dy1 * 0.5}px) rotate(-20deg) scale(0.9)`, offset: 0.35 },
            { opacity: 1, transform: `translate(${dx1}px, ${dy1}px) rotate(-8deg) scale(1.15)`, offset: 0.82 },
            { opacity: 0, transform: `translate(${dx1 + 5}px, ${dy1 + 5}px) rotate(0) scale(0.7)` },
        ], { duration: dur, easing: 'ease-in-out', fill: 'forwards' });

        sr.animate([
            { opacity: 0, transform: 'translate(0, 0) rotate(35deg) scale(0.5) scaleX(-1)' },
            { opacity: 1, transform: `translate(${dx2 * 0.5}px, ${dy2 * 0.5}px) rotate(20deg) scale(0.9) scaleX(-1)`, offset: 0.35 },
            { opacity: 1, transform: `translate(${dx2}px, ${dy2}px) rotate(8deg) scale(1.15) scaleX(-1)`, offset: 0.82 },
            { opacity: 0, transform: `translate(${dx2 + 5}px, ${dy2 + 5}px) rotate(0) scale(0.7) scaleX(-1)` },
        ], { duration: dur, easing: 'ease-in-out', fill: 'forwards' });

        setTimeout(() => {
            cl.style.cssText = `left:${clashX}px;top:${clashY}px;font-size:38px;opacity:0`;
            cl.animate([
                { opacity: 0, transform: 'translate(-50%,-50%) scale(0)' },
                { opacity: 1, transform: 'translate(-50%,-50%) scale(2)' },
                { opacity: 0.7, transform: 'translate(-50%,-50%) scale(1.3)' },
                { opacity: 0, transform: 'translate(-50%,-50%) scale(0.5)' },
            ], { duration: 480, easing: 'ease-out', fill: 'forwards' });
            const dirs = [[-24, -24], [24, -24], [-18, 24], [22, 18]];
            sps.forEach((sp, i) => {
                const [sx, sy] = dirs[i];
                sp.style.cssText = `left:${mx}px;top:${my}px;opacity:0`;
                sp.animate([
                    { opacity: 1, transform: 'translate(-50%,-50%) scale(2)' },
                    { opacity: 0, transform: `translate(-50%,-50%) translate(${sx}px,${sy}px) scale(0)` },
                ], { duration: 380, easing: 'ease-out', fill: 'forwards' });
            });
        }, dur * 0.72);
        setTimeout(cb, dur + 280);
    }

    function showPlus(key, side) {
        const el = document.getElementById(`pp-${side}-${key}`);
        if (!el) return;
        el.style.animation = 'none'; el.offsetHeight;
        el.style.animation = 'plusAnim 1.3s ease forwards';
    }

    function setCheck(key, side, result) {
        const el = document.getElementById(`chk-${side}-${key}`);
        if (el) el.textContent = result === 'won' ? '✓' : result === 'lost' ? '✗' : '–';
    }

    function flashScore(id) {
        const el = document.getElementById(id);
        el.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.45)' }, { transform: 'scale(1)' }], { duration: 300, easing: 'ease-out' });
    }

    function showSectionLabel(key) {
        if (key === 'dc') ['p1', 'p2'].forEach(p => {
            const el = document.getElementById(`lbl-${p}-dc`);
            if (el) el.style.animation = 'sectionIn 0.4s ease forwards';
        });
        if (key === 'er') ['p1', 'p2'].forEach(p => {
            const el = document.getElementById(`lbl-${p}-x`);
            if (el) el.style.animation = 'sectionIn 0.4s ease forwards';
        });
    }

    function runCat() {
        if (catIdx >= cats.length) { showWinner(); return; }
        const cat = cats[catIdx];
        showSectionLabel(cat.key);
        const r1 = document.getElementById(`p1-${cat.key}`);
        const r2 = document.getElementById(`p2-${cat.key}`);
        r1.classList.add('active-p1'); r2.classList.add('active-p2');

        setTimeout(() => {
            animateSwords(r1, r2, () => {
                r1.classList.remove('active-p1'); r2.classList.remove('active-p2');
                if (cat.pts1 > 0) {
                    r1.classList.add('won'); r2.classList.add('lost');
                    setCheck(cat.key, 'p1', 'won'); setCheck(cat.key, 'p2', 'lost');
                    score1++; document.getElementById('sc1').textContent = score1;
                    flashScore('sc1'); showPlus(cat.key, 'p1');
                } else if (cat.pts2 > 0) {
                    r2.classList.add('won'); r1.classList.add('lost');
                    setCheck(cat.key, 'p2', 'won'); setCheck(cat.key, 'p1', 'lost');
                    score2++; document.getElementById('sc2').textContent = score2;
                    flashScore('sc2'); showPlus(cat.key, 'p2');
                } else {
                    r1.classList.add('draw'); r2.classList.add('draw');
                    setCheck(cat.key, 'p1', 'draw'); setCheck(cat.key, 'p2', 'draw');
                }
                catIdx++; setTimeout(runCat, 1000);
            });
        }, 450);
    }

    function spawnConfetti(winnerSide) {
        const wc = document.getElementById('winnerCenter');
        const winColor = winnerSide === 'p1' ? getTierColor(selected[1]).main : getTierColor(selected[2]).main;
        const colors = [winColor, '#fff', winColor];
        for (let i = 0; i < 16; i++) {
            const el = document.createElement('div');
            el.className = 'confetti-piece';
            const angle = Math.random() * Math.PI * 2;
            const dist = 60 + Math.random() * 80;
            el.style.cssText = `
                background:${colors[i % colors.length]};
                left:50%;top:50%;
                --cx:${Math.cos(angle) * dist}px;
                --cy:${Math.sin(angle) * dist}px;
                --cr:${Math.random() * 360}deg;
                animation-delay:${Math.random() * 0.3}s;
                animation-duration:${0.9 + Math.random() * 0.5}s;
                border-radius:${Math.random() > 0.5 ? '50%' : '2px'};
            `;
            wc.appendChild(el);
            setTimeout(() => el.remove(), 2000);
        }
    }

    function showWinner() {
        fightInProgress = false;
        document.getElementById('backBtn').classList.remove('locked');

        let winner, winnerSide, isTiebreak = false;
        if (score1 > score2) {
            winner = p1data; winnerSide = 'p1';
        } else if (score2 > score1) {
            winner = p2data; winnerSide = 'p2';
        } else {
            const isP1 = p1data.total >= p2data.total;
            winner = isP1 ? p1data : p2data;
            winnerSide = isP1 ? 'p1' : 'p2';
            isTiebreak = true;
        }

        const winColor = getTierColor(winnerSide === 'p1' ? selected[1] : selected[2]).main;

        // Populate winner center
        const wcName = document.getElementById('wcName');
        wcName.textContent = winner.name;
        wcName.style.color = winColor;
        wcName.style.animation = 'winGlow 2.5s ease-in-out infinite';
        wcName.style.setProperty('--win-color', winColor);

        const wcBadge = document.getElementById('wcBadge');
        wcBadge.textContent = `\u26a1 ${fmt(winner.total)} pts`;
        wcBadge.style.background = `color-mix(in srgb, ${winColor} 12%, transparent)`;
        wcBadge.style.color = winColor;
        wcBadge.style.border = `1px solid color-mix(in srgb, ${winColor} 28%, transparent)`;


        document.getElementById('wcGlow').style.background = `color-mix(in srgb, ${winColor} 15%, transparent)`;

        // Score-board stays visible — no VS fade

        // Step 2: cards slide apart
        setTimeout(() => {
            document.getElementById('arena').classList.add('reveal');
        }, 300);

        // Step 3: winner appears from winning side, loser dims
        setTimeout(() => {
            const wc = document.getElementById('winnerCenter');
            wc.classList.add('show');
            wc.classList.add(winnerSide === 'p1' ? 'from-left' : 'from-right');
            // Dim losing card
            const loserId = winnerSide === 'p1' ? 'fightCard2' : 'fightCard1';
            document.getElementById(loserId).classList.add('dimmed');
            spawnConfetti(winnerSide);
        }, 900);

        // Step 4: buttons
        setTimeout(() => {
            document.getElementById('btnRow').style.animation = 'fadeIn 0.5s ease forwards';
        }, 1400);
    }

    // ---- Init ----
    document.addEventListener('DOMContentLoaded', async () => {
        await loadData();
        updateSlotColors();
        updateFightBtn();

        // Search inputs
        let debounce1, debounce2;
        document.getElementById('input1').addEventListener('input', (e) => {
            clearTimeout(debounce1);
            selected[1] = null; updateSlotColors(); updateFightBtn();
            document.getElementById('preview1').innerHTML = '<div class="preview-empty">Searching...</div>';
            debounce1 = setTimeout(() => {
                const results = searchPlayers(e.target.value.trim());
                renderDropdown(1, results);
                if (results.length === 0 && e.target.value.trim().length >= 2) {
                    document.getElementById('preview1').innerHTML = '<div class="preview-empty" style="color:rgba(255,80,80,0.4)">Player not found</div>';
                } else if (e.target.value.trim().length < 2) {
                    document.getElementById('preview1').innerHTML = '<div class="preview-empty">Enter nickname to search</div>';
                }
            }, 200);
        });

        document.getElementById('input2').addEventListener('input', (e) => {
            clearTimeout(debounce2);
            selected[2] = null; updateSlotColors(); updateFightBtn();
            document.getElementById('preview2').innerHTML = '<div class="preview-empty">Searching...</div>';
            debounce2 = setTimeout(() => {
                const results = searchPlayers(e.target.value.trim());
                renderDropdown(2, results);
                if (results.length === 0 && e.target.value.trim().length >= 2) {
                    document.getElementById('preview2').innerHTML = '<div class="preview-empty" style="color:rgba(255,80,80,0.4)">Player not found</div>';
                } else if (e.target.value.trim().length < 2) {
                    document.getElementById('preview2').innerHTML = '<div class="preview-empty">Enter nickname to search</div>';
                }
            }, 200);
        });

        // Close dropdown on outside click
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.search-wrap')) {
                document.getElementById('dropdown1').classList.remove('open');
                document.getElementById('dropdown2').classList.remove('open');
            }
        });
    });
})();
