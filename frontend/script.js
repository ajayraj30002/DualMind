/**
 * DualMind - Frontend Application Controller
 * Clean, production-ready AI assistant logic without AI slop.
 */

// API Configuration
let API_URL = window.__ENV__?.BACKEND_URL;
if (!API_URL || API_URL === '${BACKEND_URL}') {
    API_URL = window.location.origin.includes(':5173') || window.location.origin.includes(':5174') || window.location.origin.includes(':5175')
        ? 'http://localhost:8000'
        : window.location.origin;
}

// Global Application State
let token = null;
let user = null;
let currentSessionId = null;
let currentMode = 'hybrid';
let pendingFile = null;
let currentSessionDocuments = [];
let pendingSignupEmail = null;
let allSessions = [];

// DOM References
let loginPage, chatPage, sessionListDiv, messagesDiv, messageInput, sendBtn;
let newChatBtn, renameBtn, logoutBtn, chatTitleSpan, attachBtn, fileInput, fileBadge;
let modeBtns, loadingOverlay, sidebar, sidebarToggle, scrollBottomBtn;
let sessionSearchInput, clearSearchBtn;

// Clean Welcome Hero
const WELCOME_HTML = `
    <div class="welcome" id="welcomeHero">
        <div class="welcome-icon">
            <i class="fas fa-brain"></i>
        </div>
        <h3>Ready when you are</h3>
        <p>Ask from your PDFs, the web, or both. Hybrid mode gives you the best of both worlds.</p>
        
        <div class="starter-grid">
            <button class="starter-chip" data-prompt="Summarize the core takeaways and findings from the uploaded document.">
                <i class="fas fa-file-pdf"></i>
                <span>Summarize document</span>
            </button>
            <button class="starter-chip" data-prompt="Search the web for the latest updates and developments on: ">
                <i class="fas fa-globe"></i>
                <span>Search the web</span>
            </button>
            <button class="starter-chip" data-prompt="Analyze this resume with ATS scoring, section feedback, and improvements.">
                <i class="fas fa-file-contract"></i>
                <span>ATS Resume Review</span>
            </button>
            <button class="starter-chip" data-prompt="Extract key metrics, dates, and important facts into a structured table.">
                <i class="fas fa-table"></i>
                <span>Tabulate key facts</span>
            </button>
        </div>
    </div>
`;

// Toast Notification
function showToast(message, type = 'info', duration = 2600) {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    let iconClass = 'fa-info-circle';
    if (type === 'success') iconClass = 'fa-check-circle';
    if (type === 'error') iconClass = 'fa-exclamation-circle';

    toast.innerHTML = `<i class="fas ${iconClass}"></i> <span>${escapeHtml(message)}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.25s';
        setTimeout(() => toast.remove(), 250);
    }, duration);
}

// Casual conversation detection
function isCasualConversation(content) {
    if (!content) return false;
    const hasMarkdown = content.includes('##') || content.includes('**') ||
                        content.includes('```') || content.includes('- ') ||
                        content.includes('1. ') || content.includes('> ') ||
                        content.includes('* ') || /^#{1,4}\s/m.test(content);
    if (hasMarkdown) return false;
    if (content.length >= 200) return false;
    const casualPatterns = [
        /^(hey|hi|hello|yo|sup|hiya|good morning|good afternoon|good evening)/i,
        /^(thanks|thank you|great|cool|awesome|nice|bye|goodbye)/i,
        /^how are you/i,
        /^(ok|okay|got it|understood)$/i
    ];
    return casualPatterns.some(pattern => pattern.test(content.toLowerCase().trim()));
}

// Markdown and Code formatting
function addCopyButtonsToCodeBlocks() {
    document.querySelectorAll('.md-body pre').forEach(pre => {
        if (pre.parentElement.classList.contains('code-wrapper')) return;
        const code = pre.querySelector('code');
        if (!code) return;

        let lang = 'code';
        code.classList.forEach(cls => {
            if (cls.startsWith('language-')) lang = cls.replace('language-', '');
        });

        const wrapper = document.createElement('div');
        wrapper.className = 'code-wrapper';
        
        const header = document.createElement('div');
        header.className = 'code-header-bar';
        header.innerHTML = `
            <span>${escapeHtml(lang)}</span>
            <button type="button" class="copy-btn">
                <i class="fas fa-copy"></i> Copy
            </button>
        `;

        pre.parentNode.insertBefore(wrapper, pre);
        wrapper.appendChild(header);
        wrapper.appendChild(pre);

        const copyBtn = header.querySelector('.copy-btn');
        copyBtn.onclick = async () => {
            try {
                await navigator.clipboard.writeText(code.textContent || '');
                copyBtn.innerHTML = '<i class="fas fa-check"></i> Copied!';
                copyBtn.classList.add('copied');
                setTimeout(() => {
                    copyBtn.innerHTML = '<i class="fas fa-copy"></i> Copy';
                    copyBtn.classList.remove('copied');
                }, 2000);
            } catch (err) {
                showToast('Failed to copy', 'error');
            }
        };
    });
}

