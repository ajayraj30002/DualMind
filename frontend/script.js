/**
 * DualMind - Frontend Application Controller
 * Enterprise Grade UI/UX with Custom In-App Modal Dialogs (No Browser Alert/Confirm Popups)
 */

// API Configuration (Supports Render backend, custom URLs, and local dev)
const _urlParams = new URLSearchParams(window.location.search);
const _overrideBackend = _urlParams.get('backend') || _urlParams.get('backend_url');
if (_overrideBackend) {
    localStorage.setItem('dualmind_backend_url', _overrideBackend.replace(/\/+$/, ''));
}
const _savedBackend = localStorage.getItem('dualmind_backend_url');

let API_URL = window.__ENV__?.BACKEND_URL;
if (!API_URL || API_URL === '${BACKEND_URL}') {
    if (_savedBackend) {
        API_URL = _savedBackend;
    } else {
        const port = window.location.port;
        const isLocalHost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
        const isStaticDevPort = ['8080', '3000', '5173', '5174', '5175', '5500'].includes(port);
        API_URL = (isLocalHost && isStaticDevPort)
            ? 'http://localhost:8000'
            : window.location.origin;
    }
}

// Global Application State
let token = null;
let user = null;
let currentSessionId = null;
let currentMode = 'hybrid';
let pendingFile = null;
let currentSessionDocuments = [];
let pendingSignupEmail = null;
let allSessions = [];
let currentSelectedModel = localStorage.getItem('dualmind_model_preference') || 'auto';
let availableModels = [];

// DOM References
let loginPage, chatPage, sessionListDiv, messagesDiv, messageInput, sendBtn;
let newChatBtn, logoutBtn, chatTitleSpan, attachBtn, fileInput, fileBadge;
let modeBtns, loadingOverlay, sidebar, sidebarToggle, scrollBottomBtn;
let sessionSearchInput, clearSearchBtn;

// Modal references
let confirmModal, confirmTitle, confirmMessage, confirmActionBtn, confirmCancelBtn;
let promptModal, promptTitle, promptMessage, promptInput, promptSaveBtn, promptCancelBtn;
let confirmResolveFn = null;
let promptResolveFn = null;

function getUserDisplayName() {
    if (!user || !user.email) return 'Analyst';
    const raw = user.email.split('@')[0].replace(/[0-9_.-]/g, ' ').trim();
    if (!raw) return 'Analyst';
    const firstWord = raw.split(/\s+/)[0];
    return firstWord.charAt(0).toUpperCase() + firstWord.slice(1).toLowerCase();
}

function getDynamicCatchUpMessage(userName = 'Analyst') {
    const hour = new Date().getHours();
    let timeGreeting = '';
    let headlinePre = '';
    let headlineHighlight = '';

    if (hour >= 5 && hour < 12) {
        // Morning: High energy, fresh start, productive
        const morningGreetings = [
            `Good morning, ${userName}`,
            `Welcome back, ${userName}`,
            `Bright and early, ${userName}`,
            `Ready to tackle the day, ${userName}?`
        ];
        const morningHeadlines = [
            { pre: 'Ready to dig into your next ', highlight: 'deep inquiry?' },
            { pre: 'What would you like to ', highlight: 'synthesize today?' },
            { pre: 'What intelligence shall we ', highlight: 'uncover this morning?' },
            { pre: 'Ready to turn complex documents into ', highlight: 'clear answers?' }
        ];
        timeGreeting = morningGreetings[Math.floor(Math.random() * morningGreetings.length)];
        const h = morningHeadlines[Math.floor(Math.random() * morningHeadlines.length)];
        headlinePre = h.pre;
        headlineHighlight = h.highlight;
    } else if (hour >= 12 && hour < 17) {
        // Afternoon: Flow state, execution, deep dive
        const afternoonGreetings = [
            `Good afternoon, ${userName}`,
            `Welcome back, ${userName}`,
            `Midday momentum, ${userName}`,
            `Keeping up the pace, ${userName}`
        ];
        const afternoonHeadlines = [
            { pre: 'Ready to dig into your next ', highlight: 'deep inquiry?' },
            { pre: 'What would you like to ', highlight: 'synthesize today?' },
            { pre: 'Where shall we direct your ', highlight: 'focus this afternoon?' },
            { pre: 'What files or live web data shall we ', highlight: 'cross-examine?' }
        ];
        timeGreeting = afternoonGreetings[Math.floor(Math.random() * afternoonGreetings.length)];
        const h = afternoonHeadlines[Math.floor(Math.random() * afternoonHeadlines.length)];
        headlinePre = h.pre;
        headlineHighlight = h.highlight;
    } else if (hour >= 17 && hour < 21) {
        // Evening: Winding down, review, synthesis, clarity
        const eveningGreetings = [
            `Good evening, ${userName}`,
            `Welcome back, ${userName}`,
            `Evening synthesis, ${userName}`,
            `Wrapping up discoveries, ${userName}`
        ];
        const eveningHeadlines = [
            { pre: 'Ready to dig into your next ', highlight: 'deep inquiry?' },
            { pre: "Let's review and synthesize your ", highlight: 'findings tonight.' },
            { pre: 'What final insights would you like to ', highlight: 'uncover today?' },
            { pre: 'What questions shall we ', highlight: 'clarify this evening?' }
        ];
        timeGreeting = eveningGreetings[Math.floor(Math.random() * eveningGreetings.length)];
        const h = eveningHeadlines[Math.floor(Math.random() * eveningHeadlines.length)];
        headlinePre = h.pre;
        headlineHighlight = h.highlight;
    } else {
        // Late Night / Midnight (21:00 - 05:00): Quiet, deep work, curiosity
        const nightGreetings = [
            `Quiet hours, ${userName}`,
            `Welcome back, ${userName}`,
            `Late night deep work, ${userName}`,
            `Midnight inspiration, ${userName}`
        ];
        const nightHeadlines = [
            { pre: 'Ready to dig into your next ', highlight: 'deep inquiry?' },
            { pre: 'Deep focus hours. What are we ', highlight: 'investigating tonight?' },
            { pre: 'Uninterrupted thinking. What shall we ', highlight: 'synthesize tonight?' },
            { pre: 'Midnight breakthroughs start with the ', highlight: 'right question.' }
        ];
        timeGreeting = nightGreetings[Math.floor(Math.random() * nightGreetings.length)];
        const h = nightHeadlines[Math.floor(Math.random() * nightHeadlines.length)];
        headlinePre = h.pre;
        headlineHighlight = h.highlight;
    }

    return {
        greeting: timeGreeting,
        headlineHtml: `${headlinePre}<span class="gradient-orange-text">${headlineHighlight}</span>`
    };
}

function getTimeGreeting(name) {
    return getDynamicCatchUpMessage(name).greeting;
}

function getDynamicBrainMarkup() {
    return `
    <div class="dynamic-brain-core">
        <div class="brain-backdrop-glow"></div>
        <svg class="brain-orbit-svg" viewBox="0 0 200 200" aria-hidden="true">
            <circle cx="100" cy="100" r="92" fill="none" stroke="rgba(255, 173, 104, 0.28)" stroke-width="1" class="orbit-ring-outer"/>
            <circle cx="100" cy="100" r="85" fill="none" stroke="rgba(255, 255, 255, 0.08)" stroke-width="1" stroke-dasharray="2 12" class="orbit-ring-ticks"/>
            <circle cx="100" cy="100" r="76" fill="none" stroke="rgba(180, 154, 255, 0.24)" stroke-width="1" stroke-dasharray="24 16" class="orbit-ring-inner"/>
        </svg>
        <img class="dynamic-brain-image" src="dualmind_brain_tight.png?v=2.9.0" alt="DualMind Neural Brain Core" width="160" height="165">
        <div class="synapse-spark spark-1"></div>
        <div class="synapse-spark spark-2"></div>
        <div class="synapse-spark spark-3"></div>
    </div>
    `;
}

// DualMind Enterprise Stage HTML
function getWelcomeHtml(userName = null) {
    const displayName = userName || getUserDisplayName();
    const catchUp = getDynamicCatchUpMessage(displayName);
    return `
    <div class="welcome-stage" id="welcomeHero">
        <div class="orb-visual-wrap">
            ${getDynamicBrainMarkup()}
        </div>

        <h2 class="welcome-greeting-text" id="welcomeGreeting">${catchUp.greeting}</h2>
        <h1 class="welcome-headline-text">${catchUp.headlineHtml}</h1>
        
        <div class="starter-section-wrap">
            <div class="starter-section-heading">AGENTIC RETRIEVAL CAPABILITIES</div>
            <div class="starter-cards-grid">
                <button class="starter-tall-card" data-prompt="Synthesize the core takeaways, methodology, and empirical conclusions from the attached PDF document.">
                    <div class="card-header-row">
                        <span class="card-eyebrow"><span class="eyebrow-accent dot-amber"></span>HYBRID RAG</span>
                        <span class="card-top-icon"><i class="fas fa-file-lines"></i></span>
                    </div>
                    <div class="card-body-wrap">
                        <span class="card-prompt-label">Synthesize document findings & methodology</span>
                        <span class="card-desc">Multi-vector neural embeddings + BM25 keyword reranking</span>
                    </div>
                    <div class="card-action-cue">
                        <span>Synthesize</span>
                        <i class="fas fa-arrow-right"></i>
                    </div>
                </button>

                <button class="starter-tall-card" data-prompt="Cross-examine the claims in my attached document against current public industry consensus found online.">
                    <div class="card-header-row">
                        <span class="card-eyebrow"><span class="eyebrow-accent dot-violet"></span>LIVE INTEL</span>
                        <span class="card-top-icon"><i class="fas fa-globe"></i></span>
                    </div>
                    <div class="card-body-wrap">
                        <span class="card-prompt-label">Cross-examine claims with live web</span>
                        <span class="card-desc">Real-time public consensus & source verification</span>
                    </div>
                    <div class="card-action-cue">
                        <span>Cross-examine</span>
                        <i class="fas fa-arrow-right"></i>
                    </div>
                </button>

                <button class="starter-tall-card" data-prompt="Perform an in-depth ATS resume audit with score breakdown, keyword density, and actionable fixes.">
                    <div class="card-header-row">
                        <span class="card-eyebrow"><span class="eyebrow-accent dot-green"></span>ATS AUDIT</span>
                        <span class="card-top-icon"><i class="fas fa-shield-halved"></i></span>
                    </div>
                    <div class="card-body-wrap">
                        <span class="card-prompt-label">Comprehensive ATS resume audit</span>
                        <span class="card-desc">Keyword density, section scoring & structural fixes</span>
                    </div>
                    <div class="card-action-cue">
                        <span>Audit</span>
                        <i class="fas fa-arrow-right"></i>
                    </div>
                </button>

                <button class="starter-tall-card" data-prompt="Explain the architecture of hybrid reciprocal rank fusion (RRF) and provide a Python implementation.">
                    <div class="card-header-row">
                        <span class="card-eyebrow"><span class="eyebrow-accent dot-blue"></span>ARCHITECTURE</span>
                        <span class="card-top-icon"><i class="fas fa-code"></i></span>
                    </div>
                    <div class="card-body-wrap">
                        <span class="card-prompt-label">Hybrid RRF architecture & code</span>
                        <span class="card-desc">Reciprocal Rank Fusion formula & runnable Python</span>
                    </div>
                    <div class="card-action-cue">
                        <span>Explain</span>
                        <i class="fas fa-arrow-right"></i>
                    </div>
                </button>
            </div>
        </div>
    </div>
    `;
}

