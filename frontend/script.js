const API_URL = 'https://dualmind.onrender.com';

let token = null;
let user = null;
let currentSessionId = null;
let currentMode = 'hybrid';
let pendingFile = null;
let currentSessionDocuments = [];

// DOM elements
let loginPage, chatPage, sessionListDiv, messagesDiv, messageInput, sendBtn;
let newChatBtn, renameBtn, logoutBtn, chatTitleSpan, attachBtn, fileInput, fileBadge;
let modeBtns, loadingOverlay;

const WELCOME_HTML = `
    <div class="welcome">
        <i class="fas fa-brain"></i>
        <h3>Ready when you are</h3>
        <p>Ask from your PDFs, the web, or both. Use Hybrid for the best experience.</p>
    </div>
`;

// ─────────────────────────────────────────────
// CLEAN RESPONSE - PRESERVES MARKDOWN FORMATTING
// ─────────────────────────────────────────────

function cleanDualMindResponse(rawText) {
    if (!rawText || typeof rawText !== 'string') return '';
    
    let cleaned = rawText;
    
    // Remove standalone numbers (chunk indices) on their own line
    cleaned = cleaned.replace(/^\d+\s*$/gm, '');
    
    // Remove standalone "33." patterns (chunk numbers without content)
    cleaned = cleaned.replace(/^(\d+)\.\s*$/gm, '');
    
    // Remove internal source labels that might leak
    cleaned = cleaned.replace(/\[(Web Search|PDF Document|RAG|Hybrid)\]/gi, '');
    
    // Fix any malformed headers (ensure ## has space)
    cleaned = cleaned.replace(/^##([^ ])/gm, '## $1');
    
    // Fix malformed bullet points
    cleaned = cleaned.replace(/^[•\-*]\s*/gm, '- ');
    
    // Clean up excessive newlines (but preserve markdown structure)
    cleaned = cleaned.replace(/\n{4,}/g, '\n\n');
    
    // Trim
    cleaned = cleaned.trim();
    
    return cleaned;
}

// ─────────────────────────────────────────────
// MARKDOWN RENDERER SETUP
// ─────────────────────────────────────────────

function setupMarked() {
    if (typeof marked === 'undefined') {
        console.error('Marked library not loaded');
        return;
    }
    
    try {
        if (marked.setOptions) {
            marked.setOptions({
                gfm: true,
                breaks: true,
                pedantic: false,
                mangle: false,
                headerIds: false
            });
        }
        
        const renderer = {
            link(href, title, text) {
                return `<a href="${href}" target="_blank" rel="noopener noreferrer" ${title ? `title="${title}"` : ''}>${text}</a>`;
            },
            code(code, language) {
                let highlighted = code;
                if (language && hljs.getLanguage(language)) {
                    try {
                        highlighted = hljs.highlight(code, { language }).value;
                    } catch (_) {}
                } else {
                    try {
                        highlighted = hljs.highlightAuto(code).value;
                    } catch (_) {}
                }
                return `<pre><code class="hljs ${language || ''}">${highlighted}</code></pre>`;
            }
        };
        
        if (marked.use) {
            marked.use({ renderer });
        }
        console.log('✅ Markdown renderer configured');
    } catch (e) {
        console.error('Markdown setup error:', e);
    }
}

// ─────────────────────────────────────────────
// RENDER MARKDOWN (ASYNC)
// ─────────────────────────────────────────────

async function renderMarkdown(text) {
    if (!text) return '<div class="md-body"></div>';
    let cleanText = String(text);
    
    try {
        let html;
        if (marked.parse && typeof marked.parse === 'function') {
            const result = marked.parse(cleanText);
            html = (result && typeof result.then === 'function') ? await result : result;
        } else if (typeof marked === 'function') {
            html = marked(cleanText);
        } else if (marked.default && typeof marked.default.parse === 'function') {
            const result = marked.default.parse(cleanText);
            html = (result && typeof result.then === 'function') ? await result : result;
        } else {
            html = cleanText;
        }
        return `<div class="md-body">${html}</div>`;
    } catch (e) {
        console.error('Markdown render error:', e);
        return `<div class="md-body">${cleanText.replace(/\n/g, '<br>')}</div>`;
    }
}

// ─────────────────────────────────────────────
// SOURCE BADGE
// ─────────────────────────────────────────────

function buildSourceBadge(searchTypeUsed) {
    if (!searchTypeUsed || searchTypeUsed === 'Conversation') return '';

    let icon, label;
    const type = String(searchTypeUsed).toLowerCase();

    if (type.includes('pdf') || type.includes('document')) {
        icon = 'fa-file-pdf';
        label = '📄 PDF Document';
    } else if (type.includes('web') || type.includes('open') || type.includes('fallback')) {
        icon = 'fa-globe';
        label = '🌐 Web Search';
    } else if (type.includes('hybrid')) {
        icon = 'fa-link';
        label = '🔗 Hybrid Search';
    } else {
        icon = 'fa-database';
        label = searchTypeUsed;
    }

    return `<div class="source-badge"><i class="fas ${icon}"></i> ${label}</div>`;
}

// ─────────────────────────────────────────────
// ADD MESSAGE TO CHAT - PRESERVES MARKDOWN FOR ALL
// ─────────────────────────────────────────────

async function addMessageToChat(role, content, filename = null, searchTypeUsed = null) {
    if (!messagesDiv) return;

    const welcome = messagesDiv.querySelector('.welcome'); 
    if (welcome && role === 'user') welcome.remove();

    const messageDiv = document.createElement('div');
    
    // Clean the content for assistant messages (remove chunk numbers, preserve markdown)
    let finalContent = content;
    if (role === 'assistant') {
        finalContent = cleanDualMindResponse(content);
    }
    
    // ALWAYS render assistant messages with markdown (they contain ## headers, bullets, etc.)
    // User messages get plain text rendering
    messageDiv.className = `message ${role}`;

    let attachmentHTML = '';
    if (filename) {
        attachmentHTML = `<div class="message-doc-attachment"><i class="fas fa-file-pdf"></i> ${escapeHtml(filename)}</div>`;
    }

    if (role === 'user') {
        const plainText = escapeHtml(finalContent).replace(/\n/g, '<br>');
        messageDiv.innerHTML = `
            <div class="message-avatar"><i class="fas fa-user"></i></div>
            <div class="message-content">
                ${attachmentHTML}
                <span>${plainText}</span>
            </div>
        `;
    } else {
        // Assistant messages get FULL markdown rendering
        const renderedContent = await renderMarkdown(finalContent);
        const effectiveSource = searchTypeUsed || (String(finalContent).toLowerCase().includes('web') ? 'Web Search' : currentMode);
        const sourceBadge = buildSourceBadge(effectiveSource);

        messageDiv.innerHTML = `
            <div class="message-avatar"><i class="fas fa-brain"></i></div>
            <div class="message-content">
                ${renderedContent}
                ${sourceBadge}
            </div>
        `;
    }

    messagesDiv.appendChild(messageDiv);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
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
            await addMessageToChat('assistant', `❌ Upload failed: ${err.message}. Please try again.`);
            return;
        }
    }

    showTyping();
    if (sendBtn) sendBtn.disabled = true;

    try {
        const res = await fetch(`${API_URL}/chat/sessions/${currentSessionId}/messages`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
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
            let finalAnswer = data.answer || data.response || data.content || '';
            
            // Clean but preserve markdown structure
            finalAnswer = cleanDualMindResponse(finalAnswer);
            
            const searchSource = data.search_type_used || (currentMode === 'hybrid' ? 'Hybrid Search' : currentMode);
            await addMessageToChat('assistant', finalAnswer, null, searchSource);
        } else {
            await addMessageToChat('assistant', 'Sorry, something went wrong. Please try again.');
        }
    } catch (err) {
        hideTyping();
        await addMessageToChat('assistant', 'Connection error. Please check your network.');
    } finally {
        if (sendBtn) sendBtn.disabled = false;
        messageInput?.focus();
    }
}

