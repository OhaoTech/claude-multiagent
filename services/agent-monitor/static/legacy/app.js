/**
 * Agent Monitor - WebSocket Client
 */

class AgentMonitor {
    constructor() {
        this.ws = null;
        this.reconnectDelay = 1000;
        this.maxReconnectDelay = 30000;
        this.activities = [];
        this.maxActivities = 50;
        this.agents = {};
        this.currentState = {};

        this.init();
    }

    init() {
        this.connectWebSocket();
        this.setupEventListeners();
    }

    connectWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws`;

        console.log('Connecting to:', wsUrl);

        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
            console.log('WebSocket connected');
            this.setConnectionStatus(true);
            this.reconnectDelay = 1000;
        };

        this.ws.onclose = () => {
            console.log('WebSocket closed');
            this.setConnectionStatus(false);
            this.scheduleReconnect();
        };

        this.ws.onerror = (error) => {
            console.error('WebSocket error:', error);
        };

        this.ws.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                this.handleMessage(message);
            } catch (e) {
                console.error('Failed to parse message:', e);
            }
        };
    }

    scheduleReconnect() {
        setTimeout(() => {
            console.log('Reconnecting...');
            this.connectWebSocket();
        }, this.reconnectDelay);

        this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
    }

    setConnectionStatus(connected) {
        const dot = document.getElementById('connectionDot');
        const text = document.getElementById('connectionText');

        if (connected) {
            dot.classList.add('connected');
            text.textContent = 'Connected';
        } else {
            dot.classList.remove('connected');
            text.textContent = 'Disconnected';
        }
    }

    handleMessage(message) {
        console.log('Received:', message.type, message.data);

        switch (message.type) {
            case 'connected':
                this.handleConnected(message.data);
                break;
            case 'state':
                this.handleState(message.data);
                break;
            case 'result':
                this.handleResult(message.data);
                break;
            case 'output':
                this.handleOutput(message.data);
                break;
            case 'command_ack':
                this.handleCommandAck(message.data);
                break;
        }
    }

    handleConnected(data) {
        if (data.state) {
            this.handleState(data.state);
        }
        if (data.agents) {
            this.updateAgentsGrid(data.agents);
        }
        this.addActivity('connected', { message: 'Connected to monitor' });
    }

    handleState(state) {
        this.currentState = state;
        this.updateStateBanner(state);
        this.addActivity('state', state);
    }

    handleResult(data) {
        this.addActivity('result', data);
        this.updateAgentCard(data.agent, { lastStatus: data.status });
    }

    handleOutput(data) {
        this.addActivity('output', data);
    }

    handleCommandAck(data) {
        this.addActivity('command', data);
    }

    updateStateBanner(state) {
        const banner = document.getElementById('stateBanner');
        const agent = document.getElementById('stateAgent');
        const task = document.getElementById('stateTask');
        const meta = document.getElementById('stateMeta');

        if (state.current) {
            banner.classList.add('running');
            agent.textContent = `${state.current} (running)`;
            task.textContent = state.task || '';

            if (state.started) {
                const elapsed = Math.floor((Date.now() / 1000) - state.started);
                meta.textContent = `Started ${this.formatDuration(elapsed)} ago`;
            }
        } else {
            banner.classList.remove('running');

            if (state.last) {
                const statusIcon = state.status === 'success' ? '' : '';
                agent.textContent = `${state.last} (${state.status})`;
            } else {
                agent.textContent = 'No active agent';
            }
            task.textContent = '';
            meta.textContent = '';
        }
    }

    updateAgentsGrid(agents) {
        const grid = document.getElementById('agentsGrid');
        grid.innerHTML = '';

        agents.forEach(agent => {
            this.agents[agent.name] = agent;

            const card = document.createElement('div');
            card.className = 'agent-card';
            card.id = `agent-${agent.name}`;

            // Leader gets special styling
            if (agent.name === 'leader') {
                card.classList.add('leader');
            }

            if (agent.last_result) {
                card.classList.add(agent.last_result.status === 'success' ? 'success' : 'failed');
            }

            if (this.currentState.current === agent.name) {
                card.classList.add('active');
            }

            card.innerHTML = `
                <div class="agent-name">${agent.name}</div>
                <div class="agent-domain">${agent.domain}</div>
                <div class="agent-stats">${agent.result_count} runs</div>
                <div class="chat-hint">Tap to view sessions →</div>
            `;

            card.onclick = () => {
                // Navigate to sessions page for this agent
                window.location.href = `/agent/${agent.name}`;
            };

            grid.appendChild(card);
        });
    }

    updateAgentCard(agentName, updates) {
        const card = document.getElementById(`agent-${agentName}`);
        if (!card) return;

        if (updates.lastStatus) {
            card.classList.remove('success', 'failed');
            card.classList.add(updates.lastStatus === 'success' ? 'success' : 'failed');
        }
    }

    addActivity(type, data) {
        const activity = {
            type,
            data,
            timestamp: Date.now()
        };

        this.activities.unshift(activity);
        if (this.activities.length > this.maxActivities) {
            this.activities.pop();
        }

        this.renderActivities();
    }

    renderActivities() {
        const feed = document.getElementById('activityFeed');

        if (this.activities.length === 0) {
            feed.innerHTML = '<div class="empty-state">Waiting for activity...</div>';
            return;
        }

        feed.innerHTML = this.activities.map(activity => {
            const time = new Date(activity.timestamp).toLocaleTimeString();
            const content = this.formatActivityContent(activity);

            return `
                <div class="activity-item">
                    <span class="activity-type ${activity.type}">${activity.type}</span>
                    <span class="activity-time">${time}</span>
                    <div class="activity-content">${content}</div>
                </div>
            `;
        }).join('');
    }

    formatActivityContent(activity) {
        const { type, data } = activity;

        switch (type) {
            case 'connected':
                return data.message || 'Connected';

            case 'state':
                if (data.current) {
                    return `<strong>${data.current}</strong> started: ${data.task || '(no task)'}`;
                } else if (data.last) {
                    return `<strong>${data.last}</strong> ${data.status}`;
                }
                return 'State updated';

            case 'result':
                return `<strong>${data.agent}</strong> ${data.status}: ${data.summary || data.file}`;

            case 'output':
                const cost = data.cost_usd ? ` ($${data.cost_usd.toFixed(2)})` : '';
                return `<strong>${data.agent}</strong> completed in ${this.formatDuration(data.duration_ms / 1000)}${cost}`;

            case 'command':
                return `Command sent to <strong>${data.agent}</strong>: ${data.content}`;

            default:
                return JSON.stringify(data);
        }
    }

    formatDuration(seconds) {
        if (seconds < 60) return `${Math.floor(seconds)}s`;
        if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`;
        return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
    }

    setupEventListeners() {
        const input = document.getElementById('commandInput');
        const sendBtn = document.getElementById('sendBtn');

        sendBtn.onclick = () => this.sendMessage();

        input.onkeydown = (e) => {
            if (e.key === 'Enter') {
                this.sendMessage();
            }
        };

        // Stop button
        document.getElementById('chatStopBtn').onclick = () => this.stopChat();
    }

    async sendMessage() {
        const agent = document.getElementById('agentSelect').value;
        const input = document.getElementById('commandInput');
        const content = input.value.trim();

        if (!content) return;

        // Clear input
        input.value = '';
        input.disabled = true;
        document.getElementById('sendBtn').disabled = true;

        // Show response area
        const responseDiv = document.getElementById('chatResponse');
        const responseContent = document.getElementById('chatResponseContent');
        const responseTitle = document.getElementById('chatResponseTitle');

        responseDiv.classList.add('active');
        responseContent.innerHTML = '';
        responseTitle.textContent = `Chatting with ${agent}...`;

        // Create chat ID and connect WebSocket
        const chatId = Math.random().toString(36).substring(2, 10);
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws/chat/${chatId}`;

        console.log('[CHAT] Connecting to:', wsUrl);

        this.chatWs = new WebSocket(wsUrl);

        this.chatWs.onopen = () => {
            console.log('[CHAT] WebSocket connected, sending message');
            this.chatWs.send(JSON.stringify({
                agent: agent,
                message: content,
                images: [],
                resume: true
            }));
        };

        this.chatWs.onmessage = (event) => {
            const data = JSON.parse(event.data);
            this.handleChatMessage(data);
        };

        this.chatWs.onclose = () => {
            console.log('[CHAT] WebSocket closed');
            this.finishChat();
        };

        this.chatWs.onerror = (e) => {
            console.error('[CHAT] WebSocket error:', e);
            responseContent.innerHTML += '<div style="color: var(--error)">Connection error</div>';
            this.finishChat();
        };
    }

    handleChatMessage(data) {
        const responseContent = document.getElementById('chatResponseContent');
        const responseTitle = document.getElementById('chatResponseTitle');

        switch (data.type) {
            case 'chat_start':
                responseTitle.textContent = `${data.agent} is responding...`;
                break;

            case 'text':
                responseContent.innerHTML += this.escapeHtml(data.content);
                responseContent.scrollTop = responseContent.scrollHeight;
                break;

            case 'tool_use':
                responseContent.innerHTML += `<div class="chat-response-tool">🔧 ${data.name}</div>`;
                responseContent.scrollTop = responseContent.scrollHeight;
                break;

            case 'tool_result':
                // Optionally show tool results
                break;

            case 'chat_done':
                responseTitle.textContent = 'Response complete';
                this.finishChat();
                break;

            case 'error':
                responseContent.innerHTML += `<div style="color: var(--error)">Error: ${data.message}</div>`;
                this.finishChat();
                break;
        }
    }

    stopChat() {
        if (this.chatWs && this.chatWs.readyState === WebSocket.OPEN) {
            this.chatWs.send(JSON.stringify({ type: 'stop' }));
        }
        this.finishChat();
    }

    finishChat() {
        document.getElementById('commandInput').disabled = false;
        document.getElementById('sendBtn').disabled = false;

        if (this.chatWs) {
            this.chatWs.close();
            this.chatWs = null;
        }

        // Hide response area after a delay
        setTimeout(() => {
            document.getElementById('chatResponse').classList.remove('active');
        }, 5000);
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Initialize on load
document.addEventListener('DOMContentLoaded', () => {
    window.monitor = new AgentMonitor();
});