// ============================================================================
// CUSTOM IN-APP MODAL POPUPS (Replaces browser confirm() and prompt())
// ============================================================================
function showConfirmDialog(title, message, confirmText = 'Delete', isDanger = true) {
    return new Promise((resolve) => {
        if (!confirmModal) {
            confirmModal = document.getElementById('customConfirmModal');
            confirmTitle = document.getElementById('confirmModalTitle');
            confirmMessage = document.getElementById('confirmModalMessage');
            confirmActionBtn = document.getElementById('confirmModalActionBtn');
            confirmCancelBtn = document.getElementById('confirmModalCancelBtn');
        }

        if (!confirmModal) {
            resolve(window.confirm(message));
            return;
        }

        confirmTitle.textContent = title;
        confirmMessage.textContent = message;
        confirmActionBtn.textContent = confirmText;
        confirmActionBtn.className = isDanger ? 'modal-btn-danger' : 'modal-btn-primary';
        const confirmIconWrap = document.getElementById('confirmModalIcon');
        const confirmIcon = confirmIconWrap?.querySelector('i');
        const action = confirmText.toLowerCase();
        const icon = action.includes('delete') ? 'fa-trash-can'
            : action.includes('sign out') ? 'fa-right-from-bracket'
            : action.includes('clear') ? 'fa-eraser'
            : 'fa-circle-question';
        confirmIconWrap?.classList.toggle('danger', isDanger || action.includes('sign out'));
        confirmIconWrap?.classList.toggle('brand', !isDanger && !action.includes('sign out'));
        if (confirmIcon) confirmIcon.className = `fas ${icon}`;

        confirmResolveFn = resolve;
        confirmModal.classList.remove('hidden');
    });
}

function closeConfirmDialog(result) {
    if (confirmModal) confirmModal.classList.add('hidden');
    if (confirmResolveFn) {
        confirmResolveFn(result);
        confirmResolveFn = null;
    }
}

function showPromptDialog(title, message, defaultValue = '') {
    return new Promise((resolve) => {
        if (!promptModal) {
            promptModal = document.getElementById('customPromptModal');
            promptTitle = document.getElementById('promptModalTitle');
            promptMessage = document.getElementById('promptModalMessage');
            promptInput = document.getElementById('promptModalInput');
            promptSaveBtn = document.getElementById('promptModalSaveBtn');
            promptCancelBtn = document.getElementById('promptModalCancelBtn');
        }

        if (!promptModal) {
            resolve(window.prompt(message, defaultValue));
            return;
        }

        promptTitle.textContent = title;
        promptMessage.textContent = message;
        promptInput.value = defaultValue;

        promptResolveFn = resolve;
        promptModal.classList.remove('hidden');
        promptInput.focus();
        promptInput.select();
    });
}

function closePromptDialog(result) {
    if (promptModal) promptModal.classList.add('hidden');
    if (promptResolveFn) {
        promptResolveFn(result);
        promptResolveFn = null;
    }
}

function initCustomModals() {
    confirmModal = document.getElementById('customConfirmModal');
    confirmTitle = document.getElementById('confirmModalTitle');
    confirmMessage = document.getElementById('confirmModalMessage');
    confirmActionBtn = document.getElementById('confirmModalActionBtn');
    confirmCancelBtn = document.getElementById('confirmModalCancelBtn');

    confirmActionBtn?.addEventListener('click', () => closeConfirmDialog(true));
    confirmCancelBtn?.addEventListener('click', () => closeConfirmDialog(false));
    confirmModal?.addEventListener('click', (e) => {
        if (e.target === confirmModal) closeConfirmDialog(false);
    });

    promptModal = document.getElementById('customPromptModal');
    promptTitle = document.getElementById('promptModalTitle');
    promptMessage = document.getElementById('promptModalMessage');
    promptInput = document.getElementById('promptModalInput');
    promptSaveBtn = document.getElementById('promptModalSaveBtn');
    promptCancelBtn = document.getElementById('promptModalCancelBtn');

    promptSaveBtn?.addEventListener('click', () => {
        const val = promptInput?.value.trim();
        closePromptDialog(val || null);
    });
    promptCancelBtn?.addEventListener('click', () => closePromptDialog(null));
    promptInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const val = promptInput?.value.trim();
            closePromptDialog(val || null);
        } else if (e.key === 'Escape') {
            closePromptDialog(null);
        }
    });
    promptModal?.addEventListener('click', (e) => {
        if (e.target === promptModal) closePromptDialog(null);
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (confirmModal && !confirmModal.classList.contains('hidden')) {
                closeConfirmDialog(false);
            }
            if (promptModal && !promptModal.classList.contains('hidden')) {
                closePromptDialog(null);
            }
        }
    });
}

// ============================================================================
// TOAST NOTIFICATIONS
// ============================================================================
function showToast(message, type = 'info', duration = 2800) {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    let iconClass = 'fa-info-circle';
    if (type === 'success') iconClass = 'fa-check-circle';
    if (type === 'error') iconClass = 'fa-exclamation-circle';

    toast.innerHTML = `<i class="fas ${iconClass}"></i> <span>${escapeHtml(message)}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.25s';
        setTimeout(() => toast.remove(), 250);
    }, duration);
}

// Conversation detection
function isCasualConversation(content) {
    if (!content) return false;
    const hasMarkdown = content.includes('##') || content.includes('**') ||
                        content.includes('```') || content.includes('- ') ||
                        content.includes('1. ') || content.includes('> ') ||
                        content.includes('* ') || /^#{1,4}\s/m.test(content);
    if (hasMarkdown) return false;
    if (content.length >= 200) return false;
    const casualPatterns = [
        /^(hey|hi|hello|yo|sup|hiya|good morning|good afternoon|good evening)/i,
        /^(thanks|thank you|great|cool|awesome|nice|bye|goodbye)/i,
        /^how are you/i,
        /^(ok|okay|got it|understood)$/i
    ];
    return casualPatterns.some(pattern => pattern.test(content.toLowerCase().trim()));
}

// Code Copy Buttons
function addCopyButtonsToCodeBlocks() {
    document.querySelectorAll('.md-body pre').forEach(pre => {
        if (pre.parentElement.classList.contains('code-wrapper')) return;
        const code = pre.querySelector('code');
        if (!code) return;

        let lang = 'code';
        code.classList.forEach(cls => {
            if (cls.startsWith('language-')) lang = cls.replace('language-', '');
        });

        const wrapper = document.createElement('div');
        wrapper.className = 'code-wrapper';
        
        const header = document.createElement('div');
        header.className = 'code-header-bar';
        header.innerHTML = `
            <span>${escapeHtml(lang)}</span>
            <button type="button" class="copy-btn">
                <i class="fas fa-copy"></i> Copy
            </button>
        `;

        pre.parentNode.insertBefore(wrapper, pre);
        wrapper.appendChild(header);
        wrapper.appendChild(pre);

        const copyBtn = header.querySelector('.copy-btn');
        copyBtn.onclick = async () => {
            try {
                await navigator.clipboard.writeText(code.textContent || '');
                copyBtn.innerHTML = '<i class="fas fa-check"></i> Copied!';
                copyBtn.classList.add('copied');
                showToast('Code copied to clipboard', 'success', 2000);
                setTimeout(() => {
                    copyBtn.innerHTML = '<i class="fas fa-copy"></i> Copy';
                    copyBtn.classList.remove('copied');
                }, 2000);
            } catch (err) {
                showToast('Failed to copy', 'error');
            }
        };
    });
}

