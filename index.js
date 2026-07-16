const WebSocket = require('ws');
const fetch = require('node-fetch');
const fs = require('fs-extra');
const { Mutex } = require('async-mutex');
const path = require('path');
const vm = require('vm');

class LocalStorageMock {
    constructor(storagePath = './storage.json') {
        this.storagePath = storagePath;
        this.data = {};
        this.mutex = new Mutex();
        try {
            if (fs.existsSync(this.storagePath)) {
                this.data = JSON.parse(fs.readFileSync(this.storagePath, 'utf8'));
            }
        } catch (err) {
            this.data = {};
        }
    }
    getItem(key) {
        return this.data[key] || null;
    }
    async setItem(key, value) {
        const release = await this.mutex.acquire();
        try {
            this.data[key] = value;
            await fs.writeFile(this.storagePath, JSON.stringify(this.data, null, 2));
        } finally {
            release();
        }
    }
    getSync(key) {
        return this.data[key] || null;
    }
    async setItemSafe(key, value) {
        return this.setItem(key, value);
    }
    setSync(key, value) {
        this.data[key] = value;
        try {
            fs.writeFileSync(this.storagePath, JSON.stringify(this.data, null, 2));
        } catch (err) {}
    }
}

const localStorage = new LocalStorageMock();

const CONFIG = {
    server: "wss://hack.chat/chat-ws",
    channel: "lounge",
    botNick: "AmaOka",
    botTrip: "",
    debug: false,
    color: { enable: true, hex: "#5ee6ed" },
    ly: {
        expireDays: 7,
        storageKey: `bot_lyMessages`
    },
    CONST: {
        ADMIN_TRIPCODE: '2UE++I',
        NORMAL_PREFIX: '!',
        MOD_PREFIX: ';',
        ADMIN_PREFIX: '.',
        muteCheckInterval: 10000,
        maxMsgHistory: 5000,
        latestMsgCount: 5,
        welcomeMsg: "hi %s",
        styleTemplates: {
            questionReplies: ['我也很不解', '我也很困惑', '不清楚', '是这样吗', '?', '？'],
            exclaimReplies: ['嘿嘿，这也太精彩了吧', '哎呦，不错哦', '哈哈，这波我给满分'],
            greetingReplies: ['嗨，大家好呀～', '在的，有事喊你', '你好呀，今天也要加油哦'],
            smallTalkReplies: ['嗯哼~', '哦哦', '了解啦']
        },
        periodic: {
            includeYiyan: true,
            includeStyle: true,
            includeTriviaAuto: false
        },
        timestampExpireHours: 1,
        userActivityExpireHours: 24,
        bodyParts: ['heart', 'head', 'chest', 'lung', 'stomach', 'arm', 'leg', 'hand', 'foot', 'neck', 'shoulder', 'knee', 'eye', 'ear', 'mouth', 'throat', 'brain', 'liver', 'rib', 'spine'],
        timezoneOffset: 8,
        slowModeDefault: 3,
        logDir: './logs',
        adminLogMax: 100,
        maxLogAge: 30,
        emojiList: ['😀','😂','🤣','😍','😎','🥳','😜','😇','🤔','😅','😉','😘','🥰','😋','🤗','🙃','😏','😌','😔','😪','🤩','🥺','😤','😭','😱','🤯','😳','🥵','😈','💀'],
        hashPageSize: 10,
        msgTruncateLen: 100,
        codeTruncateLen: 500,
        codeMaxInputLen: 1000,
        primeMaxLen: 15,
        maxWordCount: 10000,
        maxLastSeen: 10000,
        maxHashNickCount: 100,
        recentTimestampsMax: 1000,
        maxLogFiles: 30,
        reconnectBaseDelay: 1000,
        reconnectMaxDelay: 60000,
        saveIntervalMs: 5000
    }
};

const PLACEHOLDER = '(｡•ᴗ•｡)';
const ADMIN_ACTION = '(｀へ´)';
const STAR = '(⭐)';
let BOT_START_TIME = Date.now();

class RateLimiter {
    constructor(halflife, threshold) {
        this.halflife = halflife;
        this.threshold = threshold;
        this.records = new Map();
        this.enabled = true;
    }
    fscore(score, lastTime, delta = 1) {
        score *= Math.pow(2, (lastTime - Date.now()) / this.halflife);
        return score + delta;
    }
    frisk(name, delta) {
        if (!this.enabled) return false;
        let record = this.records.get(name);
        if (!record) record = { score: 0, time: Date.now() };
        record.score = this.fscore(record.score, record.time, delta);
        record.time = Date.now();
        this.records.set(name, record);
        return record.score >= this.threshold;
    }
    setParams(halflife, threshold) {
        this.halflife = halflife;
        this.threshold = threshold;
    }
    setEnabled(enabled) {
        this.enabled = enabled;
    }
}

class TokenBucket {
    constructor(maxTokens = 10, refillInterval = 500) {
        this.maxTokens = maxTokens;
        this.refillInterval = refillInterval;
        this.tokens = maxTokens;
        this.lastRefill = Date.now();
    }
    refill() {
        const now = Date.now();
        const elapsed = now - this.lastRefill;
        const tokensToAdd = Math.floor(elapsed / this.refillInterval);
        if (tokensToAdd > 0) {
            this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd);
            this.lastRefill = now;
        }
    }
    consume() {
        this.refill();
        if (this.tokens > 0) {
            this.tokens--;
            return true;
        }
        return false;
    }
}

const CMD_CONFIG = {
    help: { trigger: ['help', 'h'], desc: '查看命令', level: 'normal', params: '[命令名]' },
    roll: { trigger: ['roll'], desc: '掷骰子', level: 'normal', params: '[NdM 或 min-max]' },
    afk: { trigger: ['afk'], desc: '设置/取消离开状态', level: 'normal', params: '[原因]' },
    online: { trigger: ['online'], desc: '查看在线用户', level: 'normal', params: '' },
    msg: { trigger: ['msg', 'msglist'], desc: '查看历史数量或查询范围', level: 'normal', params: '[N1 N2]' },
    user: { trigger: ['user', 'userinfo'], desc: '查询用户信息', level: 'normal', params: '[昵称]' },
    stats: { trigger: ['stats'], desc: '活跃度统计', level: 'normal', params: '' },
    save: { trigger: ['save'], desc: '导出聊天记录', level: 'normal', params: '' },
    clear: { trigger: ['clear'], desc: '清空本地历史', level: 'normal', params: '' },
    calc: { trigger: ['calc', '计算'], desc: '简易计算器', level: 'normal', params: '<算式>' },
    weather: { trigger: ['weather', '天气'], desc: '查询天气', level: 'normal', params: '<城市>' },
    emoji: { trigger: ['emoji', '表情'], desc: '随机表情', level: 'normal', params: '' },
    yiyan: { trigger: ['yiyan', '一言'], desc: '随机一言', level: 'normal', params: '' },
    hash: { trigger: ['hash'], desc: '查询历史nick', level: 'normal', params: '<昵称> [页码]' },
    geth: { trigger: ['geth'], desc: '查询历史hash', level: 'normal', params: '<昵称> [页码]' },
    lookh: { trigger: ['lookh'], desc: '查看hash对应nick', level: 'normal', params: '<hash>' },
    color: { trigger: ['color'], desc: '查询颜色', level: 'normal', params: '[昵称]' },
    welc: { trigger: ['welc'], desc: '设置欢迎语', level: 'normal', params: '[欢迎语]' },
    seen: { trigger: ['seen'], desc: '最后发言', level: 'normal', params: '<昵称>' },
    look: { trigger: ['look'], desc: '用户分析', level: 'normal', params: '<昵称>' },
    peep: { trigger: ['peep'], desc: '查看历史消息', level: 'normal', params: '<起始> [结束]' },
    prime: { trigger: ['prime'], desc: '质因数分解', level: 'normal', params: '<数字>' },
    hug: { trigger: ['hug'], desc: '拥抱', level: 'normal', params: '<昵称>' },
    shoot: { trigger: ['shoot'], desc: '射击', level: 'normal', params: '<昵称>' },
    lori: { trigger: ['lori'], desc: '字符辨别', level: 'normal', params: '<字符>' },
    uwu: { trigger: ['uwu'], desc: '小猫笑', level: 'normal', params: '' },
    countdown: { trigger: ['countdown'], desc: '倒计时', level: 'normal', params: '<YYYY-MM-DD>' },
    meme: { trigger: ['meme'], desc: '随机梗图', level: 'normal', params: '' },
    left: { trigger: ['left'], desc: '留言系统', level: 'normal', params: '<trip|*nick> <内容>' },
    loog: { trigger: ['loog'], desc: '查看完整消息', level: 'normal', params: '<ID>' },
    sub: { trigger: ['sub'], desc: '订阅关键词', level: 'normal', params: '<关键词>' },
    unsub: { trigger: ['unsub'], desc: '取消订阅关键词', level: 'normal', params: '<关键词>' },
    subs: { trigger: ['subs'], desc: '查看我的订阅', level: 'normal', params: '' },
    vote: { trigger: ['vote'], desc: '投票系统', level: 'normal', params: '<子命令>' },
    topwords: { trigger: ['topwords'], desc: '热词统计', level: 'normal', params: '[数量]' },
    kkme: { trigger: ['kkme'], desc: '踢出同识别码僵尸号', level: 'normal', params: '[昵称]' },
    // Mod 命令
    helpm: { trigger: ['helpm'], desc: '查询Mod命令详情', level: 'mod', params: '<命令名>' },
    kick: { trigger: ['kick'], desc: '踢出用户', level: 'mod', params: '<昵称>' },
    addword: { trigger: ['addword'], desc: '添加封禁词', level: 'mod', params: '<正则>' },
    delword: { trigger: ['delword'], desc: '删除封禁词', level: 'mod', params: '<序号或词>' },
    modlist: { trigger: ['modlist'], desc: 'Mod列表', level: 'mod', params: '' },
    lock: { trigger: ['lock'], desc: '锁房', level: 'mod', params: '' },
    unlock: { trigger: ['unlock'], desc: '解锁', level: 'mod', params: '' },
    slow: { trigger: ['slow'], desc: '慢速模式', level: 'mod', params: 'on/off [秒]' },
    whitelist: { trigger: ['whitelist'], desc: '白名单管理', level: 'mod', params: '<子命令> [trip]' },
    adminlog: { trigger: ['adminlog'], desc: '查看管理日志', level: 'mod', params: '[数量]' },
    // Admin 命令
    helpadmin: { trigger: ['helpadmin'], desc: '查看管理员命令', level: 'admin', params: '[命令名]' },
    mod: { trigger: ['mod'], desc: '协管模式', level: 'admin', params: 'on|off' },
    addmod: { trigger: ['addmod'], desc: '添加Mod', level: 'admin', params: '<tripcode>' },
    delmod: { trigger: ['delmod'], desc: '删除Mod', level: 'admin', params: '<tripcode>' },
    prtt: { trigger: ['prtt'], desc: '绑定Nick与Trip', level: 'admin', params: '<nick> <trip>' },
    delp: { trigger: ['delp'], desc: '解绑Nick', level: 'admin', params: '<nick>' },
    mute: { trigger: ['mute'], desc: '临时禁言', level: 'admin', params: '<用户> <分钟>' },
    silence: { trigger: ['silence'], desc: '永久禁言', level: 'admin', params: '<用户> [分钟]' },
    unsilence: { trigger: ['unsilence'], desc: '解除禁言', level: 'admin', params: '<用户>' },
    ban: { trigger: ['ban'], desc: '封禁用户', level: 'admin', params: '<nick|trip|hash> <值>' },
    unban: { trigger: ['unban'], desc: '解除封禁', level: 'admin', params: '<nick|trip|hash> <值>' },
    tempban: { trigger: ['tempban'], desc: '临时封禁', level: 'admin', params: '<nick> <分钟>' },
    con: { trigger: ['con'], desc: '直接输出', level: 'admin', params: '<文本>' },
    code: { trigger: ['code'], desc: '执行代码', level: 'admin', params: '<代码>' },
    announce: { trigger: ['announce'], desc: '频道公告', level: 'admin', params: '<内容>' },
    pann: { trigger: ['pann'], desc: '定时公告', level: 'admin', params: '<子命令>' },
    if: { trigger: ['if'], desc: '自动回复规则', level: 'admin', params: '<子命令>' },
    talk: { trigger: ['talk'], desc: '发言开关', level: 'admin', params: 'on|off' },
    random: { trigger: ['random'], desc: '随机回复控制', level: 'admin', params: 'off/on/N' },
    v: { trigger: ['v'], desc: '运行信息', level: 'admin', params: '' },
    dataclear: { trigger: ['dataclear'], desc: '清空所有数据', level: 'admin', params: '' },
    rl: { trigger: ['rl'], desc: '限流器管理', level: 'admin', params: '[子命令]' },
    backup: { trigger: ['backup'], desc: '手动备份数据', level: 'admin', params: '' },
    lists: { trigger: ['lists'], desc: '统一查看列表', level: 'admin', params: '<类型>' },
    igno: { trigger: ['igno'], desc: '添加到忽略列表', level: 'admin', params: '<nick/trip/hash> <值>' },
    unig: { trigger: ['unig'], desc: '从忽略列表移除', level: 'admin', params: '<nick/trip/hash> <值>' },
    stop: { trigger: ['stop'], desc: '停止机器人', level: 'admin', params: '' }
};

