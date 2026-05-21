// Backend URL
const BACKEND_URL = 'https://dualmind.onrender.com';

// State
let authToken = null;
let currentUser = null;
let currentSessionId = null;
let currentSearchType = 'hybrid';
let pendingFile = null;

// DOM Elements
let loginPage, chatPage;
let sessionsList, messagesArea;
let messageInput, sendBtn;
let attachBtn, fileInput, filePreview;
let newChatBtn, renameBtn, logoutBtn;
let chatTitleHeader;
let searchTypeBtns;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    // Pages
    loginPage = document.getElementById('login-page');
    chatPage = document.getElementById('chat-page');
    
    // Sidebar
    sessionsList = document.getElementById('sessions-list');
    newChatBtn = document.getElementById('new-chat-sidebar');
    logoutBtn = document.getElementById('sidebar-logout');
    
    // Chat area
    messagesArea = document.getElementById('messages-area');
    messageInput = document.getElementById('message-input');
    sendBtn = document.getElementById('send-message');
    attachBtn = document.getElementById('attach-file-btn');
    fileInput = document.getElementById('file-input');
    filePreview = document.getElementById('file-preview');
    renameBtn = document.getElementById('rename-chat-header');
    chatTitleHeader = document.getElementById('chat-title-header');
    searchTypeBtns = document.querySelectorAll('.search-type');
    
    setupEventListeners();
    checkAuth();
});

function setupEventListeners() {
    // Auth
    document.getElementById('login-button')?.addEventListener('click', () => {
        const email = document.getElementById('login-email').value;
        const password = document.getElementById('login-password').value;
        signin(email, password);
    });
    document.getElementById('register-button')?.addEventListener('click', () => {
        const name = document.getElementById('register-name').value;
        const email = document.getElementById('register-email').value;
        const password = document.getElementById('register-password').value;
        signup(email, password, name);
    });
    document.getElementById('switch-to-register')?.addEventListener('click', (e) => {
        e.preventDefault();
        document.getElementById('login-form').classList.remove('active');
        document.getElementById('register-form').classList.add('active');
    });
    document.getElementById('switch-to-login')?.addEventListener('click', (e) => {
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
    
    searchTypeBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            searchTypeBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentSearchType = btn.dataset.type;
        });
    });
}

// ========== AUTH ==========
async function signup(email, password, fullName) {
    if (!email || !password) {
        alert('Please fill all fields');
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
    loginPage?.classList.remove('hidden');
    chatPage?.classList.add('hidden');
    document.getElementById('login-email').value = '';
    document.getElementById('login-password').value = '';
}

function showChatPage() {
    loginPage?.classList.add('hidden');
    chatPage?.classList.remove('hidden');
    const userEmailSpan = document.getElementById('sidebar-user-email');
    if (userEmailSpan && currentUser) {
        userEmailSpan.textContent = currentUser.email.split('@')[0];
    }
}

// ========== SESSIONS ==========
async function loadSessions() {
    if (!sessionsList) return;
    sessionsList.innerHTML = '<div class="loading-sessions">Loading...</div>';
    
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
        } else {
            sessionsList.innerHTML = '<div class="loading-sessions">No conversations</div>';
        }
    } catch (error) {
        console.error('Load sessions error:', error);
        sessionsList.innerHTML = '<div class="loading-sessions">Failed to load</div>';
    }
}

function renderSessions(sessions) {
    if (!sessionsList) return;
    
    if (sessions.length === 0) {
        sessionsList.innerHTML = '<div class="loading-sessions">No conversations</div>';
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
            if (chatTitleHeader) chatTitleHeader.textContent = 'New conversation';
            clearMessages();
            await loadSessions();
        }
    } catch (error) {
        console.error('Create session error:', error);
    }
}

async function loadSession(sessionId) {
    if (sessionId === currentSessionId) return;
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
            if (chatTitleHeader && sessionInfo) {
                chatTitleHeader.textContent = sessionInfo.title;
            }
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
    const newTitle = prompt('Rename conversation:', chatTitleHeader?.textContent);
    if (!newTitle || !currentSessionId) return;
    
    try {
        await fetch(`${BACKEND_URL}/chat/sessions/${currentSessionId}?title=${encodeURIComponent(newTitle)}`, {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        if (chatTitleHeader) chatTitleHeader.textContent = newTitle;
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
        } else {
            await loadSessions();
        }
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
        if (chatTitleHeader && currentSessionId === sessionId) {
            chatTitleHeader.textContent = shortTitle;
        }
        await loadSessions();
    } catch (error) {
        console.error('Auto-title error:', error);
    }
}

// ========== MESSAGES ==========
function clearMessages() {
    if (!messagesArea) return;
    messagesArea.innerHTML = `
        <div class="welcome-area">
            <i class="fas fa-brain"></i>
            <h3>How can I help you today?</h3>
            <p>Upload documents or ask anything</p>
        </div>
    `;
}

function renderMessages(messages) {
    if (!messagesArea) return;
    
    if (messages.length === 0) {
        clearMessages();
        return;
    }
    
    messagesArea.innerHTML = messages.map(msg => `
        <div class="message ${msg.role}">
            <div class="message-avatar">
                <i class="fas ${msg.role === 'user' ? 'fa-user' : 'fa-brain'}"></i>
            </div>
            <div class="message-content">
                ${escapeHtml(msg.content).replace(/\n/g, '<br>')}
            </div>
        </div>
    `).join('');
    
    messagesArea.scrollTop = messagesArea.scrollHeight;
}

function addMessageToUI(role, content) {
    if (!messagesArea) return;
    
    const welcome = messagesArea.querySelector('.welcome-area');
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
    messagesArea.appendChild(messageDiv);
    messagesArea.scrollTop = messagesArea.scrollHeight;
}

function showTypingIndicator() {
    if (!messagesArea) return;
    
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
    messagesArea.appendChild(typingDiv);
    messagesArea.scrollTop = messagesArea.scrollHeight;
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
    if (filePreview) {
        filePreview.innerHTML = `<i class="fas fa-file-pdf"></i> ${file.name} <i class="fas fa-check-circle"></i>`;
        filePreview.classList.remove('hidden');
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
    
    messageInput.value = '';
    messageInput.style.height = 'auto';
    
    if (filePreview) filePreview.classList.add('hidden');
    
    addMessageToUI('user', message);
    
    const isFirstMessage = messagesArea?.querySelectorAll('.message').length === 1;
    if (isFirstMessage) {
        await updateSessionTitle(currentSessionId, message);
    }
    
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
