const API_URL = 'https://dualmind.onrender.com';

let token = null;
let user = null;
let currentSessionId = null;
let currentMode = 'hybrid';
let pendingFile = null;
let currentSessionDocuments = [];

let loginPage, chatPage, sessionListDiv, messagesDiv, messageInput, sendBtn;
let newChatBtn, renameBtn, logoutBtn, chatTitleSpan, attachBtn, fileInput, fileBadge;
let modeBtns, loadingOverlay, sidebar, sidebarToggle;

const WELCOME_HTML = `
    <div class="welcome">
        <i class="fas fa-brain"></i>
        <h3>Ready when you are</h3>
        <p>Ask from your PDFs, the web, or both. Use Hybrid for the best experience.</p>
    </div>
`;

// ─────────────────────────────────────────────
// MARKDOWN SETUP
// ─────────────────────────────────────────────

function setupMarked() {
    if (typeof marked === 'undefined') { console.error('Marked not loaded'); return; }
    try {
        const renderer = new marked.Renderer();

        // Links open in new tab
        renderer.link = (href, title, text) =>
            `<a href="${href}" target="_blank" rel="noopener noreferrer"${title ? ` title="${title}"` : ''}>${text}</a>`;

        // Code blocks with highlight.js + language label + copy button ID
        renderer.code = (code, language) => {
            let highlighted = escapeHtml(code);
            let langLabel = language || 'code';
            if (language && typeof hljs !== 'undefined' && hljs.getLanguage(language)) {
                try { highlighted = hljs.highlight(code, { language }).value; } catch (_) {}
            } else if (typeof hljs !== 'undefined') {
                try {
                    const result = hljs.highlightAuto(code);
                    highlighted = result.value;
                    if (result.language) langLabel = result.language;
                } catch (_) {}
            }
            const id = 'cb-' + Math.random().toString(36).substr(2, 8);
            return `<div class="code-wrapper">
  <div class="code-header">
    <span class="code-lang">${escapeHtml(langLabel)}</span>
    <button class="copy-btn" onclick="copyCode('${id}')"><i class="fas fa-copy"></i> Copy</button>
  </div>
  <pre><code id="${id}" class="hljs ${escapeHtml(language || '')}">${highlighted}</code></pre>
</div>`;
        };

        marked.use({ renderer });
        marked.setOptions({ gfm: true, breaks: true, pedantic: false });
        console.log('✅ Markdown configured');
    } catch (e) { console.error('Markdown setup error:', e); }
}

// ─────────────────────────────────────────────
// CLEAN RESPONSE — removes stray # symbols and artifacts
// ─────────────────────────────────────────────

