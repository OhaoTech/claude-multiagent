// Chat Module for Agent Monitor
// Handles session management, WebSocket chat, and UI interactions

// ============================================================================
// State
// ============================================================================
let sessionId = null;
let agentName = 'leader';
let lastMessageCount = 0;
let autoScroll = true;
let refreshInterval = null;
let lastUpdateTime = null;
let isStreaming = false;
let chatWebSocket = null;
let currentStreamingMessage = null;
let pendingImages = [];
let currentMode = 'normal';
let permissionTimeoutId = null;

const MODES = {
    normal: { name: 'Normal', dot: '', icon: '💬' },
    plan: { name: 'Plan', dot: 'plan', icon: '📋' },
    auto: { name: 'Auto Edit', dot: 'auto', icon: '⚡' },
    yolo: { name: 'YOLO', dot: 'yolo', icon: '🔥' }
};

const COMMANDS = [
    { name: 'clear', icon: '🗑️', desc: 'Clear conversation and start fresh', local: true },
    { name: 'status', icon: '📊', desc: 'Show current session status' },
    { name: 'cost', icon: '💰', desc: 'Show token usage and cost' },
    { name: 'compact', icon: '📦', desc: 'Compact conversation history' },
    { name: 'sessions', icon: '📋', desc: 'List recent sessions', local: true },
    { name: 'git status', icon: '📝', desc: 'Show git working tree status' },
    { name: 'git diff', icon: '🔍', desc: 'Show uncommitted changes' },
    { name: 'git log -5', icon: '📜', desc: 'Show recent commits' },
    { name: 'help', icon: '❓', desc: 'Show available commands', local: true },
    { name: 'model', icon: '🤖', desc: 'Show or change model' },
    { name: 'config', icon: '⚙️', desc: 'View/modify configuration' },
];

// ============================================================================
// Initialization
// ============================================================================
function initChat() {
    parseUrl();
    setupUI();
    setupEventListeners();

    if (sessionId) {
        document.getElementById('chatTitle').textContent = `Session ${sessionId.slice(0, 8)}...`;
        document.getElementById('emptyState').innerHTML = '<h2>Loading...</h2><p>Fetching conversation history</p>';
        loadSessionHistory();
        startLiveUpdates();
    } else {
        document.getElementById('chatTitle').textContent = 'New Chat';
        document.getElementById('emptyState').innerHTML = `
            <h2>Start a conversation</h2>
            <p>Send a message below or select a session from the picker</p>
        `;
    }
}

function parseUrl() {
    const pathParts = window.location.pathname.split('/');
    sessionId = pathParts[2] || null;
    const urlParams = new URLSearchParams(window.location.search);
    agentName = urlParams.get('agent') || 'leader';

    // Fallback: Try regex parsing
    if (!sessionId) {
        const match = window.location.pathname.match(/\/chat\/([a-f0-9-]+)/i);
        if (match) sessionId = match[1];
    }

    // Another fallback: query params
    if (!sessionId) {
        sessionId = urlParams.get('session_id') || urlParams.get('sessionId');
    }

    if (sessionId === '') sessionId = null;
}

function setupUI() {
    document.getElementById('agentBadge').textContent = agentName;
}

function setupEventListeners() {
    // Back button
    document.getElementById('backBtn').onclick = () => {
        window.location.href = `/agent/${agentName}`;
    };

    // Session picker
    document.getElementById('sessionPickerBtn').onclick = toggleSessionPicker;
    document.getElementById('sessionPickerClose').onclick = () => {
        document.getElementById('sessionPicker').style.display = 'none';
    };

    // Command palette close
    document.getElementById('commandPaletteClose').onclick = () => {
        document.getElementById('commandPalette').classList.remove('active');
    };

    // Image attachment
    document.getElementById('attachBtn').onclick = () => {
        document.getElementById('imageInput').click();
    };
    document.getElementById('imageInput').onchange = handleImageSelect;

    // Text input
    const textarea = document.getElementById('messageInput');
    textarea.addEventListener('input', handleTextInput);
    textarea.addEventListener('keydown', handleTextKeydown);

    // Send button
    document.getElementById('sendBtn').onclick = sendMessage;

    // Scroll tracking
    document.getElementById('messages').addEventListener('scroll', function() {
        autoScroll = (this.scrollHeight - this.scrollTop - this.clientHeight) < 100;
    });

    // Live indicator (if exists)
    const liveIndicator = document.getElementById('liveIndicator');
    if (liveIndicator) {
        liveIndicator.onclick = toggleLiveUpdates;
    }
}

