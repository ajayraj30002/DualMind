// Backend URL
const BACKEND_URL = 'https://dualmind.onrender.com';
// State
let authToken = null;
let currentUser = null;
let currentSessionId = null;
let currentSearchType = 'hybrid';

// DOM Elements
let sidebar, mainContent, authSection, chatSection;
let sessionsList, messagesArea, messageInput, sendBtn, attachBtn, fileInput;
let chatTitle, renameBtn, newChatBtn, logoutBtn;
let searchTypeBtns;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    // Get DOM elements
    authSection = document.getElementById('auth-section');
    chatSection = document.getElementById('chat-section');
    sessionsList = document.getElementById('sessions-list');
    messagesArea = document.getElementById('messages-area');
    messageInput = document.getElementById('message-input');
    sendBtn = document.getElementById('send-btn');
    attachBtn = document.getElementById('attach-btn');
    fileInput = document.getElementById('file-input');
    chatTitle = document.getElementById('chat-title');
    renameBtn = document.getElementById('rename-chat-btn');
    newChatBtn = document.getElementById('new-chat-btn');
    logoutBtn = document.getElementById('logout-btn');
    searchTypeBtns = document.querySelectorAll('.search-type-btn');
    
    // Setup event listeners
    setupEventListeners();
    
    // Check auth status
    checkAuth();
});

function setupEventListeners() {
    // Auth
    document.getElementById('show-signup')?.addEventListener('click', (e) => {
        e.preventDefault();
        showSignup();
    });
    document.getElementById('show-signin')?.addEventListener('click', (e) => {
        e.preventDefault();
        showSignin();
    });
    document.getElementById('signup-submit')?.addEventListener('click', () => {
        const email = document.getElementById('signup-email').value;
        const password = document.getElementById('signup-password').value;
        const fullName = document.getElementById('signup-fullname').value;
        signup(email, password, fullName);
    });
    document.getElementById('signin-submit')?.addEventListener('click', () => {
        const email = document.getElementById('signin-email').value;
        const password = document.getElementById('signin-password').value;
        signin(email, password);
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
    fileInput?.addEventListener('change', handleFileUpload);
    newChatBtn?.addEventListener('click', createNewSession);
    renameBtn?.addEventListener('click', renameCurrentSession);
    logoutBtn?.addEventListener('click', logout);
    
    // Search type selector
    searchTypeBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            searchTypeBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentSearchType = btn.dataset.type;
        });
    });
}

// ========== AUTH FUNCTIONS ==========
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
            alert('✅ Signup successful! Please sign in.');
            showSignin();
        } else {
            alert('❌ Signup failed: ' + (data.detail || 'Unknown error'));
        }
    } catch (error) {
        alert('❌ Connection error: ' + error.message);
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
            showApp();
            loadSessions();
            createNewSession();
        } else {
            alert('❌ Signin failed: ' + (data.detail || 'Invalid credentials'));
        }
    } catch (error) {
        alert('❌ Connection error: ' + error.message);
    }
}

function logout() {
    authToken = null;
    currentUser = null;
    currentSessionId = null;
    localStorage.removeItem('dualmind_token');
    localStorage.removeItem('dualmind_user');
    showAuth();
}

function checkAuth() {
    const token = localStorage.getItem('dualmind_token');
    const user = localStorage.getItem('dualmind_user');
    
    if (token && user) {
        authToken = token;
        currentUser = JSON.parse(user);
        showApp();
        loadSessions();
    } else {
        showAuth();
    }
}

function showAuth() {
    if (authSection) authSection.classList.remove('hidden');
    if (chatSection) chatSection.classList.add('hidden');
}

function showApp() {
    if (authSection) authSection.classList.add('hidden');
    if (chatSection) chatSection.classList.remove('hidden');
    const userEmailSpan = document.getElementById('user-email');
    if (userEmailSpan && currentUser) userEmailSpan.textContent = currentUser.email;
}

function showSignup() {
    const signupForm = document.getElementById('signup-form');
    const signinForm = document.getElementById('signin-form');
    if (signupForm) signupForm.classList.remove('hidden');
    if (signinForm) signinForm.classList.add('hidden');
}

function showSignin() {
    const signupForm = document.getElementById('signup-form');
    const signinForm = document.getElementById('signin-form');
    if (signupForm) signupForm.classList.add('hidden');
    if (signinForm) signinForm.classList.remove('hidden');
}

