const API_URL = 'https://dualmind.onrender.com';

let token = null;
let user = null;
let currentSessionId = null;
let currentMode = 'hybrid';
let pendingFile = null;

document.addEventListener('DOMContentLoaded', () => {
    checkAuth();
    setupEventListeners();
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

async function loadSession(sessionId) {
    if (sessionId === currentSessionId) return;
    
    console.log("🔄 Loading session:", sessionId);
    
    try {
        // Fetch messages for this session
        const res = await fetch(`${API_URL}/chat/sessions/${sessionId}/messages`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        console.log("📨 Messages response status:", res.status);
        
        if (res.status === 401) { 
            doLogout(); 
            return; 
        }
        
        if (!res.ok) {
            console.error("Failed to fetch messages:", res.status);
            return;
        }
        
        const data = await res.json();
        console.log("📨 Messages received:", data.messages?.length || 0, "messages");
        
        // Update current session ID AFTER successful fetch
        currentSessionId = sessionId;
        
        // Get session title separately
        const sessionsRes = await fetch(`${API_URL}/chat/sessions`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (sessionsRes.ok) {
            const sessionsData = await sessionsRes.json();
            const sessionInfo = sessionsData.sessions?.find(s => s.id === sessionId);
            if (sessionInfo) {
                document.getElementById('chatTitle').innerText = sessionInfo.title;
            }
        }
        
        // Render messages
        const messagesDiv = document.getElementById('messagesContainer');
        if (messagesDiv) {
            if (!data.messages || data.messages.length === 0) {
                messagesDiv.innerHTML = `<div class="welcome"><i class="fas fa-brain"></i><h3>How can I help?</h3><p>Upload PDFs or ask anything</p></div>`;
            } else {
                messagesDiv.innerHTML = '';
                for (const msg of data.messages) {
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
        }
        
        // Update sidebar active state
        await loadSessions();
        
    } catch (err) { 
        console.error('Load session error:', err); 
    }
}

// Debug function - call this from console
window.debugMessages = async function() {
    const res = await fetch(`${API_URL}/chat/sessions`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    console.log("All sessions:", data.sessions);
    
    if (data.sessions && data.sessions.length > 0) {
        for (const s of data.sessions) {
            const msgRes = await fetch(`${API_URL}/chat/sessions/${s.id}/messages`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const msgData = await msgRes.json();
            console.log(`Session ${s.id} (${s.title}): ${msgData.messages?.length || 0} messages`);
        }
    }
};

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
        // Fetch messages
        const res = await fetch(`${API_URL}/chat/sessions/${sessionId}/messages`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.status === 401) { doLogout(); return; }
        const data = await res.json();
        
        // Get session title
        const sessionsRes = await fetch(`${API_URL}/chat/sessions`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const sessionsData = await sessionsRes.json();
        const sessionInfo = sessionsData.sessions?.find(s => s.id === sessionId);
        if (sessionInfo) {
            document.getElementById('chatTitle').innerText = sessionInfo.title;
        }
        
        // Render messages
        const messagesDiv = document.getElementById('messagesContainer');
        if (messagesDiv) {
            if (!data.messages || data.messages.length === 0) {
                messagesDiv.innerHTML = `<div class="welcome"><i class="fas fa-brain"></i><h3>How can I help?</h3><p>Upload PDFs or ask anything</p></div>`;
            } else {
                messagesDiv.innerHTML = '';
                for (const msg of data.messages) {
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

function addMessage(role, content) {
    const messagesDiv = document.getElementById('messagesContainer');
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
        badge.innerHTML = `<i class="fas fa-file-pdf"></i> ${file.name} <i class="fas fa-check-circle"></i>`;
        badge.classList.remove('hidden');
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
    const text = document.getElementById('messageInput')?.value.trim();
    if (!text || !currentSessionId) return;
    
    document.getElementById('messageInput').value = '';
    document.getElementById('fileBadge')?.classList.add('hidden');
    
    addMessage('user', text);
    
    const isFirst = document.getElementById('messagesContainer')?.querySelectorAll('.message').length === 1;
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
            return;
        }
    }
    
    showTyping();
    const sendBtn = document.getElementById('sendMsgBtn');
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
        document.getElementById('messageInput')?.focus();
    }
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

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}
