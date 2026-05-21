const API_URL = 'https://dualmind.onrender.com';

let token = null;
let user = null;
let currentSessionId = null;
let currentMode = 'hybrid';
let pendingFile = null;
let isLoadingSessions = false;

// DOM elements
let loginPage, chatPage, sessionListDiv, messagesDiv, messageInput, sendBtn;
let newChatBtn, renameBtn, logoutBtn, chatTitleSpan, attachBtn, fileInput, fileBadge;
let modeBtns;

document.addEventListener('DOMContentLoaded', () => {
    // Get elements
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
    
    // Events
    document.getElementById('loginBtn')?.addEventListener('click', doLogin);
    document.getElementById('registerBtn')?.addEventListener('click', doRegister);
    document.getElementById('showRegister')?.addEventListener('click', (e) => { e.preventDefault(); toggleForms(true); });
    document.getElementById('showLogin')?.addEventListener('click', (e) => { e.preventDefault(); toggleForms(false); });
    
    sendBtn?.addEventListener('click', sendMessage);
    messageInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } });
    newChatBtn?.addEventListener('click', createNewSession);
    renameBtn?.addEventListener('click', renameSession);
    logoutBtn?.addEventListener('click', doLogout);
    attachBtn?.addEventListener('click', () => fileInput?.click());
    fileInput?.addEventListener('change', onFileSelect);
    
    modeBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            modeBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentMode = btn.dataset.mode;
        });
    });
    
    checkAuth();
});

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
    localStorage.removeItem('dm_token');
    localStorage.removeItem('dm_user');
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

async function loadSession(sessionId) {
    if (sessionId === currentSessionId) return;
    currentSessionId = sessionId;
    
    console.log("Loading session:", sessionId);
    console.log("Using token:", token ? token.substring(0, 50) + "..." : "NO TOKEN");
    
    try {
        const res = await fetch(`${API_URL}/chat/sessions/${sessionId}/messages`, {
            method: 'GET',
            headers: { 
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        
        console.log("Response status:", res.status);
        
        if (res.status === 401) { 
            console.error("Unauthorized! Logging out...");
            doLogout(); 
            return; 
        }
        
        const data = await res.json();
        console.log("Messages data:", data);
        
        // Get session info for title
        const sessionsRes = await fetch(`${API_URL}/chat/sessions`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const sessionsData = await sessionsRes.json();
        const sessionInfo = sessionsData.sessions?.find(s => s.id === sessionId);
        if (sessionInfo && chatTitleSpan) {
            chatTitleSpan.innerText = sessionInfo.title;
        }
        
        // Render messages
        if (messagesDiv) {
            if (!data.messages || data.messages.length === 0) {
                clearMessages();
            } else {
                renderMessages(data.messages);
            }
        }
        
        // Update sidebar active state
        await loadSessions();
        
    } catch (err) { 
        console.error('Load session error:', err); 
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
        const delBtn = div.querySelector('.delete-session');
        delBtn?.addEventListener('click', (e) => {
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
        // Fetch messages for this session
        const res = await fetch(`${API_URL}/chat/sessions/${sessionId}/messages`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.status === 401) { doLogout(); return; }
        const data = await res.json();
        
        // Get session info for title
        const sessionsRes = await fetch(`${API_URL}/chat/sessions`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const sessionsData = await sessionsRes.json();
        const sessionInfo = sessionsData.sessions?.find(s => s.id === sessionId);
        if (sessionInfo && chatTitleSpan) {
            chatTitleSpan.innerText = sessionInfo.title;
        }
        
        // Render messages
        if (messagesDiv) {
            if (!data.messages || data.messages.length === 0) {
                clearMessages();
            } else {
                renderMessages(data.messages);
            }
        }
        
        // Update sidebar active state
        await loadSessions();
        
    } catch (err) { 
        console.error('Load session error:', err); 
    }
}

async function renameSession() {
    const newName = prompt('Rename conversation:', chatTitleSpan?.innerText);
    if (!newName || newName === chatTitleSpan?.innerText || !currentSessionId) return;
    
    try {
        await fetch(`${API_URL}/chat/sessions/${currentSessionId}?title=${encodeURIComponent(newName)}`, {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (chatTitleSpan) chatTitleSpan.innerText = newName;
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
            // Refresh session list and load first session
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

async function autoTitle(sessionId, firstMsg) {
    const short = firstMsg.length > 30 ? firstMsg.substring(0, 30) + '...' : firstMsg;
    try {
        await fetch(`${API_URL}/chat/sessions/${sessionId}?title=${encodeURIComponent(short)}`, {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (currentSessionId === sessionId && chatTitleSpan) {
            chatTitleSpan.innerText = short;
        }
        await loadSessions();
    } catch (err) { console.error(err); }
}

function clearMessages() {
    if (!messagesDiv) return;
    messagesDiv.innerHTML = `<div class="welcome"><i class="fas fa-brain"></i><h3>How can I help?</h3><p>Upload PDFs or ask anything</p></div>`;
}

function renderMessages(messages) {
    if (!messagesDiv) return;
    if (!messages || messages.length === 0) {
        clearMessages();
        return;
    }
    
    messagesDiv.innerHTML = '';
    for (const msg of messages) {
        const msgDiv = document.createElement('div');
        msgDiv.className = `message ${msg.role}`;
        msgDiv.innerHTML = `
            <div class="message-avatar"><i class="fas ${msg.role === 'user' ? 'fa-user' : 'fa-brain'}"></i></div>
            <div class="message-content">${escapeHtml(msg.content).replace(/\n/g, '<br>')}</div>
        `;
        messagesDiv.appendChild(msgDiv);
    }
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function addMessage(role, content) {
    if (!messagesDiv) return;
    const welcome = messagesDiv.querySelector('.welcome');
    if (welcome) welcome.remove();
    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${role}`;
    msgDiv.innerHTML = `
        <div class="message-avatar"><i class="fas ${role === 'user' ? 'fa-user' : 'fa-brain'}"></i></div>
        <div class="message-content">${escapeHtml(content).replace(/\n/g, '<br>')}</div>
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

async function uploadFile(file) {
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

async function sendMessage() {
    const text = messageInput?.value.trim();
    if (!text || !currentSessionId) return;
    
    if (messageInput) {
        messageInput.value = '';
        messageInput.style.height = 'auto';
    }
    if (fileBadge) fileBadge.classList.add('hidden');
    
    addMessage('user', text);
    
    const isFirst = messagesDiv?.querySelectorAll('.message').length === 1;
    if (isFirst) await autoTitle(currentSessionId, text);
    
    let uploaded = null;
    if (pendingFile) {
        showTyping();
        try {
            uploaded = await uploadFile(pendingFile);
            pendingFile = null;
            hideTyping();
        } catch (err) {
            hideTyping();
            addMessage('assistant', `Upload failed: ${err.message}`);
            if (sendBtn) sendBtn.disabled = false;
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
                search_type: uploaded ? 'closed' : currentMode,
                include_sources: false
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
        if (messageInput) messageInput.focus();
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
