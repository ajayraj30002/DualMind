const API_URL = 'https://dualmind.onrender.com';

let token = null;
let user = null;
let currentSessionId = null;
let currentMode = 'hybrid';
let pendingFile = null;

document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
    checkAuth();
});

function setupEventListeners() {
    document.getElementById('loginBtn')?.addEventListener('click', doLogin);
    document.getElementById('registerBtn')?.addEventListener('click', doRegister);
    document.getElementById('showRegister')?.addEventListener('click', (e) => { e.preventDefault(); toggleForms(true); });
    document.getElementById('showLogin')?.addEventListener('click', (e) => { e.preventDefault(); toggleForms(false); });
    document.getElementById('sendMsgBtn')?.addEventListener('click', sendMessage);
    document.getElementById('newChatBtn')?.addEventListener('click', createNewSession);
    document.getElementById('logoutSidebarBtn')?.addEventListener('click', doLogout);
    document.getElementById('attachPdfBtn')?.addEventListener('click', () => document.getElementById('pdfFileInput')?.click());
    document.getElementById('pdfFileInput')?.addEventListener('change', onFileSelect);
    
    document.querySelectorAll('.mode-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
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
    document.getElementById('loginPage').classList.remove('hidden');
    document.getElementById('chatPage').classList.add('hidden');
}

function showChatUI() {
    document.getElementById('loginPage').classList.add('hidden');
    document.getElementById('chatPage').classList.remove('hidden');
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
    const sessionList = document.getElementById('sessionList');
    if (!sessionList) return;
    sessionList.innerHTML = '<div class="loading-text">Loading...</div>';
    
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
            sessionList.innerHTML = '<div class="loading-text">No conversations</div>';
            if (!currentSessionId) {
                await createNewSession();
            }
        }
    } catch (err) {
        console.error(err);
        sessionList.innerHTML = '<div class="loading-text">Failed to load</div>';
    }
}

function renderSessionList(sessions) {
    const sessionList = document.getElementById('sessionList');
    if (!sessionList) return;
    if (!sessions || sessions.length === 0) {
        sessionList.innerHTML = '<div class="loading-text">No conversations</div>';
        return;
    }
    
    sessionList.innerHTML = '';
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
        sessionList.appendChild(div);
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
            document.getElementById('chatTitle').innerText = 'New conversation';
            clearMessages();
            await loadSessions();
        }
    } catch (err) { console.error(err); }
}

async function loadSession(sessionId) {
    if (sessionId === currentSessionId) return;
    currentSessionId = sessionId;
    
    try {
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
            document.getElementById('chatTitle').innerText = sessionInfo.title;
        }
        
        const messagesDiv = document.getElementById('messagesContainer');
        if (messagesDiv) {
            if (!data.messages || data.messages.length === 0) {
                messagesDiv.innerHTML = `<div class="welcome"><i class="fas fa-brain"></i><h3>How can I help?</h3><p>Upload PDFs or ask anything</p></div>`;
            } else {
                messagesDiv.innerHTML = '';
                for (const msg of data.messages) {
                    const msgDiv = document.createElement('div');
                    msgDiv.className = `message ${msg.role}`;
                    const filename = msg.metadata?.filename;
                    msgDiv.innerHTML = `
                        <div class="message-avatar"><i class="fas ${msg.role === 'user' ? 'fa-user' : 'fa-brain'}"></i></div>
                        <div class="message-content">
                            ${filename ? `<div class="file-badge-inline"><i class="fas fa-file-pdf"></i> ${escapeHtml(filename)}</div>` : ''}
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

async function deleteSession(sessionId) {
    if (!confirm('Delete this conversation?')) return;
    
    try {
        await fetch(`${API_URL}/chat/sessions/${sessionId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (currentSessionId === sessionId) {
            currentSessionId = null;
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
    const messagesDiv = document.getElementById('messagesContainer');
    if (messagesDiv) {
        messagesDiv.innerHTML = `<div class="welcome"><i class="fas fa-brain"></i><h3>How can I help?</h3><p>Upload PDFs or ask anything</p></div>`;
    }
}

function addMessage(role, content, filename = null) {
    const messagesDiv = document.getElementById('messagesContainer');
    if (!messagesDiv) return;
    const welcome = messagesDiv.querySelector('.welcome');
    if (welcome) welcome.remove();
    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${role}`;
    msgDiv.innerHTML = `
        <div class="message-avatar"><i class="fas ${role === 'user' ? 'fa-user' : 'fa-brain'}"></i></div>
        <div class="message-content">
            ${filename ? `<div class="file-badge-inline"><i class="fas fa-file-pdf"></i> ${escapeHtml(filename)}</div>` : ''}
            ${escapeHtml(content).replace(/\n/g, '<br>')}
        </div>
    `;
    messagesDiv.appendChild(msgDiv);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function showTyping() {
    const messagesDiv = document.getElementById('messagesContainer');
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
    const badge = document.getElementById('fileBadge');
    if (badge) {
        badge.innerHTML = `<i class="fas fa-file-pdf"></i> ${file.name}`;
        badge.classList.remove('hidden');
    }
}

async function uploadFile(file, sessionId) {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch(`${API_URL}/upload`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: fd
    });
    if (res.status === 401) { doLogout(); throw new Error('Unauth'); }
    if (!res.ok) throw new Error('Upload failed');
    return await res.json();
}

async function autoTitle(sessionId, firstMsg) {
    const short = firstMsg.length > 30 ? firstMsg.substring(0, 30) + '...' : firstMsg;
    try {
        await fetch(`${API_URL}/chat/sessions/${sessionId}?title=${encodeURIComponent(short)}`, {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        document.getElementById('chatTitle').innerText = short;
        await loadSessions();
    } catch (err) { console.error(err); }
}

async function sendMessage() {
    const text = document.getElementById('messageInput')?.value.trim();
    if (!text || !currentSessionId) return;
    
    // Get file before clearing
    const fileToUpload = pendingFile;
    let uploadedFilename = fileToUpload?.name || null;
    
    // Clear input and file badge IMMEDIATELY
    document.getElementById('messageInput').value = '';
    const badge = document.getElementById('fileBadge');
    if (badge) badge.classList.add('hidden');
    
    // ***** SHOW USER MESSAGE + FILE BADGE IMMEDIATELY *****
    addMessage('user', text, uploadedFilename);
    
    // Clear pending file
    pendingFile = null;
    
    // Upload file if exists (in background)
    let uploadedFileData = null;
    if (fileToUpload) {
        try {
            uploadedFileData = await uploadFile(fileToUpload, currentSessionId);
        } catch (err) {
            addMessage('assistant', `Upload failed: ${err.message}`);
            return;
        }
    }
    
    // Auto-title if first message
    const isFirst = document.getElementById('messagesContainer')?.querySelectorAll('.message').length === 1;
    if (isFirst) await autoTitle(currentSessionId, text);
    
    // Show typing indicator
    showTyping();
    const sendBtn = document.getElementById('sendMsgBtn');
    if (sendBtn) sendBtn.disabled = true;
    
    try {
        // If file uploaded, FORCE closed mode (only search document)
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
                uploaded_document: uploadedFilename
            })
        });
        
        if (res.status === 401) { doLogout(); return; }
        const data = await res.json();
        hideTyping();
        
        if (res.ok) {
            addMessage('assistant', data.answer);
        } else {
            addMessage('assistant', 'Sorry, something went wrong.');
        }
    } catch (err) {
        hideTyping();
        addMessage('assistant', 'Connection error.');
    } finally {
        if (sendBtn) sendBtn.disabled = false;
        document.getElementById('messageInput')?.focus();
    }
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
