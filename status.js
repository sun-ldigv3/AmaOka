const fs = require('fs-extra');
const path = require('path');
const { Mutex } = require('async-mutex');

const CONFIG = {
    server: "wss://hack.chat/chat-ws",
    channel: "lounge",
    botNick: "AmaOka",
    botTrip: "",
    debug: false,
    color: { enable: true, hex: "#5ee6ed" },
    CONST: {
        ADMIN_TRIPCODE: '2UE++I',
        NORMAL_PREFIX: '!',
        MOD_PREFIX: ';',
        ADMIN_PREFIX: '.',
        muteCheckInterval: 10000,
        maxMsgHistory: 5000,
        latestMsgCount: 5,
        welcomeMsg: "hi [nick]",
        styleTemplates: {
            questionReplies: ['我也很不解', '我也很困惑', '不清楚', '是这样吗', '?', '？'],
            exclaimReplies: ['嘿嘿，这也太精彩了吧', '哎呦，不错哦', '哈哈，这波我给满分'],
            greetingReplies: ['嗨，大家好呀～', '在的，有事喊你', '你好呀，今天也要加油哦'],
            smallTalkReplies: ['嗯哼~', '哦哦', '了解啦']
        },
        periodic: {
includeYiyan: true,
    coreMode: false,
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
        maxHashKeys: 5000,
        leftExpireDays: 30,
        historyKeepDays: 90,
        recentTimestampsMax: 1000,
        maxLogFiles: 30,
        reconnectBaseDelay: 1000,
        reconnectMaxDelay: 60000,
        saveIntervalMs: 5000,
        REPO: 'https://github.com/sun-ldigv3/AmaOka'
    }
};

const PLACEHOLDER = '(｡•ᴗ•｡)';
const ADMIN_ACTION = '(｀へ´)';
const STAR = '(⭐)';
const BOT_START_TIME = Date.now();

class RateLimiter {
    constructor(halflife, threshold) {
        this.halflife = halflife;
        this.threshold = threshold;
        this.records = new Map();
        this.enabled = true;
    }
    fscore(score, lastTime, delta = 1) {
        score *= Math.pow(2, (lastTime - Date.now()) / (this.halflife * 1000));
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

const DATA_DIR = path.join(__dirname, 'data');
const BACKUP_DIR = path.join(DATA_DIR, 'backup');
const HISTORY_DIR = path.join(DATA_DIR, 'history');

const DATA_FILES = {
    rules: 'rules.json',
    hash: 'hash.json',
    welcome: 'welcome.json',
    lastseen: 'lastseen.json',
    banwords: 'banwords.json',
    mods: 'mods.json',
    announce: 'announce.json',
    random: 'random.json',
    ratelimit: 'ratelimit.json',
    slowmode: 'slowmode.json',
    subscriptions: 'subscriptions.json',
    votes: 'votes.json',
    whitelist: 'whitelist.json',
    tempban: 'tempban.json',
    adminlog: 'adminlog.json',
    ignore: 'ignore.json',
    blacklist: 'blacklist.json',
    left: 'left.json',
    bindings: 'bindings.json',
    settings: 'settings.json',
    admin: 'admin.json',
    afkme: 'afkme.json'
};

class DataStore {
    constructor(rootDir) {
        this.rootDir = rootDir;
        this.cache = new Map();
        this.mutex = new Mutex();
        fs.ensureDirSync(rootDir);
        fs.ensureDirSync(BACKUP_DIR);
        fs.ensureDirSync(HISTORY_DIR);
    }
    filePath(key) {
        return path.join(this.rootDir, DATA_FILES[key] || `${key}.json`);
    }
    safeStringify(value) {
        const seen = new WeakSet();
        const replacer = (k, v) => {
            if (typeof v === 'bigint') return v.toString();
            if (typeof v === 'number' && !Number.isFinite(v)) return null;
            if (v && typeof v === 'object') {
                if (seen.has(v)) return undefined;
                seen.add(v);
            }
            return v;
        };
        return JSON.stringify(value, replacer, 2);
    }
    writeAtomicSync(fp, text) {
        const tmp = fp + '.tmp';
        fs.ensureDirSync(path.dirname(fp));
        fs.writeFileSync(tmp, text);
        fs.renameSync(tmp, fp);
    }
    async writeAtomic(fp, text) {
        const tmp = fp + '.tmp';
        fs.ensureDirSync(path.dirname(fp));
        await fs.writeFile(tmp, text);
        await fs.rename(tmp, fp);
    }
    readJsonSafe(fp) {
        try {
            if (fs.existsSync(fp)) return JSON.parse(fs.readFileSync(fp, 'utf8'));
        } catch (e) {
            console.error(`[数据损坏] ${fp}: ${e.message}`);
        }
        return undefined;
    }
    get(key, fallback = null) {
        if (this.cache.has(key)) return this.cache.get(key);
        const fp = this.filePath(key);
        const val = this.readJsonSafe(fp);
        if (val !== undefined) {
            this.cache.set(key, val);
            return val;
        }
        return fallback;
    }
    async set(key, value) {
        this.cache.set(key, value);
        const release = await this.mutex.acquire();
        try {
            await this.writeAtomic(this.filePath(key), this.safeStringify(value));
        } finally {
            release();
        }
    }
    setSync(key, value) {
        this.cache.set(key, value);
        try {
            this.writeAtomicSync(this.filePath(key), this.safeStringify(value));
        } catch (e) {
            console.error(`[写入失败] ${key}: ${e.message}`);
        }
    }
    readFile(relPath, fallback = null) {
        const fp = path.join(this.rootDir, relPath);
        const val = this.readJsonSafe(fp);
        return val !== undefined ? val : fallback;
    }
    async writeFile(relPath, value) {
        const fp = path.join(this.rootDir, relPath);
        fs.ensureDirSync(path.dirname(fp));
        const release = await this.mutex.acquire();
        try {
            await this.writeAtomic(fp, this.safeStringify(value));
        } finally {
            release();
        }
    }
    writeFileSync(relPath, value) {
        const fp = path.join(this.rootDir, relPath);
        fs.ensureDirSync(path.dirname(fp));
        try {
            this.writeAtomicSync(fp, this.safeStringify(value));
        } catch (e) {
            console.error(`[写入失败] ${relPath}: ${e.message}`);
        }
    }
    listFiles(subdir, ext = '.json') {
        const dir = path.join(this.rootDir, subdir);
        try {
            if (!fs.existsSync(dir)) return [];
            return fs.readdirSync(dir).filter(f => f.endsWith(ext));
        } catch (e) { return []; }
    }
    exists(relPath) {
        return fs.existsSync(path.join(this.rootDir, relPath));
    }
}

const store = new DataStore(DATA_DIR);

const bot = {
    ws: null,
    clientId: Math.random().toString(36).slice(2, 10),
    stopped: false,
    isStopping: false,
    cleanedUp: false,
    cmdMap: new Map(),
    tokenBucket: new TokenBucket(20, 200),
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
    historyKeepDays: 90,
    historyKeepMsgDays: 0,
    welcomeMessages: new Map(),
    welcomeEnabled: true,
    globalWelcome: [],
    placeholder: PLACEHOLDER,
    helpColumns: 6,
    showRepo: true,
    hourlyReminder: true,
    questionReply: true,
    opHint: true,
    adminList: new Set(),
    afkme: [],
    afkmeClients: new Map(),
    lastUserColor: new Map(),
    joinColor: new Map(),
    hourlyAds: { enabled: true, hours: {}, ads: {} },
    includeYiyan: true,
    motdEnabled: false,
    motdLines: [],
    fakemotdEnabled: false,
    fakemotdContent: '',
    lastSeen: new Map(),
    banWords: [],
    modList: new Set(),
    modMode: false,
    privateCmd: { normal: 'on', mod: 'on', admin: 'on' },
    leftMessages: [],
    nickTripBinding: new Map(),
    lastQuestionReplyTime: 0,
    isMuted: false,
    randomEnabled: false,
    randomProb: 0,
    rl: new RateLimiter(30, 8),
    setuRl: new RateLimiter(40, 5),
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
    lastPingMs: null,

    markDirty() {
        this.dirty = true;
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
            const state = this.exportState();
            await Promise.all([
                store.set('rules', state.rules),
                store.set('hash', state.hash),
                store.set('welcome', state.welcome),
                store.set('lastseen', state.lastseen),
                store.set('banwords', state.banwords),
                store.set('mods', state.mods),
                store.set('announce', state.announce),
                store.set('random', state.random),
                store.set('ratelimit', state.ratelimit),
                store.set('slowmode', state.slowmode),
                store.set('subscriptions', state.subscriptions),
                store.set('votes', state.votes),
                store.set('whitelist', state.whitelist),
                store.set('tempban', state.tempban),
                store.set('adminlog', state.adminlog),
                store.set('ignore', state.ignore),
                store.set('blacklist', state.blacklist),
                store.set('left', state.left),
                store.set('bindings', state.bindings),
                store.set('settings', state.settings),
                store.set('admin', state.admin),
                store.set('afkme', state.afkme)
            ]);
            this.saveHistory();
        } catch (err) {
            console.error('[自动保存失败]', err);
        }
    },

    saveAllDataSync() {
        const state = this.exportState();
        store.setSync('rules', state.rules);
        store.setSync('hash', state.hash);
        store.setSync('welcome', state.welcome);
        store.setSync('lastseen', state.lastseen);
        store.setSync('banwords', state.banwords);
        store.setSync('mods', state.mods);
        store.setSync('announce', state.announce);
        store.setSync('random', state.random);
        store.setSync('ratelimit', state.ratelimit);
        store.setSync('slowmode', state.slowmode);
        store.setSync('subscriptions', state.subscriptions);
        store.setSync('votes', state.votes);
        store.setSync('whitelist', state.whitelist);
        store.setSync('tempban', state.tempban);
        store.setSync('adminlog', state.adminlog);
        store.setSync('ignore', state.ignore);
        store.setSync('blacklist', state.blacklist);
        store.setSync('left', state.left);
        store.setSync('bindings', state.bindings);
        store.setSync('settings', state.settings);
        store.setSync('admin', state.admin);
        store.setSync('afkme', state.afkme);
        this.saveHistory();
    },

    exportState() {
        const hashObj = Object.fromEntries([...this.hashHistory.entries()].map(([k, v]) => [k, [...v]]));
        const subsObj = Object.fromEntries([...this.subscriptions.entries()].map(([k, v]) => [k, [...v]]));
        const votesObj = Object.fromEntries([...this.votes.entries()].map(([k, v]) => [k, { ...v, options: [...v.options.entries()], voters: [...v.voters] }]));
        return {
            rules: this.ifRules,
            hash: hashObj,
            welcome: { enabled: this.welcomeEnabled, messages: Object.fromEntries(this.welcomeMessages), global: this.globalWelcome },
            lastseen: Object.fromEntries(this.lastSeen),
            banwords: this.banWords,
            mods: { list: [...this.modList], mode: this.modMode },
            announce: this.scheduledAnnouncements.map(({ lastSendTime, ...rest }) => rest),
            random: { enabled: this.randomEnabled, prob: this.randomProb },
            ratelimit: { halflife: this.rl.halflife, threshold: this.rl.threshold, enabled: this.rl.enabled },
            slowmode: { enabled: this.slowModeEnabled, interval: this.slowModeInterval },
            subscriptions: subsObj,
            votes: votesObj,
            whitelist: [...this.whitelist],
            tempban: Object.fromEntries(this.tempbanned),
            adminlog: this.adminLogs.slice(-CONFIG.CONST.adminLogMax),
            ignore: [...this.ignoreList],
            blacklist: [...this.blackList],
            left: this.leftMessages,
            bindings: Object.fromEntries(this.nickTripBinding),
            settings: {
                placeholder: this.placeholder,
                helpColumns: this.helpColumns,
                showRepo: this.showRepo,
                hourlyReminder: this.hourlyReminder,
                questionReply: this.questionReply,
                opHint: this.opHint,
                includeYiyan: this.includeYiyan,
                coreMode: this.coreMode,
                motdEnabled: this.motdEnabled,
                motdLines: this.motdLines,
                fakemotdEnabled: this.fakemotdEnabled,
                fakemotdContent: this.fakemotdContent,
                privateCmd: this.privateCmd,
                historyKeepDays: this.historyKeepDays,
                historyKeepMsgDays: this.historyKeepMsgDays,
                hourlyAds: this.hourlyAds
            },
            admin: [...this.adminList],
            afkme: this.afkme
        };
    },

    loadAllData() {
        const read = (key, fallback) => store.get(key, fallback);
        const mods = read('mods', null) || { list: [], mode: false };
        this.ifRules = read('rules', []);
        const hashObj = read('hash', {});
        this.hashHistory = new Map(Object.entries(hashObj).map(([k, v]) => [k, new Set(v)]));
        const welcome = read('welcome', {});
        if (welcome && typeof welcome === 'object' && 'messages' in welcome) {
            this.welcomeEnabled = !!welcome.enabled;
            this.welcomeMessages = new Map(Object.entries(welcome.messages || {}));
        } else {
            this.welcomeEnabled = true;
            this.welcomeMessages = new Map(Object.entries(welcome));
        }
        this.globalWelcome = Array.isArray(welcome.global) ? welcome.global : [];
        this.lastSeen = new Map(Object.entries(read('lastseen', {})));
        this.banWords = read('banwords', []);
        this.modList = new Set(mods.list || []);
        this.modMode = !!mods.mode;
        this.scheduledAnnouncements = read('announce', []).map(a => ({ ...a, lastSendTime: a.lastSendTime || 0 }));
        const random = read('random', null);
        if (random) {
            this.randomEnabled = random.enabled;
            this.randomProb = random.prob;
        }
        const rl = read('ratelimit', null);
        if (rl) {
            this.rl.setParams(rl.halflife, rl.threshold);
            this.rl.setEnabled(rl.enabled);
        }
        const slow = read('slowmode', null);
        if (slow) {
            this.slowModeEnabled = slow.enabled;
            this.slowModeInterval = slow.interval;
        }
        const subsObj = read('subscriptions', {});
        this.subscriptions = new Map(Object.entries(subsObj).map(([k, v]) => [k, new Set(v)]));
        const voteObj = read('votes', {});
        this.votes = new Map(Object.entries(voteObj).map(([k, v]) => [k, { ...v, options: new Map(v.options || []), voters: new Set(v.voters || []) }]));
        this.whitelist = new Set(read('whitelist', []));
        this.tempbanned = new Map(Object.entries(read('tempban', {})));
        this.adminLogs = read('adminlog', []);
        this.ignoreList = new Set(read('ignore', []));
        this.blackList = new Set(read('blacklist', []));
        this.leftMessages = read('left', []);
        this.nickTripBinding = new Map(Object.entries(read('bindings', {})));
        const settings = read('settings', null);
        if (settings) {
            if (settings.placeholder) this.placeholder = settings.placeholder;
            if (settings.helpColumns) this.helpColumns = settings.helpColumns;
            if (typeof settings.showRepo === 'boolean') this.showRepo = settings.showRepo;
            if (typeof settings.hourlyReminder === 'boolean') this.hourlyReminder = settings.hourlyReminder;
            if (typeof settings.questionReply === 'boolean') this.questionReply = settings.questionReply;
            if (typeof settings.opHint === 'boolean') this.opHint = settings.opHint;
            if (typeof settings.includeYiyan === 'boolean') this.includeYiyan = settings.includeYiyan;
            if (typeof settings.coreMode === 'boolean') this.coreMode = settings.coreMode;
            if (typeof settings.motdEnabled === 'boolean') this.motdEnabled = settings.motdEnabled;
            if (Array.isArray(settings.motdLines)) this.motdLines = settings.motdLines;
            if (typeof settings.fakemotdEnabled === 'boolean') this.fakemotdEnabled = settings.fakemotdEnabled;
            if (typeof settings.fakemotdContent === 'string') this.fakemotdContent = settings.fakemotdContent;
            if (settings.privateCmd && typeof settings.privateCmd === 'object') {
                for (const lv of ['normal', 'mod', 'admin']) {
                    const v = settings.privateCmd[lv];
                    if (typeof v === 'string' && ['on', 'off', 'default'].includes(v)) this.privateCmd[lv] = v === 'default' ? 'on' : v;
                    else if (typeof v === 'boolean') this.privateCmd[lv] = v ? 'on' : 'off';
                }
            }
            if (typeof settings.historyKeepMsgDays === 'number') this.historyKeepMsgDays = settings.historyKeepMsgDays;
            if (settings.hourlyAds && typeof settings.hourlyAds === 'object') {
                this.hourlyAds = { enabled: !!settings.hourlyAds.enabled, hours: settings.hourlyAds.hours || {}, ads: settings.hourlyAds.ads || {} };
            }
        }
        this.adminList = new Set(read('admin', []));
        if (!this.adminList.size) {
            this.adminList.add(CONFIG.CONST.ADMIN_TRIPCODE);
            this.adminList.add('Admin');
        }
        this.afkme = read('afkme', []);
        this.loadHistory();
        this.cleanExpiredLeftMessages();
        this.cleanOldHistory();
        this.pruneHashHistory();
    },

    cleanExpiredLeftMessages() {
        try {
            const cutoff = Date.now() - CONFIG.CONST.leftExpireDays * 24 * 3600 * 1000;
            const before = this.leftMessages.length;
            this.leftMessages = this.leftMessages.filter(m => (m.time || 0) >= cutoff);
            if (this.leftMessages.length !== before) this.markDirty();
        } catch (err) {}
    },

    cleanOldHistory() {
        try {
            const cutoff = Date.now() - this.historyKeepDays * 24 * 3600 * 1000;
            for (const f of store.listFiles('history')) {
                const m = /^history_(\d{4}-\d{2}-\d{2})\.json$/.exec(f);
                if (!m) continue;
                const d = new Date(m[1] + 'T00:00:00').getTime();
                if (d < cutoff) {
                    try { fs.unlinkSync(path.join(HISTORY_DIR, f)); } catch (e) {}
                }
            }
        } catch (err) {}
    },

    cleanOldMessages() {
        try {
            if (this.historyKeepMsgDays <= 0) return;
            const cutoff = Date.now() - this.historyKeepMsgDays * 24 * 3600 * 1000;
            const before = this.messageHistory.length;
            this.messageHistory = this.messageHistory.filter(m => (m.time || 0) >= cutoff);
            if (this.messageHistory.length !== before) {
                this.messageIdMap = new Map(this.messageHistory.map(m => [m.id, m]));
                this.markDirty();
            }
        } catch (err) {}
    },

    pruneHashHistory() {
        try {
            if (this.hashHistory.size <= CONFIG.CONST.maxHashKeys) return;
            const excess = this.hashHistory.size - CONFIG.CONST.maxHashKeys;
            let removed = 0;
            for (const key of this.hashHistory.keys()) {
                if (removed >= excess) break;
                this.hashHistory.delete(key);
                removed++;
            }
            if (removed) this.markDirty();
        } catch (err) {}
    },

    saveHistory() {
        try {
            const date = this.localDate();
            const todayMsgs = this.messageHistory.filter(m => m.time && this.isToday(m.time));
            store.writeFileSync(`history/history_${date}.json`, todayMsgs);
        } catch (e) {}
    },

    loadHistory() {
        try {
            const files = store.listFiles('history');
            if (!files.length) return;
            const all = [];
            for (const f of files) {
                const arr = store.readFile(`history/${f}`, []);
                if (Array.isArray(arr)) all.push(...arr);
            }
            all.sort((a, b) => (a.id || 0) - (b.id || 0));
            const seen = new Set();
            const merged = [];
            for (const m of all) {
                if (seen.has(m.id)) continue;
                seen.add(m.id);
                merged.push(m);
            }
            this.messageHistory = merged.slice(-CONFIG.CONST.maxMsgHistory);
            this.messageIdMap = new Map(this.messageHistory.map(m => [m.id, m]));
            this.nextMessageId = this.messageHistory.length
                ? Math.max(...this.messageHistory.map(m => m.id)) + 1
                : 1;
        } catch (e) {}
    },

    migrateFromOld() {
        try {
            const oldPath = path.join(process.cwd(), 'storage.json');
            if (!fs.existsSync(oldPath)) return;
            const raw = JSON.parse(fs.readFileSync(oldPath, 'utf8'));
            const parse = (k, fb) => {
                try { return raw[k] !== undefined ? JSON.parse(raw[k]) : fb; } catch (e) { return fb; }
            };
            const mods = { list: parse('bot_modList', []), mode: parse('bot_modMode', false) };
            store.setSync('rules', parse('bot_ifRules', []));
            store.setSync('hash', parse('bot_hashHistory', {}));
            store.setSync('welcome', parse('bot_welcomeMessages', {}));
            store.setSync('lastseen', parse('bot_lastSeen', {}));
            store.setSync('banwords', parse('bot_banWords', []));
            store.setSync('mods', mods);
            store.setSync('announce', parse('bot_scheduledAnnouncements', []));
            store.setSync('random', parse('bot_random', null));
            store.setSync('ratelimit', parse('bot_rl', null));
            store.setSync('slowmode', parse('bot_slowMode', null));
            store.setSync('subscriptions', parse('bot_subscriptions', {}));
            store.setSync('votes', parse('bot_votes', {}));
            store.setSync('whitelist', parse('bot_whitelist', []));
            store.setSync('tempban', parse('bot_tempbanned', {}));
            store.setSync('adminlog', parse('bot_adminLogs', []));
            store.setSync('ignore', parse('bot_ignoreList', []));
            store.setSync('blacklist', parse('bot_blackList', []));
            store.setSync('left', parse('bot_leftMessages', []));
            store.setSync('bindings', parse('bot_nickTripBinding', {}));
            fs.renameSync(oldPath, oldPath + '.bak');
        } catch (err) {
            console.error('[迁移失败]', err);
        }
    },

    addAdminLog(action, target, by) {
        this.adminLogs.push({ time: Date.now(), action, target: target || '', by: by || 'system' });
        if (this.adminLogs.length > CONFIG.CONST.adminLogMax) this.adminLogs.shift();
        this.markDirty();
    },

    stripAt(nick) {
        return nick ? nick.replace(/^@/, '') : '';
    },

    getLocalTime(ts) {
        const base = ts ? new Date(ts) : new Date();
        const offset = CONFIG.CONST.timezoneOffset * 60 * 60 * 1000;
        return new Date(base.getTime() + offset);
    },

    localDate() {
        const now = this.getLocalTime();
        const y = now.getFullYear();
        const m = String(now.getMonth() + 1).padStart(2, '0');
        const d = String(now.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    },

    isToday(ts) {
        return this.getLocalTime(ts).toDateString() === this.getLocalTime().toDateString();
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
    }
};

module.exports = {
    CONFIG,
    PLACEHOLDER,
    ADMIN_ACTION,
    STAR,
    BOT_START_TIME,
    RateLimiter,
    TokenBucket,
    DataStore,
    DATA_DIR,
    BACKUP_DIR,
    HISTORY_DIR,
    store,
    bot
};
