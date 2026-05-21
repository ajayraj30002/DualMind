// Backend URL
const BACKEND_URL = 'https://dualmind.onrender.com';

// State
let authToken = null;
let currentUser = null;
let currentSessionId = null;
let currentSearchType = 'hybrid';
let pendingFile = null;

// DOM Elements
let loginPage, chatPage, sessionsList, messagesContainer;
let messageInput, sendBtn, attachBtn, fileInput, newChatBtn;
let chatTitle, renameBtn, logoutBtn, modelBtns;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    // Pages
    loginPage = document.getElementById('login-page');
    chatPage = document.getElementById('chat-page');
    
    // Auth elements
    sessionsList = document.getElementById('sessions-list');
    messagesContainer = document.getElementById('messages-container');
    messageInput = document.getElementById('message-input');
    sendBtn = document.getElementById('send-message-btn');
    attachBtn = document.getElementById('attach-pdf-btn');
    fileInput = document.getElementById('pdf-input');
    newChatBtn = document.getElementById('new-chat-btn');
    chatTitle = document.getElementById('chat-title');
    renameBtn = document.getElementById('rename-chat-btn');
    logoutBtn = document.getElementById('logout-btn');
    modelBtns = document.querySelectorAll('.model-btn');
    
    setupEventListeners();
    checkAuth();
});

function setupEventListeners() {
    // Auth
    document.getElementById('login-btn')?.addEventListener('click', () => {
        const email = document.getElementById('login-email').value;
        const password = document.getElementById('login-password').value;
        signin(email, password);
    });
    document.getElementById('register-btn')?.addEventListener('click', () => {
        const name = document.getElementById('register-name').value;
        const email = document.getElementById('register-email').value;
        const password = document.getElementById('register-password').value;
        signup(email, password, name);
    });
    document.getElementById('show-register')?.addEventListener('click', (e) => {
        e.preventDefault();
        document.getElementById('login-form').classList.remove('active');
        document.getElementById('register-form').classList.add('active');
    });
    document.getElementById('show-login')?.addEventListener('click', (e) => {
        e.preventDefault();
        document.getElementById('register-form').classList.remove('active');
        document.getElementById('login-form').classList.add('active');
    });
    
    // Chat
    sendBtn?.addEventListener('click', sendMessage);
    messageInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
    attachBtn?.addEventListener('click', () => fileInput?.click());
    fileInput?.addEventListener('change', handleFileSelect);
    newChatBtn?.addEventListener('click', createNewSession);
    renameBtn?.addEventListener('click', renameCurrentSession);
    logoutBtn?.addEventListener('click', logout);
    
    modelBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            modelBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentSearchType = btn.dataset.type;
        });
    });
}

// ========== AUTH ==========
async function signup(email, password, fullName) {
    if (!email || !password) {
        alert('Please fill in all fields');
        return;
    }
    if (password.length < 6) {
        alert('Password must be at least 6 characters');
        return;
    }
    
    try {
        const response = await fetch(`${BACKEND_URL}/auth/signup`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password, full_name: fullName })
        });
        const data = await response.json();
        
        if (response.ok) {
            alert('Signup successful! Please sign in.');
            document.getElementById('register-form').classList.remove('active');
            document.getElementById('login-form').classList.add('active');
            document.getElementById('login-email').value = email;
        } else {
            alert('Signup failed: ' + (data.detail || 'Unknown error'));
        }
    } catch (error) {
        alert('Connection error: ' + error.message);
    }
}

