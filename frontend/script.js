// Backend URL
const BACKEND_URL = 'https://dualmind.onrender.com';

// State
let authToken = null;
let currentUser = null;

// Wait for DOM to load
document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
    checkAuth();
});

function setupEventListeners() {
    // Auth buttons
    const showSignupBtn = document.getElementById('show-signup');
    const showSigninBtn = document.getElementById('show-signin');
    const signupSubmit = document.getElementById('signup-submit');
    const signinSubmit = document.getElementById('signin-submit');
    const logoutBtn = document.getElementById('logout-btn');
    
    if (showSignupBtn) showSignupBtn.addEventListener('click', (e) => {
        e.preventDefault();
        showSignup();
    });
    
    if (showSigninBtn) showSigninBtn.addEventListener('click', (e) => {
        e.preventDefault();
        showSignin();
    });
    
    if (signupSubmit) signupSubmit.addEventListener('click', () => {
        const email = document.getElementById('signup-email').value;
        const password = document.getElementById('signup-password').value;
        const fullName = document.getElementById('signup-fullname').value;
        signup(email, password, fullName);
    });
    
    if (signinSubmit) signinSubmit.addEventListener('click', () => {
        const email = document.getElementById('signin-email').value;
        const password = document.getElementById('signin-password').value;
        signin(email, password);
    });
    
    if (logoutBtn) logoutBtn.addEventListener('click', logout);
    
    // Query button
    const askBtn = document.getElementById('ask-btn');
    if (askBtn) askBtn.addEventListener('click', handleQuery);
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
            loadDocuments();
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
        loadDocuments();
    } else {
        showAuth();
    }
}

function showAuth() {
    const authSection = document.getElementById('auth-section');
    const appSection = document.getElementById('app-section');
    if (authSection) authSection.classList.remove('hidden');
    if (appSection) appSection.classList.add('hidden');
}

function showApp() {
    const authSection = document.getElementById('auth-section');
    const appSection = document.getElementById('app-section');
    const userEmailSpan = document.getElementById('user-email');
    
    if (authSection) authSection.classList.add('hidden');
    if (appSection) appSection.classList.remove('hidden');
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

// ========== DOCUMENT FUNCTIONS ==========

async function loadDocuments() {
    if (!authToken) return;
    
    try {
        const response = await fetch(`${BACKEND_URL}/documents`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const data = await response.json();
        
        const uploadedFilesDiv = document.getElementById('uploaded-files');
        if (uploadedFilesDiv && data.documents && data.documents.length > 0) {
            uploadedFilesDiv.innerHTML = data.documents.map(doc => `
                <div class="file-badge">
                    📄 ${doc.filename}
                    <span class="chunk-count">${doc.chunk_count || 0} chunks</span>
                </div>
            `).join('');
        }
    } catch (error) {
        console.error('Load documents error:', error);
    }
}

// ========== QUERY FUNCTIONS ==========

async function handleQuery() {
    const questionInput = document.getElementById('question');
    const question = questionInput?.value.trim();
    
    if (!question) {
        alert('Please enter a question');
        return;
    }
    
    const searchType = document.querySelector('input[name="search-type"]:checked')?.value || 'hybrid';
    const askBtn = document.getElementById('ask-btn');
    const responseSection = document.getElementById('response-section');
    const answerDiv = document.getElementById('answer');
    const sourcesDiv = document.getElementById('sources');
    const sourcesList = document.getElementById('sources-list');
    
    if (askBtn) {
        askBtn.disabled = true;
        askBtn.textContent = 'Thinking...';
    }
    
    try {
        const response = await fetch(`${BACKEND_URL}/query`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({ question, search_type: searchType, include_sources: true })
        });
        
        const data = await response.json();
        
        if (response.ok && responseSection && answerDiv) {
            responseSection.classList.remove('hidden');
            answerDiv.textContent = data.answer;
            
            if (sourcesDiv && sourcesList && data.sources && data.sources.length > 0) {
                sourcesDiv.classList.remove('hidden');
                sourcesList.innerHTML = data.sources.map(source => `
                    <div class="source-item">
                        <div class="source-type">📌 ${source.type}</div>
                        <div class="source-content">${source.content.substring(0, 300)}...</div>
                    </div>
                `).join('');
            }
        } else if (answerDiv) {
            answerDiv.textContent = 'Error: ' + (data.detail || 'Something went wrong');
        }
    } catch (error) {
        console.error('Query error:', error);
        if (answerDiv) answerDiv.textContent = 'Connection error. Make sure backend is running.';
    } finally {
        if (askBtn) {
            askBtn.disabled = false;
            askBtn.textContent = 'Ask DualMind';
        }
    }
}

// File upload handler
const fileInput = document.getElementById('file-upload');
if (fileInput) {
    fileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        const uploadStatus = document.getElementById('upload-status');
        if (uploadStatus) uploadStatus.innerHTML = '📤 Uploading and processing...';
        
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
                if (uploadStatus) uploadStatus.innerHTML = '✅ Upload successful!';
                loadDocuments();
                setTimeout(() => {
                    if (uploadStatus) uploadStatus.innerHTML = '';
                }, 3000);
            } else {
                if (uploadStatus) uploadStatus.innerHTML = '❌ Upload failed: ' + (data.detail || 'Unknown error');
            }
        } catch (error) {
            if (uploadStatus) uploadStatus.innerHTML = '❌ Connection error';
        }
        
        fileInput.value = '';
    });
}
