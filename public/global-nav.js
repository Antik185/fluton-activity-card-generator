// global-nav.js
// Get current path to determine active state
const path = window.location.pathname;
const isGenerator = path.includes('generator.html');
const isFight     = path.includes('fight.html');
const isMascot    = path.includes('mascot');
const isEncrypted = path.includes('encrypted.html');

// Relative base so links work from any subdirectory
const base = '';

// Create nav structure
const navHTML = `
    <nav class="global-nav">
        <div class="nav-left">
            <a href="${base}index.html" class="nav-logo-wrap">
                <img src="${base}logo.png" alt="Fluton" class="nav-logo">
                <span class="nav-brand">Fluton</span>
            </a>
        </div>
        <div class="nav-center">
            <a href="${base}index.html" class="nav-item ${(!isGenerator && !isFight && !isMascot && !isEncrypted) ? 'active' : ''}">
                <i class="fas fa-trophy nav-item-icon"></i>
                <span>Leaderboard</span>
            </a>
            <a href="${base}generator.html" class="nav-item ${isGenerator ? 'active' : ''}">
                <i class="fas fa-paintbrush nav-item-icon"></i>
                <span>Card Generator</span>
            </a>
            <a href="${base}fight.html" class="nav-item ${isFight ? 'active' : ''}">
                <span class="nav-item-icon">⚔️</span>
                <span>Fight</span>
            </a>
            <a href="${base}encrypted.html" class="nav-item ${isEncrypted ? 'active' : ''}">
                <i class="fas fa-shield-halved nav-item-icon"></i>
                <span>Encrypted</span>
            </a>
            <a href="mascot.html" class="nav-item ${isMascot ? 'active' : ''}">
                <span class="nav-item-icon">🎨</span>
                <span>Mascot</span>
            </a>
        </div>
        <div class="nav-right">
            <a href="https://x.com/Virdzhi292" target="_blank" class="nav-subtitle">@Virdzhi292</a>
            <div class="nav-divider"></div>
            <div class="nav-subtitle">Last updated: 18.10.2026</div>
        </div>
    </nav>
`;

document.body.insertAdjacentHTML('afterbegin', navHTML);
