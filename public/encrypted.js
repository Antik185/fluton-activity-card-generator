(function () {
    'use strict';

    const metricGrid = document.getElementById('metricGrid');
    const supportGrid = document.getElementById('supportGrid');
    const membersBody = document.getElementById('membersBody');
    const membersPanelNote = document.getElementById('membersPanelNote');
    const periodBadge = document.getElementById('periodBadge');
    const cohortBadge = document.getElementById('cohortBadge');
    const benchmarkMode = document.getElementById('benchmarkMode');
    const memberBenchmark = document.getElementById('memberBenchmark');
    const memberBenchmarkField = document.getElementById('memberBenchmarkField');
    const benchmarkContext = document.getElementById('benchmarkContext');
    const compareSearch = document.getElementById('compareSearch');
    const compareQuery = document.getElementById('compareQuery');
    const compareMessage = document.getElementById('compareMessage');
    const compareResult = document.getElementById('compareResult');
    const compareUser = document.getElementById('compareUser');
    const progressGrid = document.getElementById('progressGrid');
    const comparisonNote = document.getElementById('comparisonNote');

    const primaryMetrics = [
        { key: 'discordMessages', label: 'Discord Messages', icon: 'fa-message', accent: 'violet', suffix: '' },
        { key: 'xPosts', label: 'X Posts', icon: 'fa-x-twitter', accent: 'cyan', suffix: '' },
        { key: 'xScore', label: 'X Score', icon: 'fa-bolt', accent: 'gold', suffix: ' pts' },
        { key: 'totalScore', label: 'Combined Score', icon: 'fa-chart-line', accent: 'rose', suffix: ' pts' }
    ];

    const supportMetrics = [
        { key: 'xViews', label: 'Views', icon: 'fa-eye' },
        { key: 'xLikes', label: 'Likes', icon: 'fa-heart' },
        { key: 'xReplies', label: 'Replies', icon: 'fa-reply' },
        { key: 'xReposts', label: 'Reposts', icon: 'fa-retweet' }
    ];

    let data = null;
    let selectedUser = null;

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function formatNumber(value, decimals) {
        const number = Number(value || 0);
        const options = Number.isInteger(number) && !decimals
            ? { maximumFractionDigits: 0 }
            : { minimumFractionDigits: 1, maximumFractionDigits: 1 };
        return number.toLocaleString('en-US', options);
    }

    function formatDate(date) {
        const [year, month, day] = date.split('-');
        return `${day}.${month}.${year}`;
    }

    function memberAvatar(member) {
        if (member.avatarUrl) {
            return `<img src="${escapeHtml(member.avatarUrl)}" alt="" loading="lazy">`;
        }
        return `<span>${escapeHtml(member.nickname.slice(0, 1).toUpperCase())}</span>`;
    }

    function userAvatar(user) {
        if (user.avatar_url) {
            return `<img src="${escapeHtml(user.avatar_url)}" alt="" loading="lazy">`;
        }
        const label = user.nickname || user.username || '?';
        return `<span>${escapeHtml(label.slice(0, 1).toUpperCase())}</span>`;
    }

    function calculateXScore(metrics) {
        const posts = Number(metrics.xPosts || metrics.x_posts || 0);
        const views = Number(metrics.xViews || metrics.x_views || 0);
        const likes = Number(metrics.xLikes || metrics.x_likes || 0);
        const reposts = Number(metrics.xReposts || metrics.x_reposts || 0);
        const replies = Number(metrics.xReplies || metrics.x_replies || 0);
        const raw = posts * 10 + views * 0.1 + likes + replies * 3 + reposts * 3;
        const erPercent = views > 0 ? ((likes + reposts + replies) / views) * 100 : 0;
        return Math.floor(raw * Math.min(1 + erPercent * 0.1, 1.5));
    }

    function summaryFromMember(member) {
        const summary = {};
        [...primaryMetrics, ...supportMetrics].forEach(metric => {
            summary[metric.key] = { average: Number(member[metric.key] || 0) };
        });
        return summary;
    }

    function getBenchmark() {
        const mode = benchmarkMode.value;
        if (mode === 'official') {
            const official = data.benchmarks.official;
            return {
                kind: 'official',
                label: official.label,
                effectiveAsOf: official.effectiveAsOf,
                summary: official.summary,
                members: []
            };
        }
        if (mode === 'member') {
            const member = data.members.find(item => item.username === memberBenchmark.value) || data.members[0];
            return {
                kind: 'member',
                label: `@${member.username}`,
                periodEnd: member.benchmarkPeriodEnd,
                summary: summaryFromMember(member),
                members: [member.username]
            };
        }

        let source;
        if (mode === 'current') {
            source = data.benchmarks.current;
        } else if (mode === 'previous') {
            source = data.benchmarks.previous;
        } else if (mode === 'lastThree') {
            source = data.benchmarks.lastThree;
        } else {
            source = data.benchmarks.all;
        }
        return {
            kind: 'average',
            label: source.label,
            cohortMode: mode === 'current' || mode === 'previous',
            periodEnd: source.periodEnd || null,
            summary: source.summary,
            members: source.members,
            excluded: source.excluded || [],
            usesIndividualCutoffs: Boolean(source.usesIndividualCutoffs)
        };
    }

    function renderPrimary(benchmark) {
        const valueLabel = benchmark.kind === 'member'
            ? 'member result'
            : benchmark.kind === 'official' ? 'official minimum' : 'average';
        const metrics = primaryMetrics.filter(metric => benchmark.summary[metric.key]);
        metricGrid.classList.toggle('official-grid', benchmark.kind === 'official');
        metricGrid.innerHTML = metrics.map(metric => {
            const stat = benchmark.summary[metric.key];
            return `
                <article class="benchmark-card accent-${metric.accent}">
                    <div class="card-topline">
                        <div class="metric-icon"><i class="fas ${metric.icon}"></i></div>
                        <span>${escapeHtml(benchmark.label)}</span>
                    </div>
                    <div class="metric-label">${metric.label}</div>
                    <div class="average-value">${formatNumber(stat.average, benchmark.kind === 'average')}<small>${metric.suffix}</small></div>
                    <div class="average-label">${valueLabel}</div>
                </article>
            `;
        }).join('');
    }

    function renderSupport(benchmark) {
        supportGrid.hidden = benchmark.kind === 'official';
        if (benchmark.kind === 'official') {
            supportGrid.innerHTML = '';
            return;
        }
        const suffix = benchmark.kind === 'average' ? ' avg' : '';
        supportGrid.innerHTML = supportMetrics.map(metric => {
            const stat = benchmark.summary[metric.key];
            return `
                <article class="support-card">
                    <div class="support-icon"><i class="fas ${metric.icon}"></i></div>
                    <div>
                        <span>${metric.label}</span>
                        <strong>${formatNumber(stat.average, benchmark.kind === 'average')}${suffix}</strong>
                    </div>
                </article>
            `;
        }).join('');
    }

    function renderBenchmarkContext(benchmark) {
        if (benchmark.kind === 'official') {
            benchmarkContext.innerHTML = `<i class="fas fa-certificate"></i> Official minimum requirements, effective ${formatDate(benchmark.effectiveAsOf)}.`;
        } else if (benchmarkMode.value === 'lastThree') {
            const included = benchmark.members.map(username => `@${username}`).join(', ');
            const excluded = benchmark.excluded.length
                ? ` Excluded under 2,000 messages: ${benchmark.excluded.map(username => `@${username}`).join(', ')}.`
                : '';
            benchmarkContext.innerHTML = `<i class="fas fa-users"></i> Latest eligible members: ${escapeHtml(included)}.${escapeHtml(excluded)}`;
        } else if (benchmark.kind === 'member') {
            benchmarkContext.innerHTML = `<i class="fas fa-user-shield"></i> Comparing against ${escapeHtml(benchmark.label)} through ${formatDate(benchmark.periodEnd)}, before the role award.`;
        } else if (benchmark.cohortMode) {
            benchmarkContext.innerHTML = `<i class="fas fa-users"></i> ${escapeHtml(benchmark.label)} across ${benchmark.members.length} recipients, measured through ${formatDate(benchmark.periodEnd)}.`;
        } else {
            benchmarkContext.innerHTML = `<i class="fas fa-chart-simple"></i> Average across all ${data.meta.memberCount} Encrypted recipients, each measured at their own pre-role cutoff.`;
        }
    }

    function statusFor(current, target) {
        if (target <= 0 || current >= target) return { key: 'good', label: 'Reached' };
        if (current / target >= 0.8) return { key: 'close', label: 'Close' };
        return { key: 'low', label: 'Needs work' };
    }

    function normalizedUser(apiData) {
        const user = apiData.user;
        const metrics = {
            discordMessages: Number(user.discord_messages || 0),
            xPosts: Number(user.x_posts || 0),
            xViews: Number(user.x_views || 0),
            xLikes: Number(user.x_likes || 0),
            xReposts: Number(user.x_reposts || 0),
            xReplies: Number(user.x_replies || 0)
        };
        metrics.xScore = calculateXScore(metrics);
        metrics.totalScore = metrics.discordMessages + metrics.xScore;
        return { user, stats: apiData.stats, metrics };
    }

    function renderComparison() {
        if (!selectedUser) return;
        const benchmark = getBenchmark();
        const user = selectedUser.user;
        const metrics = selectedUser.metrics;
        const isEncrypted = (user.roles || []).some(role => role.toLowerCase() === 'encrypted');
        const rank = selectedUser.stats && selectedUser.stats.rank != null
            ? `<span class="compare-rank">#${escapeHtml(selectedUser.stats.rank)}</span>`
            : '';

        compareUser.innerHTML = `
            <div class="compare-avatar">${userAvatar(user)}</div>
            <div class="compare-identity">
                <strong>${escapeHtml(user.nickname || user.username)}</strong>
                <span>@${escapeHtml(user.username)}</span>
            </div>
            ${isEncrypted ? '<span class="encrypted-role-pill"><i class="fas fa-shield-halved"></i> Encrypted</span>' : ''}
            ${rank}
        `;

        const comparisonMetrics = primaryMetrics.filter(metric => benchmark.summary[metric.key]);
        progressGrid.classList.toggle('official-grid', benchmark.kind === 'official');
        progressGrid.innerHTML = comparisonMetrics.map(metric => {
            const current = Number(metrics[metric.key] || 0);
            const target = Number(benchmark.summary[metric.key].average || 0);
            const status = statusFor(current, target);
            const remaining = Math.max(0, Math.ceil(target - current));
            const above = Math.max(0, Math.floor(current - target));
            const percent = target > 0 ? Math.min(100, (current / target) * 100) : 100;
            const gapText = status.key === 'good'
                ? `${formatNumber(above)} above target`
                : `${formatNumber(remaining)} remaining`;

            return `
                <article class="progress-card status-${status.key}">
                    <div class="progress-card-head">
                        <span><i class="fas ${metric.icon}"></i> ${metric.label}</span>
                        <strong>${status.label}</strong>
                    </div>
                    <div class="progress-values">
                        <div><span>You</span><strong>${formatNumber(current)}</strong></div>
                        <div><span>Target</span><strong>${formatNumber(target, benchmark.kind === 'average')}</strong></div>
                    </div>
                    <div class="progress-track"><i style="width:${percent.toFixed(1)}%"></i></div>
                    <div class="progress-gap">${gapText}</div>
                </article>
            `;
        }).join('');

        if (benchmark.kind === 'official') {
            comparisonNote.innerHTML = `Your stats include data through <strong>${formatDate(data.meta.currentDataEnd)}</strong>. `
                + `Official requirements are effective as of <strong>${formatDate(benchmark.effectiveAsOf)}</strong>.`;
        } else if (benchmark.kind === 'member') {
            comparisonNote.innerHTML = `Your stats include data through <strong>${formatDate(data.meta.currentDataEnd)}</strong>. `
                + `${escapeHtml(benchmark.label)} is measured through <strong>${formatDate(benchmark.periodEnd)}</strong>, before the role award.`;
        } else if (benchmark.cohortMode) {
            comparisonNote.innerHTML = `Your stats include data through <strong>${formatDate(data.meta.currentDataEnd)}</strong>. `
                + `The selected cohort average uses recipient stats through <strong>${formatDate(benchmark.periodEnd)}</strong>.`;
        } else {
            comparisonNote.innerHTML = `Your stats include data through <strong>${formatDate(data.meta.currentDataEnd)}</strong>. `
                + `The selected average uses each recipient's own pre-role cutoff.`;
        }
        compareResult.hidden = false;
        compareMessage.textContent = '';
    }

    function renderMembers(members) {
        membersBody.innerHTML = members.map((member, index) => `
            <tr>
                <td><span class="rank">${index + 1}</span></td>
                <td>
                    <button class="member-cell member-pick" type="button" data-member="${escapeHtml(member.username)}" title="Use @${escapeHtml(member.username)} as benchmark">
                        <span class="member-avatar">${memberAvatar(member)}</span>
                        <span class="member-copy">
                            <strong>${escapeHtml(member.nickname)}</strong>
                            <span class="member-handle">@${escapeHtml(member.username)}</span>
                        </span>
                    </button>
                </td>
                <td>${formatNumber(member.discordMessages)}</td>
                <td>${formatNumber(member.xPosts)}</td>
                <td class="score-value">${formatNumber(member.xScore)}</td>
                <td>${formatNumber(member.xViews)}</td>
                <td>${formatNumber(member.xLikes)}</td>
                <td>${formatNumber(member.xReplies)}</td>
                <td>${formatNumber(member.xReposts)}</td>
                <td class="total-value">${formatNumber(member.totalScore)}</td>
            </tr>
        `).join('');
    }

    function renderMembersForMode() {
        const mode = benchmarkMode.value;
        if (mode === 'current' || mode === 'previous') {
            const cohort = data.benchmarks[mode];
            const usernames = new Set(cohort.members);
            renderMembers(data.members.filter(member => usernames.has(member.username)));
            membersPanelNote.textContent = `${cohort.label}: ${cohort.members.length} recipients, ranked by pre-role combined score`;
            return;
        }

        renderMembers(data.members);
        membersPanelNote.textContent = `All ${data.meta.memberCount} recipients, ranked by combined score at each member's pre-role cutoff`;
    }

    function renderSelectedBenchmark() {
        memberBenchmarkField.hidden = benchmarkMode.value !== 'member';
        const benchmark = getBenchmark();
        renderPrimary(benchmark);
        renderSupport(benchmark);
        renderBenchmarkContext(benchmark);
        renderMembersForMode();
        renderComparison();
    }

    async function searchUser(event) {
        event.preventDefault();
        const query = compareQuery.value.trim().replace(/^@/, '');
        if (!query) return;

        compareMessage.className = 'compare-message loading';
        compareMessage.textContent = 'Searching...';
        compareResult.hidden = true;

        try {
            const response = await fetch(`/api/user/${encodeURIComponent(query)}?t=${Date.now()}`);
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'User not found');
            selectedUser = normalizedUser(result);
            renderComparison();
        } catch (error) {
            selectedUser = null;
            compareMessage.className = 'compare-message error';
            compareMessage.textContent = error.message === 'User not found'
                ? 'User not found. Try the exact Discord username or nickname.'
                : error.message;
        }
    }

    async function load() {
        try {
            const response = await fetch(`data/encrypted_stats.json?t=${Date.now()}`);
            if (!response.ok) throw new Error('Encrypted analytics data was not found.');
            data = await response.json();

            periodBadge.innerHTML = `<i class="fas fa-calendar"></i> ${formatDate(data.meta.periodStart)} - ${formatDate(data.meta.periodEnd)}`;
            cohortBadge.innerHTML = `<i class="fas fa-users"></i> ${data.meta.memberCount} role recipients / ${data.meta.cohortCount} cohorts`;
            memberBenchmark.innerHTML = data.members
                .map(member => `<option value="${escapeHtml(member.username)}">@${escapeHtml(member.username)} - ${escapeHtml(member.nickname)}</option>`)
                .join('');
            renderSelectedBenchmark();
        } catch (error) {
            console.error(error);
            metricGrid.innerHTML = `<div class="loading-card error">Unable to load Encrypted analytics.</div>`;
        }
    }

    benchmarkMode.addEventListener('change', renderSelectedBenchmark);
    memberBenchmark.addEventListener('change', renderSelectedBenchmark);
    compareSearch.addEventListener('submit', searchUser);
    membersBody.addEventListener('click', event => {
        const button = event.target.closest('.member-pick');
        if (!button) return;
        benchmarkMode.value = 'member';
        memberBenchmark.value = button.dataset.member;
        renderSelectedBenchmark();
        document.querySelector('.compare-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    load();
})();