// ========== CHAT SESSION FUNCTIONS ==========
async function loadSessions() {
    if (!sessionsList) return;
    sessionsList.innerHTML = '<div class="loading-sessions"><i class="fas fa-spinner fa-spin"></i> Loading chats...</div>';
    
    try {
        const response = await fetch(`${BACKEND_URL}/chat/sessions`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const data = await response.json();
        
        if (response.ok && data.sessions) {
            renderSessions(data.sessions);
        } else {
            sessionsList.innerHTML = '<div class="loading-sessions">No chats yet. Start a new one!</div>';
        }
    } catch (error) {
        console.error('Load sessions error:', error);
        sessionsList.innerHTML = '<div class="loading-sessions">Failed to load chats</div>';
    }
}

function renderSessions(sessions) {
    if (!sessionsList) return;
    
    if (sessions.length === 0) {
        sessionsList.innerHTML = '<div class="loading-sessions">No chats yet. Start a new one!</div>';
        return;
    }
    
    sessionsList.innerHTML = sessions.map(session => `
        <div class="session-item ${currentSessionId === session.id ? 'active' : ''}" data-id="${session.id}">
            <span class="session-title">${escapeHtml(session.title)}</span>
            <button class="session-delete" data-id="${session.id}">
                <i class="fas fa-trash"></i>
            </button>
        </div>
    `).join('');
    
    // Add event listeners
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
        const data = await response.json();
        
        if (response.ok) {
            currentSessionId = data.session.id;
            if (chatTitle) chatTitle.value = 'New Chat';
            clearMessages();
            loadSessions();
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
        const data = await response.json();
        
        if (response.ok) {
            const session = await getSessionInfo(sessionId);
            if (chatTitle && session) chatTitle.value = session.title;
            renderMessages(data.messages || []);
            loadSessions();
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
    const newTitle = prompt('Enter new chat name:', chatTitle?.value);
    if (!newTitle || !currentSessionId) return;
    
    try {
        await fetch(`${BACKEND_URL}/chat/sessions/${currentSessionId}?title=${encodeURIComponent(newTitle)}`, {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        if (chatTitle) chatTitle.value = newTitle;
        loadSessions();
    } catch (error) {
        console.error('Rename error:', error);
    }
}

async function deleteSession(sessionId) {
    if (!confirm('Delete this chat?')) return;
    
    try {
        await fetch(`${BACKEND_URL}/chat/sessions/${sessionId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        if (currentSessionId === sessionId) {
            createNewSession();
        }
        loadSessions();
    } catch (error) {
        console.error('Delete error:', error);
    }
}

// ========== MESSAGE FUNCTIONS ==========
function clearMessages() {
    if (!messagesArea) return;
    messagesArea.innerHTML = `
        <div class="welcome-message">
            <i class="fas fa-brain"></i>
            <h2>DualMind Assistant</h2>
            <p>Ask me anything — I can search your documents or the web</p>
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
                ${formatMessage(msg.content)}
                ${msg.sources ? renderSources(msg.sources) : ''}
            </div>
        </div>
    `).join('');
    
    messagesArea.scrollTop = messagesArea.scrollHeight;
}

function renderSources(sources) {
    if (!sources || sources.length === 0) return '';
    return `
        <div class="sources-panel">
            <div class="sources-title">📚 Sources</div>
            ${sources.map(s => `
                <div class="source-item">
                    <i class="fas ${s.type === '📁 My Documents' ? 'fa-file-alt' : 'fa-globe'}"></i>
                    <span>${escapeHtml(s.title || s.type)}</span>
                </div>
            `).join('')}
        </div>
    `;
}

function formatMessage(content) {
    return content.replace(/\n/g, '<br>');
}

async function sendMessage() {
    const message = messageInput?.value.trim();
    if (!message || !currentSessionId) return;
    
    // Add user message to UI
    addMessageToUI('user', message);
    messageInput.value = '';
    messageInput.style.height = 'auto';
    
    // Show typing indicator
    showTypingIndicator();
    sendBtn.disabled = true;
    
    try {
        const response = await fetch(`${BACKEND_URL}/chat/sessions/${currentSessionId}/messages`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({
                question: message,
                search_type: currentSearchType,
                include_sources: true
            })
        });
        
        const data = await response.json();
        removeTypingIndicator();
        
        if (response.ok) {
            addMessageToUI('assistant', data.answer, data.sources);
        } else {
            addMessageToUI('assistant', 'Sorry, something went wrong. Please try again.');
        }
    } catch (error) {
        console.error('Send error:', error);
        removeTypingIndicator();
        addMessageToUI('assistant', 'Connection error. Please check your connection.');
    } finally {
        sendBtn.disabled = false;
        messageInput.focus();
    }
}

function addMessageToUI(role, content, sources = null) {
    if (!messagesArea) return;
    
    // Remove welcome message if present
    const welcomeMsg = messagesArea.querySelector('.welcome-message');
    if (welcomeMsg) welcomeMsg.remove();
    
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${role}`;
    messageDiv.innerHTML = `
        <div class="message-avatar">
            <i class="fas ${role === 'user' ? 'fa-user' : 'fa-brain'}"></i>
        </div>
        <div class="message-content">
            ${formatMessage(content)}
            ${sources ? renderSources(sources) : ''}
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

// ========== FILE UPLOAD ==========
async function handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file || !file.name.endsWith('.pdf')) {
        alert('Please select a PDF file');
        return;
    }
    
    const attachedFilesDiv = document.getElementById('attached-files');
    if (attachedFilesDiv) {
        attachedFilesDiv.innerHTML = `<div class="file-badge">📄 ${file.name} <i class="fas fa-spinner fa-spin"></i></div>`;
    }
    
    const formData = new FormData();
    formData.append('file', file);
    
    try {
        const response = await fetch(`${BACKEND_URL}/upload`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${authToken}` },
            body: formData
        });
        
        const data = await response.json();
        
        if (response.ok) {
            if (attachedFilesDiv) {
                attachedFilesDiv.innerHTML = `<div class="file-badge">📄 ${file.name} <i class="fas fa-check-circle" style="color: #10b981;"></i></div>`;
                setTimeout(() => {
                    attachedFilesDiv.innerHTML = '';
                }, 3000);
            }
            alert(`✅ Uploaded! ${data.chunk_count} chunks processed.`);
        } else {
            attachedFilesDiv.innerHTML = '';
            alert('❌ Upload failed: ' + (data.detail || 'Unknown error'));
        }
    } catch (error) {
        attachedFilesDiv.innerHTML = '';
        alert('❌ Connection error');
    }
    
    fileInput.value = '';
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
