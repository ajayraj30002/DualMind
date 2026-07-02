const API_URL = window.__ENV__?.BACKEND_URL;
let token = null;
let user = null;
let currentSessionId = null;
let currentMode = 'hybrid';
let pendingFile = null;
let currentSessionDocuments = [];
let pendingSignupEmail = null;

let loginPage, chatPage, sessionListDiv, messagesDiv, messageInput, sendBtn;
let newChatBtn, renameBtn, logoutBtn, chatTitleSpan, attachBtn, fileInput, fileBadge;
let modeBtns, loadingOverlay, sidebar, sidebarToggle, scrollBottomBtn;

const WELCOME_HTML = `
    <div class="welcome">
        <i class="fas fa-brain"></i>
        <h3>Ready when you are</h3>
        <p>Ask from your PDFs, the web, or both. Hybrid mode gives you the best of both worlds.</p>
    </div>
`;

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

function addCopyButtonsToCodeBlocks() {
    document.querySelectorAll('.md-body pre').forEach(pre => {
        if (pre.parentElement.classList.contains('code-wrapper')) return;
        const code = pre.querySelector('code');
        if (!code) return;
        const wrapper = document.createElement('div');
        wrapper.className = 'code-wrapper';
        pre.parentNode.insertBefore(wrapper, pre);
        wrapper.appendChild(pre);
        const copyBtn = document.createElement('button');
        copyBtn.className = 'copy-btn';
        copyBtn.innerHTML = '<i class="fas fa-copy"></i> Copy';
        copyBtn.onclick = async () => {
            await navigator.clipboard.writeText(code.textContent || '');
            copyBtn.innerHTML = '<i class="fas fa-check"></i> Copied!';
            copyBtn.classList.add('copied');
            setTimeout(() => {
                copyBtn.innerHTML = '<i class="fas fa-copy"></i> Copy';
                copyBtn.classList.remove('copied');
            }, 2000);
        };
        wrapper.appendChild(copyBtn);
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

    // Custom renderer: escape HTML entities inside code blocks BEFORE
    // highlight.js processes them. This prevents the highlight.js
    // "unescaped HTML" security warning and closes the XSS vector
    // where LLM-generated code blocks could contain raw <script> tags.
    const renderer = new marked.Renderer();
    renderer.code = function(code, language) {
        // Step 1: escape any HTML entities in the raw code string
        const escaped = code
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');

        // Step 2: syntax-highlight the already-escaped code
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
        
        // Sanitize HTML to prevent XSS — explicit allowlist blocks
        // dangerous tags/attrs, and ALLOWED_URI_REGEXP blocks javascript: hrefs
        // even if the LLM outputs them (e.g. via indirect prompt injection
        // through a malicious PDF or poisoned Tavily search result).
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
        label = '📄 PDF Document';
    } else if (type.includes('web') || type.includes('open')) {
        icon = 'fa-globe';
        label = '🌐 Web Search';
    } else {
        icon = 'fa-link';
        label = '🔗 Hybrid Search';
    }
    return `<div class="source-badge"><i class="fas ${icon}"></i> ${label}</div>`;
}

async function addMessageToChat(role, content, filename = null, searchTypeUsed = null, resumeAnalysis = null) {
    if (!messagesDiv) return;
    const welcome = messagesDiv.querySelector('.welcome');
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
        messageDiv.innerHTML = `
            <div class="message-avatar"><i class="fas fa-user"></i></div>
            <div class="message-content">
                ${attachmentHTML}
                <span>${escapeHtml(finalContent).replace(/\n/g, '<br>')}</span>
            </div>
        `;
    } else {
        // Check for ATS resume analysis — from explicit data or parsed from content
        const atsData = resumeAnalysis || tryParseResumeAnalysis(finalContent);
        if (atsData && atsData.overall_score) {
            const scoreCardHtml = renderResumeScoreCard(atsData);
            messageDiv.innerHTML = `
                <div class="message-avatar"><i class="fas fa-brain"></i></div>
                <div class="message-content">
                    ${scoreCardHtml}
                    <div class="source-badge"><i class="fas fa-file-pdf"></i> 📊 ATS Analysis</div>
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
            messageDiv.innerHTML = `
                <div class="message-avatar"><i class="fas fa-brain"></i></div>
                <div class="message-content">
                    ${renderedContent}
                    ${sourceBadge}
                </div>
            `;
        }
    }
    messagesDiv.appendChild(messageDiv);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
    updateScrollBottomBtn();
}

async function sendMessage() {
    const text = messageInput?.value.trim();
    if (!text || !currentSessionId) return;
    const hasFile = !!pendingFile;
    const uploadedFilename = hasFile ? pendingFile.name : null;
    messageInput.value = '';
    messageInput.style.height = 'auto';
    await addMessageToChat('user', text, uploadedFilename);
    const messageCount = messagesDiv?.querySelectorAll('.message').length || 0;
    if (messageCount === 1) await autoTitle(currentSessionId, text);
    if (hasFile) {
        try {
            showTyping();
            await uploadFile(pendingFile, currentSessionId);
            pendingFile = null;
            if (fileBadge) fileBadge.classList.add('hidden');
            hideTyping();
        } catch (err) {
            hideTyping();
            await addMessageToChat('assistant', `❌ Upload failed: ${err.message}`);
            return;
        }
    }
    showTyping();
    if (sendBtn) sendBtn.disabled = true;
    try {
        const res = await fetch(`${API_URL}/chat/sessions/${currentSessionId}/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ question: text, search_type: currentMode, include_sources: true, uploaded_document: uploadedFilename })
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
            await addMessageToChat('assistant', 'Sorry, something went wrong.');
        }
    } catch (err) {
        hideTyping();
        await addMessageToChat('assistant', 'Connection error.');
    } finally {
        if (sendBtn) sendBtn.disabled = false;
        messageInput?.focus();
    }
}

