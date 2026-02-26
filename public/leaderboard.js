document.addEventListener('DOMContentLoaded', () => {
    const filterBtns = document.querySelectorAll('.filter-btn');
    const loadingEl = document.getElementById('loading');
    const contentEl = document.getElementById('leaderboardContent');
    const podiumContainer = document.getElementById('podiumContainer');
    const tableBody = document.getElementById('tableBody');
    const topStats = document.getElementById('topStats');
    const platformBtns = document.querySelectorAll('.platform-btn');

    const totalHeader = document.getElementById('totalHeader');

    let currentPeriod = 'all';
    let currentPlatform = 'all';
    let currentData = [];
    let fullLeaderboardData = [];
    let currentPage = 1;
    const itemsPerPage = 10;

    // Pagination elements
    const prevPageBtn = document.getElementById('prevPageBtn');
    const nextPageBtn = document.getElementById('nextPageBtn');
    const pageInfo = document.getElementById('pageInfo');
    const paginationControls = document.getElementById('paginationControls');
    const searchInput = document.getElementById('searchInput');

    // Set up filter buttons
    filterBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            filterBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentPeriod = btn.dataset.period;
            fetchData(currentPeriod);
        });
    });

    // Set up platform filter buttons
    platformBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            platformBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentPlatform = btn.dataset.platform;
            applyFilters();
        });
    });

    // Pagination listeners
    prevPageBtn.addEventListener('click', () => {
        if (currentPage > 1) {
            currentPage--;
            renderTablePage();
        }
    });

    nextPageBtn.addEventListener('click', () => {
        const totalPages = Math.ceil(currentData.length / itemsPerPage);
        if (currentPage < totalPages) {
            currentPage++;
            renderTablePage();
        }
    });

    // Search listener
    searchInput.addEventListener('input', () => {
        applyFilters();
    });

    function applyFilters() {
        const query = searchInput.value.toLowerCase().trim();

        // 1. Sort the full data based on selected platform to establish ranks
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

        // 2. Assign ranks to everyone in this platform view
        sortedFull.forEach((u, i) => {
            u.uiRank = i + 1;
        });

        // 3. Update header label
        if (currentPlatform === 'discord') {
            totalHeader.innerText = 'DC Msgs';
        } else if (currentPlatform === 'x') {
            totalHeader.innerText = 'X Score';
        } else {
            totalHeader.innerText = 'Total';
        }

        // 4. Render podium from the FULL list (so it stays constant during search)
        renderPodium(sortedFull);

        // 5. Apply search filter for the table only
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

    function renderPodium(data) {
        podiumContainer.innerHTML = '';
        if (data && data.length >= 3) {
            const first = data[0];
            const second = data[1];
            const third = data[2];

            // Setup 2nd place
            podiumContainer.innerHTML += createPodiumElement(second, 'second', '🎯', '#2', 'cyan');
            // Setup 1st place
            podiumContainer.innerHTML += createPodiumElement(first, 'first', '🔥', '#1', 'gold', '👑');
            // Setup 3rd place
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
            const url = `data/leaderboard_${period}.json?t=${new Date().getTime()}`; // cache bust
            const res = await fetch(url);
            if (!res.ok) throw new Error('Data not found');
            const data = await res.json();

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

        // Render Top Stats
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

        // Reset search on period change
        searchInput.value = '';

        // Setup data for table and render first page
        applyFilters();
    }

    function renderTablePage() {
        tableBody.innerHTML = '';
        const start = (currentPage - 1) * itemsPerPage;
        const end = start + itemsPerPage;
        const tableData = currentData.slice(start, end);

        tableData.forEach(user => {
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
                scoreColorClass = 'white'; /* Normal score color */
                dotColor = '#5ead71'; /* Green dot */
                badgeTierClass = 'silver'; /* Normal badge color */
            }

            let badgeHtml = user.tierBadge ? `<span class="tier-badge badge-${badgeTierClass}">${user.tierBadge}</span>` : '';
            let dotHtml = user.tier !== 'none' ? `<div class="tier-dot" style="background:${dotColor}"></div>` : '';

            const avatarFallback = 'https://cdn.discordapp.com/embed/avatars/0.png';

            let displayScore = user.totalPoints;
            if (currentPlatform === 'discord') displayScore = user.discordMessages;
            if (currentPlatform === 'x') displayScore = user.xScore;

            tableBody.innerHTML += `
                <div class="row">
                    <div class="rank-cell ${rankClass}">#${displayRank}</div>
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
                    <div class="score-cell ${scoreColorClass}">${formatNumber(displayScore)}</div>
                    <div class="dc-cell">${formatNumber(user.discordMessages)}</div>
                    <div class="x-cell">${user.xScore > 0 ? formatNumber(user.xScore) : '—'}</div>
                </div>
            `;
        });

        // Update pagination UI
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

    function createPodiumElement(user, type, defaultIcon, rankStr, rankColorClass, crownIcon = '') {
        const titleBadgeColor = getTierColor(user.tier);
        let blockHeightClass = type; // "first", "second", "third"
        let blockNum = type === 'first' ? 1 : (type === 'second' ? 2 : 3);
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
            <div class="podium-block ${blockHeightClass}">${blockNum}</div>
        </div>
        `;
    }

    function formatNumber(num) {
        if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
        if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
        return num.toLocaleString('en-US');
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
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }
});
