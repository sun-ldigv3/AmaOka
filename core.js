const WebSocket = require('ws');
const { CONFIG, bot } = require('./status');

module.exports = {
    shouldAddPlaceholder(text) {
        return text && text.includes('\n');
    },

    sendWSMessage(data, ignoreLimit = false, ignoreMute = false) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        if (this.selfMuteUntil && this.selfMuteUntil > Date.now()) return;
        if (this.isMuted && !ignoreMute) return;
        if (!ignoreLimit && !this.tokenBucket.consume()) return;
        this.ws.send(JSON.stringify(data));
    },

    sendChat(text, ignoreMute = false) {
        if (!text) return;
        this.sendWSMessage({ cmd: 'chat', text, clientId: this.clientId }, false, ignoreMute);
    },

    sendMessage(text, customId, ignoreMute = false) {
        if (!text) return;
        const payload = { cmd: 'chat', text, clientId: this.clientId };
        if (customId) payload.customId = customId;
        this.sendWSMessage(payload, false, ignoreMute);
    },

    sendWhisper(to, text, noPlaceholder = false) {
        if (!to || !text) return;
        const finalText = !noPlaceholder && this.shouldAddPlaceholder(text) && !text.startsWith(this.placeholder)
            ? `${this.placeholder}\n${text}` : text;
        this.sendWSMessage({ cmd: 'whisper', nick: to, text: finalText }, false, true);
    },

    selfMute(seconds) {
        if (this.selfMuteTimer) {
            clearTimeout(this.selfMuteTimer);
            this.selfMuteTimer = null;
        }
        this.selfMuteUntil = Date.now() + seconds * 1000;
        console.log(`[自我休眠] ${seconds} 秒，至 ${new Date(this.selfMuteUntil).toLocaleTimeString()}`);
        this.selfMuteTimer = setTimeout(() => {
            this.selfMuteUntil = null;
            this.selfMuteTimer = null;
            console.log('[自我休眠] 结束');
        }, seconds * 1000);
    },

    connectWS() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        this.inChannel = false;
        if (this.ws) {
            try {
                this.ws.removeAllListeners();
                if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
                    this.ws.close(1000, 'reconnect');
                }
            } catch(e) {
                console.error('[关闭旧连接失败]', e.message);
            }
            this.ws = null;
        }
        const ws = new WebSocket(CONFIG.server);
        this.ws = ws;
        ws.on('open', () => {
            if (this.ws !== ws) return;
            console.log(`[连接成功] ${CONFIG.channel}`);
            this.connectedAt = Date.now();
            this.lastAliveMs = Date.now();
            this.isReconnecting = false;
            this.joinChannel();
        });
        ws.on('pong', () => {
            if (this.ws !== ws) return;
            this.lastAliveMs = Date.now();
            this.idleStrikes = 0;
            if (this._pingSentAt) this.lastPingMs = Date.now() - this._pingSentAt;
        });
        ws.on('message', (data) => {
            this.lastAliveMs = Date.now();
            this.idleStrikes = 0;
            try {
                const msg = JSON.parse(data.toString());
                CONFIG.debug && console.log('[接收]', msg);
                this.handleOfficialCommands(msg);
            } catch (err) {
                console.error('[解析失败]', err);
            }
        });
        ws.on('close', (code, reason) => {
            console.log(`[连接关闭] ${code} ${reason}`);
            this.inChannel = false;
            if (this.ws === ws) this.ws = null;
            if (!this.stopped) {
                const aliveTime = this.connectedAt ? Date.now() - this.connectedAt : 0;
                if (aliveTime >= CONFIG.CONST.minConnectionAliveMs) this.reconnectAttempts = 0;
                const delay = Math.min(
                    CONFIG.CONST.reconnectBaseDelay * Math.pow(2, this.reconnectAttempts),
                    CONFIG.CONST.reconnectMaxDelay
                );
                this.reconnectAttempts++;
                console.log(`[重连] ${delay/1000}s 后重试 (第${this.reconnectAttempts}次)`);
                this.isReconnecting = true;
                this.reconnectTimer = setTimeout(() => {
                    this.reconnectTimer = null;
                    this.isReconnecting = false;
                    this.connectWS();
                }, delay);
            } else {
                console.log(`[${CONFIG.botNick}] 停止`);
            }
        });
        ws.on('error', (err) => {
            if (this.ws !== ws) return;
            console.error('[WS错误]', err);
        });
    },

    joinChannel() {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        if (this.inChannel) return;
        if (Date.now() - this.lastJoinTime < 5000) return;
        this.lastJoinTime = Date.now();
        const nickWithTrip = CONFIG.botTrip ? `${CONFIG.botNick}#${CONFIG.botTrip}` : CONFIG.botNick;
        this.sendWSMessage({ cmd: 'join', channel: CONFIG.channel, nick: nickWithTrip, clientId: this.clientId }, true, true);
        this.sendColorCommand();
    },

    sendColorCommand() {
        if (!CONFIG.color?.enable) return;
        const colorHex = CONFIG.color.hex?.trim() || '';
        if (!/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/.test(colorHex)) return;
        this.sendWSMessage({ cmd: 'chat', text: `/color ${colorHex}`, clientId: this.clientId }, true, true);
    },

    handleOfficialCommands(msg) {
        try {
            if (msg.channel && msg.channel !== CONFIG.channel && this.inChannel && !this.pendingTransient) {
                console.log(`[被踢] 频道变为 ${msg.channel}，重连回 ${CONFIG.channel}`);
                this.inChannel = false;
                if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
                    this.ws.close(1000, 'kicked');
                }
                return;
            }
            if (msg.cmd === 'warn') {
                this.handleWarn(msg);
                return;
            }
            if (msg.cmd === 'error') {
                this.handleServerError(msg);
                return;
            }
            if (this.onRawMessage) this.onRawMessage(msg);
        } catch (err) {
            console.error('[消息处理错误]', err);
            this.logMessage(`ERROR: ${err.stack}`);
        }
    },

    handleWarn(msg) {
        const text = msg.text || '';
        console.log(`[WARN] ${text}`);
        if (text === 'Nickname taken') {
            const baseNick = CONFIG.botNick.split('_')[0];
            const newNick = baseNick + '_' + Math.random().toString(36).slice(2, 6);
            console.log(`[昵称被占] 尝试改为 ${newNick}`);
            this.sendWSMessage({ cmd: 'chat', text: `/kick ${CONFIG.botNick}`, clientId: this.clientId }, true, true);
            CONFIG.botNick = newNick;
            this.selfMute(5);
            setTimeout(() => this.connectWS(), 6000);
        } else if (/^You are (?:be|join|send)ing/.test(text)) {
            this.selfMute(30);
        }
    },

    handleServerError(msg) {
        if (msg.error === 'rateLimited') {
            const sleepSec = Math.floor(Math.random() * 31) + 30;
            this.selfMute(sleepSec);
            return;
        }
        this.sendChat(`服务端错误：${msg.error}`);
    },

    measurePing() {
        return new Promise((resolve) => {
            const ws = this.ws;
            if (!ws || ws.readyState !== WebSocket.OPEN) return resolve(this.lastPingMs);
            const start = Date.now();
            const done = (val) => {
                clearTimeout(timer);
                ws.off('pong', onPong);
                resolve(val);
            };
            const onPong = () => {
                this.lastPingMs = Date.now() - start;
                done(this.lastPingMs);
            };
            const timer = setTimeout(() => done(this.lastPingMs), 3000);
            ws.once('pong', onPong);
            try { ws.ping(); } catch (e) { done(this.lastPingMs); }
        });
    },

    startKeepAlive() {
        this.scheduledIntervals.push(setInterval(() => {
            this.sendWhisper(CONFIG.botNick, 'w');
        }, CONFIG.CONST.pingIntervalMs));
        this.scheduledIntervals.push(setInterval(() => {
            if (!this.inChannel && this.ws && this.ws.readyState === WebSocket.OPEN &&
                !this.isReconnecting &&
                (!this.selfMuteUntil || this.selfMuteUntil <= Date.now()) &&
                Date.now() - this.lastJoinTime > 15000) {
                console.log('[保活] 尝试重新加入频道');
                this.joinChannel();
            }
        }, 60000));
        this.scheduledIntervals.push(setInterval(() => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this._pingSentAt = Date.now();
                try { this.ws.ping(); } catch(e) {}
            }
        }, CONFIG.CONST.pingIntervalMs));
        this.scheduledIntervals.push(setInterval(() => {
            this.checkWatchdog();
        }, CONFIG.CONST.watchdogIntervalMs));
    },

    checkWatchdog() {
        try {
            if (!this.ws || this.ws.readyState !== WebSocket.OPEN) { this.idleStrikes = 0; return; }
            if (this.isReconnecting) return;
            if (Date.now() - (this.connectedAt || 0) < CONFIG.CONST.watchdogGraceMs) return;
            const idle = Date.now() - (this.lastAliveMs || Date.now());
            if (idle > CONFIG.CONST.aliveTimeoutMs) {
                this.idleStrikes++;
                console.log(`[保活] 连接无响应 ${Math.floor(idle/1000)}s（第${this.idleStrikes}次）`);
                if (this.idleStrikes >= 2) {
                    this.idleStrikes = 0;
                    console.log('[保活] 连续无响应，强制重连');
                    try { this.ws.terminate(); } catch(e) {}
                }
            } else {
                this.idleStrikes = 0;
            }
        } catch (err) {
            console.error('[保活检查错误]', err);
        }
    },
};