function cleanDualMindResponse(rawText) {
    if (!rawText || typeof rawText !== 'string') return '';
    
    const codeBlocks = [];
    let cleaned = rawText.replace(/```([\s\S]*?)```/g, (match) => {
        const placeholder = `__CODEBLOCK_${codeBlocks.length}__`;
        codeBlocks.push(match);
        return placeholder;
    });
    
    cleaned = cleaned.replace(/^\d+\s*$/gm, '');
    cleaned = cleaned.replace(/^(\d+)\.\s*$/gm, '');
    cleaned = cleaned.replace(/\[(Web Search|PDF Document|RAG|Hybrid)\]/gi, '');
    cleaned = cleaned.replace(/^##([^ #])/gm, '## $1');
    cleaned = cleaned.replace(/^#([^ #])/gm, '# $1');
    cleaned = cleaned.replace(/^•\s*/gm, '- ');
    cleaned = cleaned.replace(/\n{4,}/g, '\n\n');
    cleaned = cleaned.replace(/\[object Object\]/gi, '');
    
    codeBlocks.forEach((block, i) => {
        cleaned = cleaned.replace(`__CODEBLOCK_${i}__`, block);
    });
    
    return cleaned.trim();
}

function setupMarked() {
    if (typeof marked === 'undefined') return;

    const renderer = new marked.Renderer();
    renderer.code = function(code, language) {
        const escaped = code
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');

        const lang = (language && hljs.getLanguage(language)) ? language : 'plaintext';
        try {
            const highlighted = hljs.highlight(escaped, { language: lang }).value;
            return `<pre><code class="hljs language-${lang}">${highlighted}</code></pre>`;
        } catch (e) {
            return `<pre><code class="hljs">${escaped}</code></pre>`;
        }
    };

    marked.use({ renderer, gfm: true, breaks: true });
}

async function renderMarkdown(text) {
    if (!text) return '<div class="md-body"></div>';
    try {
        if (typeof marked === 'undefined' || typeof marked.parse !== 'function') {
            return `<div class="md-body">${text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>')}</div>`;
        }
        const rawHtml = marked.parse(text);
        if (!rawHtml || typeof rawHtml !== 'string') {
            return `<div class="md-body">${text.replace(/\n/g, '<br>')}</div>`;
        }
        
        const safeHtml = typeof DOMPurify !== 'undefined'
            ? DOMPurify.sanitize(rawHtml, {
                ALLOWED_TAGS: [
                    'p', 'strong', 'em', 'b', 'i', 'u', 's',
                    'code', 'pre', 'blockquote',
                    'ul', 'ol', 'li',
                    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
                    'a', 'br', 'hr', 'span', 'div',
                    'table', 'thead', 'tbody', 'tr', 'th', 'td'
                ],
                ALLOWED_ATTR: ['href', 'class', 'data-highlighted', 'target', 'rel'],
                ALLOWED_URI_REGEXP: /^(https?|mailto):/i
            })
            : rawHtml;
        
        return `<div class="md-body">${safeHtml}</div>`;
    } catch(e) {
        console.error('renderMarkdown error:', e);
        return `<div class="md-body">${(text||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>')}</div>`;
    }
}

function buildSourceBadge(searchTypeUsed) {
    if (!searchTypeUsed || searchTypeUsed === 'Conversation') return '';
    let icon, label;
    const type = String(searchTypeUsed).toLowerCase();
    if (type.includes('pdf') || type.includes('document')) {
        icon = 'fa-file-pdf';
        label = 'PDF Document';
    } else if (type.includes('web') || type.includes('open')) {
        icon = 'fa-globe';
        label = 'Web Search';
    } else {
        icon = 'fa-link';
        label = 'Hybrid Search';
    }
    return `<div class="source-badge"><i class="fas ${icon}"></i> <span>${label}</span></div>`;
}

function buildAssistantActionBar(rawContent) {
    return `
        <div class="message-actions-toolbar">
            <button type="button" class="msg-tool-btn copy-msg-btn" title="Copy response">
                <i class="fas fa-copy"></i> <span>Copy</span>
            </button>
            <button type="button" class="msg-tool-btn tts-msg-btn" title="Read aloud">
                <i class="fas fa-volume-high"></i>
            </button>
            <button type="button" class="msg-tool-btn thumbs-up-btn" title="Helpful">
                <i class="fas fa-thumbs-up"></i>
            </button>
            <button type="button" class="msg-tool-btn thumbs-down-btn" title="Not helpful">
                <i class="fas fa-thumbs-down"></i>
            </button>
        </div>
    `;
}

async function addMessageToChat(role, content, filename = null, searchTypeUsed = null, resumeAnalysis = null) {
    if (!messagesDiv) return;
    const welcome = document.getElementById('welcomeHero');
    if (welcome && role === 'user') welcome.remove();

    const messageDiv = document.createElement('div');
    let finalContent = content;
    if (role === 'assistant') finalContent = cleanDualMindResponse(content);
    messageDiv.className = `message ${role}`;

    let attachmentHTML = '';
    if (filename) {
        attachmentHTML = `<div class="message-doc-attachment"><i class="fas fa-file-pdf"></i> ${escapeHtml(filename)}</div>`;
    }

    if (role === 'user') {
        const userInitial = user?.email ? user.email.charAt(0).toUpperCase() : 'U';
        messageDiv.innerHTML = `
            <div class="message-avatar"><span>${userInitial}</span></div>
            <div class="message-content">
                ${attachmentHTML}
                <span>${escapeHtml(finalContent).replace(/\n/g, '<br>')}</span>
            </div>
        `;
    } else {
        const atsData = resumeAnalysis || tryParseResumeAnalysis(finalContent);
        if (atsData && atsData.overall_score) {
            const scoreCardHtml = renderResumeScoreCard(atsData);
            messageDiv.innerHTML = `
                <div class="message-avatar"><i class="fas fa-brain"></i></div>
                <div class="message-content">
                    ${scoreCardHtml}
                    <div class="source-badge"><i class="fas fa-file-contract"></i> <span>ATS Analysis</span></div>
                    ${buildAssistantActionBar(finalContent)}
                </div>
            `;
        } else {
            const isCasual = isCasualConversation(finalContent);
            let renderedContent;

            if (isCasual) {
                renderedContent = `<div class="md-body">${escapeHtml(finalContent).replace(/\n/g, '<br>')}</div>`;
            } else {
                renderedContent = await renderMarkdown(finalContent);
                setTimeout(() => {
                    addCopyButtonsToCodeBlocks();
                }, 100);
            }

            const sourceBadge = buildSourceBadge(searchTypeUsed || currentMode);
            const actionBar = buildAssistantActionBar(finalContent);

            messageDiv.innerHTML = `
                <div class="message-avatar"><i class="fas fa-brain"></i></div>
                <div class="message-content">
                    ${renderedContent}
                    ${sourceBadge}
                    ${actionBar}
                </div>
            `;
        }

        bindAssistantActions(messageDiv, finalContent);
    }

    messagesDiv.appendChild(messageDiv);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
    updateScrollBottomBtn();
}

function bindAssistantActions(messageEl, rawText) {
    const copyBtn = messageEl.querySelector('.copy-msg-btn');
    if (copyBtn) {
        copyBtn.onclick = async () => {
            try {
                await navigator.clipboard.writeText(rawText);
                copyBtn.innerHTML = '<i class="fas fa-check"></i> <span>Copied</span>';
                copyBtn.classList.add('active');
                setTimeout(() => {
                    copyBtn.innerHTML = '<i class="fas fa-copy"></i> <span>Copy</span>';
                    copyBtn.classList.remove('active');
                }, 2000);
            } catch (err) {
                showToast('Failed to copy', 'error');
            }
        };
    }

    const ttsBtn = messageEl.querySelector('.tts-msg-btn');
    if (ttsBtn) {
        ttsBtn.onclick = () => {
            if ('speechSynthesis' in window) {
                if (window.speechSynthesis.speaking) {
                    window.speechSynthesis.cancel();
                    ttsBtn.classList.remove('active');
                    return;
                }
                const clean = rawText.replace(/[#*`_~\[\]]/g, '').slice(0, 1500);
                const utter = new SpeechSynthesisUtterance(clean);
                utter.onend = () => ttsBtn.classList.remove('active');
                utter.onerror = () => ttsBtn.classList.remove('active');
                window.speechSynthesis.speak(utter);
                ttsBtn.classList.add('active');
            }
        };
    }

    const upBtn = messageEl.querySelector('.thumbs-up-btn');
    const downBtn = messageEl.querySelector('.thumbs-down-btn');
    if (upBtn) {
        upBtn.onclick = () => {
            upBtn.classList.toggle('active');
            if (downBtn) downBtn.classList.remove('active');
        };
    }
    if (downBtn) {
        downBtn.onclick = () => {
            downBtn.classList.toggle('active');
            if (upBtn) upBtn.classList.remove('active');
        };
    }
}

// ============================================================================
// SEND MESSAGE
// ============================================================================
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
            await addMessageToChat('assistant', `❌ Document upload failed: ${err.message}`);
            return;
        }
    }

    showTyping();
    if (sendBtn) sendBtn.disabled = true;

    try {
        const res = await fetch(`${API_URL}/chat/sessions/${currentSessionId}/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ question: text, search_type: currentMode, include_sources: true, uploaded_document: uploadedFilename })
        });

        if (res.status === 401) { doLogout(); return; }
        const data = await res.json();
        hideTyping();

        if (res.ok) {
            let finalAnswer = data.answer || data.response || data.content || '';
            const searchSource = data.search_type_used || currentMode;
            const resumeData = data.resume_analysis || null;
            await addMessageToChat('assistant', finalAnswer, null, searchSource, resumeData);
        } else {
            await addMessageToChat('assistant', 'Sorry, something went wrong.');
        }
    } catch (err) {
        hideTyping();
        await addMessageToChat('assistant', 'Connection error. Please check if the server is running.');
    } finally {
        if (sendBtn) sendBtn.disabled = false;
        messageInput?.focus();
    }
}

// ============================================================================
// SESSION MANAGEMENT
// ============================================================================
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

        const sessionInfo = allSessions.find(s => s.id === sessionId);
        if (sessionInfo && chatTitleSpan) {
            chatTitleSpan.innerText = sessionInfo.title;
        }

        if (messagesDiv) {
            if (!data.messages || data.messages.length === 0) {
                messagesDiv.innerHTML = WELCOME_HTML;
                bindStarterChips();
            } else {
                messagesDiv.innerHTML = '';
                for (const msg of data.messages) {
                    const searchType = msg.metadata?.search_type_used || null;
                    const rawContent = msg.content || msg.answer || msg.response || '';
                    await addMessageToChat(msg.role, rawContent, msg.metadata?.filename, searchType);
                }
                messagesDiv.scrollTop = messagesDiv.scrollHeight;
            }
        }
        renderSessionList(allSessions);
    } catch (err) {
        console.error('Error loading session:', err);
    }
}

function toggleSidebar() {
    if (sidebar) {
        sidebar.classList.toggle('collapsed');
        localStorage.setItem('sidebar_collapsed', sidebar.classList.contains('collapsed'));
    }
}

async function loadSessions() {
    if (!sessionListDiv) return;
    sessionListDiv.innerHTML = '<div style="padding: 1rem; text-align: center; color: #666; font-size: 0.8rem;">Loading...</div>';
    try {
        const res = await fetch(`${API_URL}/chat/sessions`, { headers: { 'Authorization': `Bearer ${token}` } });
        if (res.status === 401) { doLogout(); return; }
        const data = await res.json();
        if (res.ok && data.sessions && data.sessions.length > 0) {
            allSessions = data.sessions;
            renderSessionList(allSessions);
            if (!currentSessionId && allSessions[0]) await loadSession(allSessions[0].id);
        } else {
            allSessions = [];
            sessionListDiv.innerHTML = '<div style="padding: 1rem; text-align: center; color: #666; font-size: 0.8rem;">No conversations yet</div>';
            if (!currentSessionId) await createNewSession();
        }
    } catch (err) {
        sessionListDiv.innerHTML = '<div style="padding: 1rem; text-align: center; color: #ef4444; font-size: 0.8rem;">Failed to load</div>';
    }
}

function renderSessionList(sessions) {
    if (!sessionListDiv) return;
    sessionListDiv.innerHTML = '';

    const filterQuery = sessionSearchInput?.value.toLowerCase().trim() || '';
    const filtered = filterQuery
        ? sessions.filter(s => (s.title || '').toLowerCase().includes(filterQuery))
        : sessions;

    if (filtered.length === 0) {
        sessionListDiv.innerHTML = `<div style="padding: 1rem; text-align: center; color: #666; font-size: 0.8rem;">No matching chats</div>`;
        return;
    }

    filtered.forEach(s => {
        const div = document.createElement('div');
        const isActive = currentSessionId === s.id;
        div.className = `session-item ${isActive ? 'active' : ''}`;
        div.dataset.id = s.id;
        div.innerHTML = `
            <span class="session-title">${escapeHtml(s.title || 'Untitled')}</span>
            <div class="session-actions">
                <button class="rename-session-btn" data-id="${s.id}" data-title="${escapeHtml(s.title || '')}" title="Rename">
                    <i class="fas fa-pen"></i>
                </button>
                <button class="delete-session" data-id="${s.id}" title="Delete">
                    <i class="fas fa-trash-alt"></i>
                </button>
            </div>
        `;

        div.addEventListener('click', (e) => {
            if (!e.target.closest('.delete-session') && !e.target.closest('.rename-session-btn')) {
                loadSession(s.id);
            }
        });

        div.querySelector('.delete-session')?.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteSessionFromSidebar(s.id);
        });

        div.querySelector('.rename-session-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            renameSessionFromSidebar(s.id, s.title || 'Conversation');
        });

        sessionListDiv.appendChild(div);
    });
}

async function renameSessionFromSidebar(sessionId, currentTitle) {
    const newName = prompt('Rename conversation:', currentTitle);
    if (!newName || newName === currentTitle) return;
    try {
        await fetch(`${API_URL}/chat/sessions/${sessionId}?title=${encodeURIComponent(newName)}`, {
            method: 'PUT', headers: { 'Authorization': `Bearer ${token}` }
        });
        if (currentSessionId === sessionId && chatTitleSpan) {
            chatTitleSpan.innerText = newName;
        }
        await loadSessions();
    } catch (err) {
        showToast('Failed to rename', 'error');
    }
}

async function deleteSessionFromSidebar(sessionId) {
    if (!confirm('Delete this conversation?')) return;
    try {
        await fetch(`${API_URL}/chat/sessions/${sessionId}`, {
            method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` }
        });
        if (currentSessionId === sessionId) {
            currentSessionId = null;
            currentSessionDocuments = [];
            const sessionsRes = await fetch(`${API_URL}/chat/sessions`, { headers: { 'Authorization': `Bearer ${token}` } });
            const sessionsData = await sessionsRes.json();
            if (sessionsData.sessions && sessionsData.sessions.length > 0) {
                await loadSession(sessionsData.sessions[0].id);
            } else {
                await createNewSession();
            }
        }
        await loadSessions();
    } catch (err) {
        showToast('Failed to delete', 'error');
    }
}