// ============================================================================
// Mode Management
// ============================================================================
function toggleModeSelector() {
    document.getElementById('modeSelector').classList.toggle('active');
}

function selectMode(mode) {
    currentMode = mode;
    const config = MODES[mode];

    document.getElementById('modeName').textContent = config.name;
    const dot = document.getElementById('modeDot');
    dot.className = 'mode-dot' + (config.dot ? ' ' + config.dot : '');

    document.querySelectorAll('.mode-option').forEach(el => {
        el.classList.toggle('selected', el.dataset.mode === mode);
    });

    document.getElementById('modeSelector').classList.remove('active');
    addMessageToUI('system', `Mode changed to ${config.icon} ${config.name}`);
}

// ============================================================================
// Session Management
// ============================================================================
function toggleSessionPicker() {
    const picker = document.getElementById('sessionPicker');
    if (picker.style.display === 'none') {
        picker.style.display = 'block';
        loadSessions();
    } else {
        picker.style.display = 'none';
    }
}

async function loadSessions() {
    const list = document.getElementById('sessionList');
    list.innerHTML = '<div style="color: var(--text-muted); font-size: 12px;">Loading...</div>';

    try {
        const response = await fetch('/api/sessions');
        const sessions = await response.json();

        if (!sessions || sessions.length === 0) {
            list.innerHTML = '<div style="color: var(--text-muted); font-size: 12px;">No sessions found</div>';
            return;
        }

        list.innerHTML = sessions.slice(0, 10).map(s => {
            const date = new Date((s.last_timestamp || 0) * 1000);
            const isActive = sessionId === s.session_id;
            return `
                <div class="session-item ${isActive ? 'active' : ''}" onclick="selectSession('${s.session_id}')">
                    <div>
                        <div class="session-id">${s.session_id.slice(0, 12)}...</div>
                        <div class="session-meta">${s.agent || 'unknown'} - ${date.toLocaleString()}</div>
                    </div>
                    <button class="session-copy-btn" onclick="event.stopPropagation(); copySessionId('${s.session_id}')">Copy ID</button>
                </div>
            `;
        }).join('');
    } catch (e) {
        list.innerHTML = `<div style="color: var(--error); font-size: 12px;">Error: ${e.message}</div>`;
    }
}

function selectSession(id) {
    sessionId = id;
    document.getElementById('chatTitle').textContent = `Session ${id.slice(0, 8)}...`;
    document.getElementById('sessionPicker').style.display = 'none';

    history.pushState({}, '', `/chat/${id}?agent=${agentName}`);

    document.getElementById('emptyState').innerHTML = '<h2>Loading...</h2><p>Fetching conversation history</p>';
    document.getElementById('emptyState').style.display = 'block';

    if (refreshInterval) {
        clearInterval(refreshInterval);
        refreshInterval = null;
    }

    loadSessionHistory().then(() => startLiveUpdates());
}

function copySessionId(id) {
    navigator.clipboard.writeText(id).then(() => alert('Session ID copied!'));
}

// ============================================================================
// Command Palette
// ============================================================================
function renderCommands(filter = '') {
    const list = document.getElementById('commandList');
    const filtered = COMMANDS.filter(c =>
        c.name.toLowerCase().includes(filter.toLowerCase()) ||
        c.desc.toLowerCase().includes(filter.toLowerCase())
    );

    list.innerHTML = filtered.map((cmd, idx) => `
        <div class="command-item ${idx === 0 ? 'selected' : ''}"
             onclick="executeCommand('${cmd.name}')"
             data-command="${cmd.name}"
             data-local="${cmd.local || false}">
            <div class="command-icon">${cmd.icon}</div>
            <div class="command-info">
                <div class="command-name"><span>/</span>${cmd.name}</div>
                <div class="command-desc">${cmd.desc}</div>
            </div>
        </div>
    `).join('');
}

function toggleCommandPalette() {
    const palette = document.getElementById('commandPalette');
    if (palette.classList.contains('active')) {
        palette.classList.remove('active');
    } else {
        palette.classList.add('active');
        renderCommands();
    }
}

function insertCommand(cmd) {
    const input = document.getElementById('messageInput');
    input.value = cmd;
    input.focus();
    if (cmd === '/') toggleCommandPalette();
}

function executeCommand(cmdName) {
    document.getElementById('commandPalette').classList.remove('active');

    const cmd = COMMANDS.find(c => c.name === cmdName);
    if (cmd && cmd.local) {
        handleLocalCommand(cmdName);
        return;
    }

    document.getElementById('messageInput').value = '/' + cmdName;
    sendMessage();
}