class AFKClient {
    constructor(bot, cfg) {
        this.bot = bot;
        this.nick = cfg.nick;
        this.trip = cfg.trip || '';
        this.channel = cfg.channel;
        this.loginNick = this.trip ? `${this.nick}#${this.trip}` : this.nick;
        this.ws = null;
        this.reconnectTimer = null;
        this.keepAliveTimer = null;
        this.watchdogTimer = null;
        this.connected = false;
        this.stopped = false;
        this.lastAliveMs = 0;
        this.connectedAt = 0;
        this.idleStrikes = 0;
        this.reconnectAttempts = 0;
    }
    connect() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        this.clearKeepAlive();
        const ws = new WebSocket(CONFIG.server);
        this.ws = ws;
        ws.on('open', () => {
            if (this.ws !== ws) return;
            this.connected = true;
            this.connectedAt = Date.now();
            this.lastAliveMs = Date.now();
            this.reconnectAttempts = 0;
            this.startKeepAlive();
            ws.send(JSON.stringify({ cmd: 'join', channel: this.channel, nick: this.loginNick }));
            console.log(`[分身] ${this.loginNick} 已加入 ${this.channel}`);
        });
        ws.on('pong', () => {
            if (this.ws !== ws) return;
            this.lastAliveMs = Date.now();
            this.idleStrikes = 0;
        });
        ws.on('message', (data) => {
            this.lastAliveMs = Date.now();
            this.idleStrikes = 0;
            try {
                const msg = JSON.parse(data.toString());
                if (msg.cmd === 'warn' && msg.text === 'Nickname taken') {
                    console.log(`[分身] ${this.loginNick} 昵称被占用`);
                    this.bot.sendChat(`分身 ${this.loginNick} 昵称被占用`);
                }
            } catch (err) {}
        });
        ws.on('close', () => {
            if (this.ws === ws) this.ws = null;
            this.connected = false;
            this.clearKeepAlive();
            if (this.stopped) return;
            const aliveTime = this.connectedAt ? Date.now() - this.connectedAt : 0;
            if (aliveTime >= CONFIG.CONST.minConnectionAliveMs) this.reconnectAttempts = 0;
            const delay = Math.min(5000 * Math.pow(2, this.reconnectAttempts), CONFIG.CONST.reconnectMaxDelay);
            this.reconnectAttempts++;
            console.log(`[分身] ${this.loginNick} 连接断开，${Math.floor(delay/1000)}s 后重连`);
            this.reconnectTimer = setTimeout(() => this.connect(), delay);
        });
        ws.on('error', (err) => {
            if (this.ws !== ws) return;
            console.error(`[分身错误] ${this.loginNick}: ${err.message}`);
        });
    }
    startKeepAlive() {
        this.clearKeepAlive();
        this.keepAliveTimer = setInterval(() => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                try { this.ws.ping(); } catch(e) {}
            }
        }, CONFIG.CONST.pingIntervalMs);
        this.watchdogTimer = setInterval(() => {
            this.checkWatchdog();
        }, CONFIG.CONST.watchdogIntervalMs);
    }
    checkWatchdog() {
        try {
            if (!this.ws || this.ws.readyState !== WebSocket.OPEN) { this.idleStrikes = 0; return; }
            if (Date.now() - (this.connectedAt || 0) < CONFIG.CONST.watchdogGraceMs) return;
            if (this.lastAliveMs && Date.now() - this.lastAliveMs > CONFIG.CONST.afkAliveTimeoutMs) {
                this.idleStrikes++;
                console.log(`[分身] ${this.loginNick} 无响应 ${Math.floor((Date.now()-this.lastAliveMs)/1000)}s（第${this.idleStrikes}次）`);
                if (this.idleStrikes >= 2) {
                    this.idleStrikes = 0;
                    console.log(`[分身] ${this.loginNick} 连续无响应，强制重连`);
                    try { this.ws.terminate(); } catch(e) {}
                }
            } else {
                this.idleStrikes = 0;
            }
        } catch (err) {}
    }
    clearKeepAlive() {
        if (this.keepAliveTimer) {
            clearInterval(this.keepAliveTimer);
            this.keepAliveTimer = null;
        }
        if (this.watchdogTimer) {
            clearInterval(this.watchdogTimer);
            this.watchdogTimer = null;
        }
    }
    close() {
        this.stopped = true;
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        this.clearKeepAlive();
        if (this.ws) {
            try { this.ws.terminate(); } catch (e) {}
            this.ws = null;
        }
    }
}

module.exports.AFKClient = AFKClient;