function cleanResponse(text) {
    if (!text || typeof text !== 'string') return '';
    let t = text;

    // Fix headers that got merged into previous line (# Summary → \n## Summary)
    // The main bug: "text# Header" → split properly
    t = t.replace(/([^\n])(#{1,4} )/g, '$1\n\n$2');

    // Fix malformed headers missing space: ##Header → ## Header
    t = t.replace(/^(#{1,4})([^ #\n])/gm, '$1 $2');

    // Remove standalone stray # on its own that's not a header
    // A real header is: start of line, 1-4 #, space, text
    // A stray # is: # followed by nothing useful or surrounded by text
    t = t.replace(/(?<!\n)#(?!#+? \w)/g, '');

    // Remove internal source labels
    t = t.replace(/\[(Web Search|PDF Document|RAG|Hybrid|Document)\]/gi, '');

    // Remove [object Object]
    t = t.replace(/\[object Object\]/gi, '');

    // Remove standalone chunk numbers on own line
    t = t.replace(/^\d+\s*$/gm, '');

    // Normalize excessive blank lines
    t = t.replace(/\n{4,}/g, '\n\n');

    return t.trim();
}

// ─────────────────────────────────────────────
// RENDER MARKDOWN
// ─────────────────────────────────────────────

function renderMarkdown(text) {
    if (!text) return '<div class="md-body"></div>';
    try {
        const html = marked.parse(String(text));
        return `<div class="md-body">${html}</div>`;
    } catch (e) {
        console.error('Markdown render error:', e);
        return `<div class="md-body"><p>${escapeHtml(text).replace(/\n/g, '<br>')}</p></div>`;
    }
}

// ─────────────────────────────────────────────
// COPY CODE BUTTON
// ─────────────────────────────────────────────

function copyCode(id) {
    const el = document.getElementById(id);
    if (!el) return;
    navigator.clipboard.writeText(el.textContent || '').then(() => {
        const btn = el.closest('.code-wrapper')?.querySelector('.copy-btn');
        if (btn) {
            btn.innerHTML = '<i class="fas fa-check"></i> Copied!';
            btn.classList.add('copied');
            setTimeout(() => {
                btn.innerHTML = '<i class="fas fa-copy"></i> Copy';
                btn.classList.remove('copied');
            }, 2000);
        }
    });
}

// ─────────────────────────────────────────────
// SOURCE BADGE
// ─────────────────────────────────────────────

function buildSourceBadge(searchTypeUsed) {
    if (!searchTypeUsed || searchTypeUsed === 'Conversation') return '';
    const t = String(searchTypeUsed).toLowerCase();
    if (t.includes('pdf') || t.includes('document')) return `<div class="source-badge"><i class="fas fa-file-pdf"></i> PDF Document</div>`;
    if (t.includes('web') || t.includes('open'))      return `<div class="source-badge"><i class="fas fa-globe"></i> Web Search</div>`;
    if (t.includes('hybrid'))                          return `<div class="source-badge"><i class="fas fa-link"></i> Hybrid Search</div>`;
    if (t.includes('rating') || t.includes('analys'))  return `<div class="source-badge"><i class="fas fa-star"></i> Document Analysis</div>`;
    return '';
}

// ─────────────────────────────────────────────
// ADD MESSAGE TO CHAT
// ─────────────────────────────────────────────

function addMessageToChat(role, content, filename = null, searchTypeUsed = null) {
    if (!messagesDiv) return;

    const welcome = messagesDiv.querySelector('.welcome');
    if (welcome && role === 'user') welcome.remove();

    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${role}`;

    let attachmentHTML = '';
    if (filename) {
        attachmentHTML = `<div class="message-doc-attachment"><i class="fas fa-file-pdf"></i> ${escapeHtml(filename)}</div>`;
    }

    if (role === 'user') {
        const plainText = escapeHtml(content).replace(/\n/g, '<br>');
        messageDiv.innerHTML = `
            <div class="message-avatar"><i class="fas fa-user"></i></div>
            <div class="message-content">
                ${attachmentHTML}
                <span>${plainText}</span>
            </div>`;
    } else {
        const cleaned = cleanResponse(content);
        const rendered = renderMarkdown(cleaned);
        const badge = buildSourceBadge(searchTypeUsed);
        messageDiv.innerHTML = `
            <div class="message-avatar"><i class="fas fa-brain"></i></div>
            <div class="message-content">
                ${rendered}
                ${badge}
            </div>`;
    }

    messagesDiv.appendChild(messageDiv);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

// ─────────────────────────────────────────────
// DETECT RATING REQUEST
// ─────────────────────────────────────────────

function isRatingRequest(text) {
    const lower = text.toLowerCase();
    const ratingKeywords = [
        'rate my', 'rate this', 'rate the', 'give me a rating', 'give a rating',
        'score my', 'score this', 'evaluate my', 'evaluate this',
        'how good is my', 'how good is this', 'analyse my', 'analyze my',
        'analyse this', 'analyze this', 'review my', 'review this',
        'ats score', 'ats check', 'resume score', 'essay score',
        'how strong is my', 'critique my', 'critique this'
    ];
    return ratingKeywords.some(kw => lower.includes(kw));
}

// ─────────────────────────────────────────────
// SEND MESSAGE
// ─────────────────────────────────────────────

async function sendMessage() {
    const text = messageInput?.value.trim();
    if (!text || !currentSessionId) return;

    const hasFile = !!pendingFile;
    const uploadedFilename = hasFile ? pendingFile.name : null;

    messageInput.value = '';
    messageInput.style.height = 'auto';

    addMessageToChat('user', text, uploadedFilename);

    const messageCount = messagesDiv?.querySelectorAll('.message').length || 0;
    if (messageCount === 1) await autoTitle(currentSessionId, text);

    // Upload file first if attached
    if (hasFile) {
        try {
            showTyping();
            await uploadFile(pendingFile, currentSessionId);
            pendingFile = null;
            if (fileBadge) fileBadge.classList.add('hidden');
            hideTyping();
        } catch (err) {
            hideTyping();
            addMessageToChat('assistant', `❌ Upload failed: ${err.message}. Please try again.`);
            return;
        }
    }

    // Detect rating request — show special typing label
    const ratingMode = isRatingRequest(text) && (uploadedFilename || currentSessionDocuments.length > 0);
    showTyping(ratingMode ? 'Analysing document...' : null);
    if (sendBtn) sendBtn.disabled = true;

    try {
        const res = await fetch(`${API_URL}/chat/sessions/${currentSessionId}/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({
                question: text,
                search_type: currentMode,
                include_sources: true,
                uploaded_document: uploadedFilename
            })
        });

        if (res.status === 401) { doLogout(); return; }
        const data = await res.json();
        hideTyping();

        if (res.ok) {
            const answer = data.answer || data.response || data.content || '';
            const source = data.search_type_used || currentMode;
            addMessageToChat('assistant', answer, null, source);
        } else {
            addMessageToChat('assistant', 'Sorry, something went wrong. Please try again.');
        }
    } catch (err) {
        hideTyping();
        addMessageToChat('assistant', 'Connection error. Please check your network.');
        console.error(err);
    } finally {
        if (sendBtn) sendBtn.disabled = false;
        messageInput?.focus();
    }
}

// ─────────────────────────────────────────────
// TYPING INDICATOR
// ─────────────────────────────────────────────

function showTyping(label = null) {
    if (!messagesDiv) return;
    hideTyping();
    const typing = document.createElement('div');
    typing.className = 'message assistant';
    typing.id = 'typingIndicator';
    typing.innerHTML = `
        <div class="message-avatar"><i class="fas fa-brain"></i></div>
        <div class="message-content">
            ${label ? `<div class="typing-label">${escapeHtml(label)}</div>` : ''}
            <div class="typing-dots"><span></span><span></span><span></span></div>
        </div>`;
    messagesDiv.appendChild(typing);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function hideTyping() {
    document.getElementById('typingIndicator')?.remove();
}

// ─────────────────────────────────────────────
// SESSION MANAGEMENT
// ─────────────────────────────────────────────

async function loadSessions() {
    if (!sessionListDiv) return;
    sessionListDiv.innerHTML = '<div class="loading-text">Loading...</div>';
    try {
        const res = await fetch(`${API_URL}/chat/sessions`, { headers: { 'Authorization': `Bearer ${token}` } });
        if (res.status === 401) { doLogout(); return; }
        const data = await res.json();
        if (res.ok && data.sessions?.length > 0) {
            renderSessionList(data.sessions);
            if (!currentSessionId) await loadSession(data.sessions[0].id);
        } else {
            sessionListDiv.innerHTML = '<div class="loading-text">No conversations</div>';
            if (!currentSessionId) await createNewSession();
        }
    } catch (err) {
        sessionListDiv.innerHTML = '<div class="loading-text">Failed to load</div>';
    }
}

function renderSessionList(sessions) {
    if (!sessionListDiv || !sessions?.length) {
        if (sessionListDiv) sessionListDiv.innerHTML = '<div class="loading-text">No conversations</div>';
        return;
    }
    sessionListDiv.innerHTML = '';
    for (const s of sessions) {
        const div = document.createElement('div');
        div.className = `session-item ${currentSessionId === s.id ? 'active' : ''}`;
        div.dataset.id = s.id;
        div.innerHTML = `
            <span class="session-title">${escapeHtml(s.title)}</span>
            <button class="delete-session" data-id="${s.id}"><i class="fas fa-times"></i></button>`;
        div.addEventListener('click', (e) => { if (!e.target.closest('.delete-session')) loadSession(s.id); });
        div.querySelector('.delete-session')?.addEventListener('click', (e) => { e.stopPropagation(); deleteSession(s.id); });
        sessionListDiv.appendChild(div);
    }
}

async function createNewSession() {
    try {
        const res = await fetch(`${API_URL}/chat/sessions`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
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

async function loadSession(sessionId) {
    if (sessionId === currentSessionId) return;
    currentSessionId = sessionId;
    try {
        await loadSessionDocuments(sessionId);

        const [msgRes, sessRes] = await Promise.all([
            fetch(`${API_URL}/chat/sessions/${sessionId}/messages`, { headers: { 'Authorization': `Bearer ${token}` } }),
            fetch(`${API_URL}/chat/sessions`, { headers: { 'Authorization': `Bearer ${token}` } })
        ]);
        if (msgRes.status === 401) { doLogout(); return; }

        const msgData  = await msgRes.json();
        const sessData = await sessRes.json();

        const sessionInfo = sessData.sessions?.find(s => s.id === sessionId);
        if (sessionInfo) chatTitleSpan.innerText = sessionInfo.title;

        if (messagesDiv) {
            if (!msgData.messages?.length) {
                messagesDiv.innerHTML = WELCOME_HTML;
            } else {
                messagesDiv.innerHTML = '';
                for (const msg of msgData.messages) {
                    const content = msg.content || msg.answer || msg.response || '';
                    const searchType = msg.metadata?.search_type_used || null;
                    addMessageToChat(msg.role, content, msg.metadata?.filename, searchType);
                }
                messagesDiv.scrollTop = messagesDiv.scrollHeight;
            }
        }
        await loadSessions();
    } catch (err) { console.error(err); }
}

async function loadSessionDocuments(sessionId) {
    try {
        const res = await fetch(`${API_URL}/chat/sessions/${sessionId}/documents`, { headers: { 'Authorization': `Bearer ${token}` } });
        if (res.ok) { const d = await res.json(); currentSessionDocuments = d.documents || []; }
    } catch { currentSessionDocuments = []; }
}

async function deleteSession(sessionId) {
    if (!confirm('Delete this conversation?')) return;
    try {
        await fetch(`${API_URL}/chat/sessions/${sessionId}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
        if (currentSessionId === sessionId) {
            currentSessionId = null;
            currentSessionDocuments = [];
            const r = await fetch(`${API_URL}/chat/sessions`, { headers: { 'Authorization': `Bearer ${token}` } });
            const d = await r.json();
            if (d.sessions?.length > 0) await loadSession(d.sessions[0].id);
            else await createNewSession();
        }
        await loadSessions();
    } catch (err) { console.error(err); }
}

function clearMessages() {
    if (messagesDiv) messagesDiv.innerHTML = WELCOME_HTML;
}

// ─────────────────────────────────────────────
// FILE HANDLING
// ─────────────────────────────────────────────

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
    if (!res.ok) { const e = await res.json(); throw new Error(e.detail || 'Upload failed'); }
    return await res.json();
}

// ─────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────

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

function toggleSidebar() {
    if (sidebar) {
        sidebar.classList.toggle('collapsed');
        localStorage.setItem('sidebar_collapsed', sidebar.classList.contains('collapsed'));
    }
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ─────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    setupMarked();

    loginPage      = document.getElementById('loginPage');
    chatPage       = document.getElementById('chatPage');
    sessionListDiv = document.getElementById('sessionList');
    messagesDiv    = document.getElementById('messagesContainer');
    messageInput   = document.getElementById('messageInput');
    sendBtn        = document.getElementById('sendMsgBtn');
    newChatBtn     = document.getElementById('newChatBtn');
    renameBtn      = document.getElementById('renameChatBtn');
    logoutBtn      = document.getElementById('logoutSidebarBtn');
    chatTitleSpan  = document.getElementById('chatTitle');
    attachBtn      = document.getElementById('attachPdfBtn');
    fileInput      = document.getElementById('pdfFileInput');
    fileBadge      = document.getElementById('fileBadge');
    modeBtns       = document.querySelectorAll('.mode-btn');
    loadingOverlay = document.getElementById('loadingOverlay');
    sidebar        = document.getElementById('sidebar');
    sidebarToggle  = document.getElementById('sidebarToggle');

    const savedSidebarState = localStorage.getItem('sidebar_collapsed');
    if (savedSidebarState === 'true' && sidebar) sidebar.classList.add('collapsed');

    setupEventListeners();
    checkAuth();
});

function showLoading() { loadingOverlay?.classList.remove('hidden'); }
function hideLoading() { loadingOverlay?.classList.add('hidden'); }

function setupEventListeners() {
    document.getElementById('loginBtn')?.addEventListener('click', async () => { showLoading(); await doLogin(); hideLoading(); });
    document.getElementById('registerBtn')?.addEventListener('click', async () => { showLoading(); await doRegister(); hideLoading(); });
    document.getElementById('showRegister')?.addEventListener('click', (e) => { e.preventDefault(); toggleForms(true); });
    document.getElementById('showLogin')?.addEventListener('click', (e) => { e.preventDefault(); toggleForms(false); });

    sendBtn?.addEventListener('click', sendMessage);
    messageInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } });
    messageInput?.addEventListener('input', () => {
        messageInput.style.height = 'auto';
        messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + 'px';
    });

    newChatBtn?.addEventListener('click', createNewSession);
    renameBtn?.addEventListener('click', renameSession);
    logoutBtn?.addEventListener('click', async () => { showLoading(); doLogout(); hideLoading(); });
    attachBtn?.addEventListener('click', () => fileInput?.click());
    fileInput?.addEventListener('change', onFileSelect);
    sidebarToggle?.addEventListener('click', toggleSidebar);

    modeBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            modeBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentMode = btn.dataset.mode;
        });
    });
}

// ─────────────────────────────────────────────
// AUTH
// ─────────────────────────────────────────────

async function doLogin() {
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    if (!email || !password) { alert('Enter email and password'); hideLoading(); return; }
    try {
        const res = await fetch(`${API_URL}/auth/signin`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
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
        } else { alert('Login failed: ' + (data.detail || 'Error')); }
    } catch { alert('Connection error'); }
}

async function doRegister() {
    const name     = document.getElementById('registerName').value;
    const email    = document.getElementById('registerEmail').value.trim();
    const password = document.getElementById('registerPassword').value;
    if (!email || !password) { alert('Fill all fields'); return; }
    if (password.length < 6) { alert('Password min 6 chars'); return; }
    try {
        const res = await fetch(`${API_URL}/auth/signup`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password, full_name: name })
        });
        if (res.ok) {
            alert('Signup successful! Please login.');
            toggleForms(false);
            document.getElementById('loginEmail').value = email;
        } else {
            const data = await res.json();
            alert('Signup failed: ' + (data.detail || 'Error'));
        }
    } catch { alert('Connection error'); }
}

function doLogout() {
    token = null; user = null; currentSessionId = null; currentSessionDocuments = [];
    localStorage.clear();
    showLoginUI();
}

function checkAuth() {
    const savedToken = localStorage.getItem('dm_token');
    const savedUser  = localStorage.getItem('dm_user');
    if (savedToken && savedUser) {
        token = savedToken;
        user  = JSON.parse(savedUser);
        showChatUI();
        loadSessions();
    } else { showLoginUI(); }
}

function showLoginUI() { loginPage.classList.remove('hidden'); chatPage.classList.add('hidden'); }
function showChatUI()   { loginPage.classList.add('hidden'); chatPage.classList.remove('hidden'); document.getElementById('userEmailSidebar').innerText = user?.email?.split('@')[0] || 'User'; }
function toggleForms(showRegister) {
    document.getElementById('loginForm').classList.toggle('active', !showRegister);
    document.getElementById('registerForm').classList.toggle('active', showRegister);
}