function handleLocalCommand(cmdName) {
    switch (cmdName) {
        case 'clear':
            clearChat();
            break;
        case 'sessions':
            toggleSessionPicker();
            break;
        case 'help':
            showHelpMessage();
            break;
    }
}

function clearChat() {
    const container = document.getElementById('messages');
    container.innerHTML = `
        <div class="empty-state" id="emptyState">
            <h2>Chat cleared</h2>
            <p>Start a new conversation</p>
        </div>
    `;
    sessionId = null;
    document.getElementById('chatTitle').textContent = 'New Chat';
    history.pushState({}, '', `/chat?agent=${agentName}`);
    addMessageToUI('system', 'Chat cleared. Starting fresh session.');
}

function showHelpMessage() {
    const helpText = COMMANDS.map(c => `/${c.name} - ${c.desc}`).join('\n');
    addMessageToUI('system', 'Available commands:\n\n' + helpText);
    scrollToBottom();
}

// ============================================================================
// Image Handling
// ============================================================================
function handleImageSelect(e) {
    const files = Array.from(e.target.files);
    files.forEach(file => {
        if (file.type.startsWith('image/')) {
            const reader = new FileReader();
            reader.onload = (ev) => {
                pendingImages.push({ file, dataUrl: ev.target.result });
                updateImagePreviews();
            };
            reader.readAsDataURL(file);
        }
    });
    e.target.value = '';
}

function updateImagePreviews() {
    const container = document.getElementById('imagePreviewContainer');
    container.innerHTML = pendingImages.map((img, idx) => `
        <div class="image-preview">
            <img src="${img.dataUrl}" alt="Preview">
            <button class="remove-btn" onclick="removeImage(${idx})">×</button>
        </div>
    `).join('');
}

function removeImage(idx) {
    pendingImages.splice(idx, 1);
    updateImagePreviews();
}

// ============================================================================
// Text Input Handling
// ============================================================================
function handleTextInput() {
    const textarea = this;
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';

    const value = textarea.value;
    if (value.startsWith('/') && value.length <= 20) {
        document.getElementById('commandPalette').classList.add('active');
        renderCommands(value.slice(1));
    } else {
        document.getElementById('commandPalette').classList.remove('active');
    }
}

function handleTextKeydown(e) {
    const palette = document.getElementById('commandPalette');

    if (palette.classList.contains('active')) {
        const items = palette.querySelectorAll('.command-item');
        const selected = palette.querySelector('.command-item.selected');
        const selectedIdx = Array.from(items).indexOf(selected);

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (selected) selected.classList.remove('selected');
            const next = items[Math.min(selectedIdx + 1, items.length - 1)];
            if (next) next.classList.add('selected');
            return;
        }

        if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (selected) selected.classList.remove('selected');
            const prev = items[Math.max(selectedIdx - 1, 0)];
            if (prev) prev.classList.add('selected');
            return;
        }

        if (e.key === 'Enter' && selected) {
            e.preventDefault();
            executeCommand(selected.dataset.command);
            return;
        }

        if (e.key === 'Escape') {
            e.preventDefault();
            palette.classList.remove('active');
            this.value = '';
            return;
        }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
}

// ============================================================================
// Live Updates
// ============================================================================
function startLiveUpdates() {
    refreshInterval = setInterval(checkForUpdates, 2000);
}

function toggleLiveUpdates() {
    const indicator = document.getElementById('liveIndicator');
    if (refreshInterval) {
        clearInterval(refreshInterval);
        refreshInterval = null;
        indicator.classList.add('paused');
        indicator.querySelector('span:last-child').textContent = 'Paused';
    } else {
        startLiveUpdates();
        indicator.classList.remove('paused');
        indicator.querySelector('span:last-child').textContent = 'Live';
    }
}

async function checkForUpdates() {
    if (!sessionId) return;

    try {
        const response = await fetch(`/api/session/${sessionId}`);
        if (!response.ok) return;

        const data = await response.json();
        const newCount = data.messages ? data.messages.length : 0;

        if (newCount > lastMessageCount) {
            lastMessageCount = newCount;
            renderMessages(data.messages);
            updateStatus(newCount);
        }
    } catch (e) {
        console.error('Update check failed:', e);
    }
}