// ─────────────────────────────────────────────
// LOAD SESSION MESSAGES
// ─────────────────────────────────────────────

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
                    let cleanMessageContent = msg.content || msg.answer || msg.response || '';
                    
                    // Clean assistant messages but preserve markdown
                    if (msg.role === 'assistant') {
                        cleanMessageContent = cleanDualMindResponse(cleanMessageContent);
                    }
                    
                    await addMessageToChat(msg.role, cleanMessageContent, msg.metadata?.filename, searchType);
                }
                messagesDiv.scrollTop = messagesDiv.scrollHeight;
            }
        }

        await loadSessions();
    } catch (err) { console.error(err); }
}

// ─────────────────────────────────────────────
// INTERFACE INITIALIZATION
// ─────────────────────────────────────────────

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
    modeBtns = document.querySelectorAll('.mode-btn');
    loadingOverlay = document.getElementById('loadingOverlay');

    setupEventListeners();
    checkAuth();
});

function showLoading() { if (loadingOverlay) loadingOverlay.classList.remove('hidden'); }
function hideLoading() { if (loadingOverlay) loadingOverlay.classList.add('hidden'); }

function setupEventListeners() {
    document.getElementById('loginBtn')?.addEventListener('click', async () => { showLoading(); await doLogin(); hideLoading(); });
    document.getElementById('registerBtn')?.addEventListener('click', async () => { showLoading(); await doRegister(); hideLoading(); });
    document.getElementById('showRegister')?.addEventListener('click', (e) => { e.preventDefault(); toggleForms(true); });
    document.getElementById('showLogin')?.addEventListener('click', (e) => { e.preventDefault(); toggleForms(false); });

    sendBtn?.addEventListener('click', sendMessage);
    messageInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });

    messageInput?.addEventListener('input', () => {
        messageInput.style.height = 'auto';
        messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + 'px';
    });

    newChatBtn?.addEventListener('click', createNewSession);
    renameBtn?.addEventListener('click', renameSession);
    logoutBtn?.addEventListener('click', async () => { showLoading(); doLogout(); hideLoading(); });
    attachBtn?.addEventListener('click', () => fileInput?.click());
    fileInput?.addEventListener('change', onFileSelect);

    modeBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            modeBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentMode = btn.dataset.mode;
        });
    });
}