async function createNewSession() {
    try {
        const res = await fetch(`${API_URL}/chat/sessions`, {
            method: 'POST', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
        });
        if (res.status === 401) { doLogout(); return; }
        const data = await res.json();
        if (res.ok && data.session) {
            currentSessionId = data.session.id;
            currentSessionDocuments = [];
            if (chatTitleSpan) chatTitleSpan.innerText = 'New conversation';
            clearMessages();
            await loadSessions();
        }
    } catch (err) {
        console.error('Failed to create session:', err);
    }
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

function clearMessages() {
    if (!messagesDiv) return;
    messagesDiv.innerHTML = WELCOME_HTML;
    bindStarterChips();
}

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

// File Attachment
function onFileSelect(e) {
    const file = e.target.files[0];
    if (!file || !file.name.toLowerCase().endsWith('.pdf')) {
        alert('Please select a PDF file');
        return;
    }
    pendingFile = file;
    if (fileBadge) {
        const nameEl = document.getElementById('fileBadgeName');
        if (nameEl) nameEl.textContent = file.name;
        fileBadge.classList.remove('hidden');
    }
}

async function uploadFile(file, sessionId) {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch(`${API_URL}/upload?session_id=${sessionId}`, {
        method: 'POST', headers: { 'Authorization': `Bearer ${token}` }, body: fd
    });
    if (res.status === 401) { doLogout(); throw new Error('Unauthorized'); }
    if (!res.ok) {
        const error = await res.json();
        throw new Error(error.detail || 'Upload failed');
    }
    return await res.json();
}

async function autoTitle(sessionId, firstMsg) {
    const short = firstMsg.length > 30 ? firstMsg.substring(0, 30) + '...' : firstMsg;
    try {
        await fetch(`${API_URL}/chat/sessions/${sessionId}?title=${encodeURIComponent(short)}`, {
            method: 'PUT', headers: { 'Authorization': `Bearer ${token}` }
        });
        if (chatTitleSpan) chatTitleSpan.innerText = short;
        await loadSessions();
    } catch (err) {
        console.error(err);
    }
}

async function renameSession() {
    const newName = prompt('Rename conversation:', chatTitleSpan?.innerText);
    if (!newName || newName === chatTitleSpan?.innerText || !currentSessionId) return;
    try {
        await fetch(`${API_URL}/chat/sessions/${currentSessionId}?title=${encodeURIComponent(newName)}`, {
            method: 'PUT', headers: { 'Authorization': `Bearer ${token}` }
        });
        if (chatTitleSpan) chatTitleSpan.innerText = newName;
        await loadSessions();
    } catch (err) {
        console.error(err);
    }
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function exportConversation() {
    const messages = messagesDiv?.querySelectorAll('.message');
    if (!messages || messages.length === 0) {
        showToast('No messages to export');
        return;
    }

    const title = chatTitleSpan?.innerText || 'Conversation';
    let md = `# ${title}\n\n`;

    messages.forEach(msg => {
        const isUser = msg.classList.contains('user');
        const role = isUser ? 'User' : 'Assistant';
        const content = msg.querySelector('.message-content')?.innerText.trim() || '';
        md += `### ${role}\n${content}\n\n`;
    });

    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title.replace(/[^a-z0-9_-]/gi, '_')}.md`;
    a.click();
    URL.revokeObjectURL(a);
    showToast('Exported as Markdown', 'success');
}

// ============================================================================
// ATS RESUME SCORE CARD
// ============================================================================
function getScoreColor(score) {
    if (score >= 8) return '#22c55e';
    if (score >= 6) return '#f59e0b';
    if (score >= 4) return '#f97316';
    return '#ef4444';
}

function getScoreLabel(score) {
    if (score >= 9) return 'Exceptional';
    if (score >= 8) return 'Excellent';
    if (score >= 7) return 'Good';
    if (score >= 5) return 'Average';
    if (score >= 3) return 'Below Average';
    return 'Needs Work';
}

function renderResumeScoreCard(data) {
    if (!data || data.error) {
        return `<div class="ats-error"><i class="fas fa-exclamation-triangle"></i> Unable to analyze resume. Please try again.</div>`;
    }

    const overall = data.overall_score || 0;
    const overallColor = getScoreColor(overall);
    const overallLabel = getScoreLabel(overall);
    const circumference = 2 * Math.PI * 45;
    const offset = circumference - (overall / 10) * circumference;

    let sectionsHtml = '';
    if (data.sections && data.sections.length > 0) {
        const sectionIcons = {
            'Contact Information': 'fa-address-card',
            'Professional Summary': 'fa-file-lines',
            'Work Experience': 'fa-briefcase',
            'Skills & Keywords': 'fa-tags',
            'Education': 'fa-graduation-cap',
            'Formatting & ATS Compatibility': 'fa-align-left',
        };
        for (const section of data.sections) {
            const sColor = getScoreColor(section.score);
            const barWidth = (section.score / 10) * 100;
            const icon = sectionIcons[section.name] || 'fa-check-circle';
            sectionsHtml += `
                <div class="ats-section-card">
                    <div class="ats-section-header">
                        <div class="ats-section-title"><i class="fas ${icon}"></i><span>${escapeHtml(section.name)}</span></div>
                        <div class="ats-section-score" style="color: ${sColor}">${section.score}/10</div>
                    </div>
                    <div class="ats-bar-track"><div class="ats-bar-fill" style="width: ${barWidth}%; background: ${sColor}"></div></div>
                    <p class="ats-section-feedback">${escapeHtml(section.feedback)}</p>
                </div>`;
        }
    }

    let strengthsHtml = '';
    if (data.top_strengths && data.top_strengths.length > 0) {
        strengthsHtml = `<div class="ats-pills-section"><h4><i class="fas fa-star"></i> Top Strengths</h4><div class="ats-pills">`;
        for (const s of data.top_strengths) {
            strengthsHtml += `<span class="ats-pill strength">${escapeHtml(s)}</span>`;
        }
        strengthsHtml += `</div></div>`;
    }

    let fixesHtml = '';
    if (data.critical_fixes && data.critical_fixes.length > 0) {
        fixesHtml = `<div class="ats-pills-section"><h4><i class="fas fa-tools"></i> Critical Improvements</h4><div class="ats-pills">`;
        for (const f of data.critical_fixes) {
            fixesHtml += `<span class="ats-pill fix">${escapeHtml(f)}</span>`;
        }
        fixesHtml += `</div></div>`;
    }

    return `
    <div class="ats-score-card">
        <div class="ats-header">
            <div class="ats-badge"><i class="fas fa-file-contract"></i> ATS Resume Analysis</div>
        </div>

        <div class="ats-overall">
            <div class="ats-circle-wrap">
                <svg class="ats-circle" viewBox="0 0 100 100">
                    <circle class="ats-circle-bg" cx="50" cy="50" r="45"/>
                    <circle class="ats-circle-progress" cx="50" cy="50" r="45"
                        style="stroke: ${overallColor}; stroke-dasharray: ${circumference}; stroke-dashoffset: ${offset}"/>
                </svg>
                <div class="ats-circle-text">
                    <span class="ats-score-number" style="color: ${overallColor}">${overall}</span>
                    <span class="ats-score-of">/10</span>
                </div>
            </div>
            <div class="ats-overall-info">
                <div class="ats-overall-label" style="color: ${overallColor}">${overallLabel}</div>
                <p class="ats-summary">${escapeHtml(data.summary || '')}</p>
            </div>
        </div>

        <div class="ats-sections">
            <h4><i class="fas fa-chart-bar"></i> Section Breakdown</h4>
            ${sectionsHtml}
        </div>

        ${strengthsHtml}
        ${fixesHtml}
    </div>`;
}

function tryParseResumeAnalysis(content) {
    if (!content || typeof content !== 'string') return null;
    try {
        const parsed = JSON.parse(content);
        if (parsed && typeof parsed === 'object' && 'overall_score' in parsed && 'sections' in parsed) {
            return parsed;
        }
    } catch (e) {
        // Not JSON
    }
    return null;
}

// Starter chips click handler
function bindStarterChips() {
    document.querySelectorAll('.starter-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            const prompt = chip.dataset.prompt;
            if (prompt && messageInput) {
                messageInput.value = prompt;
                messageInput.focus();
                messageInput.style.height = 'auto';
                messageInput.style.height = Math.min(messageInput.scrollHeight, 150) + 'px';
            }
        });
    });
}

// ============================================================================
// AUTHENTICATION
// ============================================================================
async function doLogin() {
    const email = document.getElementById('loginEmail')?.value.trim();
    const password = document.getElementById('loginPassword')?.value;
    const errorEl = document.getElementById('loginError');

    if (errorEl) {
        errorEl.textContent = '';
        errorEl.classList.add('hidden');
    }

    if (!email || !password) {
        if (errorEl) {
            errorEl.textContent = 'Please enter email and password.';
            errorEl.classList.remove('hidden');
        }
        return;
    }

    showLoading();
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
            if (errorEl) {
                errorEl.textContent = data.detail || 'Invalid email or password.';
                errorEl.classList.remove('hidden');
            }
        }
    } catch (err) {
        if (errorEl) {
            errorEl.textContent = 'Connection error. Check your network.';
            errorEl.classList.remove('hidden');
        }
    } finally {
        hideLoading();
    }
}

async function doRegister() {
    const name = document.getElementById('registerName')?.value.trim();
    const email = document.getElementById('registerEmail')?.value.trim();
    const password = document.getElementById('registerPassword')?.value;
    const errorEl = document.getElementById('registerError');

    if (errorEl) {
        errorEl.textContent = '';
        errorEl.classList.add('hidden');
    }

    if (!name || !email || !password) {
        if (errorEl) {
            errorEl.textContent = 'Please fill in all fields.';
            errorEl.classList.remove('hidden');
        }
        return;
    }

    if (password.length < 6) {
        if (errorEl) {
            errorEl.textContent = 'Password must be at least 6 characters.';
            errorEl.classList.remove('hidden');
        }
        return;
    }

    showLoading();
    try {
        const res = await fetch(`${API_URL}/auth/signup`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password, full_name: name })
        });
        const data = await res.json();

        if (res.ok) {
            pendingSignupEmail = email;
            showOtpForm(email);
        } else {
            if (errorEl) {
                errorEl.textContent = data.detail || 'Signup failed. Please try again.';
                errorEl.classList.remove('hidden');
            }
        }
    } catch (err) {
        if (errorEl) {
            errorEl.textContent = 'Connection error. Check your network.';
            errorEl.classList.remove('hidden');
        }
    } finally {
        hideLoading();
    }
}

function doLogout() {
    token = null;
    user = null;
    currentSessionId = null;
    currentSessionDocuments = [];
    pendingSignupEmail = null;
    allSessions = [];
    localStorage.clear();
    showLoginUI();
}

function checkAuth() {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('demo') === '1') {
        token = 'demo_token';
        user = { id: 'usr_demo', email: 'ajayraj30002@gmail.com' };
        showChatUI();
        allSessions = [
            { id: 'sess_1', title: 'Career Highlights & Biography' },
            { id: 'sess_2', title: 'Machine Learning Research' }
        ];
        currentSessionId = 'sess_1';
        renderSessionList(allSessions);
        if (chatTitleSpan) chatTitleSpan.innerText = 'Career Highlights & Biography';
        setTimeout(() => {
            addMessageToChat('user', 'What are the key career highlights and biography of Virat Kohli?', 'virat_kohli_bio.pdf');
            addMessageToChat('assistant', `## Career Highlights\n\n- **Made his Test debut in 2011**\n- **Became the captain of the Indian team in 2014**\n- **Plays for Royal Challengers Bengaluru in the Indian Premier League**\n\n## Personal Life and Education\n\nThere is no information available about **Virat Kohli**'s 12th grade details in the provided context. However, it is mentioned that **Ajay Raj** has 12th grade details, but this is not relevant to **Virat Kohli**.\n\n## Biography\n\n**Virat Kohli** is a renowned Indian cricketer, known for his exceptional skills on the field. His biography can be summarized as follows:\n\n- Born on 5 November 1988 in Delhi\n- Developed an interest in cricket at a young age\n- Joined the West Delhi Cricket Academy at nine\n- Made his Test debut in 2011 and became the captain of the Indian team in 2014`, null, 'hybrid');
            if (messagesDiv) messagesDiv.scrollTop = 0;
        }, 100);
        return;
    }

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
    if (loginPage) loginPage.classList.remove('hidden');
    if (chatPage) chatPage.classList.add('hidden');
}