function cleanDualMindResponse(rawText) {
    if (!rawText || typeof rawText !== 'string') return '';
    
    const codeBlocks = [];
    let cleaned = rawText.replace(/```([\s\S]*?)```/g, (match) => {
        const placeholder = `__CODEBLOCK_${codeBlocks.length}__`;
        codeBlocks.push(match);
        return placeholder;
    });
    
    cleaned = cleaned.replace(/^\d+\s*$/gm, '');
    cleaned = cleaned.replace(/^(\d+)\.\s*$/gm, '');
    cleaned = cleaned.replace(/\[(Web Search|PDF Document|RAG|Hybrid)\]/gi, '');
    cleaned = cleaned.replace(/^##([^ #])/gm, '## $1');
    cleaned = cleaned.replace(/^#([^ #])/gm, '# $1');
    cleaned = cleaned.replace(/^•\s*/gm, '- ');
    cleaned = cleaned.replace(/\n{4,}/g, '\n\n');
    cleaned = cleaned.replace(/\[object Object\]/gi, '');
    
    codeBlocks.forEach((block, i) => {
        cleaned = cleaned.replace(`__CODEBLOCK_${i}__`, block);
    });
    
    return cleaned.trim();
}

function setupMarked() {
    if (typeof marked === 'undefined') return;

    const renderer = new marked.Renderer();
    renderer.code = function(code, language) {
        const escaped = code
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');

        const lang = (language && hljs.getLanguage(language)) ? language : 'plaintext';
        try {
            const highlighted = hljs.highlight(escaped, { language: lang }).value;
            return `<pre><code class="hljs language-${lang}">${highlighted}</code></pre>`;
        } catch (e) {
            return `<pre><code class="hljs">${escaped}</code></pre>`;
        }
    };

    marked.use({ renderer, gfm: true, breaks: true });
}

async function renderMarkdown(text) {
    if (!text) return '<div class="md-body"></div>';
    try {
        if (typeof marked === 'undefined' || typeof marked.parse !== 'function') {
            return `<div class="md-body">${text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>')}</div>`;
        }
        const rawHtml = marked.parse(text);
        if (!rawHtml || typeof rawHtml !== 'string') {
            return `<div class="md-body">${text.replace(/\n/g, '<br>')}</div>`;
        }
        
        const safeHtml = typeof DOMPurify !== 'undefined'
            ? DOMPurify.sanitize(rawHtml, {
                ALLOWED_TAGS: [
                    'p', 'strong', 'em', 'b', 'i', 'u', 's',
                    'code', 'pre', 'blockquote',
                    'ul', 'ol', 'li',
                    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
                    'a', 'br', 'hr', 'span', 'div',
                    'table', 'thead', 'tbody', 'tr', 'th', 'td'
                ],
                ALLOWED_ATTR: ['href', 'class', 'data-highlighted', 'target', 'rel'],
                ALLOWED_URI_REGEXP: /^(https?|mailto):/i
            })
            : rawHtml;
        
        return `<div class="md-body">${safeHtml}</div>`;
    } catch(e) {
        console.error('renderMarkdown error:', e);
        return `<div class="md-body">${(text||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>')}</div>`;
    }
}

function buildSourceBadge(searchTypeUsed) {
    if (!searchTypeUsed || searchTypeUsed === 'Conversation') return '';
    let icon, label;
    const type = String(searchTypeUsed).toLowerCase();
    if (type.includes('pdf') || type.includes('document')) {
        icon = 'fa-file-pdf';
        label = 'PDF Document';
    } else if (type.includes('web') || type.includes('open')) {
        icon = 'fa-globe';
        label = 'Web Search';
    } else {
        icon = 'fa-link';
        label = 'Hybrid Search';
    }
    return `<div class="source-badge"><i class="fas ${icon}"></i> <span>${label}</span></div>`;
}

function buildAssistantActionBar(rawContent) {
    return `
        <div class="message-actions-toolbar">
            <button type="button" class="msg-tool-btn copy-msg-btn" title="Copy response">
                <i class="fas fa-copy"></i> <span>Copy</span>
            </button>
            <button type="button" class="msg-tool-btn tts-msg-btn" title="Read aloud">
                <i class="fas fa-volume-high"></i>
            </button>
            <button type="button" class="msg-tool-btn thumbs-up-btn" title="Helpful">
                <i class="fas fa-thumbs-up"></i>
            </button>
            <button type="button" class="msg-tool-btn thumbs-down-btn" title="Not helpful">
                <i class="fas fa-thumbs-down"></i>
            </button>
        </div>
    `;
}

async function addMessageToChat(role, content, filename = null, searchTypeUsed = null, resumeAnalysis = null) {
    if (!messagesDiv) return;
    const welcome = document.getElementById('welcomeHero');
    if (welcome && role === 'user') welcome.remove();

    const messageDiv = document.createElement('div');
    let finalContent = content;
    if (role === 'assistant') finalContent = cleanDualMindResponse(content);
    messageDiv.className = `message ${role}`;

    let attachmentHTML = '';
    if (filename) {
        attachmentHTML = `<div class="message-doc-attachment"><i class="fas fa-file-pdf"></i> ${escapeHtml(filename)}</div>`;
    }

    if (role === 'user') {
        const userInitial = user?.email ? user.email.charAt(0).toUpperCase() : 'U';
        messageDiv.innerHTML = `
            <div class="message-avatar"><span>${userInitial}</span></div>
            <div class="message-content">
                ${attachmentHTML}
                <span>${escapeHtml(finalContent).replace(/\n/g, '<br>')}</span>
            </div>
        `;
    } else {
        const atsData = resumeAnalysis || tryParseResumeAnalysis(finalContent);
        if (atsData && atsData.overall_score) {
            const scoreCardHtml = renderResumeScoreCard(atsData);
            messageDiv.innerHTML = `
                <div class="message-avatar"><i class="fas fa-brain"></i></div>
                <div class="message-content">
                    ${scoreCardHtml}
                    <div class="source-badge"><i class="fas fa-file-contract"></i> <span>ATS Analysis</span></div>
                    ${buildAssistantActionBar(finalContent)}
                </div>
            `;
        } else {
            const isCasual = isCasualConversation(finalContent);
            let renderedContent;

            if (isCasual) {
                renderedContent = `<div class="md-body">${escapeHtml(finalContent).replace(/\n/g, '<br>')}</div>`;
            } else {
                renderedContent = await renderMarkdown(finalContent);
                setTimeout(() => {
                    addCopyButtonsToCodeBlocks();
                }, 100);
            }

            const sourceBadge = buildSourceBadge(searchTypeUsed || currentMode);
            const actionBar = buildAssistantActionBar(finalContent);

            messageDiv.innerHTML = `
                <div class="message-avatar"><i class="fas fa-brain"></i></div>
                <div class="message-content">
                    ${renderedContent}
                    ${sourceBadge}
                    ${actionBar}
                </div>
            `;
        }

        bindAssistantActions(messageDiv, finalContent);
    }

    messagesDiv.appendChild(messageDiv);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
    updateScrollBottomBtn();
}

function bindAssistantActions(messageEl, rawText) {
    const copyBtn = messageEl.querySelector('.copy-msg-btn');
    if (copyBtn) {
        copyBtn.onclick = async () => {
            try {
                await navigator.clipboard.writeText(rawText);
                copyBtn.innerHTML = '<i class="fas fa-check"></i> <span>Copied</span>';
                copyBtn.classList.add('active');
                showToast('Response copied to clipboard', 'success', 2000);
                setTimeout(() => {
                    copyBtn.innerHTML = '<i class="fas fa-copy"></i> <span>Copy</span>';
                    copyBtn.classList.remove('active');
                }, 2000);
            } catch (err) {
                showToast('Failed to copy', 'error');
            }
        };
    }

    const ttsBtn = messageEl.querySelector('.tts-msg-btn');
    if (ttsBtn) {
        ttsBtn.onclick = () => {
            if ('speechSynthesis' in window) {
                if (window.speechSynthesis.speaking) {
                    window.speechSynthesis.cancel();
                    ttsBtn.classList.remove('active');
                    return;
                }
                const clean = rawText.replace(/[#*`_~\[\]]/g, '').slice(0, 1500);
                const utter = new SpeechSynthesisUtterance(clean);
                utter.onend = () => ttsBtn.classList.remove('active');
                utter.onerror = () => ttsBtn.classList.remove('active');
                window.speechSynthesis.speak(utter);
                ttsBtn.classList.add('active');
            }
        };
    }

    const upBtn = messageEl.querySelector('.thumbs-up-btn');
    const downBtn = messageEl.querySelector('.thumbs-down-btn');
    if (upBtn) {
        upBtn.onclick = () => {
            upBtn.classList.toggle('active');
            if (downBtn) downBtn.classList.remove('active');
            showToast('Feedback noted', 'info', 1800);
        };
    }
    if (downBtn) {
        downBtn.onclick = () => {
            downBtn.classList.toggle('active');
            if (upBtn) upBtn.classList.remove('active');
            showToast('Feedback noted', 'info', 1800);
        };
    }
}

// ============================================================================
// SEND MESSAGE
// ============================================================================
async function sendMessage() {
    const text = messageInput?.value.trim();
    if (!text) return;
    const hasFile = !!pendingFile;
    const uploadedFilename = hasFile ? pendingFile.name : null;

    // Auto-create chat session on the fly if starting a new chat
    if (!currentSessionId) {
        try {
            const sessRes = await fetch(`${API_URL}/chat/sessions`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
            });
            if (sessRes.status === 401) { doLogout(); return; }
            const sessData = await sessRes.json();
            if (sessRes.ok && sessData.session) {
                currentSessionId = sessData.session.id;
                currentSessionDocuments = [];
                if (chatTitleSpan) chatTitleSpan.innerText = sessData.session.title || 'New conversation';
            } else {
                showToast('Failed to start chat session', 'error');
                return;
            }
        } catch (e) {
            showToast('Unable to reach server', 'error');
            return;
        }
    }

    messageInput.value = '';
    messageInput.style.height = 'auto';
    updateSendButtonState();

    await addMessageToChat('user', text, uploadedFilename);

    const messageCount = messagesDiv?.querySelectorAll('.message').length || 0;
    if (messageCount === 1) await autoTitle(currentSessionId, text);

    if (hasFile) {
        try {
            showTyping();
            await uploadFile(pendingFile, currentSessionId);
            pendingFile = null;
            if (fileBadge) fileBadge.classList.add('hidden');
            updateSendButtonState();
            hideTyping();
        } catch (err) {
            hideTyping();
            await addMessageToChat('assistant', `❌ Document upload failed: ${err.message}`);
            return;
        }
    }

    showTyping();
    if (sendBtn) sendBtn.disabled = true;

    try {
        const res = await fetch(`${API_URL}/chat/sessions/${currentSessionId}/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({
                question: text,
                search_type: currentMode,
                include_sources: true,
                uploaded_document: uploadedFilename,
                model: currentSelectedModel || undefined
            })
        });

        if (res.status === 401) { doLogout(); return; }
        const data = await res.json();
        hideTyping();

        if (res.ok) {
            let finalAnswer = data.answer || data.response || data.content || '';
            const searchSource = data.search_type_used || currentMode;
            const resumeData = data.resume_analysis || null;
            await addMessageToChat('assistant', finalAnswer, null, searchSource, resumeData);
        } else {
            const errDetail = data?.detail || 'Sorry, something went wrong on the server.';
            await addMessageToChat('assistant', `⚠️ ${errDetail}`);
        }
    } catch (err) {
        hideTyping();
        if (token === 'demo_token') {
            const lower = text.toLowerCase().trim();
            let demoReply = '';
            if (/^(hi|hello|hey|greetings)/i.test(lower)) {
                demoReply = "Hello! I am **DualMind**, your agentic AI assistant powered by hybrid neural RAG and live web intelligence. What would you like to explore or synthesize today?";
            } else if (lower.includes('rrf') || lower.includes('reciprocal')) {
                demoReply = "### Reciprocal Rank Fusion (RRF)\n\n**RRF** combines search scores from dense vector search (semantic similarity) and sparse keyword search (BM25):\n\n$$\\text{RRF Score}(d) = \\sum_{m \\in M} \\frac{1}{k + r_m(d)}$$\n\nWhere $k=60$ balances rank-frequency distribution with zero single-model bias.";
            } else {
                demoReply = `### DualMind Agentic Intelligence\n\nI received your query: *"**${escapeHtml(text)}**"*\n\nTo connect live queries directly to your deployed backend, pass your Render backend URL (e.g. \`?backend=https://your-service.onrender.com\`) or ensure your backend is running.`;
            }
            await addMessageToChat('assistant', demoReply, null, currentMode);
        } else {
            await addMessageToChat('assistant', `⚠️ **Connection Error**: Unable to reach backend at \`${API_URL}\`. Please check that your Render service is awake or your backend server is running.`);
        }
    } finally {
        if (sendBtn) sendBtn.disabled = false;
        updateSendButtonState();
        messageInput?.focus();
    }
}

// ============================================================================
// SESSION MANAGEMENT (With In-App Modals)
// ============================================================================
async function loadSession(sessionId) {
    if (sessionId === currentSessionId) return;
    currentSessionId = sessionId;

    try {
        if (token === 'demo_token') {
            const sessionInfo = allSessions.find(s => s.id === sessionId);
            if (sessionInfo && chatTitleSpan) chatTitleSpan.innerText = sessionInfo.title;
            if (messagesDiv) {
                messagesDiv.innerHTML = '';
                if (sessionId === 'sess_1') {
                    await addMessageToChat('user', 'What are the key career highlights and biography of Virat Kohli?', 'virat_kohli_bio.pdf');
                    await addMessageToChat('assistant', `## Career Highlights\n\n- **Made his Test debut in 2011**\n- **Became the captain of the Indian team in 2014**\n- **Plays for Royal Challengers Bengaluru in the Indian Premier League**\n\n## Personal Life and Education\n\nThere is no information available about **Virat Kohli**'s 12th grade details in the provided context. However, it is mentioned that **Ajay Raj** has 12th grade details, but this is not relevant to **Virat Kohli**.\n\n## Biography\n\n**Virat Kohli** is a renowned Indian cricketer, known for his exceptional skills on the field. His biography can be summarized as follows:\n\n- Born on 5 November 1988 in Delhi\n- Developed an interest in cricket at a young age\n- Joined the West Delhi Cricket Academy at nine\n- Made his Test debut in 2011 and became the captain of the Indian team in 2014`, null, 'hybrid');
                } else {
                    await addMessageToChat('user', 'Explain reciprocal rank fusion (RRF) in hybrid RAG architecture.');
                    await addMessageToChat('assistant', `### Reciprocal Rank Fusion (RRF)\n\n**RRF** combines search scores from dense vector search (semantic similarity) and sparse keyword search (BM25):\n\n$$\\text{RRF Score}(d) = \\sum_{m \\in M} \\frac{1}{k + r_m(d)}$$\n\nWhere:\n- $k$ is a ranking constant (usually 60)\n- $r_m(d)$ is the document rank in model $m$\n\nThis ensures balanced, multi-source retrieval with zero single-model bias.`, null, 'hybrid');
                }
                messagesDiv.scrollTop = messagesDiv.scrollHeight;
            }
            renderSessionList(allSessions);
            return;
        }

        await loadSessionDocuments(sessionId);
        const res = await fetch(`${API_URL}/chat/sessions/${sessionId}/messages`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.status === 401) { doLogout(); return; }
        const data = await res.json();

        const sessionInfo = allSessions.find(s => s.id === sessionId);
        if (sessionInfo && chatTitleSpan) {
            chatTitleSpan.innerText = sessionInfo.title;
        }

        if (messagesDiv) {
            if (!data.messages || data.messages.length === 0) {
                const displayName = user?.email?.split('@')[0] || 'Explorer';
                messagesDiv.innerHTML = getWelcomeHtml(displayName);
                bindStarterChips();
            } else {
                messagesDiv.innerHTML = '';
                for (const msg of data.messages) {
                    const searchType = msg.metadata?.search_type_used || null;
                    const rawContent = msg.content || msg.answer || msg.response || '';
                    await addMessageToChat(msg.role, rawContent, msg.metadata?.filename, searchType);
                }
                messagesDiv.scrollTop = messagesDiv.scrollHeight;
            }
        }
        renderSessionList(allSessions);
        closeMobileSidebar();
    } catch (err) {
        console.error('Error loading session:', err);
    }
}

function toggleSidebar() {
    if (sidebar) {
        sidebar.classList.toggle('collapsed');
        const isCollapsed = sidebar.classList.contains('collapsed');
        localStorage.setItem('sidebar_collapsed', isCollapsed);
        document.getElementById('drawerToggleBtn')?.setAttribute('aria-expanded', String(!isCollapsed));
        document.getElementById('railHistoryBtn')?.setAttribute('aria-expanded', String(!isCollapsed));

        const backdrop = document.getElementById('drawerBackdrop');
        if (backdrop) {
            backdrop.classList.toggle('active', !isCollapsed && window.innerWidth <= 768);
        }
    }
}

function closeMobileSidebar() {
    if (window.innerWidth <= 768 && sidebar && !sidebar.classList.contains('collapsed')) {
        sidebar.classList.add('collapsed');
        localStorage.setItem('sidebar_collapsed', 'true');
        document.getElementById('drawerToggleBtn')?.setAttribute('aria-expanded', 'false');
        document.getElementById('railHistoryBtn')?.setAttribute('aria-expanded', 'false');
        document.getElementById('drawerBackdrop')?.classList.remove('active');
    }
}

function getPinnedSessionIds() {
    try { return new Set(JSON.parse(localStorage.getItem('dualmind_pinned_sessions') || '[]').map(String)); }
    catch { return new Set(); }
}

function savePinnedSessionIds(pinned) {
    localStorage.setItem('dualmind_pinned_sessions', JSON.stringify([...pinned]));
}

async function loadSessions(shouldSelectFirst = false) {
    if (!sessionListDiv) return;
    sessionListDiv.innerHTML = '<div style="padding: 1rem; text-align: center; color: var(--text-dim); font-size: 0.8rem;">Loading...</div>';
    try {
        const res = await fetch(`${API_URL}/chat/sessions`, { headers: { 'Authorization': `Bearer ${token}` } });
        if (res.status === 401) { doLogout(); return; }
        const data = await res.json();
        if (res.ok && data.sessions && data.sessions.length > 0) {
            allSessions = data.sessions;
            renderSessionList(allSessions);
            if (shouldSelectFirst && !currentSessionId && allSessions[0]) {
                await loadSession(allSessions[0].id);
            }
        } else {
            allSessions = [];
            sessionListDiv.innerHTML = '<div style="padding: 1rem; text-align: center; color: var(--text-dim); font-size: 0.8rem;">No conversations yet</div>';
        }
    } catch (err) {
        sessionListDiv.innerHTML = '<div style="padding: 1rem; text-align: center; color: #ef4444; font-size: 0.8rem;">Failed to load</div>';
    }
}

function renderSessionList(sessions) {
    if (!sessionListDiv) return;
    sessionListDiv.innerHTML = '';

    const filterQuery = sessionSearchInput?.value.toLowerCase().trim() || '';
    const pinned = getPinnedSessionIds();
    const filtered = filterQuery
        ? sessions.filter(s => (s.title || '').toLowerCase().includes(filterQuery))
        : sessions;
    filtered.sort((a, b) => Number(pinned.has(String(b.id))) - Number(pinned.has(String(a.id))));

    if (filtered.length === 0) {
        sessionListDiv.innerHTML = `<div style="padding: 1rem; text-align: center; color: var(--text-dim); font-size: 0.8rem;">No matching chats</div>`;
        return;
    }

    filtered.forEach(s => {
        const div = document.createElement('div');
        const isActive = currentSessionId === s.id;
        const isPinned = pinned.has(String(s.id));
        div.className = `session-item ${isActive ? 'active' : ''}`;
        div.dataset.id = s.id;
        div.innerHTML = `
            ${isPinned ? '<i class="fas fa-thumbtack session-pin-indicator" title="Pinned on this device"></i>' : ''}
            <span class="session-title">${escapeHtml(s.title || 'Untitled')}</span>
            <div class="session-actions">
                <button class="session-menu-trigger" type="button" aria-label="Chat options" aria-haspopup="true" aria-expanded="false" title="Chat options">
                    <i class="fas fa-ellipsis-vertical"></i>
                </button>
                <div class="session-context-menu hidden" role="menu">
                    <button type="button" class="session-menu-option" data-action="pin" role="menuitem"><i class="fas fa-thumbtack"></i><span>${isPinned ? 'Unpin' : 'Pin'}</span></button>
                    <button type="button" class="session-menu-option" data-action="rename" role="menuitem"><i class="fas fa-pen"></i><span>Rename</span></button>
                    <div class="session-menu-divider"></div>
                    <button type="button" class="session-menu-option danger" data-action="delete" role="menuitem"><i class="fas fa-trash-can"></i><span>Delete</span></button>
                </div>
            </div>
        `;

        div.addEventListener('click', (e) => {
            if (e.target.closest('.session-actions')) return;
            loadSession(s.id);
        });

        const menuTrigger = div.querySelector('.session-menu-trigger');
        const contextMenu = div.querySelector('.session-context-menu');
        menuTrigger?.addEventListener('click', (e) => {
            e.stopPropagation();
            const willOpen = contextMenu.classList.contains('hidden');
            document.querySelectorAll('.session-context-menu').forEach(menu => menu.classList.add('hidden'));
            document.querySelectorAll('.session-menu-trigger').forEach(trigger => trigger.setAttribute('aria-expanded', 'false'));
            contextMenu.classList.toggle('hidden', !willOpen);
            menuTrigger.setAttribute('aria-expanded', String(willOpen));
        });

        contextMenu?.addEventListener('click', async (e) => {
            const option = e.target.closest('[data-action]');
            if (!option) return;
            e.stopPropagation();
            contextMenu.classList.add('hidden');
            menuTrigger?.setAttribute('aria-expanded', 'false');
            if (option.dataset.action === 'pin') {
                const updatedPins = getPinnedSessionIds();
                if (updatedPins.has(String(s.id))) updatedPins.delete(String(s.id));
                else updatedPins.add(String(s.id));
                savePinnedSessionIds(updatedPins);
                renderSessionList(allSessions);
                showToast(updatedPins.has(String(s.id)) ? 'Thread pinned on this device' : 'Thread unpinned', 'info', 1400);
            } else if (option.dataset.action === 'rename') {
                await renameSessionFromSidebar(s.id, s.title || 'Conversation');
            } else if (option.dataset.action === 'delete') {
                await deleteSessionFromSidebar(s.id);
            }
        });

        sessionListDiv.appendChild(div);
    });
}

// IN-APP RENAME POPUP
async function renameSessionFromSidebar(sessionId, currentTitle) {
    const newName = await showPromptDialog('Rename conversation', 'Enter a new title for this conversation:', currentTitle);
    if (!newName || newName === currentTitle) return;

    try {
        await fetch(`${API_URL}/chat/sessions/${sessionId}?title=${encodeURIComponent(newName)}`, {
            method: 'PUT', headers: { 'Authorization': `Bearer ${token}` }
        });
        if (currentSessionId === sessionId && chatTitleSpan) {
            chatTitleSpan.innerText = newName;
        }
        showToast('Conversation renamed', 'success');
        await loadSessions();
    } catch (err) {
        showToast('Failed to rename', 'error');
    }

}

// IN-APP DELETE CONFIRMATION POPUP
async function deleteSessionFromSidebar(sessionId) {
    const confirmed = await showConfirmDialog(
        'Delete conversation?',
        'This will permanently delete this conversation and its history. This action cannot be undone.',
        'Delete'
    );
    if (!confirmed) return;

    try {
        await fetch(`${API_URL}/chat/sessions/${sessionId}`, {
            method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` }
        });
        const pinned = getPinnedSessionIds();
        pinned.delete(String(sessionId));
        savePinnedSessionIds(pinned);
        showToast('Conversation deleted', 'info');
        if (currentSessionId === sessionId) {
            startNewChat();
        }
        await loadSessions();
    } catch (err) {
        showToast('Failed to delete', 'error');
    }
}

function startNewChat() {
    currentSessionId = null;
    currentSessionDocuments = [];
    if (chatTitleSpan) chatTitleSpan.innerText = 'New conversation';
    if (fileBadge) fileBadge.classList.add('hidden');
    if (fileInput) fileInput.value = '';
    pendingFile = null;
    clearMessages();
    renderSessionList(allSessions);
    closeMobileSidebar();
    showToast('New thread started', 'info', 1400);
}

async function createNewSession() {
    startNewChat();
}

async function loadSessionDocuments(sessionId) {
    try {
        const res = await fetch(`${API_URL}/chat/sessions/${sessionId}/documents`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
            const data = await res.json();
            currentSessionDocuments = data.documents || [];
        }
    } catch (err) {
        currentSessionDocuments = [];
    }
}

function clearMessages() {
    if (!messagesDiv) return;
    const displayName = getUserDisplayName();
    messagesDiv.innerHTML = getWelcomeHtml(displayName);
    bindStarterChips();
}

function showTyping() {
    if (!messagesDiv) return;
    hideTyping();
    const typing = document.createElement('div');
    typing.className = 'message assistant';
    typing.id = 'typingIndicator';
    typing.innerHTML = `
        <div class="message-avatar"><i class="fas fa-brain"></i></div>
        <div class="message-content">
            <div class="typing-dots"><span></span><span></span><span></span></div>
        </div>
    `;
    messagesDiv.appendChild(typing);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function hideTyping() {
    const el = document.getElementById('typingIndicator');
    if (el) el.remove();
}

// File Attachment
function onFileSelect(e) {
    const file = e.target.files[0];
    if (!file || !file.name.toLowerCase().endsWith('.pdf')) {
        showToast('Please select a valid PDF file', 'error');
        return;
    }
    pendingFile = file;
    if (fileBadge) {
        const nameEl = document.getElementById('fileBadgeName');
        if (nameEl) nameEl.textContent = file.name;
        fileBadge.classList.remove('hidden');
    }
    updateSendButtonState();
    showToast(`Attached ${file.name}`, 'info', 2000);
}

function updateSendButtonState() {
    const hasText = Boolean(messageInput && messageInput.value.trim().length > 0);
    const hasDoc = Boolean(pendingFile);
    const canSend = hasText || hasDoc;
    if (sendBtn) {
        sendBtn.classList.toggle('has-text', canSend);
        sendBtn.title = canSend ? 'Send message (Enter)' : 'Enter a prompt or attach a PDF to send';
    }
}

function copyConversationTranscript() {
    const messages = messagesDiv?.querySelectorAll('.message');
    if (!messages || messages.length === 0) {
        showToast('No messages to copy', 'info');
        return;
    }
    const title = chatTitleSpan?.innerText || 'DualMind Conversation';
    let text = `DualMind Intelligence - ${title}\n` + '='.repeat(40) + '\n\n';
    messages.forEach(msg => {
        const isUser = msg.classList.contains('user');
        const role = isUser ? 'User' : 'DualMind Assistant';
        const content = msg.querySelector('.message-content')?.innerText.trim() || '';
        text += `[${role}]\n${content}\n\n`;
    });
    navigator.clipboard.writeText(text).then(() => {
        showToast('Transcript copied to clipboard', 'success');
    }).catch(() => {
        showToast('Unable to access clipboard', 'error');
    });
}

async function uploadFile(file, sessionId) {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch(`${API_URL}/upload?session_id=${sessionId}`, {
        method: 'POST', headers: { 'Authorization': `Bearer ${token}` }, body: fd
    });
    if (res.status === 401) { doLogout(); throw new Error('Unauthorized'); }
    if (!res.ok) {
        const error = await res.json();
        throw new Error(error.detail || 'Upload failed');
    }
    showToast('Document indexed for RAG search', 'success', 2500);
    return await res.json();
}

async function autoTitle(sessionId, firstMsg) {
    const short = firstMsg.length > 30 ? firstMsg.substring(0, 30) + '...' : firstMsg;
    try {
        await fetch(`${API_URL}/chat/sessions/${sessionId}?title=${encodeURIComponent(short)}`, {
            method: 'PUT', headers: { 'Authorization': `Bearer ${token}` }
        });
        if (chatTitleSpan) chatTitleSpan.innerText = short;
        await loadSessions();
    } catch (err) {
        console.error(err);
    }
}

async function renameSession() {
    const current = chatTitleSpan?.innerText || 'Conversation';
    const newName = await showPromptDialog('Rename conversation', 'Enter a new title for this conversation:', current);
    if (!newName || newName === current || !currentSessionId) return;

    try {
        await fetch(`${API_URL}/chat/sessions/${currentSessionId}?title=${encodeURIComponent(newName)}`, {
            method: 'PUT', headers: { 'Authorization': `Bearer ${token}` }
        });
        if (chatTitleSpan) chatTitleSpan.innerText = newName;
        showToast('Conversation renamed', 'success');
        await loadSessions();
    } catch (err) {
        showToast('Failed to rename', 'error');
    }
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function exportConversation() {
    const messages = messagesDiv?.querySelectorAll('.message');
    if (!messages || messages.length === 0) {
        showToast('No messages to export', 'info');
        return;
    }

    const title = chatTitleSpan?.innerText || 'Conversation';
    let md = `# ${title}\n\n`;

    messages.forEach(msg => {
        const isUser = msg.classList.contains('user');
        const role = isUser ? 'User' : 'Assistant';
        const content = msg.querySelector('.message-content')?.innerText.trim() || '';
        md += `### ${role}\n${content}\n\n`;
    });

    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title.replace(/[^a-z0-9_-]/gi, '_')}.md`;
    a.click();
    URL.revokeObjectURL(a);
    showToast('Exported as Markdown', 'success');
}

// ============================================================================
// ATS RESUME SCORE CARD
// ============================================================================
function getScoreColor(score) {
    if (score >= 8) return '#22c55e';
    if (score >= 6) return '#f59e0b';
    if (score >= 4) return '#f97316';
    return '#ef4444';
}

function getScoreLabel(score) {
    if (score >= 9) return 'Exceptional';
    if (score >= 8) return 'Excellent';
    if (score >= 7) return 'Good';
    if (score >= 5) return 'Average';
    if (score >= 3) return 'Below Average';
    return 'Needs Work';
}

function renderResumeScoreCard(data) {
    if (!data || data.error) {
        return `<div class="ats-error"><i class="fas fa-exclamation-triangle"></i> Unable to analyze resume. Please try again.</div>`;
    }

    const overall = data.overall_score || 0;
    const overallColor = getScoreColor(overall);
    const overallLabel = getScoreLabel(overall);
    const circumference = 2 * Math.PI * 45;
    const offset = circumference - (overall / 10) * circumference;

    let sectionsHtml = '';
    if (data.sections && data.sections.length > 0) {
        const sectionIcons = {
            'Contact Information': 'fa-address-card',
            'Professional Summary': 'fa-file-lines',
            'Work Experience': 'fa-briefcase',
            'Skills & Keywords': 'fa-tags',
            'Education': 'fa-graduation-cap',
            'Formatting & ATS Compatibility': 'fa-align-left',
        };
        for (const section of data.sections) {
            const sColor = getScoreColor(section.score);
            const barWidth = (section.score / 10) * 100;
            const icon = sectionIcons[section.name] || 'fa-check-circle';
            sectionsHtml += `
                <div class="ats-section-card">
                    <div class="ats-section-header">
                        <div class="ats-section-title"><i class="fas ${icon}"></i><span>${escapeHtml(section.name)}</span></div>
                        <div class="ats-section-score" style="color: ${sColor}">${section.score}/10</div>
                    </div>
                    <div class="ats-bar-track"><div class="ats-bar-fill" style="width: ${barWidth}%; background: ${sColor}"></div></div>
                    <p class="ats-section-feedback">${escapeHtml(section.feedback)}</p>
                </div>`;
        }
    }

    let strengthsHtml = '';
    if (data.top_strengths && data.top_strengths.length > 0) {
        strengthsHtml = `<div class="ats-pills-section"><h4><i class="fas fa-star"></i> Top Strengths</h4><div class="ats-pills">`;
        for (const s of data.top_strengths) {
            strengthsHtml += `<span class="ats-pill strength">${escapeHtml(s)}</span>`;
        }
        strengthsHtml += `</div></div>`;
    }

    let fixesHtml = '';
    if (data.critical_fixes && data.critical_fixes.length > 0) {
        fixesHtml = `<div class="ats-pills-section"><h4><i class="fas fa-tools"></i> Critical Improvements</h4><div class="ats-pills">`;
        for (const f of data.critical_fixes) {
            fixesHtml += `<span class="ats-pill fix">${escapeHtml(f)}</span>`;
        }
        fixesHtml += `</div></div>`;
    }

    return `
    <div class="ats-score-card">
        <div class="ats-header">
            <div class="ats-badge"><i class="fas fa-file-contract"></i> ATS Resume Analysis</div>
        </div>

        <div class="ats-overall">
            <div class="ats-circle-wrap">
                <svg class="ats-circle" viewBox="0 0 100 100">
                    <circle class="ats-circle-bg" cx="50" cy="50" r="45"/>
                    <circle class="ats-circle-progress" cx="50" cy="50" r="45"
                        style="stroke: ${overallColor}; stroke-dasharray: ${circumference}; stroke-dashoffset: ${offset}"/>
                </svg>
                <div class="ats-circle-text">
                    <span class="ats-score-number" style="color: ${overallColor}">${overall}</span>
                    <span class="ats-score-of">/10</span>
                </div>
            </div>
            <div class="ats-overall-info">
                <div class="ats-overall-label" style="color: ${overallColor}">${overallLabel}</div>
                <p class="ats-summary">${escapeHtml(data.summary || '')}</p>
            </div>
        </div>

        <div class="ats-sections">
            <h4><i class="fas fa-chart-bar"></i> Section Breakdown</h4>
            ${sectionsHtml}
        </div>

        ${strengthsHtml}
        ${fixesHtml}
    </div>`;
}

function tryParseResumeAnalysis(content) {
    if (!content || typeof content !== 'string') return null;
    try {
        const parsed = JSON.parse(content);
        if (parsed && typeof parsed === 'object' && 'overall_score' in parsed && 'sections' in parsed) {
            return parsed;
        }
    } catch (e) {
        // Not JSON
    }
    return null;
}

// Starter chips click handler
function bindStarterChips() {
    document.querySelectorAll('.starter-tall-card, .starter-card').forEach(card => {
        card.addEventListener('click', () => {
            const prompt = card.dataset.prompt;
            if (prompt && messageInput) {
                messageInput.value = prompt;
                messageInput.focus();
                messageInput.style.height = 'auto';
                messageInput.style.height = Math.min(messageInput.scrollHeight, 150) + 'px';
                updateSendButtonState();
            }
        });
    });
    // Re-initialize 3D Glowing Orb on canvas if present
    if (typeof GlowingOrb !== 'undefined' && document.getElementById('heroOrbCanvas')) {
        window.dualMindOrb = new GlowingOrb('heroOrbCanvas');
    }
}

// ============================================================================
// AUTHENTICATION
// ============================================================================
async function doLogin() {
    const email = document.getElementById('loginEmail')?.value.trim();
    const password = document.getElementById('loginPassword')?.value;
    const errorEl = document.getElementById('loginError');

    if (errorEl) {
        errorEl.textContent = '';
        errorEl.classList.add('hidden');
    }

    if (!email || !password) {
        if (errorEl) {
            errorEl.textContent = 'Please enter email and password.';
            errorEl.classList.remove('hidden');
        }
        return;
    }

    showLoading();
    try {
        const res = await fetch(`${API_URL}/auth/signin`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        const data = await res.json();

        if (res.ok) {
            token = data.access_token;
            user = { id: data.user_id, email: data.email };
            localStorage.setItem('dm_token', token);
            localStorage.setItem('dm_user', JSON.stringify(user));
            showToast('Welcome to DualMind', 'success');
            showChatUI();
            await loadSessions();
        } else {
            if (errorEl) {
                errorEl.textContent = data.detail || 'Invalid email or password.';
                errorEl.classList.remove('hidden');
            }
        }
    } catch (err) {
        if (errorEl) {
            errorEl.textContent = 'Connection error. Check your network.';
            errorEl.classList.remove('hidden');
        }
    } finally {
        hideLoading();
    }
}

async function doRegister() {
    const name = document.getElementById('registerName')?.value.trim();
    const email = document.getElementById('registerEmail')?.value.trim();
    const password = document.getElementById('registerPassword')?.value;
    const errorEl = document.getElementById('registerError');

    if (errorEl) {
        errorEl.textContent = '';
        errorEl.classList.add('hidden');
    }

    if (!name || !email || !password) {
        if (errorEl) {
            errorEl.textContent = 'Please fill in all fields.';
            errorEl.classList.remove('hidden');
        }
        return;
    }

    if (password.length < 6) {
        if (errorEl) {
            errorEl.textContent = 'Password must be at least 6 characters.';
            errorEl.classList.remove('hidden');
        }
        return;
    }

    showLoading();
    try {
        const res = await fetch(`${API_URL}/auth/signup`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password, full_name: name })
        });
        const data = await res.json();

        if (res.ok) {
            pendingSignupEmail = email;
            showOtpForm(email);
        } else {
            if (errorEl) {
                errorEl.textContent = data.detail || 'Signup failed. Please try again.';
                errorEl.classList.remove('hidden');
            }
        }
    } catch (err) {
        if (errorEl) {
            errorEl.textContent = 'Connection error. Check your network.';
            errorEl.classList.remove('hidden');
        }
    } finally {
        hideLoading();
    }
}

function doLogout() {
    token = null;
    user = null;
    currentSessionId = null;
    currentSessionDocuments = [];
    pendingSignupEmail = null;
    allSessions = [];
    localStorage.clear();
    showLoginUI();
    showToast('Signed out', 'info');
}

function checkAuth() {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('demo') === '1') {
        token = 'demo_token';
        user = { id: 'usr_demo', email: 'ajayraj30002@gmail.com' };
        showChatUI();
        allSessions = [
            { id: 'sess_1', title: 'Career Highlights & Biography' },
            { id: 'sess_2', title: 'Machine Learning Research' }
        ];
        currentSessionId = null;
        renderSessionList(allSessions);
        if (chatTitleSpan) chatTitleSpan.innerText = 'New conversation';
        clearMessages();
        return;
    }

    const savedToken = localStorage.getItem('dm_token');
    const savedUser = localStorage.getItem('dm_user');
    if (savedToken && savedUser) {
        token = savedToken;
        user = JSON.parse(savedUser);
        showChatUI();
        loadSessions();
    } else {
        showLoginUI();
    }
}

function showLoginUI() {
    if (loginPage) loginPage.classList.remove('hidden');
    if (chatPage) chatPage.classList.add('hidden');
}

function showChatUI() {
    if (loginPage) loginPage.classList.add('hidden');
    if (chatPage) chatPage.classList.remove('hidden');
    
    const emailSidebar = document.getElementById('userEmailSidebar');
    const avatarLetter = document.getElementById('userAvatarLetter');
    const drawerEmail = document.getElementById('drawerUserEmail');
    const drawerAvatarLetter = document.getElementById('drawerUserAvatarLetter');
    const name = getUserDisplayName();
    if (emailSidebar) emailSidebar.innerText = name;
    if (avatarLetter) avatarLetter.innerText = name.charAt(0).toUpperCase();
    if (drawerEmail) drawerEmail.innerText = name;
    if (drawerAvatarLetter) drawerAvatarLetter.innerText = name.charAt(0).toUpperCase();

    // Application opens with a fresh new chat by default
    currentSessionId = null;
    currentSessionDocuments = [];
    if (chatTitleSpan) chatTitleSpan.innerText = 'New conversation';
    clearMessages();
}

function toggleForms(showRegister) {
    document.getElementById('loginForm')?.classList.toggle('active', !showRegister);
    document.getElementById('registerForm')?.classList.toggle('active', showRegister);
    document.getElementById('otpForm')?.classList.remove('active');

    document.getElementById('tabSignIn')?.classList.toggle('active', !showRegister);
    document.getElementById('tabSignUp')?.classList.toggle('active', showRegister);

    const loginError = document.getElementById('loginError');
    const registerError = document.getElementById('registerError');
    const otpError = document.getElementById('otpError');
    if (loginError) loginError.classList.add('hidden');
    if (registerError) registerError.classList.add('hidden');
    if (otpError) otpError.classList.add('hidden');
}

function showOtpForm(email) {
    document.getElementById('registerForm')?.classList.remove('active');
    document.getElementById('loginForm')?.classList.remove('active');
    document.getElementById('otpForm')?.classList.add('active');

    const emailDisplay = document.getElementById('otpEmailDisplay');
    if (emailDisplay) emailDisplay.textContent = email;

    const otpInput = document.getElementById('otpInput');
    if (otpInput) {
        otpInput.value = '';
        otpInput.focus();
    }
}

function hideOtpForm() {
    document.getElementById('otpForm')?.classList.remove('active');
    document.getElementById('loginForm')?.classList.add('active');
    pendingSignupEmail = null;
}

async function verifyOtp() {
    const otp = document.getElementById('otpInput')?.value.trim();
    const errorEl = document.getElementById('otpError');

    if (errorEl) {
        errorEl.textContent = '';
        errorEl.classList.add('hidden');
    }

    if (!otp || otp.length !== 6 || !/^\d{6}$/.test(otp)) {
        if (errorEl) {
            errorEl.textContent = 'Please enter a 6-digit code.';
            errorEl.classList.remove('hidden');
        }
        return;
    }

    if (!pendingSignupEmail) {
        if (errorEl) {
            errorEl.textContent = 'Session expired. Please sign up again.';
            errorEl.classList.remove('hidden');
        }
        return;
    }

    showLoading();
    try {
        const res = await fetch(`${API_URL}/auth/verify-otp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: pendingSignupEmail, otp })
        });
        const data = await res.json();
        hideLoading();

        if (res.ok) {
            token = data.access_token;
            user = { id: data.user_id, email: data.email };
            localStorage.setItem('dm_token', token);
            localStorage.setItem('dm_user', JSON.stringify(user));

            showToast('Email verified! Launching workspace...', 'success');
            showChatUI();
            loadSessions();
            hideOtpForm();
        } else {
            if (errorEl) {
                errorEl.textContent = data.detail || 'Invalid or expired code.';
                errorEl.classList.remove('hidden');
            }
        }
    } catch (err) {
        hideLoading();
        if (errorEl) {
            errorEl.textContent = 'Connection error.';
            errorEl.classList.remove('hidden');
        }
    }
}

