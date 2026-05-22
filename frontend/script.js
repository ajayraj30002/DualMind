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

document.addEventListener('DOMContentLoaded', () => {
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

function showLoading() {
    if (loadingOverlay) loadingOverlay.classList.remove('hidden');
}

function hideLoading() {
    if (loadingOverlay) loadingOverlay.classList.add('hidden');
}

function setupEventListeners() {
    document.getElementById('loginBtn')?.addEventListener('click', async () => {
        showLoading();
        await doLogin();
        hideLoading();
    });
    document.getElementById('registerBtn')?.addEventListener('click', async () => {
        showLoading();
        await doRegister();
        hideLoading();
    });
    document.getElementById('showRegister')?.addEventListener('click', (e) => { e.preventDefault(); toggleForms(true); });
    document.getElementById('showLogin')?.addEventListener('click', (e) => { e.preventDefault(); toggleForms(false); });
    
    sendBtn?.addEventListener('click', sendMessage);
    messageInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
    newChatBtn?.addEventListener('click', createNewSession);
    renameBtn?.addEventListener('click', renameSession);
    logoutBtn?.addEventListener('click', async () => {
        showLoading();
        doLogout();
        hideLoading();
    });
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

async function doLogin() {
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    if (!email || !password) { alert('Enter email and password'); return; }
    
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
    token = null;
    user = null;
    currentSessionId = null;
    currentSessionDocuments = [];
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
    const loginForm = document.getElementById('loginForm');
    const registerForm = document.getElementById('registerForm');
    if (showRegister) {
        loginForm.classList.remove('active');
        registerForm.classList.add('active');
    } else {
        registerForm.classList.remove('active');
        loginForm.classList.add('active');
    }
}

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
            if (!currentSessionId) {
                await createNewSession();
            }
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
            if (!e.target.closest('.delete-session')) {
                loadSession(s.id);
            }
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
        if (sessionInfo) {
            chatTitleSpan.innerText = sessionInfo.title;
        }
        
        if (messagesDiv) {
            if (!data.messages || data.messages.length === 0) {
                messagesDiv.innerHTML = `<div class="welcome"><i class="fas fa-brain"></i><h3>How can I help?</h3><p>Upload PDFs or ask anything</p></div>`;
            } else {
                messagesDiv.innerHTML = '';
                for (const msg of data.messages) {
                    const msgDiv = document.createElement('div');
                    msgDiv.className = `message ${msg.role}`;
                    // Check if message has filename in metadata
                    const filename = msg.metadata?.filename;
                    msgDiv.innerHTML = `
                        <div class="message-avatar"><i class="fas ${msg.role === 'user' ? 'fa-user' : 'fa-brain'}"></i></div>
                        <div class="message-content">
                            ${filename ? `<div class="message-doc-attachment"><i class="fas fa-file-pdf"></i> ${escapeHtml(filename)}</div>` : ''}
                            ${escapeHtml(msg.content).replace(/\n/g, '<br>')}
                        </div>
                    `;
                    messagesDiv.appendChild(msgDiv);
                }
                messagesDiv.scrollTop = messagesDiv.scrollHeight;
            }
        }
        
        await loadSessions();
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
    messagesDiv.innerHTML = `<div class="welcome"><i class="fas fa-brain"></i><h3>How can I help?</h3><p>Upload PDFs or ask anything</p></div>`;
}

function addMessage(role, content, filename = null) {
    if (!messagesDiv) return;
    const welcome = messagesDiv.querySelector('.welcome');
    if (welcome) welcome.remove();
    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${role}`;
    msgDiv.innerHTML = `
        <div class="message-avatar"><i class="fas ${role === 'user' ? 'fa-user' : 'fa-brain'}"></i></div>
        <div class="message-content">
            ${filename ? `<div class="message-doc-attachment"><i class="fas fa-file-pdf"></i> ${escapeHtml(filename)}</div>` : ''}
            ${escapeHtml(content).replace(/\n/g, '<br>')}
        </div>
    `;
    messagesDiv.appendChild(msgDiv);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
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
    if (!file || !file.name.endsWith('.pdf')) {
        alert('Please select a PDF file');
        return;
    }
    pendingFile = file;
    if (fileBadge) {
        fileBadge.innerHTML = `<i class="fas fa-file-pdf"></i> ${file.name} <i class="fas fa-check-circle"></i>`;
        fileBadge.classList.remove('hidden');
    }
}

async function uploadFile(file, sessionId) {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('session_id', sessionId);
    const res = await fetch(`${API_URL}/upload`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: fd
    });
    if (res.status === 401) { doLogout(); throw new Error('Unauth'); }
    if (!res.ok) throw new Error('Upload failed');
    return await res.json();
}

async function sendMessage() {
    const text = messageInput?.value.trim();
    if (!text || !currentSessionId) return;
    
    messageInput.value = '';
    messageInput.style.height = 'auto';
    
    let uploadedFilename = null;
    let uploadedFileData = null;
    
    // Upload file if exists
    if (pendingFile) {
        showTyping();
        try {
            uploadedFileData = await uploadFile(pendingFile, currentSessionId);
            uploadedFilename = pendingFile.name;
            pendingFile = null;
            if (fileBadge) fileBadge.classList.add('hidden');
            hideTyping();
        } catch (err) {
            hideTyping();
            addMessage('assistant', `Upload failed: ${err.message}`);
            return;
        }
    }
    
    // Add user message with document attachment display
    addMessage('user', text, uploadedFilename);
    
    const isFirst = messagesDiv?.querySelectorAll('.message').length === 1;
    if (isFirst) await autoTitle(currentSessionId, text);
    
    showTyping();
    if (sendBtn) sendBtn.disabled = true;
    
    try {
        // If document was uploaded, force search to closed (documents only)
        const searchMode = uploadedFileData ? 'closed' : currentMode;
        
        const res = await fetch(`${API_URL}/chat/sessions/${currentSessionId}/messages`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                question: text,
                search_type: searchMode,
                include_sources: false,
                uploaded_document: uploadedFilename  // ← Send filename to backend
            })
        });
        if (res.status === 401) { doLogout(); return; }
        const data = await res.json();
        hideTyping();
        if (res.ok) {
            // Remove emojis for minimal style
            let cleanAnswer = data.answer;
            cleanAnswer = cleanAnswer.replace(/[\u{1F600}-\u{1F64F}]/gu, '');
            cleanAnswer = cleanAnswer.replace(/[\u{1F300}-\u{1F5FF}]/gu, '');
            cleanAnswer = cleanAnswer.replace(/[\u{1F680}-\u{1F6FF}]/gu, '');
            cleanAnswer = cleanAnswer.replace(/[\u{2600}-\u{26FF}]/gu, '');
            cleanAnswer = cleanAnswer.replace(/[\u{2700}-\u{27BF}]/gu, '');
            addMessage('assistant', cleanAnswer);
        } else {
            addMessage('assistant', 'Sorry, something went wrong.');
        }
    } catch (err) {
        hideTyping();
        addMessage('assistant', 'Connection error.');
    } finally {
        if (sendBtn) sendBtn.disabled = false;
        messageInput?.focus();
    }
}

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
    return str.replace(/[&<>]/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}