function showChatUI() {
    if (loginPage) loginPage.classList.add('hidden');
    if (chatPage) chatPage.classList.remove('hidden');
    
    const emailSidebar = document.getElementById('userEmailSidebar');
    if (emailSidebar) emailSidebar.innerText = user?.email?.split('@')[0] || 'User';
}

function toggleForms(showRegister) {
    document.getElementById('loginForm')?.classList.toggle('active', !showRegister);
    document.getElementById('registerForm')?.classList.toggle('active', showRegister);
    document.getElementById('otpForm')?.classList.remove('active');

    const loginError = document.getElementById('loginError');
    const registerError = document.getElementById('registerError');
    const otpError = document.getElementById('otpError');
    if (loginError) loginError.classList.add('hidden');
    if (registerError) registerError.classList.add('hidden');
    if (otpError) otpError.classList.add('hidden');
}

function showOtpForm(email) {
    document.getElementById('registerForm')?.classList.remove('active');
    document.getElementById('loginForm')?.classList.remove('active');
    document.getElementById('otpForm')?.classList.add('active');

    const emailDisplay = document.getElementById('otpEmailDisplay');
    if (emailDisplay) emailDisplay.textContent = email;

    const otpInput = document.getElementById('otpInput');
    if (otpInput) {
        otpInput.value = '';
        otpInput.focus();
    }
}