const bot = {
    ws: null,
    clientId: Math.random().toString(36).slice(2, 10),
    stopped: false,
    isStopping: false,
    cleanedUp: false,
    cmdMap: new Map(),
    tokenBucket: new TokenBucket(20,200),
    selfMuteTimer: null,
    selfMuteUntil: null,
    ignoreList: new Set(),
    blackList: new Set(),
    onlineUsers: new Map(),
    userActivity: new Map(),
    userJoinTime: new Map(),
    afkUsers: new Map(),
    silencedUsers: new Map(),
    messageHistory: [],
    messageIdMap: new Map(),
    nextMessageId: 1,
    recentMsgTimestamps: [],
    scheduledIntervals: [],
    periodicTimeoutId: null,
    ifTimer: null,
    memoryCleanerId: null,
    ifRules: [],
    scheduledAnnouncements: [],
    hashHistory: new Map(),
    welcomeMessages: new Map(),
    lastSeen: new Map(),
    banWords: [],
    modList: new Set(),
    modMode: false,
    lyMessages: [],
    leftMessages: [],
    nickTripBinding: new Map(),
    lastQuestionReplyTime: 0,
    isMuted: false,
    randomEnabled: false,
    randomProb: 0,
    rl: new RateLimiter(30, 8),
    slowModeEnabled: false,
    slowModeInterval: CONFIG.CONST.slowModeDefault,
    lastUserMsgTime: new Map(),
    subscriptions: new Map(),
    votes: new Map(),
    tempbanned: new Map(),
    whitelist: new Set(),
    adminLogs: [],
    wordCount: new Map(),
    logStream: null,
    logDate: '',
    inChannel: false,
    isReconnecting: false,
    reconnectAttempts: 0,
    reconnectTimer: null,
    dirty: false,
    saveTimer: null,
    hourlyTimeout: null,
    lastJoinTime: 0,

    init() {
        this.validateConfig();
        this.initCmdMap();
        this.loadAllData();
        this.cleanOldLogs();
        this.connectWS();
        this.startTimers();
        this.startMemoryCleaner();
        this.setupLogging();
        this.setupErrorHandlers();
        this.startAutoSave();
        console.log(`[${CONFIG.botNick}#${CONFIG.botTrip}] 启动 | 频道: ${CONFIG.channel} | 协管模式：${this.modMode ? '开' : '关'}`);
    },

    validateConfig() {
        if (!CONFIG.botNick || CONFIG.botNick.includes('#')) {
            console.warn('[配置警告] botNick 不应包含 # 号');
        }
        try {
            fs.ensureDirSync(CONFIG.CONST.logDir);
        } catch (err) {
            console.error('[配置错误] 无法创建日志目录:', CONFIG.CONST.logDir);
        }
    },

    initCmdMap() {
        const { NORMAL_PREFIX, MOD_PREFIX, ADMIN_PREFIX } = CONFIG.CONST;
        const prefixMap = { normal: NORMAL_PREFIX, mod: MOD_PREFIX, admin: ADMIN_PREFIX };
        for (const [cmdKey, config] of Object.entries(CMD_CONFIG)) {
            for (const trigger of config.trigger) {
                const prefix = prefixMap[config.level] || NORMAL_PREFIX;
                const fullTrigger = `${prefix}${trigger}`;
                this.cmdMap.set(fullTrigger, {
                    key: cmdKey,
                    ...config,
                    prefix,
                    handler: this[`handle${cmdKey.charAt(0).toUpperCase() + cmdKey.slice(1)}`] || (() => {})
                });
            }
        }
    },

    loadAllData() {
        const parse = (key, fallback) => {
            try {
                const raw = localStorage.getSync(key);
                return raw ? JSON.parse(raw) : fallback;
            } catch(e) { return fallback; }
        };
        this.ifRules = parse('bot_ifRules', []);
        this.lyMessages = parse(CONFIG.ly.storageKey, []);
        const hashObj = parse('bot_hashHistory', {});
        this.hashHistory = new Map(Object.entries(hashObj).map(([k, v]) => [k, new Set(v)]));
        this.welcomeMessages = new Map(Object.entries(parse('bot_welcomeMessages', {})));
        this.lastSeen = new Map(Object.entries(parse('bot_lastSeen', {})));
        this.banWords = parse('bot_banWords', []);
        this.modList = new Set(parse('bot_modList', []));
        this.modMode = parse('bot_modMode', false);
        this.scheduledAnnouncements = parse('bot_scheduledAnnouncements', []).map(a => ({ ...a, lastSendTime: a.lastSendTime || 0 }));
        const random = parse('bot_random', null);
        if (random) {
            this.randomEnabled = random.enabled;
            this.randomProb = random.prob;
        }
        const rl = parse('bot_rl', null);
        if (rl) {
            this.rl.setParams(rl.halflife, rl.threshold);
            this.rl.setEnabled(rl.enabled);
        }
        const slow = parse('bot_slowMode', null);
        if (slow) {
            this.slowModeEnabled = slow.enabled;
            this.slowModeInterval = slow.interval;
        }
        const subsObj = parse('bot_subscriptions', {});
        this.subscriptions = new Map(Object.entries(subsObj).map(([k, v]) => [k, new Set(v)]));
        const voteObj = parse('bot_votes', {});
        this.votes = new Map(Object.entries(voteObj).map(([k, v]) => [k, { ...v, options: new Map(v.options), voters: new Set(v.voters) }]));
        this.whitelist = new Set(parse('bot_whitelist', []));
        this.tempbanned = new Map(Object.entries(parse('bot_tempbanned', {})));
        this.adminLogs = parse('bot_adminLogs', []);
        this.ignoreList = new Set(parse('bot_ignoreList', []));
        this.blackList = new Set(parse('bot_blackList', []));
        this.leftMessages = parse('bot_leftMessages', []);
        this.nickTripBinding = new Map(Object.entries(parse('bot_nickTripBinding', {})));
        this.cleanExpiredLyMessages();
    },

    startAutoSave() {
        this.saveTimer = setInterval(async () => {
            if (this.dirty) {
                this.dirty = false;
                await this.flushSave();
            }
        }, CONFIG.CONST.saveIntervalMs);
    },

    async flushSave() {
        try {
            const save = (key, value) => localStorage.setItem(key, JSON.stringify(value));
            const hashObj = Object.fromEntries( [...this.hashHistory.entries()].map(([k, v]) => [k, [...v]]) );
            await Promise.all([
                save('bot_ifRules', this.ifRules),
                save(CONFIG.ly.storageKey, this.lyMessages),
                save('bot_hashHistory', hashObj),
                save('bot_welcomeMessages', Object.fromEntries(this.welcomeMessages)),
                save('bot_lastSeen', Object.fromEntries(this.lastSeen)),
                save('bot_banWords', this.banWords),
                save('bot_modList', [...this.modList]),
                save('bot_modMode', this.modMode),
                save('bot_scheduledAnnouncements', this.scheduledAnnouncements.map(({ lastSendTime, ...rest }) => rest)),
                save('bot_random', { enabled: this.randomEnabled, prob: this.randomProb }),
                save('bot_rl', { halflife: this.rl.halflife, threshold: this.rl.threshold, enabled: this.rl.enabled }),
                save('bot_slowMode', { enabled: this.slowModeEnabled, interval: this.slowModeInterval }),
                save('bot_subscriptions', Object.fromEntries( [...this.subscriptions.entries()].map(([k, v]) => [k, [...v]]) )),
                save('bot_votes', Object.fromEntries( [...this.votes.entries()].map(([k, v]) => [k, { ...v, options: [...v.options.entries()], voters: [...v.voters] }] ))),
                save('bot_whitelist', [...this.whitelist]),
                save('bot_tempbanned', Object.fromEntries(this.tempbanned)),
                save('bot_adminLogs', this.adminLogs.slice(-CONFIG.CONST.adminLogMax)),
                save('bot_ignoreList', [...this.ignoreList]),
                save('bot_blackList', [...this.blackList]),
                save('bot_leftMessages', this.leftMessages),
                save('bot_nickTripBinding', Object.fromEntries(this.nickTripBinding))
            ]);
        } catch (err) {
            console.error('[自动保存失败]', err);
        }
    },

    saveAllDataSync() {
        const save = (key, value) => localStorage.setSync(key, JSON.stringify(value));
        const hashObj = Object.fromEntries( [...this.hashHistory.entries()].map(([k, v]) => [k, [...v]]) );
        save('bot_ifRules', this.ifRules);
        save(CONFIG.ly.storageKey, this.lyMessages);
        save('bot_hashHistory', hashObj);
        save('bot_welcomeMessages', Object.fromEntries(this.welcomeMessages));
        save('bot_lastSeen', Object.fromEntries(this.lastSeen));
        save('bot_banWords', this.banWords);
        save('bot_modList', [...this.modList]);
        save('bot_modMode', this.modMode);
        save('bot_scheduledAnnouncements', this.scheduledAnnouncements.map(({ lastSendTime, ...rest }) => rest));
        save('bot_random', { enabled: this.randomEnabled, prob: this.randomProb });
        save('bot_rl', { halflife: this.rl.halflife, threshold: this.rl.threshold, enabled: this.rl.enabled });
        save('bot_slowMode', { enabled: this.slowModeEnabled, interval: this.slowModeInterval });
        save('bot_subscriptions', Object.fromEntries( [...this.subscriptions.entries()].map(([k, v]) => [k, [...v]]) ));
        save('bot_votes', Object.fromEntries( [...this.votes.entries()].map(([k, v]) => [k, { ...v, options: [...v.options.entries()], voters: [...v.voters] }] )));
        save('bot_whitelist', [...this.whitelist]);
        save('bot_tempbanned', Object.fromEntries(this.tempbanned));
        save('bot_adminLogs', this.adminLogs.slice(-CONFIG.CONST.adminLogMax));
        save('bot_ignoreList', [...this.ignoreList]);
        save('bot_blackList', [...this.blackList]);
        save('bot_leftMessages', this.leftMessages);
        save('bot_nickTripBinding', Object.fromEntries(this.nickTripBinding));
    },

    markDirty() {
        this.dirty = true;
    },

    cleanOldLogs() {
        try {
            const logDir = CONFIG.CONST.logDir;
            if (!fs.existsSync(logDir)) return;
            const files = fs.readdirSync(logDir).filter(f => f.endsWith('.log'));
            if (files.length > CONFIG.CONST.maxLogFiles) {
                const sorted = files.sort();
                const toDelete = sorted.slice(0, files.length - CONFIG.CONST.maxLogFiles);
                for (const file of toDelete) {
                    fs.unlinkSync(path.join(logDir, file));
                }
            }
        } catch (err) {
            console.error('[日志清理失败]', err);
        }
    },

    stripAt(nick) {
        return nick ? nick.replace(/^@/, '') : '';
    },

    getLocalTime() {
        const now = new Date();
        const offset = CONFIG.CONST.timezoneOffset * 60 * 60 * 1000;
        return new Date(now.getTime() + offset);
    },

    shouldAddPlaceholder(text) {
        return text && text.includes('\n');
    },

    sendUsage(cmdKey, msg, prefix) {
        const cfg = CMD_CONFIG[cmdKey];
        if (!cfg) return;
        const p = prefix || CONFIG.CONST.NORMAL_PREFIX;
        this.sendChat(`参数错误 正确用法：${p}${cfg.trigger[0]} ${cfg.params || ''}`);
    },

    addAdminLog(action, target, by) {
        this.adminLogs.push({ time: Date.now(), action, target: target || '', by: by || 'system' });
        if (this.adminLogs.length > CONFIG.CONST.adminLogMax) this.adminLogs.shift();
        this.markDirty();
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

    setupLogging() {
        try {
            const logDir = CONFIG.CONST.logDir;
            fs.ensureDirSync(logDir);
            const date = new Date().toISOString().slice(0, 10);
            this.logDate = date;
            const logPath = path.join(logDir, `${date}.log`);
            if (this.logStream) this.logStream.end();
            this.logStream = fs.createWriteStream(logPath, { flags: 'a' });
            this.logStream.write(`=== Bot started at ${new Date().toISOString()} ===\n`);
        } catch (err) {
            console.error('[日志初始化失败]', err);
        }
    },

    logMessage(text) {
        try {
            if (!this.logStream) return;
            const today = new Date().toISOString().slice(0, 10);
            if (today !== this.logDate) {
                this.logDate = today;
                const newPath = path.join(CONFIG.CONST.logDir, `${today}.log`);
                this.logStream.end();
                this.logStream = fs.createWriteStream(newPath, { flags: 'a' });
                this.cleanOldLogs();
            }
            this.logStream.write(`[${new Date().toISOString()}] ${text}\n`);
        } catch (err) {}
    },

    setupErrorHandlers() {
        process.on('uncaughtException', (err) => {
            console.error('[未捕获异常]', err);
            if (this.logMessage) {
                try { this.logMessage(`UNCAUGHT EXCEPTION: ${err.stack}`); } catch(e) {}
            }
        });
        process.on('unhandledRejection', (reason) => {
            console.error('[未处理的Promise拒绝]', reason);
            if (this.logMessage) {
                try { this.logMessage(`UNHANDLED REJECTION: ${reason}`); } catch(e) {}
            }
        });
    },

    fetchWithTimeout(url, options = {}, timeout = 10000) {
        const controller = new AbortController();
        const signal = controller.signal;
        const timeoutId = setTimeout(() => controller.abort(), timeout);
        return fetch(url, { ...options, signal }).finally(() => clearTimeout(timeoutId));
    },

    truncate(text, maxLen, msgId = null) {
        if (text.length <= maxLen) return text;
        let truncated = text.slice(0, maxLen - 3) + '...';
        if (msgId) truncated += `!loog ${msgId}`;
        return truncated;
    },

    connectWS() {
        if (this.isReconnecting) return;
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
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
        this.ws = new WebSocket(CONFIG.server);
        this.ws.on('open', () => {
            console.log(`[连接成功] ${CONFIG.channel}`);
            this.reconnectAttempts = 0;
            this.isReconnecting = false;
            this.joinChannel();
        });
        this.ws.on('message', (data) => {
            try {
                const msg = JSON.parse(data.toString());
                CONFIG.debug && console.log('[接收]', msg);
                this.handleOfficialCommands(msg);
            } catch (err) {
                console.error('[解析失败]', err);
            }
        });
        this.ws.on('close', (code, reason) => {
            console.log(`[连接关闭] ${code} ${reason}`);
            this.inChannel = false;
            if (!this.stopped) {
                this.isReconnecting = true;
                const delay = Math.min(
                    CONFIG.CONST.reconnectBaseDelay * Math.pow(2, this.reconnectAttempts),
                    CONFIG.CONST.reconnectMaxDelay
                );
                this.reconnectAttempts++;
                console.log(`[重连] ${delay/1000}s 后重试 (第${this.reconnectAttempts}次)`);
                this.reconnectTimer = setTimeout(() => this.connectWS(), delay);
            } else {
                console.log(`[${CONFIG.botNick}] 停止`);
            }
        });
        this.ws.on('error', (err) => {
            console.error('[WS错误]', err);
        });
    },

    joinChannel() {
        if (this.ws.readyState !== WebSocket.OPEN) return;
        if (this.inChannel) return;
        if (Date.now() - this.lastJoinTime < 10000) return;
        this.lastJoinTime = Date.now();
        const nickWithTrip = `${CONFIG.botNick}#${CONFIG.botTrip}`;
        this.sendWSMessage({ cmd: 'join', channel: CONFIG.channel, nick: nickWithTrip, clientId: this.clientId }, true, true);
        this.sendColorCommand();
    },

    sendColorCommand() {
        if (!CONFIG.color?.enable) return;
        const colorHex = CONFIG.color.hex?.trim() || '';
        if (!/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/.test(colorHex)) return;
        this.sendWSMessage({ cmd: 'chat', text: `/color ${colorHex}`, clientId: this.clientId }, true, true);
    },

    sendWSMessage(data, ignoreLimit = false, ignoreMute = false) {
        if (this.ws.readyState !== WebSocket.OPEN) return;
        if (this.selfMuteUntil && this.selfMuteUntil > Date.now()) return;
        if (this.isMuted && !ignoreMute) return;
        if (!ignoreLimit && !this.tokenBucket.consume()) return;
        this.ws.send(JSON.stringify(data));
    },

    sendChat(text, ignoreMute = false) {
        if (!text) return;
        this.sendWSMessage({ cmd: 'chat', text, clientId: this.clientId }, false, ignoreMute);
    },

    sendWhisper(to, text, noPlaceholder = false) {
        if (!to || !text) return;
        const finalText = !noPlaceholder && this.shouldAddPlaceholder(text) && !text.startsWith(PLACEHOLDER)
            ? `${PLACEHOLDER}\n${text}` : text;
        this.sendWSMessage({ cmd: 'whisper', nick: to, text: finalText }, false, true);
    },

    hasAdminAuth(msg) {
        return msg && msg.trip === CONFIG.CONST.ADMIN_TRIPCODE;
    },

    hasModAuth(msg) {
        return this.hasAdminAuth(msg) || (msg && msg.trip && this.modList.has(msg.trip));
    },

    isWhitelisted(trip) {
        return trip && this.whitelist.has(trip);
    },

    isTempbanned(nick) {
        if (!this.tempbanned.has(nick)) return false;
        const expire = this.tempbanned.get(nick);
        if (expire > Date.now()) return true;
        this.tempbanned.delete(nick);
        this.markDirty();
        return false;
    },

    isSilenced(nick) {
        if (!this.silencedUsers.has(nick)) return false;
        const expire = this.silencedUsers.get(nick);
        if (expire === Infinity) return true;
        if (expire > Date.now()) return true;
        this.silencedUsers.delete(nick);
        return false;
    },

    isIgnored(item) {
        return item && this.ignoreList.has(item);
    },

    isBlacklisted(item) {
        return item && this.blackList.has(item);
    },

    kickUser(nick) {
        if (nick && nick !== CONFIG.botNick) {
            this.sendChat(`/kick ${nick}`, true);
            this.addAdminLog('kick', nick, 'system');
        }
    },

    handleOfficialCommands(msg) {
        try {
            if (msg.channel && msg.channel !== CONFIG.channel && this.inChannel) {
                console.log(`[被踢] 频道变为 ${msg.channel}，重连回 ${CONFIG.channel}`);
                this.inChannel = false;
                if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
                    this.ws.close(1000, 'kicked');
                }
                return;
            }
            if (msg.cmd === 'onlineSet') {
                this.updateOnlineUsers(msg);
                return;
            }
            if (msg.cmd === 'onlineRemove') {
                this.onUserLeave(msg.nick);
                return;
            }
            switch (msg.cmd) {
                case 'chat':
                    this.recordMessage(msg);
                    if (this.isTempbanned(msg.nick) || this.isBlacklisted(msg.nick) || this.isBlacklisted(msg.trip) || (msg.hash && this.isBlacklisted(msg.hash))) {
                        this.kickUser(msg.nick);
                        return;
                    }
                    if (this.modMode && !this.hasModAuth(msg) && msg.nick !== CONFIG.botNick) {
                        const text = msg.text.trim();
                        const prefixes = [CONFIG.CONST.NORMAL_PREFIX, CONFIG.CONST.MOD_PREFIX, CONFIG.CONST.ADMIN_PREFIX];
                        if (prefixes.some(p => text.startsWith(p))) {
                            const [cmdTrigger] = text.split(/\s+/);
                            const cmdItem = this.cmdMap.get(cmdTrigger);
                            if (cmdItem && cmdItem.level !== 'normal') return;
                        }
                    }
                    if (this.isMuted && msg.text.trim() !== `${CONFIG.CONST.ADMIN_PREFIX}talk on`) return;
                    if (!this.isSilenced(msg.nick)) {
                        this.handleChatMessage(msg);
                        this.checkIfRules(msg.text);
                        this.tryRandomReply(msg);
                        this.checkSubscriptions(msg.text, msg.nick, msg.trip);
                    } else {
                        this.kickUser(msg.nick);
                    }
                    break;
                case 'onlineAdd':
                    this.onUserJoin(msg);
                    break;
                case 'warn':
                    this.handleWarn(msg);
                    break;
                case 'error':
                    this.handleServerError(msg);
                    break;
                case 'info':
                    if (msg.type === 'whisper') this.handleWhisper(msg);
                    break;
                default:
                    CONFIG.debug && console.log('[未处理]', msg.cmd);
            }
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

    handleWhisper(msg) {
        try {
            const from = msg.from;
            const text = msg.text;
            const trip = msg.trip || '';
            if (typeof from === 'number') return;
            const nickPrefix = `${from} whispered: `;
            const cleanText = text.startsWith(nickPrefix) ? text.slice(nickPrefix.length) : text;
            const prefixes = [CONFIG.CONST.NORMAL_PREFIX, CONFIG.CONST.MOD_PREFIX, CONFIG.CONST.ADMIN_PREFIX];
            let prefix = null;
            for (const p of prefixes) {
                if (cleanText && cleanText.startsWith(p)) {
                    prefix = p;
                    break;
                }
            }
            if (!prefix) return;
            this.handleCommands({ nick: from, trip: trip }, cleanText);
        } catch (err) {
            console.error('[私信处理错误]', err);
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

    updateOnlineUsers(data) {
        try {
            const newMap = new Map();
            for (const u of data.users) {
                newMap.set(u.nick, {
                    trip: u.trip || '',
                    hash: u.hash,
                    color: u.color || false,
                    joinTime: u.time * 1000
                });
                if (u.hash) {
                    if (!this.hashHistory.has(u.hash)) this.hashHistory.set(u.hash, new Set());
                    const nickSet = this.hashHistory.get(u.hash);
                    const pureNick = u.nick.split('#')[0];
                    nickSet.add(pureNick);
                    if (pureNick !== u.nick) nickSet.add(u.nick);
                    if (nickSet.size > CONFIG.CONST.maxHashNickCount) {
                        const iter = nickSet.values();
                        nickSet.delete(iter.next().value);
                    }
                    this.markDirty();
                }
                if (u.nick !== CONFIG.botNick && !this.userJoinTime.has(u.nick)) {
                    this.userJoinTime.set(u.nick, u.time * 1000);
                }
            }
            this.onlineUsers = newMap;
            const myFullNick = `${CONFIG.botNick}#${CONFIG.botTrip}`;
            this.inChannel = this.onlineUsers.has(myFullNick);
            if (this.inChannel) {
                console.log(`[频道确认] 已成功加入 ${CONFIG.channel}`);
            }
        } catch (err) {
            console.error('[更新在线用户错误]', err);
        }
    },

    onUserJoin(data) {
        try {
            const nick = data.nick;
            if (nick === CONFIG.botNick) return;
            if (this.isTempbanned(nick) || this.isBlacklisted(nick) || this.isBlacklisted(data.trip) || (data.hash && this.isBlacklisted(data.hash))) {
                this.kickUser(nick);
                this.sendChat(`${nick} 已被封禁`);
                return;
            }
            const userTrip = data.trip || '';
            if (this.nickTripBinding.has(nick)) {
                const boundTrip = this.nickTripBinding.get(nick);
                if (boundTrip !== userTrip) {
                    this.sendChat(`昵称 ${nick} 已被绑定到识别码 ${boundTrip}，请更换昵称重进。`);
                    this.kickUser(nick);
                    return;
                }
            }
            this.onlineUsers.set(nick, {
                trip: userTrip,
                hash: data.hash,
                color: data.color || false,
                joinTime: data.time * 1000
            });
            if (data.hash) {
                if (!this.hashHistory.has(data.hash)) this.hashHistory.set(data.hash, new Set());
                const nickSet = this.hashHistory.get(data.hash);
                const pureNick = nick.split('#')[0];
                nickSet.add(pureNick);
                if (pureNick !== nick) nickSet.add(nick);
                if (nickSet.size > CONFIG.CONST.maxHashNickCount) {
                    const iter = nickSet.values();
                    nickSet.delete(iter.next().value);
                }
                this.markDirty();
            }
            let welcomeMsg = (userTrip && this.welcomeMessages.has(userTrip))
                ? this.welcomeMessages.get(userTrip)
                : CONFIG.CONST.welcomeMsg.replace('%s', nick);
            if (welcomeMsg) {
                this.sendChat('\u200B' + welcomeMsg);
            }
            const msgs = this.leftMessages.filter(m => m.toNick === nick || m.toTrip === userTrip);
            if (msgs.length) {
                const list = msgs.map(m => `来自 ${m.fromNick}: ${m.content}`).join('\n');
                this.sendWhisper(nick, `您有 ${msgs.length} 条留言:\n${list}`);
                this.leftMessages = this.leftMessages.filter(m => !msgs.includes(m));
                this.markDirty();
            }
        } catch (err) {
            console.error('[用户加入错误]', err);
        }
    },

    onUserLeave(nick) {
        try {
            this.onlineUsers.delete(nick);
            this.afkUsers.delete(nick);
            this.lastUserMsgTime.delete(nick);
        } catch (err) {}
    },

    handleChatMessage(msg) {
        try {
            const text = msg.text.trim();
            if (!text) return;
            const isWhitelisted = this.isWhitelisted(msg.trip);
            const isMod = this.hasModAuth(msg);
            for (const word of this.banWords) {
                try {
                    if (new RegExp(word, 'i').test(text)) {
                        this.kickUser(msg.nick);
                        return;
                    }
                } catch(e) {}
            }
            if (!isWhitelisted && !isMod && this.rl.frisk(msg.nick, 1 + text.length/512)) {
                this.kickUser(msg.nick);
                return;
            }
            if (this.slowModeEnabled && !isWhitelisted && !isMod) {
                const lastTime = this.lastUserMsgTime.get(msg.nick) || 0;
                const elapsed = Date.now() - lastTime;
                if (elapsed < this.slowModeInterval * 1000) {
                    const remain = Math.ceil((this.slowModeInterval * 1000 - elapsed) / 1000);
                    this.sendChat(`慢速模式中，请等待 ${remain} 秒再发言`);
                    return;
                }
                this.lastUserMsgTime.set(msg.nick, Date.now());
            }
            this.handleCommands(msg, text);
            this.handleAFKMention(msg);
            this.updateUserActivity(msg.nick);
            this.lastSeen.set(msg.nick, { time: Date.now(), msg: text });
            if (this.lastSeen.size > CONFIG.CONST.maxLastSeen) {
                const firstKey = this.lastSeen.keys().next().value;
                this.lastSeen.delete(firstKey);
            }
            if (msg.trip) {
                this.lastSeen.set(msg.trip, { time: Date.now(), msg: text });
                if (this.lastSeen.size > CONFIG.CONST.maxLastSeen) {
                    const firstKey = this.lastSeen.keys().next().value;
                    this.lastSeen.delete(firstKey);
                }
            }
            const words = text.split(/\s+/);
            for (const w of words) {
                if (w.length > 2) {
                    const key = w.toLowerCase();
                    const cnt = this.wordCount.get(key) || 0;
                    this.wordCount.set(key, cnt + 1);
                    if (this.wordCount.size > CONFIG.CONST.maxWordCount) {
                        const firstKey = this.wordCount.keys().next().value;
                        this.wordCount.delete(firstKey);
                    }
                }
            }
            this.markDirty();
            this.logMessage(`${msg.nick}: ${text}`);
            if (!this.isMuted && !text.startsWith(CONFIG.CONST.NORMAL_PREFIX) && /[？?]/.test(text)) {
                const now = Date.now();
                if (!this.lastQuestionReplyTime || now - this.lastQuestionReplyTime > 5000) {
                    if (Math.random() <= 0.15) {
                        this.sendChat(this.pickStyleReply('questionReplies'));
                        this.lastQuestionReplyTime = now;
                    }
                }
            }
        } catch (err) {
            console.error('[聊天消息处理错误]', err);
            this.logMessage(`ERROR in handleChatMessage: ${err.stack}`);
        }
    },

    recordMessage(msg) {
        try {
            if (msg.cmd !== 'chat') return;
            const nick = msg.nick;
            const trip = msg.trip || '';
            const hash = this.onlineUsers.get(nick)?.hash || msg.hash || '';
            if (this.isIgnored(nick) || this.isIgnored(trip) || this.isIgnored(hash)) return;
            if (this.isBlacklisted(nick) || this.isBlacklisted(trip) || this.isBlacklisted(hash)) {
                this.kickUser(nick);
                return;
            }
            const obj = { id: this.nextMessageId++, nick, trip, text: msg.text, time: Date.now() };
            this.messageHistory.push(obj);
            this.messageIdMap.set(obj.id, obj);
            this.recentMsgTimestamps.push(Date.now());
            if (this.recentMsgTimestamps.length > CONFIG.CONST.recentTimestampsMax) {
                this.recentMsgTimestamps = this.recentMsgTimestamps.slice(-CONFIG.CONST.recentTimestampsMax);
            }
            if (this.messageHistory.length > CONFIG.CONST.maxMsgHistory) {
                const removed = this.messageHistory.shift();
                this.messageIdMap.delete(removed.id);
            }

            // 从聊天消息中补充 hash-nick 关联
            if (hash && nick) {
                if (!this.hashHistory.has(hash)) this.hashHistory.set(hash, new Set());
                const nickSet = this.hashHistory.get(hash);
                const pureNick = nick.split('#')[0];
                nickSet.add(pureNick);
                if (pureNick !== nick) nickSet.add(nick);
                if (nickSet.size > CONFIG.CONST.maxHashNickCount) {
                    const iter = nickSet.values();
                    nickSet.delete(iter.next().value);
                }
                this.markDirty();
            }
        } catch (err) {}
    },

    updateUserActivity(nick) {
        try {
            if (nick) this.userActivity.set(nick, (this.userActivity.get(nick) || 0) + 1);
        } catch (err) {}
    },

    handleAFKMention(msg) {
        try {
            if (this.isMuted || !msg) return;
            const mentionReg = /@(\w+)/g;
            let match;
            while ((match = mentionReg.exec(msg.text)) !== null) {
                const user = match[1];
                if (this.afkUsers.has(user)) {
                    const afkData = this.afkUsers.get(user);
                    const afkMs = Date.now() - afkData.time;
                    const afkStr = afkMs > 3600000 ? `${(afkMs/3600000).toFixed(1)}h` : `${Math.floor(afkMs/60000)}m`;
                    this.sendChat(`@${msg.nick}：${user} AFK(${afkStr})：${afkData.reason || 'AFK'}`);
                }
            }
        } catch (err) {}
    },

    checkIfRules(text) {
        try {
            if (this.isMuted || !this.ifRules.length || !text) return;
            const trimText = text.trim();
            for (const rule of this.ifRules) {
                let isMatch = false;
                if (rule.isRegex) {
                    try { isMatch = new RegExp(rule.trigger, 'i').test(trimText); } catch(e) {}
                } else {
                    isMatch = trimText === rule.trigger;
                }
                if (isMatch && Math.random() <= rule.probability / 100) this.sendChat(rule.reply);
            }
        } catch (err) {}
    },

    checkSubscriptions(text, nick, trip) {
        try {
            if (!text || !trip) return;
            const lowerText = text.toLowerCase();
            for (const [subTrip, keywords] of this.subscriptions.entries()) {
                if (subTrip === trip) continue;
                for (const keyword of keywords) {
                    if (lowerText.includes(keyword.toLowerCase())) {
                        this.sendWhisper(
                            this.getNickByTrip(subTrip),
                            `关键词 "${keyword}" 被 ${nick} 提到：${text.slice(0, 100)}`
                        );
                        break;
                    }
                }
            }
        } catch (err) {}
    },

    getNickByTrip(trip) {
        for (const [nick, data] of this.onlineUsers.entries()) {
            if (data.trip === trip) return nick;
        }
        return null;
    },

    tryRandomReply(msg) {
        try {
            if (this.isMuted || !this.randomEnabled || msg.nick === CONFIG.botNick) return;
            if (Math.random() * 100 > this.randomProb) return;
            const text = msg.text.trim();
            if (text.startsWith(CONFIG.CONST.NORMAL_PREFIX)) return;
            const candidates = this.messageHistory.filter(m =>
                m.nick !== CONFIG.botNick &&
                !m.text.startsWith(CONFIG.CONST.NORMAL_PREFIX) &&
                m.text.trim().length > 0
            );
            if (!candidates.length) return;
            const chosen = candidates[Math.floor(Math.random() * candidates.length)];
            this.sendChat('\u200B' + chosen.text);
        } catch (err) {}
    },

    startTimers() {
        this.scheduledIntervals.push(setInterval(() => {
            this.sendWhisper(CONFIG.botNick, 'w');
        }, 30000));
        this.scheduledIntervals.push(setInterval(() => {
            if (!this.inChannel && this.ws && this.ws.readyState === WebSocket.OPEN &&
                !this.isReconnecting &&
                (!this.selfMuteUntil || this.selfMuteUntil <= Date.now()) &&
                Date.now() - this.lastJoinTime > 30000) {
                console.log('[保活] 尝试重新加入频道');
                this.joinChannel();
            }
        }, 60000));
        this.scheduledIntervals.push(setInterval(() => this.checkMuteExpire(), CONFIG.CONST.muteCheckInterval));
        this.scheduledIntervals.push(setInterval(() => this.checkTempbanExpire(), 60000));
        const scheduleHourly = () => {
            const now = this.getLocalTime();
            const nextHour = new Date(now);
            nextHour.setHours(now.getHours() + 1, 0, 0, 0);
            const delay = nextHour.getTime() - now.getTime();
            this.hourlyTimeout = setTimeout(() => {
                if (!this.isMuted) {
                    const hour = this.getLocalTime().getHours();
                    this.sendChat(`${hour} 点了，喝口水吧`);
                }
                scheduleHourly();
            }, delay);
        };
        scheduleHourly();
        this.ifTimer = setInterval(() => {
            if (this.isMuted) return;
            for (const rule of this.ifRules) {
                if (!rule.trigger && Math.random() <= rule.probability / 100) this.sendChat(rule.reply);
            }
        }, 10000);
        this.schedulePeriodicPost();
    },

    schedulePeriodicPost() {
        if (this.periodicTimeoutId) clearTimeout(this.periodicTimeoutId);
        const delay = 10 * 60 * 1000;
        this.periodicTimeoutId = setTimeout(() => {
            if (!this.isMuted) {
                const now = Date.now();
                for (const ann of this.scheduledAnnouncements) {
                    if (now - ann.lastSendTime >= ann.interval * 60 * 1000) {
                        this.sendChat(ann.content);
                        ann.lastSendTime = now;
                    }
                }
                if (Math.random() < 0.15) {
                    if (CONFIG.CONST.periodic.includeYiyan && Math.random() > 0.5) this.handleYiyan();
                    else if (CONFIG.CONST.periodic.includeStyle) {
                        const reply = this.pickStyleReply('smallTalkReplies');
                        if (reply) this.sendChat(reply);
                    }
                }
            }
            this.periodicTimeoutId = null;
            this.schedulePeriodicPost();
        }, delay);
    },

    checkMuteExpire() {
        try {
            const now = Date.now();
            for (const [user, expire] of this.silencedUsers.entries()) {
                if (expire !== Infinity && expire < now) this.silencedUsers.delete(user);
            }
        } catch (err) {}
    },

    checkTempbanExpire() {
        try {
            const now = Date.now();
            for (const [user, expire] of this.tempbanned.entries()) {
                if (expire < now) {
                    this.tempbanned.delete(user);
                    this.markDirty();
                }
            }
        } catch (err) {}
    },

    startMemoryCleaner() {
        this.memoryCleanerId = setInterval(() => {
            try {
                const expireTime = Date.now() - CONFIG.CONST.timestampExpireHours * 3600 * 1000;
                this.recentMsgTimestamps = this.recentMsgTimestamps.filter(ts => ts >= expireTime);
                const activeUsers = new Set(this.messageHistory.slice(-1000).map(m => m.nick));
                for (const [user] of this.userActivity.entries()) {
                    if (!activeUsers.has(user)) this.userActivity.delete(user);
                }
                const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
                for (const [key, val] of this.lastSeen.entries()) {
                    if (val.time < weekAgo) this.lastSeen.delete(key);
                }
                this.markDirty();
            } catch (err) {}
        }, 3600 * 1000);
    },

    pickStyleReply(type) {
        try {
            const pool = CONFIG.CONST.styleTemplates[type];
            return pool ? pool[Math.floor(Math.random() * pool.length)] : null;
        } catch (err) { return null; }
    },

    cleanExpiredLyMessages() {
        try {
            const now = Date.now();
            this.lyMessages = this.lyMessages.filter(m => m.expireTime > now);
            this.markDirty();
        } catch (err) {}
    },

    formatHelp(cmdKey, prefix) {
        const cfg = CMD_CONFIG[cmdKey];
        if (!cfg) return null;
        const p = prefix || CONFIG.CONST.NORMAL_PREFIX;
        const lines = [
            `# ${cmdKey}`,
            '||',
            '|:-:|',
            `| 参数 | ${cfg.params || '无'} |`,
            `| 描述 | ${cfg.desc} |`,
            `| 例 | ${p}${cfg.trigger[0]} ${cfg.params} |`,
            `| 权限 | ${cfg.level} |`
        ];
        return lines.join('\n');
    },

    formatCmdList(cmds) {
        const triggers = cmds.map(([_, c]) => c.trigger[0]);
        const lines = [];
        for (let i = 0; i < triggers.length; i += 6) {
            lines.push('> ' + triggers.slice(i, i + 6).join(', '));
        }
        return lines.join('\n');
    },

    handleCommands(msg, text) {
        try {
            const [cmdTrigger, ...params] = text.split(/\s+/);
            const cmdItem = this.cmdMap.get(cmdTrigger);
            if (!cmdItem) return;
            if (cmdItem.level === 'admin' && !this.hasAdminAuth(msg)) {
                this.sendChat('无权限，仅管理员可执行');
                return;
            }
            if (cmdItem.level === 'mod' && !this.hasModAuth(msg)) {
                this.sendChat('无权限，需要 Mod 或管理员权限');
                return;
            }
            cmdItem.handler.call(this, msg, params);
        } catch (err) {
            console.error(`[命令失败] ${text}`, err);
            this.sendChat(`执行出错：${err.message.slice(0, 30)}`);
        }
    },

    handleHelp(msg, params) {
        try {
            const target = msg.nick;
            const prefix = CONFIG.CONST.NORMAL_PREFIX;
            if (params.length === 0) {
                const normalCmds = Object.entries(CMD_CONFIG).filter(([_, c]) => c.level === 'normal');
                const modCmds = Object.entries(CMD_CONFIG).filter(([_, c]) => c.level === 'mod');
                const normalList = this.formatCmdList(normalCmds);
                const modList = this.formatCmdList(modCmds);
                const helpText = [
                    `${PLACEHOLDER}`,
                    `普通命令 前缀==${prefix}==`,
                    normalList,
                    '',
                    `Mod命令 前缀==${CONFIG.CONST.MOD_PREFIX}==`,
                    modList,
                    '',
                    `发送==${prefix}help 命令名==获取详细帮助 Mod使用==${CONFIG.CONST.MOD_PREFIX}==`,
                    `管理员请使用==${CONFIG.CONST.ADMIN_PREFIX}helpadmin==`
                ].join('\n');
                this.sendWhisper(target, helpText);
            } else {
                const cmdName = params[0].toLowerCase();
                const matched = Object.entries(CMD_CONFIG).find(([k, c]) =>
                    c.level === 'normal' && (c.trigger.includes(cmdName) || k === cmdName)
                );
                if (matched) {
                    this.sendWhisper(target, this.formatHelp(matched[0], prefix));
                } else {
                    const modMatched = Object.entries(CMD_CONFIG).find(([k, c]) =>
                        c.level === 'mod' && (c.trigger.includes(cmdName) || k === cmdName)
                    );
                    if (modMatched) {
                        this.sendWhisper(target, `"${cmdName}" 是 Mod 命令，请使用 ${CONFIG.CONST.MOD_PREFIX}helpm ${cmdName} 查询`);
                    } else {
                        this.sendWhisper(target, `未知命令 "${cmdName}"`);
                    }
                }
            }
        } catch (err) {
            this.sendChat('帮助命令出错了');
        }
    },

    handleHelpm(msg, params) {
        try {
            const target = msg.nick;
            const prefix = CONFIG.CONST.MOD_PREFIX;
            if (params.length === 0) {
                this.sendChat('参数错误 正确用法：;helpm <命令名>');
                return;
            }
            const cmdName = params[0].toLowerCase();
            const matched = Object.entries(CMD_CONFIG).find(([k, c]) =>
                c.level === 'mod' && (c.trigger.includes(cmdName) || k === cmdName)
            );
            if (matched) {
                this.sendWhisper(target, this.formatHelp(matched[0], prefix));
            } else {
                this.sendWhisper(target, `未知Mod命令 "${cmdName}"`);
            }
        } catch (err) {
            this.sendChat('Mod帮助出错了');
        }
    },

    handleHelpadmin(msg, params) {
        try {
            const target = msg.nick;
            const prefix = CONFIG.CONST.ADMIN_PREFIX;
            if (params.length === 0) {
                const adminCmds = Object.entries(CMD_CONFIG).filter(([_, c]) => c.level === 'admin');
                const adminList = this.formatCmdList(adminCmds);
                const helpText = [
                    `${PLACEHOLDER}`,
                    `管理员命令 前缀==${prefix}==`,
                    adminList,
                    '',
                    `查询管理员命令==${prefix}helpadmin 命令名==`
                ].join('\n');
                this.sendWhisper(target, helpText);
            } else {
                const cmdName = params[0].toLowerCase();
                const matched = Object.entries(CMD_CONFIG).find(([k, c]) =>
                    c.level === 'admin' && (c.trigger.includes(cmdName) || k === cmdName)
                );
                if (matched) {
                    this.sendWhisper(target, this.formatHelp(matched[0], prefix));
                } else {
                    this.sendWhisper(target, `未知管理员命令 "${cmdName}"`);
                }
            }
        } catch (err) {
            this.sendChat('管理员帮助出错了');
        }
    },

    handleRoll(msg, params) {
        try {
            if (!params.length) {
                const res = Math.floor(Math.random() * 6) + 1;
                this.sendChat(`[1-6]：${res}`);
                return;
            }
            const arg = params[0];
            const match = arg.match(/^(\d+)d(\d+)$/i);
            if (match) {
                const count = parseInt(match[1]);
                const sides = parseInt(match[2]);
                if (count > 100 || sides > 1000) {
                    this.sendChat('骰子数量太多啦～ 限制100个，面数1000');
                    return;
                }
                const results = [];
                let sum = 0;
                for (let i = 0; i < count; i++) {
                    const r = Math.floor(Math.random() * sides) + 1;
                    results.push(r);
                    sum += r;
                }
                this.sendChat(`${count}d${sides}：${results.join('+')} = ${sum}`);
                return;
            }
            const range = arg.split('-');
            if (range.length === 2) {
                const min = parseInt(range[0]);
                const max = parseInt(range[1]);
                if (!isNaN(min) && !isNaN(max) && min < max) {
                    const res = Math.floor(Math.random() * (max - min + 1)) + min;
                    this.sendChat(`[${min}-${max}]：${res}`);
                    return;
                }
            }
            this.sendChat('参数错误 正确用法：!roll 2d6 或 !roll 1-100');
        } catch (err) {
            this.sendChat('掷骰子出错了');
        }
    },

    handleAfk(msg, params) {
        try {
            const nick = msg.nick;
            const reason = params.join(' ').trim() || 'AFK';
            if (this.afkUsers.has(nick)) {
                const data = this.afkUsers.get(nick);
                const ms = Date.now() - data.time;
                const duration = ms > 3600000 ? `${(ms/3600000).toFixed(1)}h` : `${Math.floor(ms/60000)}m`;
                this.afkUsers.delete(nick);
                this.sendChat(`${nick} ${data.reason || 'AFK'}了 ${duration}，欢迎回来。`);
            } else {
                this.afkUsers.set(nick, { time: Date.now(), reason });
                const msg = Math.random() > 0.5
                    ? `${nick} 正在 ${reason}...，加油！`
                    : `${nick} 正在 ${reason}...，请不要打扰他。`;
                this.sendChat(msg);
            }
        } catch (err) {
            this.sendChat('AFK 命令出错了');
        }
    },

    handleOnline(msg) {
        try {
            const userList = [...this.onlineUsers.entries()]
                .map(([nick, info]) => {
                    const tag = this.modList.has(info.trip) ? STAR : '';
                    return `${nick}${tag}`;
                }).join('、');
            this.sendChat(`当前在线（${this.onlineUsers.size}人）：\n${userList}`);
        } catch (err) {
            this.sendChat('获取在线用户失败');
        }
    },

    handleMsg(msg, params) {
        try {
            if (params.length === 0) {
                this.sendChat(`当前已保存 ${this.messageHistory.length} 条历史`);
                return;
            }
            const n1 = parseInt(params[0]);
            const n2 = parseInt(params[1]);
            let slice, start, end;
            if (!isNaN(n1) && !isNaN(n2)) {
                start = n1 - 1;
                end = n2;
                slice = this.messageHistory.slice(start, end);
            } else if (!isNaN(n1)) {
                start = Math.max(0, this.messageHistory.length - n1);
                end = this.messageHistory.length;
                slice = this.messageHistory.slice(start, end);
            } else {
                this.sendChat('参数错误 正确用法：!msg N1 N2 或 !msg N');
                return;
            }
            if (!slice.length) {
                this.sendChat('无消息');
                return;
            }
            const lines = slice.map(m => {
                const truncated = this.truncate(m.text, CONFIG.CONST.msgTruncateLen, m.id);
                return `#${m.id}: ${m.nick}: ${truncated}`;
            });
            this.sendWhisper(msg.nick, `消息 (${start+1}-${end}):\n${lines.join('\n')}`, true);
        } catch (err) {
            this.sendChat('查询消息失败');
        }
    },

    handleUser(msg, params) {
        try {
            const target = this.stripAt(params[0] || msg.nick);
            const info = this.onlineUsers.get(target);
            if (!info) {
                this.sendChat(`用户 ${target} 不在线`);
                return;
            }
            const trip = info.trip || '无';
            const afk = this.afkUsers.has(target) ? '是' : '否';
            const mod = this.modList.has(info.trip) || info.trip === CONFIG.CONST.ADMIN_TRIPCODE ? '是' : '否';
            this.sendChat(`**${target}** | trip: ${trip} | 在线: 是 | afk: ${afk} | mod: ${mod}`);
        } catch (err) {
            this.sendChat('查询用户失败');
        }
    },

    handleStats(msg) {
        try {
            const top3 = [...this.userActivity.entries()]
                .sort((a,b) => b[1]-a[1]).slice(0,3)
                .map(([n,c]) => `${n}：${c}条`).join('、');
            const now = this.getLocalTime();
            this.sendChat(`统计\n在线：${this.onlineUsers.size}人\n活跃TOP3：${top3 || '无'}\n时间：${now.toLocaleString()}`);
        } catch (err) {
            this.sendChat('统计失败');
        }
    },

    handleSave(msg) {
        try {
            const filename = `hackchat_${CONFIG.channel}_${new Date().toISOString().slice(0,10)}.json`;
            fs.writeFileSync(filename, JSON.stringify(this.messageHistory, null, 2));
            this.sendChat(`导出到 ${filename}`);
        } catch(e) {
            this.sendChat('导出失败');
        }
    },

    handleClear(msg) {
        try {
            this.messageHistory = [];
            this.messageIdMap.clear();
            this.nextMessageId = 1;
            this.sendChat('本地历史已清空');
        } catch (err) {
            this.sendChat('清空失败');
        }
    },

    handleCalc(msg, params) {
        try {
            const expr = params.join(' ');
            if (!expr) {
                this.sendChat('格式：!calc 1+2');
                return;
            }
            if (expr.length > 100 || !/^[0-9\+\-\*\/\(\)\.\s]+$/.test(expr)) throw new Error();
            const res = eval(expr);
            this.sendChat(`==${expr}== = ${isNaN(res) ? '无效' : res}`);
        } catch(e) {
            this.sendChat('计算失败');
        }
    },

    handleWeather(msg, params) {
        try {
            const city = params.join(' ');
            if (!city) {
                this.sendChat('格式：!weather 北京');
                return;
            }
            this.fetchWithTimeout(`https://wttr.in/${encodeURIComponent(city)}?format=3`, {}, 8000)
                .then(res => res.text())
                .then(data => {
                    if (data?.trim()) this.sendChat(data.trim());
                    else this.sendChat(`未查到${city}`);
                })
                .catch(() => this.sendChat('查询失败'));
        } catch (err) {
            this.sendChat('天气查询失败');
        }
    },

    handleEmoji(msg) {
        try {
            this.sendChat(CONFIG.CONST.emojiList[Math.floor(Math.random() * CONFIG.CONST.emojiList.length)]);
        } catch (err) {}
    },

    handleYiyan(msg) {
        try {
            this.fetchWithTimeout('https://v1.hitokoto.cn/?encode=json', {}, 5000)
                .then(res => res.json())
                .then(data => {
                    const text = data.hitokoto?.trim();
                    if (text) this.sendChat(data.from ? `${text} —— ${data.from}` : text);
                    else this.sendChat('获取失败');
                })
                .catch(() => this.sendChat('获取失败'));
        } catch (err) {
            this.sendChat('一言获取失败');
        }
    },

    // 查询历史nick：输出该nick用过的所有nick（相同hash即输出）
    handleHash(msg, params) {
        try {
            const nick = this.stripAt(params[0]);
            if (!nick) {
                this.sendWhisper(msg.nick, '格式：!hash <昵称> [页码]');
                return;
            }
            const page = parseInt(params[1]) || 1;
            const lowerNick = nick.toLowerCase();

            const allNicks = new Set();
            for (const [, nicks] of this.hashHistory.entries()) {
                const arr = [...nicks];
                if (arr.some(n => n.toLowerCase() === lowerNick || n.toLowerCase().startsWith(lowerNick + '#'))) {
                    for (const n of arr) allNicks.add(n);
                }
            }

            if (allNicks.size === 0) {
                this.sendWhisper(msg.nick, `未找到 ${nick} 的历史记录`);
                return;
            }

            const nickList = [...allNicks];
            const total = Math.ceil(nickList.length / CONFIG.CONST.hashPageSize);
            const pageNum = Math.max(1, Math.min(page, total));
            const start = (pageNum - 1) * CONFIG.CONST.hashPageSize;
            const pageItems = nickList.slice(start, start + CONFIG.CONST.hashPageSize);

            let output = pageItems.join('\n');
            if (start + pageItems.length < nickList.length) output += '\n...';
            this.sendWhisper(msg.nick, `${nick} 的历史 nick (第${pageNum}/${total}页):\n${output}`);
        } catch (err) {
            this.sendWhisper(msg.nick, '查询失败');
        }
    },

    // 查询历史hash：输出该nick用过的所有hash
    handleGeth(msg, params) {
        try {
            const nick = this.stripAt(params[0]);
            if (!nick) {
                this.sendWhisper(msg.nick, '格式：!geth <昵称> [页码]');
                return;
            }
            const page = parseInt(params[1]) || 1;
            const lowerNick = nick.toLowerCase();

            const hashes = [];
            for (const [hash, nicks] of this.hashHistory.entries()) {
                if ([...nicks].some(n => n.toLowerCase() === lowerNick || n.toLowerCase().startsWith(lowerNick + '#'))) {
                    hashes.push(hash);
                }
            }

            if (hashes.length === 0) {
                this.sendWhisper(msg.nick, `未找到 ${nick} 的历史hash`);
                return;
            }

            const total = Math.ceil(hashes.length / CONFIG.CONST.hashPageSize);
            const pageNum = Math.max(1, Math.min(page, total));
            const start = (pageNum - 1) * CONFIG.CONST.hashPageSize;
            const pageItems = hashes.slice(start, start + CONFIG.CONST.hashPageSize);

            let output = pageItems.join('\n');
            if (start + pageItems.length < hashes.length) output += '\n...';
            this.sendWhisper(msg.nick, `${nick} 的历史 hash (第${pageNum}/${total}页):\n${output}`);
        } catch (err) {
            this.sendWhisper(msg.nick, '查询失败');
        }
    },

    // 查询指定hash对应的历史nick
    handleLookh(msg, params) {
        try {
            const hash = params[0];
            if (!hash) {
                this.sendWhisper(msg.nick, '格式：!lookh <hash>');
                return;
            }
            const nicks = this.hashHistory.get(hash);
            if (!nicks || nicks.size === 0) {
                this.sendWhisper(msg.nick, `未找到 hash ${hash}`);
                return;
            }
            this.sendWhisper(msg.nick, `Hash ${hash}:\n${[...nicks].join(', ')}`);
        } catch (err) {
            this.sendWhisper(msg.nick, '查询失败');
        }
    },

    handleCode(msg, params) {
        try {
            const code = params.join(' ');
            if (!code) {
                this.sendChat('格式：.code <JavaScript 代码>');
                return;
            }
            if (code.length > CONFIG.CONST.codeMaxInputLen) {
                this.sendChat('代码过长');
                return;
            }
            const sandbox = Object.create(null);
            Object.freeze(Object.getPrototypeOf(sandbox));
            const result = vm.runInNewContext(code, sandbox, { timeout: 1000 });
            const output = String(result).slice(0, CONFIG.CONST.codeTruncateLen);
            this.sendChat(output);
        } catch (err) {
            this.sendChat(`执行错误: ${err.message}`);
        }
    },

    handleColor(msg, params) {
        try {
            const target = this.stripAt(params[0] || msg.nick);
            const user = this.onlineUsers.get(target);
            if (!user) {
                this.sendChat(`用户 ${target} 不在线`);
                return;
            }
            this.sendChat(user.color ? `${target} 颜色: ${user.color}` : `${target} 默认颜色`);
        } catch (err) {
            this.sendChat('颜色查询失败');
        }
    },

    handleWelc(msg, params) {
        try {
            const trip = msg.trip;
            if (!trip) {
                this.sendWhisper(msg.nick, '无识别码');
                return;
            }
            const text = params.join(' ').trim();
            if (!text) {
                if (this.welcomeMessages.has(trip)) {
                    this.welcomeMessages.delete(trip);
                    this.markDirty();
                    this.sendWhisper(msg.nick, '已清除欢迎语');
                } else {
                    this.sendWhisper(msg.nick, '未设置欢迎语');
                }
            } else {
                this.welcomeMessages.set(trip, text);
                this.markDirty();
                this.sendWhisper(msg.nick, `欢迎语已设置：${text}`);
            }
        } catch (err) {
            this.sendWhisper(msg.nick, '设置失败');
        }
    },

    handleSeen(msg, params) {
        try {
            const target = this.stripAt(params[0]);
            if (!target) {
                this.sendChat('格式：!seen <昵称>');
                return;
            }
            const data = this.lastSeen.get(target);
            if (!data) {
                this.sendChat(`未见 ${target}`);
                return;
            }
            const diff = Date.now() - data.time;
            const timeStr = diff > 86400000 ? `${Math.floor(diff/86400000)}天前`
                : diff > 3600000 ? `${Math.floor(diff/3600000)}小时前`
                : `${Math.floor(diff/60000)}分钟前`;
            this.sendChat(`${target} 最后发言 ${timeStr}：${data.msg.slice(0, 100)}`);
        } catch (err) {
            this.sendChat('查询失败');
        }
    },

    handleLook(msg, params) {
        try {
            const target = this.stripAt(params[0]);
            if (!target) {
                this.sendChat('格式：!look <昵称>');
                return;
            }
            const joinTime = this.userJoinTime.get(target);
            const activity = this.userActivity.get(target) || 0;
            if (!joinTime && !activity) {
                this.sendChat(`无 ${target} 记录`);
                return;
            }
            let text = `**${target}**\n`;
            if (joinTime) {
                const joinDate = new Date(joinTime);
                const joinedAgo = Date.now() - joinTime;
                const joinedStr = joinedAgo > 86400000 ? `${Math.floor(joinedAgo/86400000)}天` : `${Math.floor(joinedAgo/3600000)}小时`;
                text += `加入：${joinDate.toLocaleString()}（${joinedStr}前）\n`;
            }
            if (activity) {
                text += `发言：${activity}次\n`;
                if (joinTime) {
                    const hours = (Date.now() - joinTime) / 3600000;
                    text += `频率：${hours > 0 ? (activity / hours).toFixed(1) : 'N/A'}条/小时\n`;
                }
            }
            this.sendChat(text);
        } catch (err) {
            this.sendChat('分析失败');
        }
    },

    handlePeep(msg, params) {
        try {
            if (params.length === 0) {
                this.sendWhisper(msg.nick, '格式：!peep <数量> 或 !peep <起始> <结束>');
                return;
            }
            let start, end;
            const p1 = params[0];
            const p2 = params[1];
            if (p1 && p2) {
                const n1 = parseInt(p1);
                const n2 = parseInt(p2);
                if (!isNaN(n1) && !isNaN(n2) && n1 > 0 && n2 > 0) {
                    if (n1 <= n2) {
                        start = Math.max(0, this.messageHistory.length - n2);
                        end = this.messageHistory.length - n1 + 1;
                    } else {
                        start = Math.max(0, this.messageHistory.length - n1);
                        end = this.messageHistory.length - n2 + 1;
                    }
                } else {
                    this.sendWhisper(msg.nick, '参数无效，例如 !peep 200 100');
                    return;
                }
            } else {
                const n = parseInt(p1);
                if (isNaN(n) || n <= 0) {
                    this.sendWhisper(msg.nick, '数量须正整数');
                    return;
                }
                start = Math.max(0, this.messageHistory.length - n);
                end = this.messageHistory.length;
            }
            if (start >= end) {
                this.sendWhisper(msg.nick, '无消息');
                return;
            }
            const slice = this.messageHistory.slice(start, end);
            const lines = slice.map(m => {
                const truncated = this.truncate(m.text, CONFIG.CONST.msgTruncateLen, m.id);
                return `${m.nick}: ${truncated}`;
            });
            this.sendWhisper(msg.nick, `消息 (${start+1}-${end}):\n${lines.join('\n')}`, true);
        } catch (err) {
            this.sendWhisper(msg.nick, '查询失败');
        }
    },

    handlePrime(msg, params) {
        try {
            const num = params[0];
            if (!num || num.length > CONFIG.CONST.primeMaxLen) {
                this.sendChat('数字过长，最多15位');
                return;
            }
            const n = parseInt(num);
            if (isNaN(n) || n < 2) {
                this.sendChat('请输入 >1 整数');
                return;
            }
            let val = n, factors = [];
            for (let i = 2; i <= Math.sqrt(val); i++) {
                while (val % i === 0) {
                    factors.push(i);
                    val /= i;
                }
            }
            if (val > 1) factors.push(val);
            this.sendChat(`${n} = ${factors.join(' × ')}`);
        } catch (err) {
            this.sendChat('分解失败');
        }
    },

    handleHug(msg, params) {
        try {
            const target = this.stripAt(params[0]);
            if (!target) {
                this.sendChat('格式：!hug <昵称>');
                return;
            }
            this.sendChat(`/me hugs @${target}`, true);
        } catch (err) {
            this.sendChat('拥抱失败');
        }
    },

    handleShoot(msg, params) {
        try {
            const target = this.stripAt(params[0]);
            if (!target) {
                this.sendChat('格式：!shoot <昵称>');
                return;
            }
            const hit = Math.random() > 0.15;
            if (hit) {
                const part = CONFIG.CONST.bodyParts[Math.floor(Math.random() * CONFIG.CONST.bodyParts.length)];
                this.sendChat(`/me shoots @${target} in the ${part}!`, true);
            } else {
                this.sendChat(`/me shoots at @${target}, but misses!`, true);
            }
        } catch (err) {
            this.sendChat('射击失败');
        }
    },

    handleLori(msg, params) {
        try {
            const char = params[0] || '';
            const map = {
                'l': '"l" 是 L 的小写',
                'I': '"I" 是 i 的大写',
                '0': '"0" 是数字零',
                'O': '"O" 是 o 的大写',
                '|': '"|" 是竖线',
                '丨': '"丨" 汉字读 gǔn'
            };
            this.sendChat(map[char] || `无法识别 "${char}"，试试 l / I / 0 / O / | / 丨`);
        } catch (err) {
            this.sendChat('字符辨别失败');
        }
    },

    handleUwu(msg) {
        try {
            this.sendChat('😸');
            this.sendChat(`/uwuify ${msg.nick}`);
        } catch (err) {}
    },

    handleCountdown(msg, params) {
        try {
            const dateStr = params[0];
            if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
                this.sendUsage('countdown', msg);
                return;
            }
            const target = new Date(dateStr);
            const now = new Date();
            const diff = target - now;
            if (diff < 0) {
                this.sendChat(`${dateStr} 已经过去了`);
                return;
            }
            const days = Math.floor(diff / 86400000);
            const hours = Math.floor((diff % 86400000) / 3600000);
            const minutes = Math.floor((diff % 3600000) / 60000);
            this.sendChat(`距离 ${dateStr} 还有 ${days} 天 ${hours} 时 ${minutes} 分`);
        } catch (err) {
            this.sendChat('倒计时计算失败');
        }
    },

    handleMeme(msg) {
        try {
            this.fetchWithTimeout('https://meme-api.com/gimme', {}, 8000)
                .then(res => res.json())
                .then(data => {
                    if (data && data.url) {
                        this.sendChat(`${data.title}\n${data.url}`);
                    } else {
                        this.sendChat('获取梗图失败');
                    }
                })
                .catch(() => this.sendChat('梗图服务暂时不可用'));
        } catch (err) {
            this.sendChat('获取梗图失败');
        }
    },

    handleLeft(msg, params) {
        try {
            if (params.length < 2) {
                this.sendChat('格式：!left <trip> <内容> 或 !left *nick <内容>');
                return;
            }
            const fromNick = msg.nick;
            const target = params[0];
            const content = params.slice(1).join(' ');
            let toNick = null, toTrip = null;
            if (target.startsWith('*')) {
                toNick = target.slice(1);
            } else {
                toTrip = target;
            }
            this.leftMessages.push({ toNick, toTrip, fromNick, content, time: Date.now() });
            this.markDirty();
            this.sendChat(`留言已保存`);
        } catch (err) {
            this.sendChat('留言失败');
        }
    },

    handleLoog(msg, params) {
        try {
            const id = parseInt(params[0]);
            if (isNaN(id)) {
                this.sendWhisper(msg.nick, '格式：!loog <ID>');
                return;
            }
            const record = this.messageIdMap.get(id);
            if (!record) {
                this.sendWhisper(msg.nick, `未找到消息 #${id}`);
                return;
            }
            this.sendWhisper(msg.nick, `#${id}: ${record.nick}: ${record.text}`);
        } catch (err) {
            this.sendWhisper(msg.nick, '查询失败');
        }
    },

    handleSub(msg, params) {
        try {
            const trip = msg.trip;
            if (!trip) {
                this.sendWhisper(msg.nick, '你没有识别码，无法订阅');
                return;
            }
            const keyword = params.join(' ').trim();
            if (!keyword) {
                this.sendUsage('sub', msg);
                return;
            }
            if (!this.subscriptions.has(trip)) this.subscriptions.set(trip, new Set());
            const subs = this.subscriptions.get(trip);
            if (subs.size >= 20) {
                this.sendWhisper(msg.nick, '最多订阅20个关键词');
                return;
            }
            subs.add(keyword);
            this.markDirty();
            this.sendWhisper(msg.nick, `已订阅关键词："${keyword}"`);
        } catch (err) {
            this.sendWhisper(msg.nick, '订阅失败');
        }
    },

    handleUnsub(msg, params) {
        try {
            const trip = msg.trip;
            if (!trip) {
                this.sendWhisper(msg.nick, '你没有识别码');
                return;
            }
            const keyword = params.join(' ').trim();
            if (!keyword) {
                this.sendUsage('unsub', msg);
                return;
            }
            const subs = this.subscriptions.get(trip);
            if (!subs || !subs.has(keyword)) {
                this.sendWhisper(msg.nick, `你未订阅 "${keyword}"`);
                return;
            }
            subs.delete(keyword);
            if (subs.size === 0) this.subscriptions.delete(trip);
            this.markDirty();
            this.sendWhisper(msg.nick, `已取消订阅 "${keyword}"`);
        } catch (err) {
            this.sendWhisper(msg.nick, '取消订阅失败');
        }
    },

    handleSubs(msg) {
        try {
            const trip = msg.trip;
            if (!trip) {
                this.sendWhisper(msg.nick, '你没有识别码');
                return;
            }
            const subs = this.subscriptions.get(trip);
            if (!subs || subs.size === 0) {
                this.sendWhisper(msg.nick, '你还没有订阅任何关键词');
                return;
            }
            this.sendWhisper(msg.nick, `你订阅的关键词：${[...subs].join('、')}`);
        } catch (err) {
            this.sendWhisper(msg.nick, '查看订阅失败');
        }
    },

    handleVote(msg, params) {
        try {
            const trip = msg.trip;
            if (!trip) {
                this.sendChat('你没有识别码，无法使用投票');
                return;
            }
            const sub = params[0]?.toLowerCase();
            if (!sub) {
                this.sendChat('投票子命令：create, end, result, 或投票选项');
                return;
            }
            const currentVote = this.votes.get('current');
            const isCreator = currentVote && currentVote.creator === trip;
            if (sub === 'create') {
                if (currentVote && !currentVote.ended) {
                    this.sendChat('当前已有投票，请先结束');
                    return;
                }
                const topic = params.slice(1).join(' ');
                if (!topic) {
                    this.sendUsage('vote', msg);
                    return;
                }
                this.votes.set('current', {
                    topic,
                    options: new Map(),
                    voters: new Set(),
                    creator: trip,
                    ended: false
                });
                this.markDirty();
                this.sendChat(`投票已创建：${topic}\n输入 !vote <选项> 参与投票`);
            } else if (sub === 'end') {
                if (!currentVote || currentVote.ended) {
                    this.sendChat('当前没有进行中的投票');
                    return;
                }
                if (!isCreator && !this.hasModAuth(msg)) {
                    this.sendChat('只有创建者或Mod可以结束投票');
                    return;
                }
                currentVote.ended = true;
                this.sendChat('投票已结束，使用 !vote result 查看结果');
                this.markDirty();
            } else if (sub === 'result') {
                if (!currentVote) {
                    this.sendChat('暂无投票');
                    return;
                }
                const opts = [...currentVote.options.entries()];
                if (!opts.length) {
                    this.sendChat('还没有人投票');
                    return;
                }
                const sorted = opts.sort((a,b) => b[1]-a[1]);
                const result = sorted.map(([opt, count]) => `${opt}：${count}票`).join('\n');
                this.sendChat(`${currentVote.topic}\n${result}`);
            } else {
                if (!currentVote || currentVote.ended) {
                    this.sendChat('当前没有进行中的投票');
                    return;
                }
                if (currentVote.voters.has(trip)) {
                    this.sendChat('你已经投过票了');
                    return;
                }
                const option = params.join(' ').trim();
                if (!option) {
                    this.sendUsage('vote', msg);
                    return;
                }
                if (!currentVote.options.has(option)) currentVote.options.set(option, 0);
                currentVote.options.set(option, currentVote.options.get(option) + 1);
                currentVote.voters.add(trip);
                this.markDirty();
                this.sendChat(`已投票："${option}"`);
            }
        } catch (err) {
            this.sendChat('投票操作失败');
        }
    },

    handleTopwords(msg, params) {
        try {
            const count = parseInt(params[0]) || 10;
            const sorted = [...this.wordCount.entries()]
                .sort((a,b) => b[1]-a[1])
                .slice(0, count);
            if (!sorted.length) {
                this.sendChat('暂无热词数据');
                return;
            }
            const list = sorted.map(([word, cnt], i) => `[${i+1}] ${word} (${cnt}次)`).join('\n');
            this.sendChat(`热词 TOP${Math.min(count, sorted.length)}：\n${list}`);
        } catch (err) {
            this.sendChat('热词统计失败');
        }
    },

    handleKkme(msg, params) {
        try {
            const sender = msg.nick;
            const trip = msg.trip;
            if (!trip) {
                this.sendChat('你没有识别码，无法使用此命令');
                return;
            }
            const target = params[0] ? this.stripAt(params[0]) : null;
            let kicked = [];
            for (const [nick, data] of this.onlineUsers.entries()) {
                if (nick === sender) continue;
                if (target && nick !== target) continue;
                if (data.trip === trip) {
                    this.kickUser(nick);
                    kicked.push(nick);
                }
            }
            if (kicked.length) this.sendChat(`已踢出同识别码僵尸号：${kicked.join('、')}`);
            else this.sendChat('没有找到同识别码的僵尸号');
        } catch (err) {
            this.sendChat('操作失败');
        }
    },

    // Mod 命令
    handleKick(msg, params) {
        try {
            const target = this.stripAt(params[0]);
            if (!target) {
                this.sendUsage('kick', msg, CONFIG.CONST.MOD_PREFIX);
                return;
            }
            if (target === CONFIG.botNick) {
                this.sendChat('不能踢自己');
                return;
            }
            this.kickUser(target);
            this.sendChat(`已踢出 ${target} ${ADMIN_ACTION}`);
        } catch (err) {
            this.sendChat('踢出失败');
        }
    },

    handleAddword(msg, params) {
        try {
            const word = params.join(' ');
            if (!word) {
                this.sendUsage('addword', msg, CONFIG.CONST.MOD_PREFIX);
                return;
            }
            this.banWords.push(word);
            this.markDirty();
            this.sendChat(`已添加封禁词：${word}`);
        } catch (err) {
            this.sendChat('添加失败');
        }
    },

    handleDelword(msg, params) {
        try {
            const arg = params.join(' ');
            if (!arg) {
                this.sendUsage('delword', msg, CONFIG.CONST.MOD_PREFIX);
                return;
            }
            const index = parseInt(arg);
            if (!isNaN(index) && index >= 1 && index <= this.banWords.length) {
                const removed = this.banWords.splice(index - 1, 1)[0];
                this.markDirty();
                this.sendChat(`已删除封禁词[${index}]：${removed}`);
                return;
            }
            const idx = this.banWords.indexOf(arg);
            if (idx !== -1) {
                this.banWords.splice(idx, 1);
                this.markDirty();
                this.sendChat(`已删除：${arg}`);
            } else {
                this.sendChat(`未找到封禁词 "${arg}"`);
            }
        } catch (err) {
            this.sendChat('删除失败');
        }
    },

    handleModlist(msg) {
        try {
            const list = [...this.modList];
            if (list.length) {
                this.sendWhisper(msg.nick, `${PLACEHOLDER}\nMod列表：${list.join(', ')}`, true);
            } else {
                this.sendWhisper(msg.nick, `${PLACEHOLDER}\n暂无 Mod`, true);
            }
        } catch (err) {
            this.sendWhisper(msg.nick, '查询Mod列表失败');
        }
    },

    handleLock(msg) {
        try {
            this.sendChat('/lockroom', true);
            this.sendChat('频道已锁定');
        } catch (err) {
            this.sendChat('锁房失败');
        }
    },

    handleUnlock(msg) {
        try {
            this.sendChat('/unlockroom', true);
            this.sendChat('房间已解锁');
        } catch (err) {
            this.sendChat('解锁失败');
        }
    },

    handleSlow(msg, params) {
        try {
            if (params.length === 0) {
                this.sendChat(`慢速模式：${this.slowModeEnabled ? '开启' : '关闭'}，间隔 ${this.slowModeInterval} 秒`);
                return;
            }
            const action = params[0].toLowerCase();
            if (action === 'on') {
                const sec = parseInt(params[1]) || CONFIG.CONST.slowModeDefault;
                if (sec < 1 || sec > 60) {
                    this.sendChat('间隔须在 1~60 秒之间');
                    return;
                }
                this.slowModeEnabled = true;
                this.slowModeInterval = sec;
                this.markDirty();
                this.sendChat(`慢速模式已开启，发言间隔 ${sec} 秒`);
            } else if (action === 'off') {
                this.slowModeEnabled = false;
                this.markDirty();
                this.sendChat('慢速模式已关闭');
            } else {
                this.sendUsage('slow', msg, CONFIG.CONST.MOD_PREFIX);
            }
        } catch (err) {
            this.sendChat('慢速模式操作失败');
        }
    },

    handleWhitelist(msg, params) {
        try {
            const sub = params[0]?.toLowerCase();
            if (!sub) {
                this.sendChat('白名单子命令：add, del, list');
                return;
            }
            if (sub === 'add') {
                const trip = params[1];
                if (!trip || !/^[A-Za-z0-9+/]{6}$/.test(trip)) {
                    this.sendChat('无效的 tripcode 格式');
                    return;
                }
                this.whitelist.add(trip);
                this.markDirty();
                this.sendChat(`已添加白名单：${trip}`);
            } else if (sub === 'del') {
                const trip = params[1];
                if (!trip) {
                    this.sendChat('格式：;whitelist del <tripcode>');
                    return;
                }
                if (this.whitelist.delete(trip)) {
                    this.markDirty();
                    this.sendChat(`已删除白名单：${trip}`);
                } else {
                    this.sendChat(`未找到 ${trip}`);
                }
            } else if (sub === 'list') {
                const list = [...this.whitelist];
                if (list.length) this.sendWhisper(msg.nick, `${PLACEHOLDER}\n白名单：${list.join(', ')}`, true);
                else this.sendWhisper(msg.nick, `${PLACEHOLDER}\n暂无白名单用户`, true);
            } else {
                this.sendChat('白名单子命令：add, del, list');
            }
        } catch (err) {
            this.sendChat('白名单操作失败');
        }
    },

    handleAdminlog(msg, params) {
        try {
            const logs = this.adminLogs.slice(-10).reverse();
            if (!logs.length) {
                this.sendWhisper(msg.nick, '暂无管理日志');
                return;
            }
            const list = logs.map(l =>
                `${new Date(l.time).toLocaleString()} [${l.action}] ${l.target} (by ${l.by})`
            ).join('\n');
            this.sendWhisper(msg.nick, `管理日志（最近10条）：\n${list}`);
        } catch (err) {
            this.sendWhisper(msg.nick, '查看日志失败');
        }
    },

    // Admin 命令
    handleMod(msg, params) {
        try {
            const action = params[0]?.toLowerCase();
            if (action === 'on') {
                this.modMode = true;
                this.markDirty();
                this.sendChat('已开启协管功能');
            } else if (action === 'off') {
                this.modMode = false;
                this.markDirty();
                this.sendChat('已关闭协管功能');
            } else {
                this.sendChat('格式：.mod on|off');
            }
        } catch (err) {
            this.sendChat('协管模式操作失败');
        }
    },

    handleAddmod(msg, params) {
        try {
            const trip = params[0];
            if (!trip || !/^[A-Za-z0-9+/]{6}$/.test(trip)) {
                this.sendChat('无效 tripcode');
                return;
            }
            this.modList.add(trip);
            this.markDirty();
            this.sendChat(`已添加 Mod：${trip}`);
            this.addAdminLog('addmod', trip, msg.trip);
        } catch (err) {
            this.sendChat('添加Mod失败');
        }
    },

    handleDelmod(msg, params) {
        try {
            const trip = params[0];
            if (!trip) {
                this.sendChat('格式：.delmod <tripcode>');
                return;
            }
            if (this.modList.delete(trip)) {
                this.markDirty();
                this.sendChat(`已删除 Mod：${trip}`);
                this.addAdminLog('delmod', trip, msg.trip);
            } else {
                this.sendChat(`未找到 ${trip}`);
            }
        } catch (err) {
            this.sendChat('删除Mod失败');
        }
    },

    handlePrtt(msg, params) {
        try {
            const nick = this.stripAt(params[0]);
            const trip = params[1];
            if (!nick || !trip) {
                this.sendChat('格式：.prtt <nick> <trip>');
                return;
            }
            if (this.nickTripBinding.has(nick) && this.nickTripBinding.get(nick) !== trip) {
                this.sendChat(`昵称 ${nick} 已绑定到 ${this.nickTripBinding.get(nick)}，请先解绑`);
                return;
            }
            this.nickTripBinding.set(nick, trip);
            this.markDirty();
            this.sendChat(`已绑定 ${nick} -> ${trip}`);
        } catch (err) {
            this.sendChat('绑定失败');
        }
    },

    handleDelp(msg, params) {
        try {
            const nick = this.stripAt(params[0]);
            if (!nick) {
                this.sendChat('格式：.delp <nick>');
                return;
            }
            if (this.nickTripBinding.delete(nick)) {
                this.markDirty();
                this.sendChat(`已解绑 ${nick}`);
            } else {
                this.sendChat(`未找到 ${nick} 的绑定`);
            }
        } catch (err) {
            this.sendChat('解绑失败');
        }
    },

    handleMute(msg, params) {
        try {
            const target = this.stripAt(params[0]);
            const minutes = parseInt(params[1]);
            if (!target || isNaN(minutes) || minutes <= 0) {
                this.sendUsage('mute', msg, CONFIG.CONST.ADMIN_PREFIX);
                return;
            }
            this.silencedUsers.set(target, Date.now() + minutes * 60000);
            this.sendChat(`${target} 已被禁言${minutes}分钟 ${ADMIN_ACTION}`);
            this.addAdminLog('mute', target, msg.trip);
        } catch (err) {
            this.sendChat('禁言失败');
        }
    },

    handleSilence(msg, params) {
        try {
            const target = this.stripAt(params[0]);
            const minutes = parseInt(params[1]);
            if (!target) {
                this.sendUsage('silence', msg, CONFIG.CONST.ADMIN_PREFIX);
                return;
            }
            if (!isNaN(minutes) && minutes > 0) {
                this.silencedUsers.set(target, Date.now() + minutes * 60000);
                this.sendChat(`${target} 已被禁言${minutes}分钟 ${ADMIN_ACTION}`);
            } else {
                this.silencedUsers.set(target, Infinity);
                this.sendChat(`${target} 已被永久禁言 ${ADMIN_ACTION}`);
            }
            this.addAdminLog('silence', target, msg.trip);
        } catch (err) {
            this.sendChat('禁言失败');
        }
    },

    handleUnsilence(msg, params) {
        try {
            const target = this.stripAt(params[0]);
            if (!target) {
                this.sendUsage('unsilence', msg, CONFIG.CONST.ADMIN_PREFIX);
                return;
            }
            if (this.silencedUsers.delete(target)) {
                this.sendChat(`${target} 禁言已解除`);
                this.addAdminLog('unsilence', target, msg.trip);
            } else {
                this.sendChat(`${target} 未被禁言`);
            }
        } catch (err) {
            this.sendChat('解除禁言失败');
        }
    },

    handleBan(msg, params) {
        try {
            if (params.length < 2) {
                this.sendChat('格式：.ban <nick|trip|hash> <值>');
                return;
            }
            const type = params[0].toLowerCase();
            const value = params[1];
            if (!['nick', 'trip', 'hash'].includes(type)) {
                this.sendChat('类型错误，可选：nick, trip, hash');
                return;
            }
            let target = value;
            if (type === 'nick') target = this.stripAt(value);
            this.blackList.add(target);
            this.markDirty();
            for (const [nick, data] of this.onlineUsers.entries()) {
                if ((type === 'nick' && nick === target) ||
                    (type === 'trip' && data.trip === target) ||
                    (type === 'hash' && data.hash === target)) {
                    this.kickUser(nick);
                }
            }
            this.sendChat(`${type} ${target} 已被封禁 ${ADMIN_ACTION}`);
            this.addAdminLog('ban', `${type}:${target}`, msg.trip);
        } catch (err) {
            this.sendChat('封禁失败');
        }
    },

    handleUnban(msg, params) {
        try {
            if (params.length < 2) {
                this.sendChat('格式：.unban <nick|trip|hash> <值>');
                return;
            }
            const type = params[0].toLowerCase();
            const value = params[1];
            if (!['nick', 'trip', 'hash'].includes(type)) {
                this.sendChat('类型错误，可选：nick, trip, hash');
                return;
            }
            let target = value;
            if (type === 'nick') target = this.stripAt(value);
            if (this.blackList.delete(target)) {
                this.markDirty();
                this.sendChat(`${type} ${target} 已解除封禁`);
                this.addAdminLog('unban', `${type}:${target}`, msg.trip);
            } else {
                this.sendChat(`${type} ${target} 不在黑名单中`);
            }
        } catch (err) {
            this.sendChat('解除封禁失败');
        }
    },

    handleTempban(msg, params) {
        try {
            const nick = this.stripAt(params[0]);
            const minutes = parseInt(params[1]);
            if (!nick || isNaN(minutes) || minutes <= 0) {
                this.sendUsage('tempban', msg, CONFIG.CONST.ADMIN_PREFIX);
                return;
            }
            this.tempbanned.set(nick, Date.now() + minutes * 60000);
            this.markDirty();
            this.kickUser(nick);
            this.sendChat(`${nick} 已被临时封禁 ${minutes} 分钟 ${ADMIN_ACTION}`);
            this.addAdminLog('tempban', `${nick} ${minutes}m`, msg.trip);
        } catch (err) {
            this.sendChat('临时封禁失败');
        }
    },

    handleCon(msg, params) {
        try {
            const content = params.join(' ');
            if (!content) {
                this.sendUsage('con', msg, CONFIG.CONST.ADMIN_PREFIX);
                return;
            }
            this.sendChat(content, true);
        } catch (err) {
            this.sendChat('输出失败');
        }
    },

    handleAnnounce(msg, params) {
        try {
            const text = params.join(' ');
            if (!text) {
                this.sendUsage('announce', msg, CONFIG.CONST.ADMIN_PREFIX);
                return;
            }
            this.sendChat(`**频道公告**\n${text}`);
        } catch (err) {
            this.sendChat('公告失败');
        }
    },

    handlePann(msg, params) {
        try {
            const sub = params[0];
            if (!sub) {
                this.sendChat('格式：.pann add|remove|list|clear');
                return;
            }
            switch (sub) {
                case 'add': {
                    const interval = parseInt(params[1]);
                    const content = params.slice(2).join(' ');
                    if (isNaN(interval) || interval <= 0 || !content) {
                        this.sendChat('格式：.pann add <分钟> <内容>');
                        return;
                    }
                    this.scheduledAnnouncements.push({ content, interval, lastSendTime: 0 });
                    this.markDirty();
                    this.sendChat(`已添加定时公告（间隔${interval}分）：${content}`);
                    break;
                }
                case 'remove': {
                    const idx = parseInt(params[1]);
                    if (isNaN(idx) || idx < 1 || idx > this.scheduledAnnouncements.length) {
                        const keyword = params.slice(1).join(' ');
                        const found = this.scheduledAnnouncements.findIndex(a => a.content === keyword);
                        if (found !== -1) {
                            this.scheduledAnnouncements.splice(found, 1);
                            this.markDirty();
                            this.sendChat(`已移除公告：${keyword}`);
                        } else {
                            this.sendChat('索引无效或内容不匹配');
                        }
                        return;
                    }
                    const removed = this.scheduledAnnouncements.splice(idx - 1, 1)[0];
                    this.markDirty();
                    this.sendChat(`已移除 #${idx}：${removed.content}`);
                    break;
                }
                case 'list': {
                    if (!this.scheduledAnnouncements.length) {
                        this.sendChat('无定时公告');
                        return;
                    }
                    const pageSize = 10;
                    const page = parseInt(params[1]) || 1;
                    const total = Math.ceil(this.scheduledAnnouncements.length / pageSize);
                    const start = (page - 1) * pageSize;
                    const pageItems = this.scheduledAnnouncements.slice(start, start + pageSize);
                    const list = pageItems.map((a, i) =>
                        `[${start + i + 1}] [${a.interval}分] ${a.content}`
                    ).join('\n');
                    let output = `定时公告 (第${page}/${total}页)：\n${list}`;
                    if (page < total) {
                        output += `\n.pann list ${page + 1} 查看下一页`;
                    }
                    this.sendChat(output);
                    break;
                }
                case 'clear':
                    this.scheduledAnnouncements = [];
                    this.markDirty();
                    this.sendChat('已清空定时公告');
                    break;
                default:
                    this.sendChat('未知子命令');
            }
        } catch (err) {
            this.sendChat('定时公告操作失败');
        }
    },

    handleIf(msg, params) {
        try {
            const sub = params[0];
            if (!sub) {
                this.sendChat('格式：.if add|addz|list|remove|clear');
                return;
            }
            switch (sub) {
                case 'add': {
                    const prob = parseInt(params[params.length - 1]);
                    if (isNaN(prob) || prob < 0 || prob > 100) {
                        this.sendChat('概率0-100');
                        return;
                    }
                    const reply = params.slice(-2, -1).join(' ') || '';
                    const trigger = params.slice(1, -2).join(' ') || '';
                    if (!reply) {
                        this.sendChat('格式：.if add <触发词> <回复> <概率>');
                        return;
                    }
                    this.ifRules.push({ trigger, reply, probability: prob, isRegex: false, id: Date.now() });
                    this.markDirty();
                    this.sendChat(`已添加：[${trigger || '空'}] -> [${reply}] (${prob}%)`);
                    break;
                }
                case 'addz': {
                    const probZ = parseInt(params[params.length - 1]);
                    if (isNaN(probZ) || probZ < 0 || probZ > 100) {
                        this.sendChat('概率0-100');
                        return;
                    }
                    const replyZ = params.slice(-2, -1).join(' ') || '';
                    const regex = params.slice(1, -2).join(' ') || '';
                    if (!replyZ) {
                        this.sendChat('格式：.if addz <正则> <回复> <概率>');
                        return;
                    }
                    this.ifRules.push({ trigger: regex, reply: replyZ, probability: probZ, isRegex: true, id: Date.now() });
                    this.markDirty();
                    this.sendChat(`已添加：[${regex || '空'}] -> [${replyZ}] (${probZ}%) [正则]`);
                    break;
                }
                case 'list': {
                    if (!this.ifRules.length) {
                        this.sendChat('无规则');
                        return;
                    }
                    const pageSize = 10;
                    const page = parseInt(params[1]) || 1;
                    const total = Math.ceil(this.ifRules.length / pageSize);
                    const start = (page - 1) * pageSize;
                    const pageItems = this.ifRules.slice(start, start + pageSize);
                    const list = pageItems.map((r, i) =>
                        `[${start + i + 1}] ${r.isRegex ? '[正则]' : ''}[${r.trigger || '空'}] -> [${r.reply}] (${r.probability}%)`
                    ).join('\n');
                    let output = `自动回复规则 (第${page}/${total}页)：\n${list}`;
                    if (page < total) {
                        output += `\n.if list ${page + 1} 查看下一页`;
                    }
                    this.sendChat(output);
                    break;
                }
                case 'remove': {
                    const arg = params[1];
                    if (!arg) {
                        this.sendChat('格式：.if remove <序号> 或 .if remove <内容片段>');
                        return;
                    }
                    const num = parseInt(arg);
                    if (!isNaN(num) && num >= 1 && num <= this.ifRules.length) {
                        const removed = this.ifRules.splice(num - 1, 1)[0];
                        this.markDirty();
                        this.sendChat(`已移除：[${removed.trigger || '空'}]`);
                    } else {
                        const keyword = params.slice(1).join(' ');
                        const found = this.ifRules.findIndex(r => r.trigger === keyword || r.reply === keyword);
                        if (found !== -1) {
                            const removed = this.ifRules.splice(found, 1)[0];
                            this.markDirty();
                            this.sendChat(`已移除：[${removed.trigger || '空'}]`);
                        } else {
                            this.sendChat('未找到匹配的规则');
                        }
                    }
                    break;
                }
                case 'clear':
                    this.ifRules = [];
                    this.markDirty();
                    this.sendChat('已清空规则');
                    break;
                default:
                    this.sendChat('未知子命令');
            }
        } catch (err) {
            this.sendChat('自动回复操作失败');
        }
    },

    handleTalk(msg, params) {
        try {
            const action = params[0]?.toLowerCase();
            if (action === 'off') {
                this.isMuted = true;
                this.sendChat('闭嘴了', true);
            } else if (action === 'on') {
                this.isMuted = false;
                this.sendChat('张嘴了', true);
            } else {
                this.sendChat('格式：.talk on|off');
            }
        } catch (err) {
            this.sendChat('发言开关操作失败');
        }
    },

    handleRandom(msg, params) {
        try {
            const arg = params[0]?.toLowerCase();
            if (arg === 'off') {
                this.randomEnabled = false;
                this.markDirty();
                this.sendChat('随机回复已关闭');
            } else if (arg === 'on') {
                this.randomEnabled = true;
                this.markDirty();
                this.sendChat('随机回复已开启');
            } else {
                const prob = parseInt(arg);
                if (!isNaN(prob) && prob >= 0 && prob <= 100) {
                    this.randomEnabled = true;
                    this.randomProb = prob;
                    this.markDirty();
                    this.sendChat(`随机回复概率设为 ${prob}%`);
                } else {
                    this.sendChat('格式：.random off/on/N (N=0-100)');
                }
            }
        } catch (err) {
            this.sendChat('随机回复操作失败');
        }
    },

    handleV(msg) {
        try {
            const uptime = Date.now() - BOT_START_TIME;
            const days = Math.floor(uptime / 86400000);
            const hours = Math.floor((uptime % 86400000) / 3600000);
            const minutes = Math.floor((uptime % 3600000) / 60000);
            const seconds = Math.floor((uptime % 60000) / 1000);
            const startTime = new Date(BOT_START_TIME).toLocaleString();
            this.sendChat(`启动：${startTime}\n运行：${days}天 ${hours}时 ${minutes}分 ${seconds}秒`);
        } catch (err) {
            this.sendChat('获取运行信息失败');
        }
    },

    handleDataclear(msg) {
        try {
            this.onlineUsers.clear();
            this.userActivity.clear();
            this.userJoinTime.clear();
            this.afkUsers.clear();
            this.silencedUsers.clear();
            this.messageHistory = [];
            this.messageIdMap.clear();
            this.nextMessageId = 1;
            this.recentMsgTimestamps = [];
            this.ifRules = [];
            this.scheduledAnnouncements = [];
            this.hashHistory.clear();
            this.welcomeMessages.clear();
            this.lastSeen.clear();
            this.banWords = [];
            this.modList.clear();
            this.lyMessages = [];
            this.leftMessages = [];
            this.nickTripBinding.clear();
            this.modMode = false;
            this.isMuted = false;
            this.randomEnabled = false;
            this.randomProb = 0;
            this.rl = new RateLimiter(30, 13);
            this.subscriptions.clear();
            this.votes.clear();
            this.tempbanned.clear();
            this.whitelist.clear();
            this.adminLogs = [];
            this.wordCount.clear();
            this.blackList.clear();
            this.ignoreList.clear();
            this.markDirty();
            this.sendChat('所有数据已清空');
        } catch (err) {
            this.sendChat('数据清空失败');
        }
    },

    handleRl(msg, params) {
        try {
            const sub = params[0]?.toLowerCase();
            if (!sub) {
                this.sendChat(`限流器：半衰期 ${this.rl.halflife}s，阈值 ${this.rl.threshold}，状态 ${this.rl.enabled ? '开' : '关'}`);
            } else if (sub === 'set') {
                const halflife = parseInt(params[1]);
                const threshold = parseInt(params[2]);
                if (isNaN(halflife) || isNaN(threshold) || halflife <= 0 || threshold <= 0) {
                    this.sendChat('格式：.rl set <半衰期秒> <阈值>');
                    return;
                }
                this.rl.setParams(halflife, threshold);
                this.markDirty();
                this.sendChat(`限流器参数已更新`);
            } else if (sub === 'on') {
                this.rl.setEnabled(true);
                this.markDirty();
                this.sendChat('限流器已开启');
            } else if (sub === 'off') {
                this.rl.setEnabled(false);
                this.markDirty();
                this.sendChat('限流器已关闭');
            } else {
                this.sendChat('格式：.rl 查看 | .rl set <半衰期> <阈值> | .rl on/off');
            }
        } catch (err) {
            this.sendChat('限流器操作失败');
        }
    },

    handleBackup(msg) {
        try {
            this.markDirty();
            this.saveAllDataSync();
            const backupPath = `backup_${new Date().toISOString().slice(0,10)}.json`;
            fs.copyFileSync('./storage.json', backupPath);
            this.sendChat(`数据已备份到 ${backupPath}`);
        } catch (err) {
            this.sendChat('备份失败');
        }
    },

    handleLists(msg, params) {
        try {
            const type = params[0]?.toLowerCase();
            if (!type) {
                this.sendChat('格式：.lists wht|ign|afks|word');
                return;
            }
            let result = '';
            switch (type) {
                case 'wht': result = `白名单：${[...this.whitelist].join(', ') || '无'}`; break;
                case 'ign': result = `忽略列表：${[...this.ignoreList].join(', ') || '无'}`; break;
                case 'afks': result = `AFK用户：${[...this.afkUsers.keys()].join(', ') || '无'}`; break;
                case 'word': result = `封禁词：${this.banWords.join(', ') || '无'}`; break;
                default: this.sendChat('类型错误，可选：wht, ign, afks, word'); return;
            }
            this.sendChat(result);
        } catch (err) {
            this.sendChat('列表查询失败');
        }
    },

    handleIgno(msg, params) {
        try {
            const type = params[0]?.toLowerCase();
            const value = params[1];
            if (!type || !value || !['nick', 'trip', 'hash'].includes(type)) {
                this.sendChat('格式：.igno <nick|trip|hash> <值>');
                return;
            }
            let target = value;
            if (type === 'nick') target = this.stripAt(value);
            this.ignoreList.add(target);
            this.markDirty();
            this.sendChat(`已添加到忽略列表：${type} ${target}`);
        } catch (err) {
            this.sendChat('添加忽略失败');
        }
    },

    handleUnig(msg, params) {
        try {
            const type = params[0]?.toLowerCase();
            const value = params[1];
            if (!type || !value || !['nick', 'trip', 'hash'].includes(type)) {
                this.sendChat('格式：.unig <nick|trip|hash> <值>');
                return;
            }
            let target = value;
            if (type === 'nick') target = this.stripAt(value);
            if (this.ignoreList.delete(target)) {
                this.markDirty();
                this.sendChat(`已从忽略列表移除：${type} ${target}`);
            } else {
                this.sendChat(`未在忽略列表中找到 ${type} ${target}`);
            }
        } catch (err) {
            this.sendChat('移除忽略失败');
        }
    },

    handleStop(msg) {
        if (this.isStopping) return;
        this.isStopping = true;
        this.sendChat('毁灭吧，消失吧。');
        setTimeout(() => {
            this.stopped = true;
            this.saveAllDataSync();
            this.cleanup();
            process.exit(0);
        }, 1000);
    },

    cleanup() {
        if (this.cleanedUp) return;
        this.cleanedUp = true;
        for (const id of this.scheduledIntervals) clearInterval(id);
        if (this.ifTimer) clearInterval(this.ifTimer);
        if (this.periodicTimeoutId) clearTimeout(this.periodicTimeoutId);
        if (this.memoryCleanerId) clearInterval(this.memoryCleanerId);
        if (this.hourlyTimeout) clearTimeout(this.hourlyTimeout);
        if (this.saveTimer) clearInterval(this.saveTimer);
        if (this.selfMuteTimer) clearTimeout(this.selfMuteTimer);
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        if (this.logStream) {
            this.logStream.write(`=== Bot stopped at ${new Date().toISOString()} ===\n`);
            this.logStream.end();
        }
        if (this.ws) {
            try {
                this.ws.removeAllListeners();
                if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
                    this.ws.close(1000, 'cleanup');
                }
            } catch(e) {}
        }
        console.log(`[${CONFIG.botNick}] 已停止`);
    }
};

process.on('SIGINT', () => {
    console.log('\n[SIGINT] 收到退出信号');
    bot.saveAllDataSync();
    bot.cleanup();
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n[SIGTERM] 收到终止信号');
    bot.saveAllDataSync();
    bot.cleanup();
    process.exit(0);
});

process.on('exit', () => {
    bot.cleanup();
});

process.on('uncaughtException', (err) => {
    console.error('[未捕获异常]', err);
    if (bot.logMessage) {
        try { bot.logMessage(`UNCAUGHT EXCEPTION: ${err.stack}`); } catch(e) {}
    }
});

bot.init();