function updateStatus(count) {
    lastUpdateTime = new Date();
    document.getElementById('lastUpdate').textContent = `Updated ${lastUpdateTime.toLocaleTimeString()}`;
    document.getElementById('messageCount').textContent = `${count} messages`;
}

// ============================================================================
// Session History
// ============================================================================
async function loadSessionHistory() {
    if (!sessionId) return;

    try {
        const response = await fetch(`/api/session/${sessionId}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const data = await response.json();

        if (data.messages && data.messages.length > 0) {
            document.getElementById('emptyState').style.display = 'none';
            lastMessageCount = data.messages.length;
            renderMessages(data.messages);
            updateStatus(data.messages.length);
        } else {
            document.getElementById('emptyState').innerHTML = '<h2>Empty session</h2><p>No messages yet</p>';
        }
    } catch (e) {
        console.error('Failed to load session:', e);
        document.getElementById('emptyState').innerHTML = `<h2>Error</h2><p>${e.message}</p>`;
    }
}

function renderMessages(messages) {
    const container = document.getElementById('messages');
    const emptyState = document.getElementById('emptyState');

    container.innerHTML = '';
    container.appendChild(emptyState);

    let toolBuffer = [];
    let lastUserMsg = null;

    messages.forEach((msg) => {
        const content = msg.content || '';
        if (!content.trim()) return;

        // Check if it's a tool call or tool result
        const isTool = content.startsWith('[Tool:') || content.startsWith('[Result]') || content.startsWith('[Summary]')
            || (content.includes('[Tool:') && content.trim().split('\n').every(line => !line.trim() || line.includes('[Tool:') || line.includes('[Result]')));

        if (isTool) {
            toolBuffer.push(content);
            return;
        }

        // Flush tool buffer before non-tool message
        if (toolBuffer.length > 0) {
            addToolSummary(toolBuffer);
            toolBuffer = [];
        }

        // Skip duplicate user messages
        if (msg.type === 'user') {
            if (lastUserMsg === content) return;
            lastUserMsg = content;
        }

        addMessageToUI(msg.type, content, msg.timestamp);
    });

    // Flush remaining tools
    if (toolBuffer.length > 0) {
        addToolSummary(toolBuffer);
    }

    if (messages.length > 0) {
        emptyState.style.display = 'none';
    }

    if (autoScroll) {
        scrollToBottom();
    }
}

// ============================================================================
// Tool Summary Widget
// ============================================================================
function addToolSummary(tools) {
    const container = document.getElementById('messages');
    const div = document.createElement('div');
    div.className = 'tool-summary';

    const count = tools.length;

    // Create header
    const header = document.createElement('div');
    header.className = 'tool-summary-header';
    header.innerHTML = `<span class="tool-summary-icon">▶</span> ${count} tool calls <span class="tool-summary-hint">(tap to expand)</span>`;
    div.appendChild(header);

    // Create details container (hidden by default)
    const details = document.createElement('div');
    details.className = 'tool-summary-details';
    details.style.display = 'none';

    tools.forEach(t => {
        const item = document.createElement('div');
        item.className = 'tool-summary-item';
        item.textContent = t.slice(0, 150);
        details.appendChild(item);
    });
    div.appendChild(details);

    // Toggle on click
    let expanded = false;
    div.addEventListener('click', function(e) {
        e.stopPropagation();
        expanded = !expanded;
        if (expanded) {
            header.querySelector('.tool-summary-icon').textContent = '▼';
            header.querySelector('.tool-summary-hint').textContent = '(tap to collapse)';
            details.style.display = 'block';
        } else {
            header.querySelector('.tool-summary-icon').textContent = '▶';
            header.querySelector('.tool-summary-hint').textContent = '(tap to expand)';
            details.style.display = 'none';
        }
    });

    container.appendChild(div);
}

// ============================================================================
// Message UI
// ============================================================================
function addMessageToUI(type, content, timestamp = null) {
    const container = document.getElementById('messages');
    document.getElementById('emptyState').style.display = 'none';

    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${type}`;

    const formattedContent = formatContent(content);

    let timeStr = '';
    if (timestamp) {
        const date = new Date(timestamp * 1000);
        timeStr = `<div class="message-time">${date.toLocaleTimeString()}</div>`;
    }

    msgDiv.innerHTML = `<div class="message-content">${formattedContent}</div>${timeStr}`;
    container.appendChild(msgDiv);

    return msgDiv;
}

function formatContent(text) {
    if (!text) return '';

    let html = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    // Code blocks
    html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, '<pre><code>$2</code></pre>');
    // Inline code
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    // Bold
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    // Newlines
    html = html.replace(/\n/g, '<br>');

    return html;
}

function scrollToBottom() {
    const container = document.getElementById('messages');
    container.scrollTop = container.scrollHeight;
}

// ============================================================================
// Chat / WebSocket
// ============================================================================
async function sendMessage() {
    const input = document.getElementById('messageInput');
    const message = input.value.trim();
    const images = pendingImages.map(img => img.dataUrl);

    if (!message && images.length === 0) return;

    input.disabled = true;
    document.getElementById('sendBtn').disabled = true;

    const userMsgDiv = addMessageToUI('user', message);
    if (images.length > 0) {
        const imgHtml = images.map(url => `<img src="${url}" style="max-width:100px;max-height:100px;border-radius:8px;margin:4px">`).join('');
        userMsgDiv.innerHTML = userMsgDiv.innerHTML + imgHtml;
    }
    scrollToBottom();

    input.value = '';
    input.style.height = 'auto';
    pendingImages = [];
    updateImagePreviews();

    const chatId = Math.random().toString(36).substring(2, 10);
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/chat/${chatId}`;

    isStreaming = true;
    updateSendButton();

    try {
        chatWebSocket = new WebSocket(wsUrl);

        chatWebSocket.onopen = () => {
            chatWebSocket.send(JSON.stringify({
                agent: agentName,
                message: message,
                images: images,
                resume: !!sessionId,
                session_id: sessionId,
                mode: currentMode
            }));
        };

        chatWebSocket.onmessage = (event) => {
            handleChatMessage(JSON.parse(event.data));
        };

        chatWebSocket.onclose = () => finishStreaming();

        chatWebSocket.onerror = (e) => {
            console.error('[CHAT] WebSocket error:', e);
            addMessageToUI('system', 'Connection error. Please try again.');
            finishStreaming();
        };

    } catch (e) {
        console.error('[CHAT] Error:', e);
        addMessageToUI('system', `Error: ${e.message}`);
        finishStreaming();
    }
}

function handleChatMessage(data) {
    switch (data.type) {
        case 'chat_start':
            addLoadingIndicator();
            break;

        case 'text':
            removeLoadingIndicator();
            if (!currentStreamingMessage) {
                currentStreamingMessage = addMessageToUI('assistant', '');
                currentStreamingMessage.classList.add('streaming');
            }
            const contentDiv = currentStreamingMessage.querySelector('.message-content');
            contentDiv.innerHTML += formatContent(data.content);
            scrollToBottom();
            break;

        case 'tool_use':
            removeLoadingIndicator();
            addToolMessage(data.name, data.input);
            break;

        case 'tool_result':
            addToolResultMessage(data.name, data.result);
            break;

        case 'permission_request':
            removeLoadingIndicator();
            showPermissionPrompt(data);
            break;

        case 'permission_response_sent':
            hidePermissionPrompt();
            addMessageToUI('system', `Responded: ${data.response}`);
            addLoadingIndicator();
            break;

        case 'done':
            if (currentStreamingMessage) {
                currentStreamingMessage.classList.remove('streaming');
                currentStreamingMessage = null;
            }
            break;

        case 'chat_done':
            hidePermissionPrompt();
            finishStreaming();
            break;

        case 'error':
            removeLoadingIndicator();
            hidePermissionPrompt();
            addMessageToUI('system', `Error: ${data.message}`);
            finishStreaming();
            break;

        case 'raw':
            if (data.content) addMessageToUI('system', data.content);
            break;
    }
}

// ============================================================================
// Permission Handling
// ============================================================================
function showPermissionPrompt(data) {
    const prompt = document.getElementById('permissionPrompt');
    const toolEl = document.getElementById('permissionTool');
    const actionEl = document.getElementById('permissionAction');
    const optionsEl = document.getElementById('permissionOptions');
    const timeoutEl = document.getElementById('permissionTimeout');

    if (data.tool) {
        toolEl.textContent = data.tool;
        toolEl.style.display = 'inline-block';
    } else {
        toolEl.style.display = 'none';
    }

    actionEl.textContent = data.action || data.prompt || 'Permission required';

    const options = data.options || ['Yes', 'No'];
    optionsEl.innerHTML = options.map((opt, idx) => {
        let btnClass = 'permission-btn other';
        if (idx === 0 || opt.toLowerCase().includes('yes') || opt.toLowerCase() === 'y') {
            btnClass = 'permission-btn approve';
        } else if (opt.toLowerCase().includes('no') || opt.toLowerCase() === 'n') {
            btnClass = 'permission-btn deny';
        }
        return `<button class="${btnClass}" onclick="sendPermissionResponse('${opt}')">${opt}</button>`;
    }).join('');

    let secondsLeft = 300;
    timeoutEl.textContent = `Waiting for response... (${Math.floor(secondsLeft / 60)}:${(secondsLeft % 60).toString().padStart(2, '0')})`;

    if (permissionTimeoutId) clearInterval(permissionTimeoutId);
    permissionTimeoutId = setInterval(() => {
        secondsLeft--;
        if (secondsLeft <= 0) {
            clearInterval(permissionTimeoutId);
            timeoutEl.textContent = 'Timeout reached';
        } else {
            timeoutEl.textContent = `Waiting for response... (${Math.floor(secondsLeft / 60)}:${(secondsLeft % 60).toString().padStart(2, '0')})`;
        }
    }, 1000);

    prompt.classList.add('active');
    addMessageToUI('system', `⚠️ ${data.tool || 'Permission'}: ${data.action || data.prompt}`);
    scrollToBottom();
}

function hidePermissionPrompt() {
    document.getElementById('permissionPrompt').classList.remove('active');
    if (permissionTimeoutId) {
        clearInterval(permissionTimeoutId);
        permissionTimeoutId = null;
    }
}

function sendPermissionResponse(response) {
    if (chatWebSocket && chatWebSocket.readyState === WebSocket.OPEN) {
        chatWebSocket.send(JSON.stringify({
            type: 'permission_response',
            response: response
        }));
    }
    hidePermissionPrompt();
}

// ============================================================================
// Loading & Tool Messages
// ============================================================================
function addLoadingIndicator() {
    const container = document.getElementById('messages');
    if (document.getElementById('loadingIndicator')) return;

    const div = document.createElement('div');
    div.id = 'loadingIndicator';
    div.className = 'loading-indicator';
    div.innerHTML = `
        <div class="loading-dots">
            <span></span><span></span><span></span>
        </div>
        <span>Agent is thinking...</span>
    `;
    container.appendChild(div);
    scrollToBottom();
}

function removeLoadingIndicator() {
    const indicator = document.getElementById('loadingIndicator');
    if (indicator) indicator.remove();
}

function addToolMessage(name, input) {
    const container = document.getElementById('messages');
    const div = document.createElement('div');
    div.className = 'tool-detail';

    div.innerHTML = `
        <div class="tool-header" onclick="this.parentElement.classList.toggle('expanded')">
            <span class="tool-badge">${name}</span>
            <span class="tool-expand">▶</span>
        </div>
        <div class="tool-body">
            <div class="tool-input">
                <div class="tool-label">Input</div>
                ${JSON.stringify(input, null, 2)}
            </div>
        </div>
    `;
    container.appendChild(div);
    scrollToBottom();
}

function addToolResultMessage(name, result) {
    const container = document.getElementById('messages');
    const lastTool = container.querySelector('.tool-detail:last-of-type');
    if (lastTool) {
        const body = lastTool.querySelector('.tool-body');
        if (body) {
            const resultStr = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
            const preview = resultStr.substring(0, 500);
            body.innerHTML += `
                <div class="tool-output">
                    <div class="tool-label">Output</div>
                    ${preview}${resultStr.length > 500 ? '...' : ''}
                </div>
            `;
        }
    }
}

// ============================================================================
// Send Button State
// ============================================================================
function updateSendButton() {
    const btn = document.getElementById('sendBtn');
    if (isStreaming) {
        btn.classList.add('stop-btn');
        btn.innerHTML = '■';
        btn.onclick = stopStreaming;
    } else {
        btn.classList.remove('stop-btn');
        btn.innerHTML = '→';
        btn.onclick = sendMessage;
    }
}

function stopStreaming() {
    if (chatWebSocket && chatWebSocket.readyState === WebSocket.OPEN) {
        chatWebSocket.send(JSON.stringify({ type: 'stop' }));
    }
    finishStreaming();
}

function finishStreaming() {
    isStreaming = false;
    currentStreamingMessage = null;
    removeLoadingIndicator();

    document.getElementById('messageInput').disabled = false;
    document.getElementById('sendBtn').disabled = false;
    updateSendButton();

    if (chatWebSocket) {
        chatWebSocket.close();
        chatWebSocket = null;
    }

    if (sessionId) {
        setTimeout(() => loadSessionHistory(), 500);
    }
}

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', initChat);