function hideOtpForm() {
    document.getElementById('otpForm')?.classList.remove('active');
    document.getElementById('loginForm')?.classList.add('active');
    pendingSignupEmail = null;
}

async function verifyOtp() {
    const otp = document.getElementById('otpInput')?.value.trim();
    const errorEl = document.getElementById('otpError');

    if (errorEl) {
        errorEl.textContent = '';
        errorEl.classList.add('hidden');
    }

    if (!otp || otp.length !== 6 || !/^\d{6}$/.test(otp)) {
        if (errorEl) {
            errorEl.textContent = 'Please enter a 6-digit code.';
            errorEl.classList.remove('hidden');
        }
        return;
    }

    if (!pendingSignupEmail) {
        if (errorEl) {
            errorEl.textContent = 'Session expired. Please sign up again.';
            errorEl.classList.remove('hidden');
        }
        return;
    }

    showLoading();
    try {
        const res = await fetch(`${API_URL}/auth/verify-otp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: pendingSignupEmail, otp })
        });
        const data = await res.json();
        hideLoading();

        if (res.ok) {
            token = data.access_token;
            user = { id: data.user_id, email: data.email };
            localStorage.setItem('dm_token', token);
            localStorage.setItem('dm_user', JSON.stringify(user));

            showChatUI();
            loadSessions();
            hideOtpForm();
        } else {
            if (errorEl) {
                errorEl.textContent = data.detail || 'Invalid or expired code.';
                errorEl.classList.remove('hidden');
            }
        }
    } catch (err) {
        hideLoading();
        if (errorEl) {
            errorEl.textContent = 'Connection error.';
            errorEl.classList.remove('hidden');
        }
    }
}

async function resendOtp() {
    const errorEl = document.getElementById('otpError');
    if (errorEl) errorEl.classList.add('hidden');

    if (!pendingSignupEmail) {
        if (errorEl) {
            errorEl.textContent = 'Session expired. Please sign up again.';
            errorEl.classList.remove('hidden');
        }
        return;
    }

    showLoading();
    try {
        const res = await fetch(`${API_URL}/auth/resend-otp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: pendingSignupEmail })
        });
        hideLoading();
        if (res.ok) {
            showToast('New verification code sent', 'success');
            const otpInput = document.getElementById('otpInput');
            if (otpInput) {
                otpInput.value = '';
                otpInput.focus();
            }
        } else {
            const data = await res.json();
            if (errorEl) {
                errorEl.textContent = data.detail || 'Failed to resend code.';
                errorEl.classList.remove('hidden');
            }
        }
    } catch (err) {
        hideLoading();
        if (errorEl) {
            errorEl.textContent = 'Connection error.';
            errorEl.classList.remove('hidden');
        }
    }
}