async function signin(email, password) {
    if (!email || !password) {
        alert('Please enter email and password');
        return;
    }
    
    try {
        const response = await fetch(`${BACKEND_URL}/auth/signin`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        const data = await response.json();
        
        if (response.ok) {
            authToken = data.access_token;
            currentUser = { id: data.user_id, email: data.email };
            localStorage.setItem('dualmind_token', authToken);
            localStorage.setItem('dualmind_user', JSON.stringify(currentUser));
            showChatPage();
            await loadSessions();
            await createNewSession();
        } else {
            alert('Signin failed: ' + (data.detail || 'Invalid credentials'));
        }
    } catch (error) {
        alert('Connection error: ' + error.message);
    }
}

function logout() {
    authToken = null;
    currentUser = null;
    currentSessionId = null;
    pendingFile = null;
    localStorage.removeItem('dualmind_token');
    localStorage.removeItem('dualmind_user');
    showLoginPage();
}

function checkAuth() {
    const token = localStorage.getItem('dualmind_token');
    const user = localStorage.getItem('dualmind_user');
    
    if (token && user) {
        authToken = token;
        currentUser = JSON.parse(user);
        showChatPage();
        loadSessions();
    } else {
        showLoginPage();
    }
}

function showLoginPage() {
    if (loginPage) loginPage.classList.remove('hidden');
    if (chatPage) chatPage.classList.add('hidden');
    clearAuthForms();
}

function showChatPage() {
    if (loginPage) loginPage.classList.add('hidden');
    if (chatPage) chatPage.classList.remove('hidden');
    const userEmailSpan = document.getElementById('user-email-sidebar');
    if (userEmailSpan && currentUser) userEmailSpan.textContent = currentUser.email.split('@')[0];
}

function clearAuthForms() {
    document.getElementById('login-email').value = '';
    document.getElementById('login-password').value = '';
    document.getElementById('register-name').value = '';
    document.getElementById('register-email').value = '';
    document.getElementById('register-password').value = '';
}

// ========== SESSIONS ==========
async function loadSessions() {
    if (!sessionsList) return;
    sessionsList.innerHTML = '<div style="padding: 1rem; text-align: center; color: #52525b;">Loading...</div>';
    
    try {
        const response = await fetch(`${BACKEND_URL}/chat/sessions`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        
        if (response.status === 401) {
            logout();
            return;
        }
        
        const data = await response.json();
        
        if (response.ok && data.sessions) {
            renderSessions(data.sessions);
        }
    } catch (error) {
        console.error('Load sessions error:', error);
        sessionsList.innerHTML = '<div style="padding: 1rem; text-align: center; color: #52525b;">Failed to load</div>';
    }
}

function renderSessions(sessions) {
    if (!sessionsList) return;
    
    if (sessions.length === 0) {
        sessionsList.innerHTML = '<div style="padding: 1rem; text-align: center; color: #52525b;">No conversations</div>';
        return;
    }
    
    sessionsList.innerHTML = sessions.map(session => `
        <div class="session-item ${currentSessionId === session.id ? 'active' : ''}" data-id="${session.id}">
            <span class="session-title">${escapeHtml(session.title)}</span>
            <button class="session-delete" data-id="${session.id}">
                <i class="fas fa-times"></i>
            </button>
        </div>
    `).join('');
    
    document.querySelectorAll('.session-item').forEach(el => {
        el.addEventListener('click', (e) => {
            if (!e.target.closest('.session-delete')) {
                loadSession(el.dataset.id);
            }
        });
    });
    document.querySelectorAll('.session-delete').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteSession(btn.dataset.id);
        });
    });
}

