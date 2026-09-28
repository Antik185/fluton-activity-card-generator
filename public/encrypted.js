(function () {
    'use strict';

    const metricGrid = document.getElementById('metricGrid');
    const supportGrid = document.getElementById('supportGrid');
    const membersBody = document.getElementById('membersBody');
    const periodBadge = document.getElementById('periodBadge');
    const cohortBadge = document.getElementById('cohortBadge');

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

    function formatNumber(value, decimals) {
        const options = Number.isInteger(value) && !decimals
            ? { maximumFractionDigits: 0 }
            : { minimumFractionDigits: 1, maximumFractionDigits: 1 };
        return Number(value || 0).toLocaleString('en-US', options);
    }

    function formatDate(date) {
        const [year, month, day] = date.split('-');
        return `${day}.${month}.${year}`;
    }

    function avatar(member) {
        if (member.avatarUrl) {
            return `<img src="${member.avatarUrl}" alt="" loading="lazy">`;
        }
        return `<span>${member.nickname.slice(0, 1).toUpperCase()}</span>`;
    }

    function renderPrimary(summary) {
        metricGrid.innerHTML = primaryMetrics.map(metric => {
            const stat = summary[metric.key];
            return `
                <article class="benchmark-card accent-${metric.accent}">
                    <div class="card-topline">
                        <div class="metric-icon"><i class="fas ${metric.icon}"></i></div>
                        <span>Role benchmark</span>
                    </div>
                    <div class="metric-label">${metric.label}</div>
                    <div class="average-value">${formatNumber(stat.average, true)}<small>${metric.suffix}</small></div>
                    <div class="average-label">average</div>
                </article>
            `;
        }).join('');
    }

    function renderSupport(summary) {
        supportGrid.innerHTML = supportMetrics.map(metric => {
            const stat = summary[metric.key];
            return `
                <article class="support-card">
                    <div class="support-icon"><i class="fas ${metric.icon}"></i></div>
                    <div>
                        <span>${metric.label}</span>
                        <strong>${formatNumber(stat.average, true)} avg</strong>
                    </div>
                </article>
            `;
        }).join('');
    }

    function renderMembers(members) {
        membersBody.innerHTML = members.map(member => `
            <tr>
                <td><span class="rank">${member.rank}</span></td>
                <td>
                    <div class="member-cell">
                        <div class="member-avatar">${avatar(member)}</div>
                        <div>
                            <strong>${member.nickname}</strong>
                            <span>@${member.username}</span>
                        </div>
                    </div>
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

    async function load() {
        try {
            const response = await fetch(`data/encrypted_stats.json?t=${Date.now()}`);
            if (!response.ok) throw new Error('Encrypted analytics data was not found.');
            const data = await response.json();

            periodBadge.innerHTML = `<i class="fas fa-calendar"></i> ${formatDate(data.meta.periodStart)} - ${formatDate(data.meta.periodEnd)}`;
            cohortBadge.innerHTML = `<i class="fas fa-users"></i> ${data.meta.memberCount} role recipients`;
            renderPrimary(data.summary);
            renderSupport(data.summary);
            renderMembers(data.members);
        } catch (error) {
            console.error(error);
            metricGrid.innerHTML = `<div class="loading-card error">Unable to load Encrypted analytics.</div>`;
        }
    }

    load();
})();