function showLoading() { if (loadingOverlay) loadingOverlay.classList.remove('hidden'); }
function hideLoading() { if (loadingOverlay) loadingOverlay.classList.add('hidden'); }

function updateScrollBottomBtn() {
    if (!messagesDiv || !scrollBottomBtn) return;
    const distanceFromBottom = messagesDiv.scrollHeight - messagesDiv.scrollTop - messagesDiv.clientHeight;
    if (distanceFromBottom > 200) {
        scrollBottomBtn.classList.remove('hidden');
    } else {
        scrollBottomBtn.classList.add('hidden');
    }
}

// ============================================================================
// INITIALIZATION
// ============================================================================
document.addEventListener('DOMContentLoaded', () => {
    setupMarked();

    // Cache DOM
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
    modeBtns = document.querySelectorAll('.mode-pill');
    loadingOverlay = document.getElementById('loadingOverlay');
    sidebar = document.getElementById('sidebar');
    sidebarToggle = document.getElementById('sidebarToggle');
    scrollBottomBtn = document.getElementById('scrollBottomBtn');
    sessionSearchInput = document.getElementById('sessionSearchInput');
    clearSearchBtn = document.getElementById('clearSearchBtn');

    const savedSidebarState = localStorage.getItem('sidebar_collapsed');
    if (savedSidebarState === 'true' && sidebar) sidebar.classList.add('collapsed');

    bindStarterChips();
    setupEventListeners();
    checkAuth();
});