async function loadSession(sessionId) {
    if (sessionId === currentSessionId) return;
    currentSessionId = sessionId;
    try {
        await loadSessionDocuments(sessionId);
        const res = await fetch(`${API_URL}/chat/sessions/${sessionId}/messages`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.status === 401) { doLogout(); return; }
        const data = await res.json();
        const sessionsRes = await fetch(`${API_URL}/chat/sessions`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const sessionsData = await sessionsRes.json();
        const sessionInfo = sessionsData.sessions?.find(s => s.id === sessionId);
        if (sessionInfo) chatTitleSpan.innerText = sessionInfo.title;
        if (messagesDiv) {
            if (!data.messages || data.messages.length === 0) {
                messagesDiv.innerHTML = WELCOME_HTML;
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
        await loadSessions();
    } catch (err) { console.error(err); }
}

function toggleSidebar() {
    if (sidebar) {
        sidebar.classList.toggle('collapsed');
        localStorage.setItem('sidebar_collapsed', sidebar.classList.contains('collapsed'));
    }
}

document.addEventListener('DOMContentLoaded', () => {
    setupMarked();
    loginPage = document.getElementById('loginPage');
    chatPage = document.getElementById('chatPage');
    sessionListDiv = document.getElementById('sessionList');
    messagesDiv = document.getElementById('messagesContainer');
    messageInput = document.getElementById('messageInput');
    sendBtn = document.getElementById('sendMsgBtn');
    newChatBtn = document.getElementById('newChatBtn');
    renameBtn = document.getElementById('renameChatBtn');
    logoutBtn = document.getElementById('logoutSidebarBtn');
    chatTitleSpan = document.getElementById('chatTitle');
    attachBtn = document.getElementById('attachPdfBtn');
    fileInput = document.getElementById('pdfFileInput');
    fileBadge = document.getElementById('fileBadge');
    modeBtns = document.querySelectorAll('.mode-pill');
    loadingOverlay = document.getElementById('loadingOverlay');
    sidebar = document.getElementById('sidebar');
    sidebarToggle = document.getElementById('sidebarToggle');
    scrollBottomBtn = document.getElementById('scrollBottomBtn');
    const savedSidebarState = localStorage.getItem('sidebar_collapsed');
    if (savedSidebarState === 'true' && sidebar) sidebar.classList.add('collapsed');
    setupEventListeners();
    checkAuth();
});

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

// ========== AUTH FUNCTIONS ==========

function setupEventListeners() {
    // Login
    document.getElementById('loginBtn')?.addEventListener('click', async () => { 
        showLoading(); 
        await doLogin(); 
        hideLoading(); 
    });
    document.getElementById('loginPassword')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { 
            e.preventDefault(); 
            document.getElementById('loginBtn').click(); 
        }
    });
    document.getElementById('loginEmail')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { 
            e.preventDefault(); 
            document.getElementById('loginBtn').click(); 
        }
    });
    
    // Register
    document.getElementById('registerBtn')?.addEventListener('click', async () => { 
        showLoading(); 
        await doRegister(); 
        hideLoading(); 
    });
    document.getElementById('registerPassword')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { 
            e.preventDefault(); 
            document.getElementById('registerBtn').click(); 
        }
    });
    
    // OTP
    document.getElementById('verifyOtpBtn')?.addEventListener('click', verifyOtp);
    document.getElementById('otpInput')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { 
            e.preventDefault(); 
            verifyOtp(); 
        }
    });
    document.getElementById('resendOtpBtn')?.addEventListener('click', resendOtp);
    document.getElementById('backToSignin')?.addEventListener('click', (e) => {
        e.preventDefault();
        hideOtpForm();
    });
    
    // Form switches
    document.getElementById('showRegister')?.addEventListener('click', (e) => {
        e.preventDefault();
        toggleForms(true);
    });
    document.getElementById('showLogin')?.addEventListener('click', (e) => {
        e.preventDefault();
        toggleForms(false);
    });
    
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
    });
    newChatBtn?.addEventListener('click', createNewSession);
    renameBtn?.addEventListener('click', renameSession);
    logoutBtn?.addEventListener('click', async () => { showLoading(); doLogout(); hideLoading(); });
    attachBtn?.addEventListener('click', () => fileInput?.click());
    fileInput?.addEventListener('change', onFileSelect);
    sidebarToggle?.addEventListener('click', toggleSidebar);
    scrollBottomBtn?.addEventListener('click', () => {
        if (messagesDiv) messagesDiv.scrollTo({ top: messagesDiv.scrollHeight, behavior: 'smooth' });
    });
    messagesDiv?.addEventListener('scroll', updateScrollBottomBtn);
    
    modeBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            modeBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentMode = btn.dataset.mode;
        });
    });
}

