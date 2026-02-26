// global-nav.js
// Get current path to determine active state
// Simple check: if ending in generator.html, else assume index/leaderboard
const isGenerator = window.location.pathname.includes('generator.html');

// Create nav structure
const navHTML = `
    <nav class="global-nav">
        <div class="nav-left">
            <a href="index.html" class="nav-logo-wrap">
                <img src="logo.png" alt="Fluton" class="nav-logo">
                <span class="nav-brand">Fluton</span>
            </a>
        </div>
        <div class="nav-center">
            <a href="index.html" class="nav-item ${!isGenerator ? 'active' : ''}">
                <i class="fas fa-trophy nav-item-icon"></i>
                <span>Leaderboard</span>
            </a>
            <a href="generator.html" class="nav-item ${isGenerator ? 'active' : ''}">
                <i class="fas fa-paintbrush nav-item-icon"></i>
                <span>Card Generator</span>
            </a>
        </div>
        <div class="nav-right">
            <a href="https://x.com/Virdzhi292" target="_blank" class="nav-subtitle">@Virdzhi292</a>
            <div class="nav-divider"></div>
            <div class="nav-subtitle">Last updated: 2/25/2026</div>
        </div>
    </nav>
`;

document.body.insertAdjacentHTML('afterbegin', navHTML);