async function resendOtp() {
    const errorEl = document.getElementById('otpError');
    if (errorEl) errorEl.classList.add('hidden');

    if (!pendingSignupEmail) {
        if (errorEl) {
            errorEl.textContent = 'Session expired. Please sign up again.';
            errorEl.classList.remove('hidden');
        }
        return;
    }

    showLoading();
    try {
        const res = await fetch(`${API_URL}/auth/resend-otp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: pendingSignupEmail })
        });
        hideLoading();
        if (res.ok) {
            showToast('New verification code sent', 'success');
            const otpInput = document.getElementById('otpInput');
            if (otpInput) {
                otpInput.value = '';
                otpInput.focus();
            }
        } else {
            const data = await res.json();
            if (errorEl) {
                errorEl.textContent = data.detail || 'Failed to resend code.';
                errorEl.classList.remove('hidden');
            }
        }
    } catch (err) {
        hideLoading();
        if (errorEl) {
            errorEl.textContent = 'Connection error.';
            errorEl.classList.remove('hidden');
        }
    }
}

function showLoading() { if (loadingOverlay) loadingOverlay.classList.remove('hidden'); }
function hideLoading() { if (loadingOverlay) loadingOverlay.classList.add('hidden'); }

function updateScrollBottomBtn() {
    if (!messagesDiv || !scrollBottomBtn) return;
    const distanceFromBottom = messagesDiv.scrollHeight - messagesDiv.scrollTop - messagesDiv.clientHeight;
    if (distanceFromBottom > 200) {
        scrollBottomBtn.classList.remove('hidden');
    } else {
        scrollBottomBtn.classList.add('hidden');
    }
}

// ============================================================================
// INITIALIZATION
// ============================================================================
document.addEventListener('DOMContentLoaded', () => {
    setupMarked();
    initCustomModals();

    // Cache DOM
    loginPage = document.getElementById('loginPage');
    chatPage = document.getElementById('chatPage');
    sessionListDiv = document.getElementById('sessionList');
    messagesDiv = document.getElementById('messagesContainer');
    messageInput = document.getElementById('messageInput');
    sendBtn = document.getElementById('sendMsgBtn');
    newChatBtn = document.getElementById('newChatBtn');
    logoutBtn = document.getElementById('logoutSidebarBtn');
    chatTitleSpan = document.getElementById('chatTitle');
    attachBtn = document.getElementById('attachPdfBtn');
    fileInput = document.getElementById('pdfFileInput');
    fileBadge = document.getElementById('fileBadge');
    modeBtns = document.querySelectorAll('.mode-pill');
    loadingOverlay = document.getElementById('loadingOverlay');
    // Sidebar / Drawer
    sidebar = document.getElementById('sessionDrawer') || document.getElementById('sidebar');
    sidebarToggle = document.getElementById('sidebarToggle');
    scrollBottomBtn = document.getElementById('scrollBottomBtn');
    sessionSearchInput = document.getElementById('sessionSearchInput');
    clearSearchBtn = document.getElementById('clearSearchBtn');

    const isMobile = window.innerWidth <= 768;
    const savedSidebarState = localStorage.getItem('sidebar_collapsed');
    if ((savedSidebarState === 'true' || (isMobile && savedSidebarState === null)) && sidebar) {
        sidebar.classList.add('collapsed');
    }
    const sidebarIsOpen = !sidebar?.classList.contains('collapsed');
    document.getElementById('drawerToggleBtn')?.setAttribute('aria-expanded', String(sidebarIsOpen));

    bindStarterChips();
    setupEventListeners();
    loadAvailableModels(false);
    checkAuth();
});

// ============================================================================
// DYNAMIC MODEL DISCOVERY SERVICE
// Fetches whatever models are available with the API key in .env, auto-refreshed
// ============================================================================
async function loadAvailableModels(forceRefresh = false) {
    const listContainer = document.getElementById('composerModelList');
    const noteEl = document.getElementById('composerModelNote');

    try {
        const url = `${API_URL}/models${forceRefresh ? '?refresh=1' : ''}`;
        const res = await fetch(url);
        if (res.ok) {
            const data = await res.json();
            if (data.models && Array.isArray(data.models) && data.models.length > 0) {
                availableModels = data.models;
                renderModelOptions(data.models, data.default);
                if (noteEl) {
                    noteEl.innerHTML = `<span style="display:inline-flex;align-items:center;gap:5px;"><i class="fas fa-bolt" style="color:#65d69a;"></i> Synced with API key</span> <span style="color:#6c7280;font-size:0.65rem;">${data.models.length} available</span>`;
                }
                return;
            }
        }
    } catch (err) {
        console.warn('Dynamic model fetch failed, using fallback models:', err);
    }

    // Fallback models when offline, initial load before network, or demo mode
    if (!availableModels || availableModels.length === 0) {
        availableModels = [
            { id: 'auto', name: 'Auto', description: 'Let DualMind choose the best model', badge: 'Smart' },
            { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B', description: 'Balanced reasoning · Current default', badge: 'Default' },
            { id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B', description: 'Faster responses · 128k context', badge: 'Fast' },
            { id: 'deepseek-r1-distill-llama-70b', name: 'DeepSeek R1 70B', description: 'Advanced reasoning & logic', badge: 'Reasoning' }
        ];
        renderModelOptions(availableModels, 'llama-3.3-70b-versatile');
    }
}

function renderModelOptions(models, defaultModelId = 'llama-3.3-70b-versatile') {
    const listContainer = document.getElementById('composerModelList');
    const modelMenu = document.getElementById('composerModelMenu');
    const modelButton = document.getElementById('composerModelBtn');
    const labelSpan = document.getElementById('selectedModelLabel');
    if (!listContainer) return;

    // Retrieve saved user preference
    const saved = localStorage.getItem('dualmind_model_preference') || currentSelectedModel || 'auto';
    let matched = models.find(m => m.id.toLowerCase() === saved.toLowerCase() || m.name.toLowerCase() === saved.toLowerCase());
    if (!matched) {
        matched = models.find(m => m.id === defaultModelId) || models[0];
    }
    currentSelectedModel = matched ? matched.id : 'auto';

    if (labelSpan && matched) {
        labelSpan.textContent = matched.name;
    }

    listContainer.innerHTML = '';
    models.forEach(m => {
        const isSelected = (m.id.toLowerCase() === currentSelectedModel.toLowerCase() || 
                           (currentSelectedModel === 'auto' && m.id === 'auto'));

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `composer-menu-option ${isSelected ? 'selected' : ''}`;
        btn.dataset.model = m.id;
        btn.dataset.name = m.name;
        btn.setAttribute('role', 'menuitemradio');
        btn.setAttribute('aria-checked', String(isSelected));

        const badgeClass = (m.badge || '').toLowerCase();
        const badgeHtml = m.badge 
            ? `<span class="model-badge ${badgeClass}">${escapeHtml(m.badge)}</span>` 
            : '';

        btn.innerHTML = `
            <span>
                <strong style="display:inline-flex;align-items:center;gap:6px;">
                    <span>${escapeHtml(m.name)}</span>
                    ${badgeHtml}
                </strong>
                <small>${escapeHtml(m.description || '')}</small>
            </span>
            <i class="fas fa-check"></i>
        `;

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            currentSelectedModel = m.id;
            localStorage.setItem('dualmind_model_preference', m.id);
            if (labelSpan) labelSpan.textContent = m.name;

            listContainer.querySelectorAll('.composer-menu-option').forEach(opt => {
                const sel = (opt === btn);
                opt.classList.toggle('selected', sel);
                opt.setAttribute('aria-checked', String(sel));
            });

            if (modelMenu) modelMenu.classList.add('hidden');
            if (modelButton) modelButton.setAttribute('aria-expanded', 'false');
            showToast(`Active model: ${m.name}`, 'info', 1600);
        });

        listContainer.appendChild(btn);
    });
}

function setupEventListeners() {
    // Auth Tabs
    document.getElementById('tabSignIn')?.addEventListener('click', () => toggleForms(false));
    document.getElementById('tabSignUp')?.addEventListener('click', () => toggleForms(true));
    document.getElementById('showRegister')?.addEventListener('click', (e) => { e.preventDefault(); toggleForms(true); });
    document.getElementById('showLogin')?.addEventListener('click', (e) => { e.preventDefault(); toggleForms(false); });

    // Password visibility toggle
    document.querySelectorAll('.password-toggle').forEach(btn => {
        btn.addEventListener('click', () => {
            const targetId = btn.dataset.target;
            const targetInput = document.getElementById(targetId);
            if (targetInput) {
                const isPassword = targetInput.type === 'password';
                targetInput.type = isPassword ? 'text' : 'password';
                btn.innerHTML = `<i class="fas fa-${isPassword ? 'eye-slash' : 'eye'}"></i>`;
            }
        });
    });

    // Login
    document.getElementById('loginBtn')?.addEventListener('click', doLogin);
    document.getElementById('loginPassword')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doLogin(); } });
    document.getElementById('loginEmail')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doLogin(); } });

    // Register
    document.getElementById('registerBtn')?.addEventListener('click', doRegister);
    document.getElementById('registerPassword')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doRegister(); } });

    // OTP
    document.getElementById('verifyOtpBtn')?.addEventListener('click', verifyOtp);
    document.getElementById('otpInput')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); verifyOtp(); } });
    document.getElementById('resendOtpBtn')?.addEventListener('click', resendOtp);
    document.getElementById('backToSignin')?.addEventListener('click', (e) => { e.preventDefault(); hideOtpForm(); });

    // Chat
    sendBtn?.addEventListener('click', sendMessage);
    messageInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    messageInput?.addEventListener('input', () => {
        messageInput.style.height = 'auto';
        messageInput.style.height = Math.min(messageInput.scrollHeight, 150) + 'px';
        updateSendButtonState();
    });

    newChatBtn?.addEventListener('click', startNewChat);
    document.getElementById('railNewThreadBtn')?.addEventListener('click', startNewChat);
    document.getElementById('railHomeBtn')?.addEventListener('click', startNewChat);

    logoutBtn?.addEventListener('click', async () => {
        const confirmed = await showConfirmDialog('Sign out?', 'Are you sure you want to sign out of DualMind?', 'Sign Out', false);
        if (confirmed) doLogout();
    });

    // File attachments
    attachBtn?.addEventListener('click', () => fileInput?.click());
    document.getElementById('railDocumentsBtn')?.addEventListener('click', () => fileInput?.click());
    fileInput?.addEventListener('change', onFileSelect);
    document.getElementById('removeFileBtn')?.addEventListener('click', () => {
        pendingFile = null;
        if (fileBadge) fileBadge.classList.add('hidden');
        if (fileInput) fileInput.value = '';
        updateSendButtonState();
        showToast('Attachment removed', 'info');
    });

    // Drawer / Rail Navigation
    document.getElementById('railHistoryBtn')?.addEventListener('click', toggleSidebar);
    document.getElementById('drawerToggleBtn')?.addEventListener('click', toggleSidebar);
    document.getElementById('railClearChatBtn')?.addEventListener('click', async () => {
        const confirmed = await showConfirmDialog(
            'Clear this chat view?',
            'This clears the messages from view. Your saved thread remains in Sessions.',
            'Clear chat',
            false
        );
        if (confirmed) {
            clearMessages();
            showToast('Chat view cleared', 'info');
        }
    });
    document.getElementById('closeDrawerBtn')?.addEventListener('click', () => {
        const drawer = document.getElementById('sessionDrawer') || sidebar;
        drawer?.classList.add('collapsed');
        localStorage.setItem('sidebar_collapsed', 'true');
        document.getElementById('drawerToggleBtn')?.setAttribute('aria-expanded', 'false');
        document.getElementById('railHistoryBtn')?.setAttribute('aria-expanded', 'false');
        document.getElementById('drawerBackdrop')?.classList.remove('active');
    });

    document.getElementById('drawerBackdrop')?.addEventListener('click', closeMobileSidebar);

    document.getElementById('drawerLogoutBtn')?.addEventListener('click', () => {
        doLogout();
    });

    window.addEventListener('resize', () => {
        if (window.innerWidth > 768) {
            document.getElementById('drawerBackdrop')?.classList.remove('active');
        }
    });

    // Search strategy and model pickers live beside the message composer.
    const searchModeButton = document.getElementById('writingStyleBtn');
    const searchModeMenu = document.getElementById('searchModeMenu');
    const modelButton = document.getElementById('composerModelBtn');
    const modelMenu = document.getElementById('composerModelMenu');
    searchModeButton?.addEventListener('click', (event) => {
        event.stopPropagation();
        const opening = searchModeMenu?.classList.contains('hidden');
        searchModeMenu?.classList.toggle('hidden', !opening);
        searchModeButton.setAttribute('aria-expanded', String(Boolean(opening)));
    });
    searchModeMenu?.querySelectorAll('[data-search-mode]').forEach(option => option.addEventListener('click', () => {
        currentMode = option.dataset.searchMode;
        searchModeMenu.querySelectorAll('[data-search-mode]').forEach(item => {
            const selected = item === option;
            item.classList.toggle('selected', selected);
            item.setAttribute('aria-checked', String(selected));
        });
        document.getElementById('currentWritingStyle').textContent = currentMode === 'hybrid' ? 'Hybrid search' : 'Live web';
        searchModeMenu.classList.add('hidden');
        searchModeButton.setAttribute('aria-expanded', 'false');
    }));
    modelButton?.addEventListener('click', (event) => {
        event.stopPropagation();
        const opening = modelMenu?.classList.contains('hidden');
        modelMenu?.classList.toggle('hidden', !opening);
        modelButton.setAttribute('aria-expanded', String(Boolean(opening)));
        if (opening) {
            loadAvailableModels(false);
        }
    });

    // User Avatar Popup Menu
    const userAvatarBtn = document.getElementById('railUserAvatarBtn');
    const userMenu = document.getElementById('userPopupMenu');
    userAvatarBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        userMenu?.classList.toggle('hidden');
    });

    // Enterprise Multi-Format Export Menu
    const exportBtn = document.getElementById('exportChatBtn');
    const exportDropdown = document.getElementById('exportDropdownMenu');
    exportBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!exportDropdown) {
            exportConversation();
            return;
        }
        const opening = exportDropdown.classList.contains('hidden');
        exportDropdown.classList.toggle('hidden', !opening);
        exportBtn.setAttribute('aria-expanded', String(opening));
    });
    document.getElementById('exportMarkdownOption')?.addEventListener('click', () => {
        exportDropdown?.classList.add('hidden');
        exportBtn?.setAttribute('aria-expanded', 'false');
        exportConversation();
    });
    document.getElementById('exportCopyOption')?.addEventListener('click', () => {
        exportDropdown?.classList.add('hidden');
        exportBtn?.setAttribute('aria-expanded', 'false');
        copyConversationTranscript();
    });
    document.getElementById('exportPrintOption')?.addEventListener('click', () => {
        exportDropdown?.classList.add('hidden');
        exportBtn?.setAttribute('aria-expanded', 'false');
        window.print();
    });

    // Close menus on outside click
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.session-actions')) {
            document.querySelectorAll('.session-context-menu').forEach(menu => menu.classList.add('hidden'));
            document.querySelectorAll('.session-menu-trigger').forEach(trigger => trigger.setAttribute('aria-expanded', 'false'));
        }
        if (!e.target.closest('.mode-picker-wrap')) {
            searchModeMenu?.classList.add('hidden');
            searchModeButton?.setAttribute('aria-expanded', 'false');
        }
        if (!e.target.closest('.composer-model-wrap')) {
            modelMenu?.classList.add('hidden');
            modelButton?.setAttribute('aria-expanded', 'false');
        }
        if (!e.target.closest('.topbar-export-wrap')) {
            exportDropdown?.classList.add('hidden');
            exportBtn?.setAttribute('aria-expanded', 'false');
        }
        if (userMenu && !userMenu.contains(e.target) && !userAvatarBtn?.contains(e.target)) {
            userMenu.classList.add('hidden');
        }
    });

    // Session search
    sessionSearchInput?.addEventListener('input', () => {
        const query = sessionSearchInput.value.trim();
        clearSearchBtn?.classList.toggle('hidden', !query);
        renderSessionList(allSessions);
    });

    clearSearchBtn?.addEventListener('click', () => {
        sessionSearchInput.value = '';
        clearSearchBtn.classList.add('hidden');
        renderSessionList(allSessions);
    });

    // Scroll
    scrollBottomBtn?.addEventListener('click', () => {
        if (messagesDiv) messagesDiv.scrollTo({ top: messagesDiv.scrollHeight, behavior: 'smooth' });
    });
    messagesDiv?.addEventListener('scroll', updateScrollBottomBtn);

    // Initial state sync
    updateSendButtonState();

    // Keyboard Shortcuts
    window.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
            e.preventDefault();
            createNewSession();
        } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
            e.preventDefault();
            toggleSidebar();
        } else if (e.key === 'Escape') {
            closeConfirmDialog(false);
            closePromptDialog(null);
            modelMenu?.classList.add('hidden');
            searchModeMenu?.classList.add('hidden');
            exportDropdown?.classList.add('hidden');
            exportBtn?.setAttribute('aria-expanded', 'false');
            document.querySelectorAll('.session-context-menu').forEach(menu => menu.classList.add('hidden'));
            userMenu?.classList.add('hidden');
        }
    });
}