async function createNewSession() {
    try {
        const response = await fetch(`${BACKEND_URL}/chat/sessions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            }
        });
        
        if (response.status === 401) {
            logout();
            return;
        }
        
        const data = await response.json();
        
        if (response.ok) {
            currentSessionId = data.session.id;
            if (chatTitle) chatTitle.textContent = 'New conversation';
            clearMessages();
            await loadSessions();
        }
    } catch (error) {
        console.error('Create session error:', error);
    }
}

async function loadSession(sessionId) {
    currentSessionId = sessionId;
    
    try {
        const response = await fetch(`${BACKEND_URL}/chat/sessions/${sessionId}/messages`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        
        if (response.status === 401) {
            logout();
            return;
        }
        
        const data = await response.json();
        
        if (response.ok) {
            const sessionInfo = await getSessionInfo(sessionId);
            if (chatTitle && sessionInfo) chatTitle.textContent = sessionInfo.title;
            renderMessages(data.messages || []);
            await loadSessions();
        }
    } catch (error) {
        console.error('Load session error:', error);
    }
}

async function getSessionInfo(sessionId) {
    try {
        const response = await fetch(`${BACKEND_URL}/chat/sessions`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const data = await response.json();
        return data.sessions?.find(s => s.id === sessionId);
    } catch {
        return null;
    }
}

async function renameCurrentSession() {
    const newTitle = prompt('Rename conversation:', chatTitle?.textContent);
    if (!newTitle || !currentSessionId) return;
    
    try {
        await fetch(`${BACKEND_URL}/chat/sessions/${currentSessionId}?title=${encodeURIComponent(newTitle)}`, {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        if (chatTitle) chatTitle.textContent = newTitle;
        await loadSessions();
    } catch (error) {
        console.error('Rename error:', error);
    }
}

async function deleteSession(sessionId) {
    if (!confirm('Delete this conversation?')) return;
    
    try {
        await fetch(`${BACKEND_URL}/chat/sessions/${sessionId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        if (currentSessionId === sessionId) {
            await createNewSession();
        }
        await loadSessions();
    } catch (error) {
        console.error('Delete error:', error);
    }
}

async function updateSessionTitle(sessionId, firstMessage) {
    const shortTitle = firstMessage.length > 30 ? firstMessage.substring(0, 30) + '...' : firstMessage;
    try {
        await fetch(`${BACKEND_URL}/chat/sessions/${sessionId}?title=${encodeURIComponent(shortTitle)}`, {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        if (chatTitle && currentSessionId === sessionId) chatTitle.textContent = shortTitle;
        await loadSessions();
    } catch (error) {
        console.error('Auto-title error:', error);
    }
}

// ========== MESSAGES ==========
function clearMessages() {
    if (!messagesContainer) return;
    messagesContainer.innerHTML = `
        <div class="welcome-screen">
            <div class="welcome-icon">
                <i class="fas fa-brain"></i>
            </div>
            <h2>How can I help you today?</h2>
            <p>Upload PDFs, search the web, or ask anything</p>
        </div>
    `;
}

function renderMessages(messages) {
    if (!messagesContainer) return;
    
    if (messages.length === 0) {
        clearMessages();
        return;
    }
    
    messagesContainer.innerHTML = messages.map(msg => `
        <div class="message ${msg.role}">
            <div class="message-avatar">
                <i class="fas ${msg.role === 'user' ? 'fa-user' : 'fa-brain'}"></i>
            </div>
            <div class="message-content">
                ${escapeHtml(msg.content).replace(/\n/g, '<br>')}
            </div>
        </div>
    `).join('');
    
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function addMessageToUI(role, content) {
    if (!messagesContainer) return;
    
    const welcome = messagesContainer.querySelector('.welcome-screen');
    if (welcome) welcome.remove();
    
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${role}`;
    messageDiv.innerHTML = `
        <div class="message-avatar">
            <i class="fas ${role === 'user' ? 'fa-user' : 'fa-brain'}"></i>
        </div>
        <div class="message-content">
            ${escapeHtml(content).replace(/\n/g, '<br>')}
        </div>
    `;
    messagesContainer.appendChild(messageDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function showTypingIndicator() {
    if (!messagesContainer) return;
    
    const typingDiv = document.createElement('div');
    typingDiv.className = 'message assistant';
    typingDiv.id = 'typing-indicator';
    typingDiv.innerHTML = `
        <div class="message-avatar">
            <i class="fas fa-brain"></i>
        </div>
        <div class="message-content">
            <div class="typing-indicator">
                <span></span><span></span><span></span>
            </div>
        </div>
    `;
    messagesContainer.appendChild(typingDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function removeTypingIndicator() {
    const indicator = document.getElementById('typing-indicator');
    if (indicator) indicator.remove();
}

// ========== FILE HANDLING ==========
function handleFileSelect(e) {
    const file = e.target.files[0];
    if (!file || !file.name.endsWith('.pdf')) {
        alert('Please select a PDF file');
        return;
    }
    
    pendingFile = file;
    const badge = document.getElementById('file-badge');
    if (badge) {
        badge.innerHTML = `<i class="fas fa-file-pdf"></i> ${file.name} <i class="fas fa-check-circle"></i>`;
        badge.classList.remove('hidden');
    }
}

async function uploadFileAndSend(file, message) {
    const formData = new FormData();
    formData.append('file', file);
    
    const response = await fetch(`${BACKEND_URL}/upload`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${authToken}` },
        body: formData
    });
    
    if (response.status === 401) {
        logout();
        throw new Error('Unauthorized');
    }
    
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || 'Upload failed');
    return data;
}

// ========== SEND MESSAGE ==========
async function sendMessage() {
    const message = messageInput?.value.trim();
    if (!message || !currentSessionId) return;
    
    // Clear UI
    messageInput.value = '';
    messageInput.style.height = 'auto';
    const badge = document.getElementById('file-badge');
    if (badge) badge.classList.add('hidden');
    
    addMessageToUI('user', message);
    
    // Check if first message (auto-title)
    const isFirstMessage = messagesContainer?.querySelectorAll('.message').length === 0;
    if (isFirstMessage) {
        await updateSessionTitle(currentSessionId, message);
    }
    
    // Upload file if exists
    let uploadedFile = null;
    if (pendingFile) {
        showTypingIndicator();
        try {
            uploadedFile = await uploadFileAndSend(pendingFile, message);
            pendingFile = null;
            removeTypingIndicator();
        } catch (error) {
            removeTypingIndicator();
            addMessageToUI('assistant', `Upload failed: ${error.message}`);
            sendBtn.disabled = false;
            return;
        }
    }
    
    showTypingIndicator();
    sendBtn.disabled = true;
    
    try {
        const requestBody = {
            question: message,
            search_type: uploadedFile ? 'closed' : currentSearchType,
            include_sources: false
        };
        
        const response = await fetch(`${BACKEND_URL}/chat/sessions/${currentSessionId}/messages`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify(requestBody)
        });
        
        if (response.status === 401) {
            removeTypingIndicator();
            logout();
            return;
        }
        
        const data = await response.json();
        removeTypingIndicator();
        
        if (response.ok) {
            addMessageToUI('assistant', data.answer);
        } else {
            addMessageToUI('assistant', 'Sorry, something went wrong. Please try again.');
        }
    } catch (error) {
        console.error('Send error:', error);
        removeTypingIndicator();
        addMessageToUI('assistant', 'Connection error. Please try again.');
    } finally {
        sendBtn.disabled = false;
        messageInput.focus();
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