async function doLogin() {
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    const errorEl = document.getElementById('loginError');
    
    // Clear previous errors
    if (errorEl) {
        errorEl.textContent = '';
        errorEl.classList.add('hidden');
    }
    
    if (!email || !password) {
        if (errorEl) {
            errorEl.textContent = 'Please enter both email and password.';
            errorEl.classList.remove('hidden');
        }
        hideLoading();
        return;
    }
    
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
            showChatUI();
            await loadSessions();
        } else {
            // Show error inside the page
            if (errorEl) {
                errorEl.textContent = data.detail || 'Invalid email or password. Please try again.';
                errorEl.classList.remove('hidden');
            }
        }
    } catch (err) {
        if (errorEl) {
            errorEl.textContent = 'Connection error. Please check your network.';
            errorEl.classList.remove('hidden');
        }
    } finally {
        hideLoading();
    }
}

async function doRegister() {
    const name = document.getElementById('registerName').value.trim();
    const email = document.getElementById('registerEmail').value.trim();
    const password = document.getElementById('registerPassword').value;
    const errorEl = document.getElementById('registerError');
    
    // Clear previous messages
    if (errorEl) {
        errorEl.textContent = '';
        errorEl.classList.add('hidden');
    }
    
    if (!name || !email || !password) {
        if (errorEl) {
            errorEl.textContent = 'Please fill in all fields.';
            errorEl.classList.remove('hidden');
        }
        hideLoading();
        return;
    }
    
    if (password.length < 6) {
        if (errorEl) {
            errorEl.textContent = 'Password must be at least 6 characters.';
            errorEl.classList.remove('hidden');
        }
        hideLoading();
        return;
    }
    
    try {
        const res = await fetch(`${API_URL}/auth/signup`, {
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password, full_name: name })
        });
        const data = await res.json();
        
        if (res.ok) {
            // Signup successful - show OTP form
            pendingSignupEmail = email;
            showOtpForm(email);
        } else {
            // Show error (user already exists, etc.)
            if (errorEl) {
                errorEl.textContent = data.detail || 'Signup failed. Please try again.';
                errorEl.classList.remove('hidden');
            }
        }
    } catch (err) {
        if (errorEl) {
            errorEl.textContent = 'Connection error. Please check your network.';
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
    localStorage.clear();
    showLoginUI();
}

function checkAuth() {
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
    loginPage.classList.remove('hidden');
    chatPage.classList.add('hidden');
}

function showChatUI() {
    loginPage.classList.add('hidden');
    chatPage.classList.remove('hidden');
    document.getElementById('userEmailSidebar').innerText = user?.email?.split('@')[0] || 'User';
}

function toggleForms(showRegister) {
    document.getElementById('loginForm').classList.toggle('active', !showRegister);
    document.getElementById('registerForm').classList.toggle('active', showRegister);
    document.getElementById('otpForm').classList.remove('active');
    
    // Clear errors
    const loginError = document.getElementById('loginError');
    const registerError = document.getElementById('registerError');
    const otpError = document.getElementById('otpError');
    if (loginError) { loginError.textContent = ''; loginError.classList.add('hidden'); }
    if (registerError) { registerError.textContent = ''; registerError.classList.add('hidden'); }
    if (otpError) { otpError.textContent = ''; otpError.classList.add('hidden'); }
}

function showOtpForm(email) {
    document.getElementById('registerForm').classList.remove('active');
    document.getElementById('loginForm').classList.remove('active');
    document.getElementById('otpForm').classList.add('active');
    document.getElementById('otpEmailDisplay').textContent = email;
    document.getElementById('otpInput').value = '';
    document.getElementById('otpInput').focus();
    
    // Clear OTP errors
    const otpError = document.getElementById('otpError');
    if (otpError) { otpError.textContent = ''; otpError.classList.add('hidden'); }
}

function hideOtpForm() {
    document.getElementById('otpForm').classList.remove('active');
    document.getElementById('loginForm').classList.add('active');
    document.getElementById('otpInput').value = '';
    pendingSignupEmail = null;
    
    // Clear OTP errors
    const otpError = document.getElementById('otpError');
    if (otpError) { otpError.textContent = ''; otpError.classList.add('hidden'); }
}

async function verifyOtp() {
    const otp = document.getElementById('otpInput').value.trim();
    const errorEl = document.getElementById('otpError');
    
    // Clear previous messages
    if (errorEl) {
        errorEl.textContent = '';
        errorEl.classList.add('hidden');
    }
    
    if (!otp || otp.length !== 6 || !/^\d{6}$/.test(otp)) {
        if (errorEl) {
            errorEl.textContent = 'Please enter a valid 6-digit code.';
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
            body: JSON.stringify({ email: pendingSignupEmail, otp: otp })
        });
        const data = await res.json();
        hideLoading();
        
        if (res.ok) {
            // Verification successful - auto login
            token = data.access_token;
            user = { id: data.user_id, email: data.email };
            localStorage.setItem('dm_token', token);
            localStorage.setItem('dm_user', JSON.stringify(user));
            
            // Show success message
            const successEl = document.getElementById('otpSuccess');
            if (successEl) {
                successEl.textContent = '✅ Email verified! Logging you in...';
                successEl.classList.remove('hidden');
            }
            
            setTimeout(() => {
                showChatUI();
                loadSessions();
                // Reset OTP form
                document.getElementById('otpForm').classList.remove('active');
                document.getElementById('loginForm').classList.add('active');
                document.getElementById('otpInput').value = '';
                pendingSignupEmail = null;
                if (successEl) successEl.classList.add('hidden');
            }, 1500);
        } else {
            if (errorEl) {
                errorEl.textContent = data.detail || 'Invalid or expired OTP. Please try again.';
                errorEl.classList.remove('hidden');
            }
        }
    } catch (err) {
        hideLoading();
        if (errorEl) {
            errorEl.textContent = 'Connection error. Please check your network.';
            errorEl.classList.remove('hidden');
        }
    }
}