function setupEventListeners() {
    // Form switch
    document.getElementById('showRegister')?.addEventListener('click', (e) => { e.preventDefault(); toggleForms(true); });
    document.getElementById('showLogin')?.addEventListener('click', (e) => { e.preventDefault(); toggleForms(false); });

    // Password visibility toggle
    document.querySelectorAll('.password-toggle').forEach(btn => {
        btn.addEventListener('click', () => {
            const targetId = btn.dataset.target;
            const targetInput = document.getElementById(targetId);
            if (targetInput) {
                const isPassword = targetInput.type === 'password';
                targetInput.type = isPassword ? 'text' : 'password';
                btn.innerHTML = `<i class="fas fa-${isPassword ? 'eye-slash' : 'eye'}"></i>`;
            }
        });
    });

    // Login
    document.getElementById('loginBtn')?.addEventListener('click', doLogin);
    document.getElementById('loginPassword')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doLogin(); } });
    document.getElementById('loginEmail')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doLogin(); } });

    // Register
    document.getElementById('registerBtn')?.addEventListener('click', doRegister);
    document.getElementById('registerPassword')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doRegister(); } });

    // OTP
    document.getElementById('verifyOtpBtn')?.addEventListener('click', verifyOtp);
    document.getElementById('otpInput')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); verifyOtp(); } });
    document.getElementById('resendOtpBtn')?.addEventListener('click', resendOtp);
    document.getElementById('backToSignin')?.addEventListener('click', (e) => { e.preventDefault(); hideOtpForm(); });

    // Chat
    sendBtn?.addEventListener('click', sendMessage);
    messageInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    messageInput?.addEventListener('input', () => {
        messageInput.style.height = 'auto';
        messageInput.style.height = Math.min(messageInput.scrollHeight, 150) + 'px';
    });

    newChatBtn?.addEventListener('click', createNewSession);
    renameBtn?.addEventListener('click', renameSession);
    chatTitleSpan?.addEventListener('click', renameSession);
    logoutBtn?.addEventListener('click', doLogout);

    // File attachments
    attachBtn?.addEventListener('click', () => fileInput?.click());
    fileInput?.addEventListener('change', onFileSelect);
    document.getElementById('removeFileBtn')?.addEventListener('click', () => {
        pendingFile = null;
        if (fileBadge) fileBadge.classList.add('hidden');
        if (fileInput) fileInput.value = '';
    });

    // Sidebar
    sidebarToggle?.addEventListener('click', toggleSidebar);
    document.getElementById('mobileToggleBtn')?.addEventListener('click', () => {
        sidebar?.classList.toggle('mobile-open');
    });

    // Search
    sessionSearchInput?.addEventListener('input', () => {
        const query = sessionSearchInput.value.trim();
        clearSearchBtn?.classList.toggle('hidden', !query);
        renderSessionList(allSessions);
    });

    clearSearchBtn?.addEventListener('click', () => {
        sessionSearchInput.value = '';
        clearSearchBtn.classList.add('hidden');
        renderSessionList(allSessions);
    });

    // Mode Selector
    modeBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            modeBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentMode = btn.dataset.mode;
        });
    });

    // Actions
    document.getElementById('exportChatBtn')?.addEventListener('click', exportConversation);
    document.getElementById('clearChatHeaderBtn')?.addEventListener('click', () => {
        if (confirm('Clear current messages?')) {
            clearMessages();
        }
    });

    // Scroll
    scrollBottomBtn?.addEventListener('click', () => {
        if (messagesDiv) messagesDiv.scrollTo({ top: messagesDiv.scrollHeight, behavior: 'smooth' });
    });
    messagesDiv?.addEventListener('scroll', updateScrollBottomBtn);

    // Keyboard Shortcuts
    window.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
            e.preventDefault();
            createNewSession();
        } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
            e.preventDefault();
            toggleSidebar();
        }
    });
}