// ─────────────────────────────────────────────
// AUTH MANAGEMENT
// ─────────────────────────────────────────────

async function doLogin() {
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    if (!email || !password) { alert('Enter email and password'); hideLoading(); return; }

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
            alert('Login failed: ' + (data.detail || 'Error'));
        }
    } catch (err) { alert('Connection error'); }
}

async function doRegister() {
    const name = document.getElementById('registerName').value;
    const email = document.getElementById('registerEmail').value.trim();
    const password = document.getElementById('registerPassword').value;
    if (!email || !password) { alert('Fill all fields'); return; }
    if (password.length < 6) { alert('Password min 6 chars'); return; }

    try {
        const res = await fetch(`${API_URL}/auth/signup`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
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
    } catch (err) { alert('Connection error'); }
}

function doLogout() {
    token = null; user = null; currentSessionId = null; currentSessionDocuments = [];
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
}

// ─────────────────────────────────────────────
// CHAT SESSION DATABASE INTERACTION
// ─────────────────────────────────────────────

async function loadSessions() {
    if (!sessionListDiv) return;
    sessionListDiv.innerHTML = '<div class="loading-text">Loading...</div>';

    try {
        const res = await fetch(`${API_URL}/chat/sessions`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.status === 401) { doLogout(); return; }
        const data = await res.json();

        if (res.ok && data.sessions && data.sessions.length > 0) {
            renderSessionList(data.sessions);
            if (!currentSessionId && data.sessions[0]) {
                await loadSession(data.sessions[0].id);
            }
        } else {
            sessionListDiv.innerHTML = '<div class="loading-text">No conversations</div>';
            if (!currentSessionId) await createNewSession();
        }
    } catch (err) {
        console.error(err);
        sessionListDiv.innerHTML = '<div class="loading-text">Failed to load</div>';
    }
}

function renderSessionList(sessions) {
    if (!sessionListDiv) return;
    if (!sessions || sessions.length === 0) {
        sessionListDiv.innerHTML = '<div class="loading-text">No conversations</div>';
        return;
    }

    sessionListDiv.innerHTML = '';
    for (const s of sessions) {
        const div = document.createElement('div');
        div.className = `session-item ${currentSessionId === s.id ? 'active' : ''}`;
        div.dataset.id = s.id;
        div.innerHTML = `
            <span class="session-title">${escapeHtml(s.title)}</span>
            <button class="delete-session" data-id="${s.id}"><i class="fas fa-times"></i></button>
        `;
        div.addEventListener('click', (e) => {
            if (!e.target.closest('.delete-session')) loadSession(s.id);
        });
        div.querySelector('.delete-session')?.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteSession(s.id);
        });
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
        console.error('Load session docs error:', err);
        currentSessionDocuments = [];
    }
}

async function deleteSession(sessionId) {
    if (!confirm('Delete this conversation?')) return;

    try {
        await fetch(`${API_URL}/chat/sessions/${sessionId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (currentSessionId === sessionId) {
            currentSessionId = null;
            currentSessionDocuments = [];
            const sessionsRes = await fetch(`${API_URL}/chat/sessions`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
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

function clearMessages() {
    if (!messagesDiv) return;
    messagesDiv.innerHTML = WELCOME_HTML;
}

// ─────────────────────────────────────────────
// TYPING ANIMATION
// ─────────────────────────────────────────────

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
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: fd
    });

    if (res.status === 401) { doLogout(); throw new Error('Unauthorized'); }
    if (!res.ok) {
        const error = await res.json();
        throw new Error(error.detail || 'Upload failed');
    }
    return await res.json();
}

// ─────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────

async function autoTitle(sessionId, firstMsg) {
    const short = firstMsg.length > 30 ? firstMsg.substring(0, 30) + '...' : firstMsg;
    try {
        await fetch(`${API_URL}/chat/sessions/${sessionId}?title=${encodeURIComponent(short)}`, {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${token}` }
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
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        chatTitleSpan.innerText = newName;
        await loadSessions();
    } catch (err) { console.error(err); }
}

function escapeHtml(str) {
    if (!str) return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
