document.addEventListener('DOMContentLoaded', () => {
    const filterBtns = document.querySelectorAll('.filter-btn');
    const loadingEl = document.getElementById('loading');
    const contentEl = document.getElementById('leaderboardContent');
    const podiumContainer = document.getElementById('podiumContainer');
    const tableBody = document.getElementById('tableBody');
    const topStats = document.getElementById('topStats');
    const platformBtns = document.querySelectorAll('.platform-btn');
    const totalHeader = document.getElementById('totalHeader');
    const compareToggleEl = document.getElementById('compareToggle');
    const tableWrap = document.querySelector('.table-wrap');
    tableWrap.className = 'table-wrap plat-all';

    let currentPeriod = 'all';
    let currentPlatform = 'all';
    let currentData = [];
    let fullLeaderboardData = [];
    let currentPage = 1;
    const itemsPerPage = 10;

    // Compare state
    let compareMode = false;
    let prevSnapshot = null;    // map: username -> prev period user object
    let currentSnapshots = [];  // raw snapshots array (newest first) for bar charts
    let dailyData = null;       // snapshots_daily.json content
    let dailyMeta = null;       // shortcut to dailyData.meta

    // Pagination elements
    const prevPageBtn = document.getElementById('prevPageBtn');
    const nextPageBtn = document.getElementById('nextPageBtn');
    const pageInfo = document.getElementById('pageInfo');
    const paginationControls = document.getElementById('paginationControls');
    const searchInput = document.getElementById('searchInput');

    // ---- Filter buttons (period) ----
    filterBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            filterBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentPeriod = btn.dataset.period;

            if (currentPeriod === 'all') {
                if (compareMode) {
                    compareMode = false;
                    compareToggleEl.classList.remove('on');
                    tableWrap.classList.remove('compare-on');
                    prevSnapshot = null;
                    currentSnapshots = [];
                }
                compareToggleEl.classList.add('disabled');
            } else {
                compareToggleEl.classList.remove('disabled');
            }

            fetchData(currentPeriod);
        });
    });

    // ---- Platform filter buttons ----
    platformBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            platformBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentPlatform = btn.dataset.platform;
            tableWrap.className = `table-wrap plat-${currentPlatform}${compareMode ? ' compare-on' : ''}`;
            applyFilters();
        });
    });

    // ---- Compare toggle ----
    compareToggleEl.addEventListener('click', () => {
        if (compareToggleEl.classList.contains('disabled')) return;
        compareMode = !compareMode;
        compareToggleEl.classList.toggle('on', compareMode);

        if (compareMode) {
            Promise.all([loadSnapshotData(currentPeriod), loadDailyData()]).then(() => {
                tableWrap.classList.add('compare-on');
                renderTablePage();
            });
        } else {
            tableWrap.classList.remove('compare-on');
            prevSnapshot = null;
            currentSnapshots = [];
            dailyData = null;
            dailyMeta = null;
            document.querySelectorAll('.row-wrap.expanded').forEach(r => r.classList.remove('expanded'));
            renderTablePage();
        }
    });

    // ---- Row expand/collapse (event delegation) ----
    tableBody.addEventListener('click', (e) => {
        if (!compareMode) return;
        // Don't close if clicking inside the detail panel
        if (e.target.closest('.detail-panel')) return;
        const rowWrap = e.target.closest('.row-wrap');
        if (!rowWrap) return;
        rowWrap.classList.toggle('expanded');
    });

    // ---- Pagination ----
    prevPageBtn.addEventListener('click', () => {
        if (currentPage > 1) { currentPage--; renderTablePage(); }
    });
    nextPageBtn.addEventListener('click', () => {
        const totalPages = Math.ceil(currentData.length / itemsPerPage);
        if (currentPage < totalPages) { currentPage++; renderTablePage(); }
    });

    // ---- Search ----
    searchInput.addEventListener('input', () => { applyFilters(); });

    // ---- Date helper (client-side) ----
    function addDaysClient(dateStr, days) {
        const d = new Date(dateStr + 'T00:00:00Z');
        d.setUTCDate(d.getUTCDate() + days);
        return d.toISOString().split('T')[0];
    }

    const MONTH_NAMES = ["January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"
    ];

    function getMonthNameShort(dateStr) {
        if (!dateStr) return "";
        const d = new Date(dateStr + 'T00:00:00Z');
        return MONTH_NAMES[d.getUTCMonth()];
    }

    function fmtDateRange(start, end) {
        const s = new Date(start + 'T00:00:00Z');
        const e = new Date(end + 'T00:00:00Z');
        const fmt = (d) => (d.getUTCMonth() + 1).toString().padStart(2, '0') + '.' + d.getUTCDate().toString().padStart(2, '0');
        return `${fmt(s)} - ${fmt(e)}`;
    }

    // ---- Load daily snapshot data ----
    async function loadDailyData() {
        try {
            const res = await fetch(`data/snapshots_daily.json?t=${Date.now()}`);
            if (!res.ok) { dailyData = null; dailyMeta = null; return; }
            dailyData = await res.json();
            dailyMeta = dailyData ? dailyData.meta : null;
        } catch (e) {
            dailyData = null; dailyMeta = null;
        }
    }

    // ---- Compute DC stats from daily snapshot ----
    function getDcStats(username, startOrPeriod, end, label) {
        if (!dailyData || !dailyMeta) return null;
        const days = (dailyData.users && dailyData.users[username]) || [];

        let start = startOrPeriod;
        let finalEnd = end;
        let finalLabel = label;

        // Auto-resolve period names if passed as strings
        if (startOrPeriod === 'week') {
            start = dailyMeta.weekStart;
            finalEnd = dailyMeta.maxDate;
            finalLabel = fmtDateRange(start, finalEnd);
        } else if (startOrPeriod === 'month') {
            start = dailyMeta.monthStart;
            finalEnd = dailyMeta.maxDate;
            finalLabel = getMonthNameShort(start);
        } else if (startOrPeriod === 'all') {
            start = '2020-01-01'; // dummy far past
            finalEnd = dailyMeta.maxDate;
            finalLabel = 'all time';
        }

        const periodDays = days.filter(d => d.d >= start && d.d <= finalEnd);
        const periodMap = {};
        periodDays.forEach(d => { periodMap[d.d] = d.m; });

        // MAX STREAK and ACTIVE DAYS calculation within the window
        let maxStreak = 0, currentRun = 0, activeCount = 0;
        let curr = new Date(start + 'T00:00:00Z');
        const last = new Date(finalEnd + 'T00:00:00Z');

        while (curr <= last) {
            const ds = curr.toISOString().split('T')[0];
            if ((periodMap[ds] || 0) > 0) {
                activeCount++;
                currentRun++;
                if (currentRun > maxStreak) maxStreak = currentRun;
            } else {
                currentRun = 0;
            }
            curr.setUTCDate(curr.getUTCDate() + 1);
        }
        const streak = maxStreak;
        const activeDays = activeCount;
        const totalMsgs = periodDays.reduce((s, d) => s + (d.m || 0), 0);
        const avgPerDay = activeDays > 0 ? Math.round(totalMsgs / activeDays) : 0;

        let bestDayVal = 0;
        let bestDayDate = '';
        periodDays.forEach(r => {
            if ((r.m || 0) > bestDayVal) {
                bestDayVal = r.m;
                bestDayDate = r.d;
            }
        });

        const fmtDateShort = (s) => {
            if (!s) return '';
            const parts = s.split('-');
            return parts[1] + '.' + parts[2];
        };

        return { streak, activeDays, avgPerDay, bestDay: bestDayVal, bestDayDate: fmtDateShort(bestDayDate), periodName: finalLabel };
    }

    // ---- Compute X stats (aggregated from xDetails) ----
    function getXStats(user, start, end) {
        if (!user.xDetails) return null;
        const startTime = new Date(start + 'T00:00:00Z').getTime();
        const endTime = new Date(end + 'T23:59:59Z').getTime();
        const periodPosts = user.xDetails.filter(p => p.timestamp >= startTime && p.timestamp <= endTime);

        const views = periodPosts.reduce((s, p) => s + (p.views || 0), 0);
        const likes = periodPosts.reduce((s, p) => s + (p.likes || 0), 0);
        const reposts = periodPosts.reduce((s, p) => s + (p.reposts || 0), 0);
        const replies = periodPosts.reduce((s, p) => s + (p.replies || 0), 0);

        return { posts: periodPosts.length, views, likes, reposts, replies };
    }

    // ---- Load snapshot data ----
    async function loadSnapshotData(period) {
        try {
            const res = await fetch(`data/snapshots_${period}.json?t=${Date.now()}`);
            if (!res.ok) { prevSnapshot = null; currentSnapshots = []; return; }
            const snapshots = await res.json();
            currentSnapshots = snapshots || [];
            if (snapshots && snapshots.length > 0) {
                prevSnapshot = {};
                snapshots[0].leaderboard.forEach(u => {
                    prevSnapshot[u.username] = u;
                });
            } else {
                prevSnapshot = null;
            }
        } catch (e) {
            prevSnapshot = null;
            currentSnapshots = [];
        }
    }

    // ---- Apply filters & sort ----
    function applyFilters() {
        const query = searchInput.value.toLowerCase().trim();

        let sortedFull = [...fullLeaderboardData];
        if (currentPlatform === 'discord') {
            sortedFull = sortedFull.filter(user => user.discordMessages > 0);
            sortedFull.sort((a, b) => b.discordMessages - a.discordMessages);
        } else if (currentPlatform === 'x') {
            sortedFull = sortedFull.filter(user => user.xScore > 0);
            sortedFull.sort((a, b) => b.xScore - a.xScore);
        } else {
            sortedFull.sort((a, b) => b.totalPoints - a.totalPoints);
        }

        sortedFull.forEach((u, i) => { u.uiRank = i + 1; });

        if (currentPlatform === 'discord') totalHeader.innerText = 'DC Msgs';
        else if (currentPlatform === 'x') totalHeader.innerText = 'X Score';
        else totalHeader.innerText = 'Total';

        renderPodium(sortedFull);

        if (query !== '') {
            currentData = sortedFull.filter(user =>
                (user.nickname && user.nickname.toLowerCase().includes(query)) ||
                (user.username && user.username.toLowerCase().includes(query))
            );
        } else {
            currentData = sortedFull;
        }

        currentPage = 1;
        renderTablePage();
    }

    // ---- Render Podium ----
    function renderPodium(data) {
        podiumContainer.innerHTML = '';
        if (data && data.length >= 3) {
            const first = data[0], second = data[1], third = data[2];
            podiumContainer.innerHTML += createPodiumElement(second, 'second', '🎯', '#2', 'cyan');
            podiumContainer.innerHTML += createPodiumElement(first, 'first', '🔥', '#1', 'gold', '👑');
            podiumContainer.innerHTML += createPodiumElement(third, 'third', '⚡', '#3', 'purple');
        }
    }

    // Initial load
    fetchData('all', true);

    async function fetchData(period, isInitial = false) {
        if (isInitial) {
            loadingEl.classList.remove('hidden');
            contentEl.classList.add('hidden');
        } else {
            contentEl.style.opacity = '0.5';
            contentEl.style.pointerEvents = 'none';
            contentEl.style.transition = 'opacity 0.2s';
        }

        try {
            const url = `data/leaderboard_${period}.json?t=${new Date().getTime()}`;
            const res = await fetch(url);
            if (!res.ok) throw new Error('Data not found');
            const data = await res.json();

            if (compareMode && period !== 'all') {
                await Promise.all([loadSnapshotData(period), loadDailyData()]);
            }

            renderLeaderboard(data);

            if (isInitial) {
                loadingEl.classList.add('hidden');
                contentEl.classList.remove('hidden');
            } else {
                contentEl.style.opacity = '1';
                contentEl.style.pointerEvents = 'auto';
            }
        } catch (error) {
            console.error(error);
            if (isInitial) {
                loadingEl.innerHTML = 'Error loading data.';
            } else {
                contentEl.style.opacity = '1';
                contentEl.style.pointerEvents = 'auto';
            }
        }
    }

    function renderLeaderboard(data) {
        const { stats, leaderboard } = data;

        topStats.innerHTML = `
            <div class="tstat-box">
                <div class="tstat-icon"><i class="fas fa-user-group"></i></div>
                <div class="tstat-info">
                    <div class="tstat-value">${formatNumber(stats.participants)}</div>
                    <div class="tstat-label">PARTICIPANTS</div>
                </div>
            </div>
            <div class="tstat-box">
                <div class="tstat-icon"><i class="fas fa-message"></i></div>
                <div class="tstat-info">
                    <div class="tstat-value">${formatNumber(stats.totalDcMessages)}</div>
                    <div class="tstat-label">DC MESSAGES</div>
                </div>
            </div>
            <div class="tstat-box">
                <div class="tstat-icon"><i class="fa-brands fa-x-twitter"></i></div>
                <div class="tstat-info">
                    <div class="tstat-value">${formatNumber(stats.totalXPosts)}</div>
                    <div class="tstat-label">X POSTS</div>
                </div>
            </div>
            <div class="tstat-box">
                <div class="tstat-icon"><i class="fas fa-eye"></i></div>
                <div class="tstat-info">
                    <div class="tstat-value">${formatNumber(stats.totalViews)}</div>
                    <div class="tstat-label">TOTAL VIEWS</div>
                </div>
            </div>
        `;

        fullLeaderboardData = leaderboard;
        searchInput.value = '';
        applyFilters();
    }

    // ============ CHART HELPERS ============

    function deltaClass(d) {
        if (d > 0) return 'up';
        if (d < 0) return 'down';
        return 'same';
    }

    function deltaSign(d, isFull = false) {
        const fmt = isFull ? formatNumberFull : formatNumber;
        if (d > 0) return `<span class="arrow-sym">↑</span>+${fmt(d)}`;
        if (d < 0) return `<span class="arrow-sym">↓</span>-${fmt(Math.abs(d))}`;
        return '<span class="arrow-sym">→</span>0';
    }

    function calcPct(curr, prev) {
        if (!prev || prev === 0) return '';
        const pct = Math.round((curr - prev) / prev * 100);
        return (pct >= 0 ? '+' : '') + pct + '%';
    }

    function getBarValues(username, metric, currentVal) {
        if (!currentSnapshots || currentSnapshots.length === 0) return [currentVal];
        const snaps = [...currentSnapshots].reverse(); // oldest first
        const vals = snaps.map(snap => {
            const u = snap.leaderboard.find(u => u.username === username);
            return u ? (Number(u[metric]) || 0) : 0;
        });
        vals.push(currentVal);
        return vals;
    }

    function makeBars(containerId, values, color, dimColor, username, metric) {
        const el = document.getElementById(containerId);
        if (!el || values.length === 0) return;
        const max = Math.max(...values, 1);
        values.forEach((v, i) => {
            const bar = document.createElement('div');
            bar.className = 'bar';
            const isLast = i === values.length - 1;
            if (isLast) bar.classList.add('bar-current');
            bar.style.height = Math.max(6, Math.round((v / max) * 100)) + '%';
            bar.style.background = isLast ? color : dimColor;
            bar.style.opacity = isLast ? '1' : String(0.2 + (i / values.length) * 0.5);
            bar.dataset.color = color;
            bar.dataset.dimColor = dimColor;
            bar.dataset.dimOpacity = String(0.2 + (i / values.length) * 0.5);

            // Interactive Click
            bar.addEventListener('click', (e) => {
                e.stopPropagation();
                updatePanelToSnapshot(containerId, i, values.length - 1, username, metric);
            });

            el.appendChild(bar);
        });
    }

    function updatePanelToSnapshot(barsId, snapIdx, lastIdx, username, _metric) {
        const rowWrap = document.querySelector(`.row-wrap[data-username="${username}"]`);
        if (!rowWrap) return;

        // 1. Sync all charts in this panel to show the same selection
        rowWrap.querySelectorAll('.bar-chart').forEach(chart => {
            chart.querySelectorAll('.bar').forEach((b, i) => {
                const isSelected = (i === snapIdx);
                const color = b.dataset.color;
                const dimColor = b.dataset.dimColor;
                const dimOpacity = b.dataset.dimOpacity;

                b.style.background = isSelected ? color : dimColor;
                b.style.opacity = isSelected ? '1' : dimOpacity;
                if (isSelected) b.classList.add('bar-selected');
                else b.classList.remove('bar-selected');
            });
        });

        // 2. Determine target snapshot and time window
        let targetUser = null;
        let start, end, label;

        function fmtDate(s) {
            const parts = s.split('-');
            return parts[1] + '.' + parts[2];
        }

        if (snapIdx === lastIdx) {
            targetUser = fullLeaderboardData.find(u => u.username === username);
            end = dailyMeta.maxDate;
            if (currentPeriod === 'week') {
                start = dailyMeta.weekStart;
                label = fmtDateRange(start, end);
            } else if (currentPeriod === 'month') {
                start = dailyMeta.monthStart;
                label = getMonthNameShort(start);
            } else {
                start = '2020-01-01';
                label = 'all time';
            }
        } else {
            const reversedSnaps = [...currentSnapshots].reverse();
            const snapshot = reversedSnaps[snapIdx];
            if (snapshot) {
                targetUser = snapshot.leaderboard.find(u => u.username === username);
                end = snapshot.date;
                if (currentPeriod === 'week') {
                    start = addDaysClient(end, -6);
                    label = fmtDateRange(start, end);
                } else {
                    start = end.substring(0, 7) + '-01';
                    label = snapshot.monthLabel || getMonthNameShort(start);
                    if (label.includes(' ')) label = label.split(' ')[0]; // "January 2026" -> "January"
                }
            }
        }

        if (!targetUser) {
            targetUser = {
                totalPoints: 0, discordMessages: 0, xScore: 0,
                xPosts: 0, xViews: 0, xLikes: 0, xReposts: 0, xReplies: 0,
                x_posts: 0, x_views: 0, x_likes: 0, x_reposts: 0, x_replies: 0,
                x_score: 0
            };
        }

        // 2b. Determine previous snapshot data for delta
        let prevTargetUser = null;
        if (snapIdx === lastIdx) {
            if (prevSnapshot) prevTargetUser = prevSnapshot[username];
        } else if (snapIdx > 0) {
            const reversedSnaps = [...currentSnapshots].reverse();
            const prevSnapshotObj = reversedSnaps[snapIdx - 1];
            if (prevSnapshotObj) prevTargetUser = prevSnapshotObj.leaderboard.find(u => u.username === username);
        }

        // 3. Update all Card Values
        const cards = rowWrap.querySelectorAll('.chart-card');
        cards.forEach(card => {
            const titleEl = card.querySelector('.chart-title');
            const valEl = card.querySelector('.chart-this'); // Regular cards
            const lastEl = card.querySelector('.chart-last');

            // Handling for regular Total/DC/X Trend cards
            if (titleEl && valEl) {
                let metric = '';
                const title = titleEl.innerText.toLowerCase();
                if (title.includes('total')) metric = 'totalPoints';
                else if (title.includes('discord') || title.includes('messages')) metric = 'discordMessages';
                else if (title.includes('x score')) metric = 'xScore';

                if (metric) {
                    const currVal = targetUser[metric] || targetUser[metric.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`)] || 0;
                    valEl.innerText = formatNumberFull(currVal);
                    const badgeEl = card.querySelector('.period-badge');
                    if (badgeEl) badgeEl.innerText = label;
                    if (lastEl) lastEl.innerText = label;

                    const deltaBlock = card.querySelector('.chart-delta');
                    if (deltaBlock) {
                        const prevVal = prevTargetUser ? (prevTargetUser[metric] || prevTargetUser[metric.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`)] || 0) : null;
                        const delta = prevVal !== null ? currVal - prevVal : null;

                        if (delta !== null) {
                            deltaBlock.classList.remove('hidden');
                            deltaBlock.style.display = 'flex';
                            const valSpan = deltaBlock.querySelector('.chart-delta-val');
                            const pctSpan = deltaBlock.querySelector('.chart-delta-pct');
                            const dc = deltaClass(delta);

                            if (valSpan) {
                                valSpan.className = `chart-delta-val ${dc}`;
                                valSpan.innerHTML = deltaSign(delta, true);
                            }
                            if (pctSpan) {
                                if (prevVal > 0) {
                                    pctSpan.className = `chart-delta-pct ${dc}`;
                                    pctSpan.innerText = calcPct(currVal, prevVal);
                                    pctSpan.style.display = 'inline';
                                } else {
                                    pctSpan.style.display = 'none';
                                }
                            }

                            const vsSpan = deltaBlock.querySelector('.chart-delta-vs');
                            if (vsSpan) {
                                let unit = currentPeriod === 'week' ? 'week' : 'month';
                                if (currentPeriod === 'all') {
                                    vsSpan.style.display = 'none';
                                } else {
                                    vsSpan.style.display = 'inline';
                                    vsSpan.innerText = `vs previous ${unit}`;
                                }
                            }
                        } else {
                            deltaBlock.style.display = 'none';
                        }
                    }
                }
            }

            // Handling for the special X Metrics (ER) card
            if (card.classList.contains('er-card')) {
                const v = targetUser.xViews ?? targetUser.x_views ?? 0;
                const l = targetUser.xLikes ?? targetUser.x_likes ?? 0;
                const r = targetUser.xReposts ?? targetUser.x_reposts ?? 0;
                const re = targetUser.xReplies ?? targetUser.x_replies ?? 0;

                const er = v > 0 ? ((l + r + re) / v * 100) : 0;
                const erMult = Math.min(1 + (er * 0.1), 1.5);

                const erValEl = card.querySelector('.er-big-val');
                const erRateEl = card.querySelector('.er-mult-val');

                const badgeEl = card.querySelector('.period-badge');
                if (badgeEl) badgeEl.innerText = label;

                if (erValEl) erValEl.innerText = formatNumberFull(targetUser.xScore ?? targetUser.x_score ?? 0);
                if (erRateEl) erRateEl.innerText = `${er.toFixed(1)}%`;

                // Update comparison section if exists
                const erComp = card.querySelector('.er-compare-section');
                if (erComp) {
                    const prevV = prevTargetUser ? (prevTargetUser.xViews ?? prevTargetUser.x_views ?? 0) : 0;
                    const prevL = prevTargetUser ? (prevTargetUser.xLikes ?? prevTargetUser.x_likes ?? 0) : 0;
                    const prevR = prevTargetUser ? (prevTargetUser.xReposts ?? prevTargetUser.x_reposts ?? 0) : 0;
                    const prevRe = prevTargetUser ? (prevTargetUser.xReplies ?? prevTargetUser.x_replies ?? 0) : 0;
                    const prevEr = prevV > 0 ? ((prevL + prevR + prevRe) / prevV * 100) : 0;

                    const prevSpan = erComp.querySelector('.er-cp-prev');
                    const currSpan = erComp.querySelector('.er-cp-curr');
                    const diffSpan = erComp.querySelector('.er-cp-diff');
                    const compLbl = erComp.querySelector('.er-compare-lbl');

                    if (prevSpan) prevSpan.innerText = `${prevEr.toFixed(1)}%`;
                    if (currSpan) {
                        currSpan.innerText = `${er.toFixed(1)}%`;
                        const diff = er - prevEr;
                        const dc = deltaClass(diff);
                        currSpan.className = `er-cp-curr ${dc}`;
                    }
                    if (diffSpan) {
                        const diff = er - prevEr;
                        const dc = deltaClass(diff);
                        diffSpan.className = `er-cp-diff ${dc}`;
                        diffSpan.innerHTML = diff > 0 ? '<span class="arrow-sym">↑</span>' : diff < 0 ? '<span class="arrow-sym">↓</span>' : '';
                    }
                    if (compLbl) compLbl.innerText = `previous ${currentPeriod}`;
                }
            }
        });

        // 4. Update X Breakdown Stats (if X card exists)
        const xBreakdown = rowWrap.querySelector('.x-breakdown');
        if (xBreakdown) {
            const getField = (obj, field) => obj ? (obj[field] ?? obj[field.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`)] ?? 0) : 0;
            const metrics = [
                { id: '.st-posts', key: 'xPosts' },
                { id: '.st-views', key: 'xViews' },
                { id: '.st-likes', key: 'xLikes' },
                { id: '.st-reposts', key: 'xReposts' },
                { id: '.st-comments', key: 'xReplies' }
            ];

            metrics.forEach(m => {
                const statEl = xBreakdown.querySelector(m.id);
                if (!statEl) return;

                const currVal = getField(targetUser, m.key);
                const prevVal = prevTargetUser ? getField(prevTargetUser, m.key) : null;

                const valEl = statEl.querySelector('.x-stat-val');
                const deltaEl = statEl.querySelector('.x-stat-delta');

                if (valEl) valEl.innerText = formatNumberFull(currVal);
                if (deltaEl) {
                    const delta = prevVal !== null ? currVal - prevVal : null;
                    if (delta !== null && delta !== 0) {
                        deltaEl.style.display = 'inline-flex';
                        deltaEl.style.alignItems = 'center';
                        const dc = deltaClass(delta);
                        deltaEl.className = `x-stat-delta ${dc}`;
                        deltaEl.innerHTML = `<span class="arrow-sym">${delta > 0 ? '↑' : '↓'}</span>${delta > 0 ? '+' : ''}${formatNumberFull(Math.abs(delta))}`;
                    } else if (delta === 0) {
                        deltaEl.style.display = 'inline-flex';
                        deltaEl.style.alignItems = 'center';
                        deltaEl.className = 'x-stat-delta same';
                        deltaEl.innerHTML = '<span class="arrow-sym">→</span>0';
                    } else {
                        deltaEl.style.display = 'none';
                    }
                }
            });
        }

        // 5. Update DC Stats (Streak, Avg, etc)
        const statsSide = rowWrap.querySelector('.stats-side');
        if (statsSide) {
            const stats = getDcStats(username, start, end, label);
            if (stats) {
                const streakVal = statsSide.querySelector('.streak-val');
                const streakLbl = statsSide.querySelector('.streak-lbl');
                const streakFire = statsSide.querySelector('.streak-fire');
                if (streakVal) streakVal.innerText = `${stats.streak} days`;
                if (streakLbl) streakLbl.innerText = `Streak in ${label}`;
                if (streakFire) {
                    streakFire.innerText = stats.streak >= 7 ? '🔥' : stats.streak >= 3 ? '⚡' : '💤';
                    streakFire.className = 'streak-fire ' + (stats.streak >= 7 ? 'streak-is-fire' : stats.streak >= 3 ? 'streak-is-bolt' : 'streak-is-sleep');
                }

                const miniStats = statsSide.querySelectorAll('.mini-stat');
                if (miniStats.length === 3) {
                    miniStats[0].querySelector('.mini-stat-val').innerText = `${stats.activeDays} days`;
                    miniStats[0].querySelector('.mini-stat-lbl').innerText = `Active (${stats.periodName})`;
                    miniStats[1].querySelector('.mini-stat-val').innerText = `${formatNumberFull(stats.avgPerDay)} msgs`;
                    miniStats[2].querySelector('.mini-stat-val').innerText = `${formatNumberFull(stats.bestDay)} msgs`;
                    miniStats[2].querySelector('.mini-stat-lbl').innerText = `Best day (${stats.bestDayDate})`;
                }
            }
        }

        // 5. Update X Posts Table (filter by historical window)
        const postsBody = rowWrap.querySelector('.x-posts-body');
        const originalUser = fullLeaderboardData.find(u => u.username === username);
        if (postsBody && originalUser && originalUser.xDetails) {
            const startTime = new Date(start + 'T00:00:00Z').getTime();
            const endTime = new Date(end + 'T23:59:59Z').getTime();

            const filteredPosts = originalUser.xDetails
                .filter(p => p.timestamp >= startTime && p.timestamp <= endTime)
                .sort((a, b) => b.timestamp - a.timestamp);

            postsBody.innerHTML = filteredPosts.map(p => {
                const d = new Date(p.timestamp).toLocaleDateString();
                const sum = (p.likes || 0) + (p.reposts || 0) + (p.replies || 0);
                return `
                <div class="x-post-row">
                    <span>${d}</span>
                    <span>${formatNumberFull(p.views)}</span>
                    <span>${formatNumberFull(p.likes)}/${formatNumberFull(p.reposts)}/${formatNumberFull(p.replies)} (${formatNumberFull(sum)})</span>
                    <a href="${p.url}" target="_blank">🔗</a>
                </div>`;
            }).join('') || '<div style="padding:15px;text-align:center;color:rgba(255,255,255,0.2);font-size:11px">No post details available for this window</div>';
        }
    }

    function initAllBars(tableData) {
        if (!compareMode || currentSnapshots.length === 0) return;
        tableData.forEach((user, i) => {
            const uid = user.pageIdx !== undefined ? user.pageIdx : i; // Use stable index
            if (currentPlatform === 'all' && currentPeriod !== 'all') {
                makeBars(`bc-tot-${uid}`, getBarValues(user.username, 'totalPoints', user.totalPoints), '#FFD700', 'rgba(255,215,0,0.18)', user.username, 'totalPoints');
                makeBars(`bc-dc-${uid}`, getBarValues(user.username, 'discordMessages', user.discordMessages), '#a855f7', 'rgba(168,85,247,0.18)', user.username, 'discordMessages');
                if (user.xScore > 0) makeBars(`bc-x-${uid}`, getBarValues(user.username, 'xScore', user.xScore), '#06b6d4', 'rgba(6,182,212,0.18)', user.username, 'xScore');
            } else if (currentPlatform === 'discord' && currentPeriod !== 'all') {
                makeBars(`bc-dc-${uid}`, getBarValues(user.username, 'discordMessages', user.discordMessages), '#818cf8', '#2d3060', user.username, 'discordMessages');
            } else if (currentPlatform === 'x' && currentPeriod !== 'all') {
                if (user.xScore > 0) makeBars(`bc-x-${uid}`, getBarValues(user.username, 'xScore', user.xScore), '#06b6d4', '#064e5a', user.username, 'xScore');
            }
        });
    }

    // ============ PANEL BUILDERS ============

    function buildAllPanel(user, uid, period) {
        const prevUser = prevSnapshot ? prevSnapshot[user.username] : null;
        const prevTotal = prevUser ? prevUser.totalPoints : null;
        const prevDc = prevUser ? prevUser.discordMessages : null;
        const prevX = prevUser ? prevUser.xScore : null;
        const prevLbl = period === 'week' ? 'prev wk' : 'prev mo';

        let label = period === 'week' ? 'week' : period === 'month' ? 'month' : 'all time';
        if (period === 'week' && dailyMeta) label = fmtDateRange(dailyMeta.weekStart, dailyMeta.maxDate);
        else if (period === 'month' && dailyMeta) label = getMonthNameShort(dailyMeta.monthStart);

        const showBars = period !== 'all' && currentSnapshots.length > 0;
        const barsLbl = currentSnapshots.length + ' periods ago';

        const card = (title, color, curr, prev, barsId) => {
            const delta = prev !== null ? curr - prev : null;
            const dc = delta !== null ? deltaClass(delta) : '';
            return `
            <div class="chart-card chart-card-all">
                <div class="chart-top">
                    <div class="chart-title">${title}</div>
                    <div class="period-badge">${label}</div>
                </div>
                <div class="chart-values">
                    <div class="chart-this" style="color:${color}">${formatNumberFull(curr)}</div>
                </div>
                ${showBars ? `<div class="bar-chart" id="${barsId}"></div>
                <div class="chart-footer"><span>${barsLbl}</span><span>now</span></div>` : ''}
                <div class="chart-delta" style="${delta === null ? 'display:none' : ''}">
                    <span class="chart-delta-val ${dc}">${delta !== null ? deltaSign(delta, true) : ''}</span>
                    <span class="chart-delta-pct ${dc}" style="${prev > 0 ? '' : 'display:none'}">${prev > 0 ? calcPct(curr, prev) : ''}</span>
                    <span class="chart-delta-vs" style="${period === 'all' ? 'display:none' : ''}">vs previous ${period === 'week' ? 'week' : 'month'}</span>
                </div>
            </div>`;
        };

        return `<div class="detail-panel">
            ${card('Total Score', '#FFD700', user.totalPoints, prevTotal, `bc-tot-${uid}`)}
            ${card('Discord', '#a855f7', user.discordMessages, prevDc, `bc-dc-${uid}`)}
            ${user.xScore > 0
                ? card('X Score', '#06b6d4', user.xScore, prevX, `bc-x-${uid}`)
                : `<div class="chart-card">
                    <div class="chart-title">X Score</div>
                    <div class="chart-values"><div class="chart-this" style="color:#06b6d4">—</div></div>
                   </div>`}
        </div>`;
    }

    function buildDcPanel(user, uid, period) {
        const prevUser = prevSnapshot ? prevSnapshot[user.username] : null;
        const prevDc = prevUser ? prevUser.discordMessages : null;
        const prevLbl = period === 'week' ? 'last wk' : 'last mo';
        const delta = prevDc !== null ? user.discordMessages - prevDc : null;
        const dc = delta !== null ? deltaClass(delta) : '';
        const showBars = period !== 'all' && currentSnapshots.length > 0;
        const barsLbl = currentSnapshots.length + 'w ago';

        const stats = getDcStats(user.username, period);
        const streak = stats ? stats.streak : 0;
        const activeDays = stats ? stats.activeDays : 0;
        const avgPerDay = stats ? stats.avgPerDay : 0;
        const bestDay = stats ? stats.bestDay : 0;
        const streakIcon = streak >= 7 ? '🔥' : streak >= 3 ? '⚡' : '💤';
        const streakClass = streak >= 7 ? 'streak-is-fire' : streak >= 3 ? 'streak-is-bolt' : 'streak-is-sleep';
        const streakStyle = streak < 3 ? 'border-color:rgba(255,255,255,0.1);background:rgba(255,255,255,0.03)' : '';
        const streakValStyle = streak < 3 ? 'color:rgba(255,255,255,0.4);text-shadow:none' : '';

        return `<div class="detail-panel">
            <div class="chart-card chart-card-dc">
                <div class="chart-title">Messages</div>
                <div class="chart-top">
                    <div class="chart-this" style="color:#818cf8">${formatNumberFull(user.discordMessages)}</div>
                </div>
                ${showBars ? `<div class="bar-chart" id="bc-dc-${uid}"></div>
                <div class="chart-footer"><span>${barsLbl}</span><span>now</span></div>` : ''}
            </div>
            <div class="stats-side">
                <div class="streak-card" style="${streakStyle}">
                    <div class="streak-fire ${streakClass}">${streakIcon}</div>
                    <div class="streak-info">
                        <div class="streak-val" style="${streakValStyle}">${streak > 0 ? streak + ' days' : '0 days'}</div>
                        <div class="streak-lbl">Streak in ${stats ? stats.periodName : 'period'}</div>
                    </div>
                </div>
                <div class="mini-stats">
                    <div class="mini-stat">
                        <div class="mini-stat-val">${activeDays} days</div>
                        <div class="mini-stat-lbl">Active (${stats ? stats.periodName : ''})</div>
                    </div>
                    <div class="mini-stat">
                        <div class="mini-stat-val">${avgPerDay} msgs</div>
                        <div class="mini-stat-lbl">Avg / active</div>
                    </div>
                    <div class="mini-stat">
                        <div class="mini-stat-val">${bestDay} msgs</div>
                        <div class="mini-stat-lbl">Best day (${stats ? stats.bestDayDate : ''})</div>
                    </div>
                </div>
            </div>
        </div>`;
    }

    function buildXPanel(user, uid, period) {
        const prevUser = prevSnapshot ? prevSnapshot[user.username] : null;
        const prevX = prevUser ? prevUser.xScore : null;
        const prevLbl = period === 'week' ? 'last wk' : 'last mo';
        const delta = prevX !== null ? user.xScore - prevX : null;
        const dc = delta !== null ? deltaClass(delta) : '';
        const showBars = period !== 'all' && currentSnapshots.length > 0 && user.xScore > 0;
        const barsLbl = currentSnapshots.length + 'w ago';

        const xPosts = user.xPosts || 0;
        const xViews = user.xViews || 0;
        const xLikes = user.xLikes || 0;
        const xReposts = user.xReposts || 0;
        const xReplies = user.xReplies || 0;

        const erPct = xViews > 0 ? ((xLikes + xReposts + xReplies) / xViews * 100) : 0;
        const erMult = Math.min(1 + (erPct * 0.1), 1.5);
        const erBar = Math.min(100, Math.round(erPct / 5 * 100));

        const prevViews = prevUser ? (prevUser.xViews || prevUser.x_views || 0) : 0;
        const prevLikes = prevUser ? (prevUser.xLikes || prevUser.x_likes || 0) : 0;
        const prevReposts = prevUser ? (prevUser.xReposts || prevUser.x_reposts || 0) : 0;
        const prevReplies = prevUser ? (prevUser.xReplies || prevUser.x_replies || 0) : 0;
        const prevErPct = prevViews > 0 ? ((prevLikes + prevReposts + prevReplies) / prevViews * 100) : 0;
        const erDiff = erPct - prevErPct;
        const erDc = deltaClass(erDiff);

        let periodLbl = period === 'week' ? 'week' : period === 'month' ? 'month' : 'all time';
        if (period === 'week' && dailyMeta) periodLbl = fmtDateRange(dailyMeta.weekStart, dailyMeta.maxDate);
        else if (period === 'month' && dailyMeta) periodLbl = getMonthNameShort(dailyMeta.monthStart);

        // X Posts Table
        let postsHtml = '';
        if (user.xDetails && user.xDetails.length > 0) {
            const sortedPosts = [...user.xDetails].sort((a, b) => b.timestamp - a.timestamp);
            postsHtml = `
            <div class="x-posts-table">
                <div class="x-posts-head">
                    <span>Date</span>
                    <span>Views</span>
                    <span>L / Re / C</span>
                    <span>Link</span>
                </div>
                <div class="x-posts-body">
                    ${sortedPosts.map(p => {
                const d = new Date(p.timestamp).toLocaleDateString();
                const sum = (p.likes || 0) + (p.reposts || 0) + (p.replies || 0);
                return `
                        <div class="x-post-row">
                            <span>${d}</span>
                            <span>${formatNumber(p.views)}</span>
                            <span>${p.likes}/${p.reposts}/${p.replies} (${sum})</span>
                            <a href="${p.url}" target="_blank">🔗</a>
                        </div>`;
            }).join('')}
                </div>
            </div>`;
        }

        const getField = (obj, field) => obj ? (obj[field] ?? obj[field.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`)] ?? 0) : 0;

        const buildXStatDelta = (currKey, prevObj) => {
            if (!prevObj) return '';
            const currVal = getField(user, currKey);
            const prevVal = getField(prevObj, currKey);
            const delta = currVal - prevVal;
            if (delta === 0) return '<span class="x-stat-delta same"><span class="arrow-sym">→</span>0</span>';
            const dc = deltaClass(delta);
            return `<span class="x-stat-delta ${dc}"><span class="arrow-sym">${delta > 0 ? '↑' : '↓'}</span>${delta > 0 ? '+' : ''}${formatNumberFull(Math.abs(delta))}</span>`;
        };

        return `<div class="detail-panel detail-panel-x">
            <div class="detail-top-row">
                <div class="chart-card chart-card-x">
                    <div class="chart-top">
                        <div class="chart-title">X Score trend</div>
                        <div class="period-badge">${periodLbl}</div>
                    </div>
                    <div class="chart-values">
                        <div class="chart-this" style="color:#06b6d4">${user.xScore > 0 ? formatNumberFull(user.xScore) : '—'}</div>
                    </div>
                    ${showBars ? `<div class="bar-chart" id="bc-x-${uid}"></div>
                    <div class="chart-footer"><span>${barsLbl}</span><span>now</span></div>` : ''}
                    <div class="chart-delta" style="${(delta === null || user.xScore <= 0) ? 'display:none' : ''}">
                        <span class="chart-delta-val ${dc}">${delta !== null ? deltaSign(delta, true) : ''}</span>
                        <span class="chart-delta-pct ${dc}" style="${prevX > 0 ? '' : 'display:none'}">${prevX > 0 ? calcPct(user.xScore, prevX) : ''}</span>
                        <span class="chart-delta-vs" style="${period === 'all' ? 'display:none' : ''}">vs previous ${period === 'week' ? 'week' : 'month'}</span>
                    </div>
                    <div class="x-breakdown" style="margin-top:10px">
                        <div class="x-stat st-posts">
                             <div class="x-stat-top">
                                <span class="x-stat-val">${formatNumberFull(xPosts)}</span>
                                <span class="x-stat-delta">${buildXStatDelta('xPosts', prevUser)}</span>
                             </div>
                             <div class="x-stat-lbl">Posts</div>
                        </div>
                        <div class="x-stat st-views">
                             <div class="x-stat-top">
                                <span class="x-stat-val">${formatNumberFull(xViews)}</span>
                                <span class="x-stat-delta">${buildXStatDelta('xViews', prevUser)}</span>
                             </div>
                             <div class="x-stat-lbl">Views</div>
                        </div>
                        <div class="x-stat st-likes">
                             <div class="x-stat-top">
                                <span class="x-stat-val">${formatNumberFull(xLikes)}</span>
                                <span class="x-stat-delta">${buildXStatDelta('xLikes', prevUser)}</span>
                             </div>
                             <div class="x-stat-lbl">Likes</div>
                        </div>
                        <div class="x-stat st-reposts">
                             <div class="x-stat-top">
                                <span class="x-stat-val">${formatNumberFull(xReposts)}</span>
                                <span class="x-stat-delta">${buildXStatDelta('xReposts', prevUser)}</span>
                             </div>
                             <div class="x-stat-lbl">Reposts</div>
                        </div>
                        <div class="x-stat st-comments">
                             <div class="x-stat-top">
                                <span class="x-stat-val">${formatNumberFull(xReplies)}</span>
                                <span class="x-stat-delta">${buildXStatDelta('xReplies', prevUser)}</span>
                             </div>
                             <div class="x-stat-lbl">Comments</div>
                        </div>
                    </div>
                </div>
                <div class="chart-card er-card">
                    <div class="chart-title">X Metrics</div>
                    <div class="er-main">
                        <div class="er-val er-big-val">${user.xScore > 0 ? formatNumberFull(user.xScore) : '—'}</div>
                        <div class="er-lbl">X Score</div>
                    </div>
                    <div class="er-divider"></div>
                    <div class="er-mult-section">
                        <div class="er-mult-title">Engagement Rate</div>
                        <div class="er-mult-val er-mult-val-text">${erPct.toFixed(1)}%</div>
                    </div>
                    <div class="er-divider"></div>
                    <div class="er-compare-section">
                        <div class="er-compare-lbl">previous ${period}</div>
                        <div class="er-compare-row">
                             <span class="er-cp-prev">${prevErPct.toFixed(1)}%</span>
                             <span class="er-cp-arrow"><span class="arrow-sym">→</span></span>
                             <span class="er-cp-curr ${erDc}">${erPct.toFixed(1)}%</span>
                             <span class="er-cp-diff ${erDc}">${erDiff > 0 ? '<span class="arrow-sym">↑</span>' : erDiff < 0 ? '<span class="arrow-sym">↓</span>' : ''}</span>
                        </div>
                    </div>
                </div>
            </div>
            ${postsHtml}
        </div>`;
    }

    // ============ COMPARE HELPERS (row deltas) ============

    function buildDeltaHtml(curr, prev) {
        if (prev === null || prev === undefined) {
            return `<span class="delta same" style="opacity:0.4"><span class="arrow-sym">→</span></span>`;
        }
        curr = Number(curr) || 0;
        prev = Number(prev) || 0;
        const d = curr - prev;
        if (d > 0) return `<span class="delta up"><span class="arrow-sym">↑</span>+${formatNumber(d)}</span>`;
        if (d < 0) return `<span class="delta down"><span class="arrow-sym">↓</span>-${formatNumber(Math.abs(d))}</span>`;
        return `<span class="delta same"><span class="arrow-sym">→</span>0</span>`;
    }

    function buildSubHtml(prev, label) {
        if (prev === null || prev === undefined) return `<div class="score-sub">—</div>`;
        return `<div class="score-sub">last ${label}: ${formatNumber(prev)}</div>`;
    }

    // ---- Render Table ----
    function renderTablePage() {
        tableBody.innerHTML = '';
        const start = (currentPage - 1) * itemsPerPage;
        const end = start + itemsPerPage;
        const tableData = currentData.slice(start, end);

        let periodLabel = currentPeriod === 'week' ? 'week' : 'month';

        tableData.forEach((user, i) => {
            const displayRank = user.uiRank;
            let rankClass = '';
            if (displayRank === 1) rankClass = 'top1';
            else if (displayRank === 2) rankClass = 'top2';
            else if (displayRank === 3) rankClass = 'top3';

            let tierClassValue = 'ring-none';
            let dotColor = getTierColor(user.tier);
            let scoreColorClass = user.tier !== 'none' ? user.tier : 'white';
            let badgeTierClass = user.tier;

            if (displayRank === 1) {
                tierClassValue = 'ring-gold-glow';
                scoreColorClass = 'gold-glow';
                dotColor = getTierColor('gold');
                badgeTierClass = 'gold';
            } else if (displayRank === 2) {
                tierClassValue = 'ring-cyan-glow';
                scoreColorClass = 'cyan-glow';
                dotColor = getTierColor('cyan');
                badgeTierClass = 'cyan';
            } else if (displayRank === 3) {
                tierClassValue = 'ring-purple-glow';
                scoreColorClass = 'purple-glow';
                dotColor = getTierColor('purple');
                badgeTierClass = 'purple';
            } else {
                tierClassValue = 'ring-none';
                scoreColorClass = 'white';
                dotColor = '#5ead71';
                badgeTierClass = 'silver';
            }

            let badgeHtml = user.tierBadge ? `<span class="tier-badge badge-${badgeTierClass}">${user.tierBadge}</span>` : '';
            let dotHtml = user.tier !== 'none' ? `<div class="tier-dot" style="background:${dotColor}"></div>` : '';
            const avatarFallback = 'https://cdn.discordapp.com/embed/avatars/0.png';

            let displayScore = user.totalPoints;
            if (currentPlatform === 'discord') displayScore = user.discordMessages;
            if (currentPlatform === 'x') displayScore = user.xScore;

            // Previous period data
            const prevUser = (prevSnapshot && user.username) ? (prevSnapshot[user.username] || null) : null;
            const prevTotal = prevUser ? prevUser.totalPoints : null;
            const prevDc = prevUser ? prevUser.discordMessages : null;
            const prevX = prevUser ? prevUser.xScore : null;

            let prevDisplayScore = null;
            if (currentPlatform === 'discord') prevDisplayScore = prevDc;
            else if (currentPlatform === 'x') prevDisplayScore = prevX;
            else prevDisplayScore = prevTotal;

            // Rank change
            let rankChangeHtml = '';
            const currRank = user.uiRank || user.rank;
            const prevRank = prevUser ? prevUser.rank : null;

            if (prevUser && prevRank) {
                const diff = prevRank - currRank;
                const isCompact = window.innerWidth <= 650;
                if (diff > 0) rankChangeHtml = `<div class="rank-change up"><span class="rank-arrow">↑</span>${diff}</div>`;
                else if (diff < 0) rankChangeHtml = `<div class="rank-change down"><span class="rank-arrow">↓</span>${Math.abs(diff)}</div>`;
                else rankChangeHtml = `<div class="rank-change same"><span class="rank-arrow">—</span></div>`;
            } else {
                rankChangeHtml = `<div class="rank-change same">new</div>`;
            }

            // Detail panel — platform-specific chart panel
            let detailPanelHtml = '';
            const uid = user.pageIdx !== undefined ? user.pageIdx : i;
            if (compareMode) {
                if (currentPlatform === 'all') detailPanelHtml = buildAllPanel(user, uid, currentPeriod);
                else if (currentPlatform === 'discord') detailPanelHtml = buildDcPanel(user, uid, currentPeriod);
                else if (currentPlatform === 'x') detailPanelHtml = buildXPanel(user, uid, currentPeriod);
            }

            tableBody.innerHTML += `
                <div class="row-wrap" data-username="${escapeHtml(user.username)}" data-uid="${uid}">
                    <div class="row">
                        <div class="rank-cell ${rankClass}">#${displayRank}${rankChangeHtml}</div>
                        <div class="user-cell">
                            <div class="avatar-wrap">
                                <div class="avatar-ring ${tierClassValue}">
                                    <div class="avatar"><img src="${user.avatarUrl}" onerror="this.src='${avatarFallback}'" alt=""></div>
                                </div>
                                ${dotHtml}
                            </div>
                            <div class="user-info">
                                <div class="user-name">${escapeHtml(user.nickname)} ${badgeHtml}</div>
                                <div class="user-handle">@${escapeHtml(user.username)}</div>
                            </div>
                        </div>
                        <div class="score-cell ${scoreColorClass}">
                            <div class="score-main">${formatNumber(displayScore)} ${buildDeltaHtml(displayScore, prevDisplayScore)}</div>
                            ${buildSubHtml(prevDisplayScore, periodLabel)}
                        </div>
                        <div class="dc-cell">
                            <div class="score-main">${formatNumber(user.discordMessages)} ${buildDeltaHtml(user.discordMessages, prevDc)}</div>
                            ${buildSubHtml(prevDc, periodLabel)}
                        </div>
                        <div class="x-cell">
                            <div class="score-main">${user.xScore > 0 ? formatNumber(user.xScore) : '—'}${user.xScore > 0 ? ' ' + buildDeltaHtml(user.xScore, prevX) : ''}</div>
                            ${user.xScore > 0 ? buildSubHtml(prevX, periodLabel) : '<div class="score-sub">—</div>'}
                        </div>
                        <span class="expand-arrow">▼</span>
                    </div>
                    ${detailPanelHtml}
                </div>
            `;
        });

        // Initialize bar charts after DOM is updated
        if (compareMode) initAllBars(tableData);

        // Pagination UI
        const totalPages = Math.ceil(currentData.length / itemsPerPage);
        if (totalPages > 1) {
            paginationControls.classList.remove('hidden');
            pageInfo.innerText = `Page ${currentPage} of ${totalPages}`;
            prevPageBtn.disabled = currentPage === 1;
            nextPageBtn.disabled = currentPage === totalPages;
        } else {
            paginationControls.classList.add('hidden');
        }
    }

    function createPodiumElement(user, type, _icon, rankStr, rankColorClass, crownIcon = '') {
        const blockNum = type === 'first' ? 1 : (type === 'second' ? 2 : 3);
        const avatarFallback = 'https://cdn.discordapp.com/embed/avatars/0.png';
        let crownHtml = crownIcon ? `<div class="podium-crown">${crownIcon}</div>` : '';

        let displayPoints = user.totalPoints;
        if (currentPlatform === 'discord') displayPoints = user.discordMessages;
        if (currentPlatform === 'x') displayPoints = user.xScore;

        return `
        <div class="podium-item">
            <div class="podium-avatar-wrap">
                ${crownHtml}
                <div class="podium-avatar-ring ${type}">
                    <div class="podium-avatar"><img src="${user.avatarUrl}" onerror="this.src='${avatarFallback}'" alt=""></div>
                </div>
            </div>
            <div class="podium-rank ${rankColorClass}">${rankStr}</div>
            <div class="podium-name">${escapeHtml(user.nickname)}</div>
            <div class="podium-score">${formatNumber(displayPoints)} pts</div>
            <div class="podium-block ${type}">${blockNum}</div>
        </div>
        `;
    }

    function formatNumber(num) {
        if (num === null || num === undefined) return '—';
        const n = Number(num);
        if (isNaN(n)) return '—';
        if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
        if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
        return n.toLocaleString('en-US');
    }

    function formatNumberFull(num) {
        if (num === null || num === undefined) return '—';
        const n = Number(num);
        if (isNaN(n)) return '—';
        return n.toString();
    }

    function getTierColor(tier) {
        if (tier === 'gold') return '#FFD700';
        if (tier === 'purple') return '#A855F7';
        if (tier === 'cyan') return '#00D4FF';
        if (tier === 'silver') return '#A8B2C0';
        return '#ffffff';
    }

    function escapeHtml(unsafe) {
        if (!unsafe) return '';
        return unsafe.toString()
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }
});