async function resendOtp() {
    const errorEl = document.getElementById('otpError');
    const successEl = document.getElementById('otpSuccess');
    
    if (errorEl) { errorEl.textContent = ''; errorEl.classList.add('hidden'); }
    if (successEl) { successEl.textContent = ''; successEl.classList.add('hidden'); }
    
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
        const data = await res.json();
        hideLoading();
        
        if (res.ok) {
            if (successEl) {
                successEl.textContent = '✅ New verification code sent to your email!';
                successEl.classList.remove('hidden');
            }
            document.getElementById('otpInput').value = '';
            document.getElementById('otpInput').focus();
        } else {
            if (errorEl) {
                errorEl.textContent = data.detail || 'Failed to resend code. Please try again.';
                errorEl.classList.remove('hidden');
            }
        }
    } catch (err) {
        hideLoading();
        if (errorEl) {
            errorEl.textContent = 'Connection error. Please check your network.';
            errorEl.classList.remove('hidden');
        }
    }
}

async function loadSessions() {
    if (!sessionListDiv) return;
    sessionListDiv.innerHTML = '<div style="padding: 1rem; text-align: center; color: #666;">Loading...</div>';
    try {
        const res = await fetch(`${API_URL}/chat/sessions`, { headers: { 'Authorization': `Bearer ${token}` } });
        if (res.status === 401) { doLogout(); return; }
        const data = await res.json();
        if (res.ok && data.sessions && data.sessions.length > 0) {
            renderSessionList(data.sessions);
            if (!currentSessionId && data.sessions[0]) await loadSession(data.sessions[0].id);
        } else {
            sessionListDiv.innerHTML = '<div style="padding: 1rem; text-align: center; color: #666;">No conversations yet</div>';
            if (!currentSessionId) await createNewSession();
        }
    } catch (err) {
        sessionListDiv.innerHTML = '<div style="padding: 1rem; text-align: center; color: #666;">Failed to load</div>';
    }
}

