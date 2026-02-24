document.addEventListener('DOMContentLoaded', () => {
    const usernameInput = document.getElementById('usernameInput');
    const generateBtn = document.getElementById('generateBtn');
    const errorMsg = document.getElementById('errorMsg');
    const loadingSpinner = document.getElementById('loadingSpinner');
    const cardContainer = document.getElementById('cardContainer');
    const downloadBtn = document.getElementById('downloadBtn');
    const shareBtn = document.getElementById('shareBtn');

    // Card Elements
    const userAvatar = document.getElementById('userAvatar');
    const userNickname = document.getElementById('userNickname');
    const userUsername = document.getElementById('userUsername');
    const rankBadge = document.getElementById('rankBadge');
    const rolesContainer = document.getElementById('rolesContainer');
    const discordPoints = document.getElementById('discordPoints');
    const xPoints = document.getElementById('xPoints');
    const xLikes = document.getElementById('xLikes');
    const xReposts = document.getElementById('xReposts');
    const xComments = document.getElementById('xComments');
    const xViews = document.getElementById('xViews');
    const totalPoints = document.getElementById('totalPoints');

    generateBtn.addEventListener('click', fetchUserData);
    usernameInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') fetchUserData();
    });

    downloadBtn.addEventListener('click', downloadCard);

    shareBtn.addEventListener('click', () => {
        const score = totalPoints.innerText;
        const rank = rankBadge.innerText;
        const text = `I just grabbed my Fluton Activity Card! 🃏✨\n\n🏆 Total Impact Score: ${score}\n📈 Rank: ${rank}\n\nCheck your stats here:`;
        const targetUrl = 'https://fluton-activity-card-generator.vercel.app/';
        const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(targetUrl)}`;
        window.open(url, '_blank', 'noopener,noreferrer');
    });

    // Initialize Simple Horizontal Overlap Carousel
    initSimpleCarousel();

    function initSimpleCarousel() {
        const carouselContainer = document.getElementById('carouselContainer');
        const carouselWrapper = document.getElementById('carouselWrapper');
        if (!carouselContainer || !carouselWrapper) return;

        let itemsHtml = '';
        // 10 items
        for (let i = 1; i <= 10; i++) {
            itemsHtml += `
            <div class="carousel-item">
                <img src="cards/${i}.png" onerror="this.src='https://cdn.discordapp.com/embed/avatars/0.png'" />
            </div>`;
        }
        // Duplicate items twice for smooth infinite loop
        carouselContainer.innerHTML = itemsHtml + itemsHtml + itemsHtml;

        let isHovered = false;
        let frameCount = 0;
        carouselWrapper.addEventListener('mouseenter', () => isHovered = true);
        carouselWrapper.addEventListener('mouseleave', () => isHovered = false);

        // Simple right-to-left auto scroll loop
        function scrollLoop() {
            if (!isHovered && carouselContainer.children.length > 0) {
                frameCount++;
                if (frameCount % 2 === 0) { // scroll every other frame (half speed)
                    carouselContainer.scrollLeft += 1;

                    // Calculate exact width of one set of 10 items including gap
                    const firstItem = carouselContainer.children[0];
                    const gap = parseInt(window.getComputedStyle(carouselContainer).gap) || 0;
                    const itemWidthAndGap = firstItem.offsetWidth + gap;
                    const resetPosition = itemWidthAndGap * 10; // 10 base items

                    // Seamless snap back
                    if (carouselContainer.scrollLeft >= resetPosition) {
                        carouselContainer.scrollLeft -= resetPosition;
                    }
                }
            }
            requestAnimationFrame(scrollLoop);
        }

        requestAnimationFrame(scrollLoop);
    }

    async function fetchUserData() {
        const username = usernameInput.value.trim();
        if (!username) return;

        // Start fade out transition if card is already visible
        if (!cardContainer.classList.contains('hidden')) {
            cardContainer.classList.add('fading-out');

            // Wait for fade out animation
            await new Promise(r => setTimeout(r, 400));
        }

        // Hide carousel if it's visible
        const carouselWrapper = document.getElementById('carouselWrapper');
        if (carouselWrapper && !carouselWrapper.classList.contains('hidden')) {
            carouselWrapper.classList.add('hidden');
        }

        // Wipe old card data to prevent flashing while new image loads
        userAvatar.src = 'https://cdn.discordapp.com/embed/avatars/0.png';
        userNickname.textContent = '';
        userUsername.textContent = '';
        rankBadge.textContent = '';
        rolesContainer.innerHTML = '';
        discordPoints.innerHTML = '0';
        xPoints.innerHTML = '0';
        xLikes.innerHTML = '0';
        xReposts.innerHTML = '0';
        if (xComments) xComments.innerHTML = '0';
        xViews.innerHTML = '0';
        totalPoints.innerHTML = '0';

        // Reset UI
        errorMsg.classList.add('hidden');
        cardContainer.classList.add('hidden');

        loadingSpinner.classList.remove('hidden');

        try {
            // Artificial delay for smooth loading UX when requests are too fast locally
            await new Promise(r => setTimeout(r, 600));

            const response = await fetch('/api/user/' + encodeURIComponent(username));
            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'User not found');
            }

            populateCard(data);
        } catch (err) {
            errorMsg.textContent = err.message;
            errorMsg.classList.remove('hidden');
            loadingSpinner.classList.add('hidden');
        }
    }

    function populateCard(data) {
        const { user, stats } = data;

        // Set Images & Text
        userAvatar.src = user.avatar_url || 'https://cdn.discordapp.com/embed/avatars/0.png';

        // Handle image loading error
        userAvatar.onerror = function () {
            this.src = 'https://cdn.discordapp.com/embed/avatars/0.png';
        };

        userNickname.textContent = user.nickname || user.username;
        userUsername.textContent = user.username;
        rankBadge.innerHTML = '#' + stats.rank + '<br>' + stats.percentile;

        // Apply tier class for card-tiers.css colours & animations
        const cardElement = document.getElementById('activityCard');
        const topRatio = (stats.rank / stats.totalUsers) * 100;
        // Strip old tier classes
        cardElement.classList.remove('card-top-50', 'card-top-10', 'card-top-1', 'card-top-01');

        if (topRatio <= 0.1 || stats.rank <= 10) {
            cardElement.classList.add('card-top-01');
        } else if (topRatio <= 1) {
            cardElement.classList.add('card-top-1');
        } else if (topRatio <= 10) {
            cardElement.classList.add('card-top-10');
        } else if (topRatio <= 50) {
            cardElement.classList.add('card-top-50');
        }

        // Animate numbers
        animateValue(discordPoints, 0, user.discord_messages, 1000);
        animateValue(xPoints, 0, user.x_posts, 1000);
        animateValue(xLikes, 0, user.x_likes || 0, 1000);
        animateValue(xReposts, 0, user.x_reposts || 0, 1000);
        if (xComments) animateValue(xComments, 0, user.x_comments || 0, 1000);
        animateValue(xViews, 0, user.x_views || 0, 1000);
        animateValue(totalPoints, 0, user.total_points, 1500);

        // Roles Priorities
        const rolePriority = {
            'admin': 1,
            'team': 2,
            'moderator': 3,
            'regional mod': 4,
            'server booster': 5,
            'encrypted': 6,
            'early': 7
        };
        const getRoleWeight = (role) => rolePriority[role.toLowerCase()] || 99;

        rolesContainer.innerHTML = '';
        if (user.roles && user.roles.length > 0) {
            // Sort roles by priority
            const sortedRoles = [...user.roles].sort((a, b) => getRoleWeight(a) - getRoleWeight(b));

            // Take up to 3 roles to avoid clutter
            const displayRoles = sortedRoles.slice(0, 3);
            displayRoles.forEach(role => {
                const span = document.createElement('span');
                span.className = 'role-tag';
                const roleClass = role.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
                span.classList.add('role-' + roleClass);
                span.textContent = role;
                rolesContainer.appendChild(span);
            });
            if (sortedRoles.length > 3) {
                const span = document.createElement('span');
                span.className = 'role-tag extra-tag';
                span.textContent = '+' + (sortedRoles.length - 3);
                rolesContainer.appendChild(span);
            }
        }

        loadingSpinner.classList.add('hidden');

        // Prepare for fade-in
        cardContainer.classList.add('fading-out');
        cardContainer.classList.remove('hidden');

        // Trigger reflow to ensure the transition happens
        void cardContainer.offsetWidth;

        // Fade in
        cardContainer.classList.remove('fading-out');
    }

    function animateValue(obj, start, end, duration) {
        let startTimestamp = null;
        if (obj.animationId) {
            cancelAnimationFrame(obj.animationId);
        }
        const step = (timestamp) => {
            if (!startTimestamp) startTimestamp = timestamp;
            const progress = Math.min((timestamp - startTimestamp) / duration, 1);
            obj.innerHTML = Math.floor(progress * (end - start) + start).toLocaleString();
            if (progress < 1) {
                obj.animationId = window.requestAnimationFrame(step);
            }
        };
        obj.animationId = window.requestAnimationFrame(step);
    }

    function downloadCard() {
        const cardElement = document.getElementById('activityCard');

        // Add export-mode to get a clean render
        cardElement.classList.add('export-mode');

        html2canvas(cardElement, {
            scale: 2,
            backgroundColor: '#0a0d14',
            useCORS: true,
            logging: false,
            allowTaint: true
        }).then(canvas => {
            cardElement.classList.remove('export-mode');

            const link = document.createElement('a');
            link.download = userUsername.textContent + '-activity-card.png';
            link.href = canvas.toDataURL('image/png');
            link.click();
        }).catch(err => {
            cardElement.classList.remove('export-mode');
            console.error('Error generating image:', err);
            alert('Could not generate the image.');
        });
    }
});
