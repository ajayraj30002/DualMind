const BACKEND_URL = process.env.VITE_BACKEND_URL || 'http://localhost:8000';

// Stat 
let authToken = null;
let currentUser = null;

// DOM Elements
const fileInput = document.getElementById('file-upload');
const uploadStatus = document.getElementById('upload-status');
const uploadedFilesDiv = document.getElementById('uploaded-files');
const questionInput = document.getElementById('question');
const askBtn = document.getElementById('ask-btn');
const responseSection = document.getElementById('response-section');
const answerDiv = document.getElementById('answer');
const sourcesDiv = document.getElementById('sources');
const sourcesList = document.getElementById('sources-list');

// Auth UI Elements
const authSection = document.getElementById('auth-section');
const appSection = document.getElementById('app-section');
const signupForm = document.getElementById('signup-form');
const signinForm = document.getElementById('signin-form');
const logoutBtn = document.getElementById('logout-btn');
const userEmailSpan = document.getElementById('user-email');

// ========== AUTH FUNCTIONS ==========

async function signup(email, password, fullName) {
    try {
        const response = await fetch(`${BACKEND_URL}/auth/signup`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password, full_name: fullName })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            alert('Signup successful! Please sign in.');
            showSignin();
        } else {
            alert('Signup failed: ' + data.detail);
        }
    } catch (error) {
        alert('Connection error: ' + error.message);
    }
}

async function signin(email, password) {
    try {
        const response = await fetch(`${BACKEND_URL}/auth/signin`, {
            method: 'POST',
            headers: { 'Content-Type':application/json' },
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
            alert('Signin failed: ' + data.detail);
        }
    } catch (error) {
        alert('Connection error: ' + error.message);
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

// ========== UI FUNCTIONS ==========

function showAuth() {
    if (authSection) authSection.classList.remove('hidden');
    if (appSection) appSection.classList.add('hidden');
}

function showApp() {
    if (authSection) authSection.classList.add('hidden');
    if (appSection) appSection.classList.remove('hidden');
    if (userEmailSpan && currentUser) userEmailSpan.textContent = currentUser.email;
}

function showSignup() {
    if (signupForm) signupForm.classList.remove('hidden');
    if (signinForm) signinForm.classList.add('hidden');
}

function showSignin() {
    if (signupForm) signupForm.classList.add('hidden');
    if (signinForm) signinForm.classList.remove('hidden');
}

// ========== API FUNCTIONS (with auth) ==========

async function apiCall(endpoint, options = {}) {
    const headers = {
        'Content-Type': 'application/json',
        ...options.headers
    };
    
    if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
    }
    
    const response = await fetch(`${BACKEND_URL}${endpoint}`, {
        ...options,
        headers
    });
    
    if (response.status === 401) {
        logout();
        throw new Error('Session expired. Please sign in again.');
    }
    
    return response;
}

// File upload handler
fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    uploadStatus.innerHTML = '📤 Uploading and processing...';
    
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
            uploadStatus.innerHTML = '✅ Upload successful!';
            loadDocuments();
            setTimeout(() => { uploadStatus.innerHTML = ''; }, 3000);
        } else {
            uploadStatus.innerHTML = '❌ Upload failed: ' + data.detail;
        }
    } catch (error) {
        uploadStatus.innerHTML = '❌ Connection error';
        console.error('Upload error:', error);
    }
    
    fileInput.value = '';
});

async function loadDocuments() {
    try {
        const response = await apiCall('/documents');
        const data = await response.json();
        
        if (response.ok && data.documents) {
            displayUploadedFiles(data.documents);
        }
    } catch (error) {
        console.error('Load documents error:', error);
    }
}

function displayUploadedFiles(documents) {
    if (!uploadedFilesDiv) return;
    
    if (!documents || documents.length === 0) {
        uploadedFilesDiv.innerHTML = '<p class="no-files">No documents uploaded yet</p>';
        return;
    }
    
    uploadedFilesDiv.innerHTML = documents.map(doc => `
        <div class="file-badge">
            📄 ${doc.filename}
            <span class="chunk-count">(${doc.chunk_count} chunks)</span>
        </div>
    `).join('');
}

// Query handler
askBtn.addEventListener('click', async () => {
    const question = questionInput.value.trim();
    if (!question) {
        alert('Please enter a question');
        return;
    }
    
    const searchType = document.querySelector('input[name="search-type"]:checked').value;
    
    askBtn.disabled = true;
    const spinner = askBtn.querySelector('.spinner');
    const btnText = askBtn.querySelector('span:first-child');
    if (spinner) spinner.classList.remove('hidden');
    btnText.textContent = 'Thinking';
    
    try {
        const response = await apiCall('/query', {
            method: 'POST',
            body: JSON.stringify({ question, search_type: searchType, include_sources: true })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            responseSection.classList.remove('hidden');
            answerDiv.textContent = data.answer;
            
            if (data.sources && data.sources.length > 0) {
                sourcesDiv.classList.remove('hidden');
                sourcesList.innerHTML = data.sources.map(source => `
                    <div class="source-item">
                        <div class="source-type">📌 ${source.type}</div>
                        <div class="source-content">${source.content.substring(0, 300)}...</div>
                    </div>
                `).join('');
            } else {
                sourcesDiv.classList.add('hidden');
            }
        } else {
            answerDiv.textContent = 'Error: ' + (data.detail || 'Something went wrong');
        }
    } catch (error) {
        console.error('Query error:', error);
        answerDiv.textContent = 'Connection error. Make sure backend is running.';
        responseSection.classList.remove('hidden');
    } finally {
        askBtn.disabled = false;
        if (spinner) spinner.classList.add('hidden');
        btnText.textContent = 'Ask';
    }
});

// Enter to submit
questionInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        askBtn.click();
    }
});

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    checkAuth();
    
    // Event listeners for auth buttons
    document.getElementById('show-signup')?.addEventListener('click', showSignup);
    document.getElementById('show-signin')?.addEventListener('click', showSignin);
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
    logoutBtn?.addEventListener('click', logout);
});