async function renameSessionFromSidebar(sessionId, currentTitle) {
    const newName = prompt('Rename conversation:', currentTitle);
    if (!newName || newName === currentTitle) return;
    try {
        await fetch(`${API_URL}/chat/sessions/${sessionId}?title=${encodeURIComponent(newName)}`, {
            method: 'PUT', headers: { 'Authorization': `Bearer ${token}` }
        });
        if (currentSessionId === sessionId) {
            chatTitleSpan.innerText = newName;
        }
        await loadSessions();
    } catch (err) { console.error(err); }
}

async function deleteSessionFromSidebar(sessionId) {
    if (!confirm('Delete this conversation?')) return;
    try {
        await fetch(`${API_URL}/chat/sessions/${sessionId}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
        if (currentSessionId === sessionId) {
            currentSessionId = null;
            currentSessionDocuments = [];
            const sessionsRes = await fetch(`${API_URL}/chat/sessions`, { headers: { 'Authorization': `Bearer ${token}` } });
            const sessionsData = await sessionsRes.json();
            if (sessionsData.sessions && sessionsData.sessions.length > 0) {
                await loadSession(sessionsData.sessions[0].id);
            } else {
                await createNewSession();
            }
        }
        await loadSessions();
    } catch (err) { console.error(err); }
}

function renderSessionList(sessions) {
    if (!sessionListDiv) return;
    sessionListDiv.innerHTML = '';
    for (const s of sessions) {
        const div = document.createElement('div');
        div.className = `session-item ${currentSessionId === s.id ? 'active' : ''}`;
        div.dataset.id = s.id;
        div.innerHTML = `
            <span class="session-title">${escapeHtml(s.title)}</span>
            <div class="session-actions">
                <button class="rename-session-btn" data-id="${s.id}" data-title="${escapeHtml(s.title)}" title="Rename">
                    <i class="fas fa-pen"></i>
                </button>
                <button class="delete-session" data-id="${s.id}" title="Delete">
                    <i class="fas fa-trash-alt"></i>
                </button>
            </div>
        `;
        div.addEventListener('click', (e) => {
            if (!e.target.closest('.delete-session') && !e.target.closest('.rename-session-btn')) {
                loadSession(s.id);
            }
        });
        div.querySelector('.delete-session')?.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteSessionFromSidebar(s.id);
        });
        div.querySelector('.rename-session-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            renameSessionFromSidebar(s.id, s.title);
        });
        sessionListDiv.appendChild(div);
    }
}

async function createNewSession() {
    try {
        const res = await fetch(`${API_URL}/chat/sessions`, {
            method: 'POST', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
        });
        if (res.status === 401) { doLogout(); return; }
        const data = await res.json();
        if (res.ok && data.session) {
            currentSessionId = data.session.id;
            currentSessionDocuments = [];
            chatTitleSpan.innerText = 'New conversation';
            clearMessages();
            await loadSessions();
        }
    } catch (err) { console.error(err); }
}

async function loadSessionDocuments(sessionId) {
    try {
        const res = await fetch(`${API_URL}/chat/sessions/${sessionId}/documents`, { headers: { 'Authorization': `Bearer ${token}` } });
        if (res.ok) { const data = await res.json(); currentSessionDocuments = data.documents || []; }
    } catch (err) { currentSessionDocuments = []; }
}

function clearMessages() {
    if (!messagesDiv) return;
    messagesDiv.innerHTML = WELCOME_HTML;
}

function showTyping() {
    if (!messagesDiv) return;
    hideTyping();
    const typing = document.createElement('div');
    typing.className = 'message assistant';
    typing.id = 'typingIndicator';
    typing.innerHTML = `<div class="message-avatar"><i class="fas fa-brain"></i></div><div class="message-content"><div class="typing-dots"><span></span><span></span><span></span></div></div>`;
    messagesDiv.appendChild(typing);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function hideTyping() {
    const el = document.getElementById('typingIndicator');
    if (el) el.remove();
}

function onFileSelect(e) {
    const file = e.target.files[0];
    if (!file || !file.name.endsWith('.pdf')) { alert('Please select a PDF file'); return; }
    pendingFile = file;
    if (fileBadge) {
        fileBadge.innerHTML = `<i class="fas fa-file-pdf"></i> ${escapeHtml(file.name)} <i class="fas fa-check-circle"></i>`;
        fileBadge.classList.remove('hidden');
    }
}

async function uploadFile(file, sessionId) {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch(`${API_URL}/upload?session_id=${sessionId}`, {
        method: 'POST', headers: { 'Authorization': `Bearer ${token}` }, body: fd
    });
    if (res.status === 401) { doLogout(); throw new Error('Unauthorized'); }
    if (!res.ok) { const error = await res.json(); throw new Error(error.detail || 'Upload failed'); }
    return await res.json();
}

async function autoTitle(sessionId, firstMsg) {
    const short = firstMsg.length > 30 ? firstMsg.substring(0, 30) + '...' : firstMsg;
    try {
        await fetch(`${API_URL}/chat/sessions/${sessionId}?title=${encodeURIComponent(short)}`, {
            method: 'PUT', headers: { 'Authorization': `Bearer ${token}` }
        });
        chatTitleSpan.innerText = short;
        await loadSessions();
    } catch (err) { console.error(err); }
}

async function renameSession() {
    const newName = prompt('Rename conversation:', chatTitleSpan?.innerText);
    if (!newName || newName === chatTitleSpan?.innerText || !currentSessionId) return;
    try {
        await fetch(`${API_URL}/chat/sessions/${currentSessionId}?title=${encodeURIComponent(newName)}`, {
            method: 'PUT', headers: { 'Authorization': `Bearer ${token}` }
        });
        chatTitleSpan.innerText = newName;
        await loadSessions();
    } catch (err) { console.error(err); }
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ========== ATS RESUME SCORE CARD ==========

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
    const circumference = 2 * Math.PI * 54;
    const offset = circumference - (overall / 10) * circumference;

    let sectionsHtml = '';
    if (data.sections && data.sections.length > 0) {
        const sectionIcons = {
            'Contact Information': 'fa-address-card',
            'Professional Summary': 'fa-file-alt',
            'Work Experience': 'fa-briefcase',
            'Skills & Keywords': 'fa-tags',
            'Education': 'fa-graduation-cap',
            'Formatting & ATS Compatibility': 'fa-align-left',
        };
        for (const section of data.sections) {
            const sColor = getScoreColor(section.score);
            const barWidth = (section.score / 10) * 100;
            const icon = sectionIcons[section.name] || 'fa-check-circle';
            let improvementsHtml = '';
            if (section.improvements && section.improvements.length > 0) {
                improvementsHtml = `<div class="ats-improvements">`;
                for (const imp of section.improvements) {
                    improvementsHtml += `<div class="ats-improvement-item"><i class="fas fa-lightbulb"></i><span>${escapeHtml(imp)}</span></div>`;
                }
                improvementsHtml += `</div>`;
            }
            sectionsHtml += `
                <div class="ats-section-card">
                    <div class="ats-section-header">
                        <div class="ats-section-title"><i class="fas ${icon}"></i><span>${escapeHtml(section.name)}</span></div>
                        <div class="ats-section-score" style="color: ${sColor}">${section.score}/10</div>
                    </div>
                    <div class="ats-bar-track"><div class="ats-bar-fill" style="width: ${barWidth}%; background: ${sColor}"></div></div>
                    <p class="ats-section-feedback">${escapeHtml(section.feedback)}</p>
                    ${improvementsHtml}
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
                <svg class="ats-circle" viewBox="0 0 120 120">
                    <circle class="ats-circle-bg" cx="60" cy="60" r="54"/>
                    <circle class="ats-circle-progress" cx="60" cy="60" r="54"
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
    // Check if the content is a JSON string containing resume analysis data
    if (!content || typeof content !== 'string') return null;
    try {
        const parsed = JSON.parse(content);
        if (parsed && typeof parsed === 'object' && 'overall_score' in parsed && 'sections' in parsed) {
            return parsed;
        }
    } catch (e) {
        // Not JSON — that's fine
    }
    return null;
}
