(function () {
    'use strict';

    const roleHolderCount = document.getElementById('roleHolderCount');
    const flaggedUserCount = document.getElementById('flaggedUserCount');
    const flaggedPostCount = document.getElementById('flaggedPostCount');
    const dataThrough = document.getElementById('dataThrough');
    const searchInput = document.getElementById('searchInput');
    const reasonFilter = document.getElementById('reasonFilter');
    const periodFilter = document.getElementById('periodFilter');
    const minimumFilter = document.getElementById('minimumFilter');
    const sortFilter = document.getElementById('sortFilter');
    const visibleUsers = document.getElementById('visibleUsers');
    const visiblePosts = document.getElementById('visiblePosts');
    const auditResults = document.getElementById('auditResults');

    let data = null;

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function formatNumber(value) {
        return Number(value || 0).toLocaleString('en-US');
    }

    function formatDate(value) {
        if (!value) return '-';
        const [year, month, day] = value.slice(0, 10).split('-');
        return `${day}.${month}.${year}`;
    }

    function avatar(user) {
        if (user.avatarUrl) {
            return `<img src="${escapeHtml(user.avatarUrl)}" alt="" loading="lazy">`;
        }
        return escapeHtml((user.nickname || user.username || '?').slice(0, 1).toUpperCase());
    }

    function reasonBadges(post) {
        return post.reasons.map(reason => {
            if (reason === 'comments_more_than_likes') {
                return '<span class="reason-badge reason-comments">Comments &gt; likes</span>';
            }
            return '<span class="reason-badge reason-views">1-4 likes / 1K+ views</span>';
        }).join('');
    }

    function matchesSearch(user, posts, query) {
        if (!query) return true;
        const identity = `${user.username} ${user.nickname}`.toLowerCase();
        if (identity.includes(query)) return true;
        return posts.some(post => (post.authorHandle || '').toLowerCase().includes(query));
    }

    function filteredPosts(user) {
        const reason = reasonFilter.value;
        const currentOnly = periodFilter.value === 'current';
        return user.posts.filter(post => {
            if (currentOnly && !post.isCurrentPeriod) return false;
            if (reason !== 'all' && !post.reasons.includes(reason)) return false;
            return true;
        });
    }

    function renderPostRows(posts) {
        return posts.map(post => `
            <tr>
                <td>${formatDate(post.date)}</td>
                <td>
                    <a class="post-link" href="${escapeHtml(post.url)}" target="_blank" rel="noopener noreferrer">
                        <i class="fa-brands fa-x-twitter"></i>
                        @${escapeHtml(post.authorHandle || 'unknown')}
                        <i class="fas fa-arrow-up-right-from-square"></i>
                    </a>
                </td>
                <td>${formatNumber(post.views)}</td>
                <td>${formatNumber(post.likes)}</td>
                <td class="${post.comments > post.likes ? 'metric-danger' : ''}">${formatNumber(post.comments)}</td>
                <td>${formatNumber(post.reposts)}</td>
                <td><div class="reason-badges">${reasonBadges(post)}</div></td>
            </tr>
        `).join('');
    }

    function renderUser(user, posts, open) {
        const commentsCount = posts.filter(post => post.reasons.includes('comments_more_than_likes')).length;
        const viewsCount = posts.filter(post => post.reasons.includes('low_likes_high_views')).length;
        return `
            <details class="user-card" ${open ? 'open' : ''}>
                <summary>
                    <div class="identity">
                        <div class="avatar">${avatar(user)}</div>
                        <div class="identity-copy">
                            <strong>${escapeHtml(user.nickname)}</strong>
                            <span>@${escapeHtml(user.username)}</span>
                        </div>
                    </div>
                    <div class="reason-count">
                        <span>Comments &gt; likes</span>
                        <strong>${commentsCount}</strong>
                    </div>
                    <div class="reason-count">
                        <span>Low likes / high views</span>
                        <strong>${viewsCount}</strong>
                    </div>
                    <div class="flag-total">${posts.length} flags</div>
                    <i class="fas fa-chevron-down chevron"></i>
                </summary>
                <div class="post-table-wrap">
                    <table>
                        <thead>
                            <tr>
                                <th>Date</th>
                                <th>X post</th>
                                <th>Views</th>
                                <th>Likes</th>
                                <th>Comments</th>
                                <th>Reposts</th>
                                <th>Reason</th>
                            </tr>
                        </thead>
                        <tbody>${renderPostRows(posts)}</tbody>
                    </table>
                </div>
            </details>
        `;
    }

    function render() {
        if (!data) return;
        const query = searchInput.value.trim().toLowerCase().replace(/^@/, '');
        const minimum = Number(minimumFilter.value);

        const users = data.users.map(user => ({
            user,
            posts: filteredPosts(user)
        })).filter(item =>
            item.posts.length >= minimum && matchesSearch(item.user, item.posts, query)
        );

        if (sortFilter.value === 'name') {
            users.sort((a, b) => a.user.username.localeCompare(b.user.username));
        } else if (sortFilter.value === 'recent') {
            users.sort((a, b) =>
                (b.posts[0] && b.posts[0].timestamp || '').localeCompare(
                    a.posts[0] && a.posts[0].timestamp || ''
                )
            );
        } else {
            users.sort((a, b) => b.posts.length - a.posts.length || a.user.username.localeCompare(b.user.username));
        }

        const postCount = users.reduce((sum, item) => sum + item.posts.length, 0);
        visibleUsers.textContent = `${users.length} ${users.length === 1 ? 'user' : 'users'}`;
        visiblePosts.textContent = `${postCount} matching ${postCount === 1 ? 'post' : 'posts'}`;

        if (users.length === 0) {
            auditResults.innerHTML = '<div class="empty-card">No users match the selected filters.</div>';
            return;
        }

        const openFirst = Boolean(query) || users.length <= 3;
        auditResults.innerHTML = users.map((item, index) =>
            renderUser(item.user, item.posts, openFirst && index === 0)
        ).join('');
    }

    async function load() {
        try {
            const response = await fetch(`data/encrypted_audit_7c9f4d.json?t=${Date.now()}`);
            if (!response.ok) throw new Error('Audit data was not found.');
            data = await response.json();

            roleHolderCount.textContent = formatNumber(data.meta.encryptedRoleHolders);
            flaggedUserCount.textContent = formatNumber(data.meta.flaggedUsers);
            flaggedPostCount.textContent = formatNumber(data.meta.suspiciousPosts);
            dataThrough.textContent = formatDate(data.meta.dataThrough);
            render();
        } catch (error) {
            console.error(error);
            auditResults.innerHTML = `<div class="empty-card">${escapeHtml(error.message)}</div>`;
        }
    }

    searchInput.addEventListener('input', render);
    reasonFilter.addEventListener('change', render);
    periodFilter.addEventListener('change', render);
    minimumFilter.addEventListener('change', render);
    sortFilter.addEventListener('change', render);

    load();
})();
