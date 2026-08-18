const fs = require('fs-extra');
const path = require('path');
const WebSocket = require('ws');
const { CONFIG, ADMIN_ACTION, STAR, BOT_START_TIME, RateLimiter, BACKUP_DIR, HISTORY_DIR, store, bot } = require('./status');
const core = require('./core');
const { AFKClient } = core;

const CMD_CONFIG = {
    help: { trigger: ['help', 'h'], desc: '查看命令', level: 'normal', params: '[命令名]', example: '!help roll' },
    roll: { trigger: ['roll'], desc: '掷骰子', level: 'normal', params: '[NdM 或 min-max]', example: '!roll 3d5' },
    afk: { trigger: ['afk'], desc: '设置/取消离开状态', level: 'normal', params: '[原因]', example: '!afk 吃饭' },
    online: { trigger: ['online'], desc: '查看在线用户', level: 'normal', params: '', example: '!online' },
    msg: { trigger: ['msg', 'msglist'], desc: '查看历史数量或查询范围', level: 'normal', params: '[N1 N2]', example: '!msg 20' },
    user: { trigger: ['user', 'userinfo'], desc: '查询用户信息', level: 'normal', params: '[昵称]', example: '!user sun' },
    stats: { trigger: ['stats'], desc: '活跃度统计', level: 'normal', params: '', example: '!stats' },
    calc: { trigger: ['calc', '计算'], desc: '简易计算器', level: 'normal', params: '<算式>', example: '!calc 1+2*3' },
    weather: { trigger: ['weather', '天气'], desc: '查询天气', level: 'normal', params: '<城市>', example: '!weather 北京' },
    emoji: { trigger: ['emoji', '表情'], desc: '随机表情', level: 'normal', params: '', example: '!emoji' },
    yiyan: { trigger: ['yiyan', '一言'], desc: '随机一言', level: 'normal', params: '', example: '!yiyan' },
    color: { trigger: ['color'], desc: '查询颜色', level: 'normal', params: '[昵称]', example: '!color sun' },
    hash: { trigger: ['hash'], desc: '查询历史nick', level: 'normal', params: '<昵称> [页码]', example: '!hash sun' },
    geth: { trigger: ['geth'], desc: '查询历史hash', level: 'normal', params: '<昵称> [页码]', example: '!geth sun' },
    lookh: { trigger: ['lookh'], desc: '查看hash对应nick', level: 'normal', params: '<hash>', example: '!lookh ojXwDxpDStQCWuy' },
    welc: { trigger: ['welc'], desc: '设置/取消自己的欢迎语', level: 'normal', params: '[内容]', example: '!welc 欢迎回来' },
    seen: { trigger: ['seen'], desc: '最后发言', level: 'normal', params: '<昵称>', example: '!seen sun' },
    look: { trigger: ['look'], desc: '用户分析', level: 'normal', params: '<昵称>', example: '!look sun' },
    peep: { trigger: ['peep'], desc: '查看历史消息', level: 'normal', params: '<起始> [结束]', example: '!peep 50' },
    prime: { trigger: ['prime'], desc: '质因数分解', level: 'normal', params: '<数字>', example: '!prime 120' },
    hug: { trigger: ['hug'], desc: '拥抱', level: 'normal', params: '<昵称>', example: '!hug sun' },
    shoot: { trigger: ['shoot'], desc: '射击', level: 'normal', params: '<昵称>', example: '!shoot sun' },
    lori: { trigger: ['lori'], desc: '字符辨别', level: 'normal', params: '<字符>', example: '!lori l' },
    uwu: { trigger: ['uwu'], desc: '小猫笑', level: 'normal', params: '', example: '!uwu' },
    countdown: { trigger: ['countdown'], desc: '倒计时', level: 'normal', params: '<YYYY-MM-DD>', example: '!countdown 2027-01-01' },
    meme: { trigger: ['meme'], desc: '随机梗图', level: 'normal', params: '', example: '!meme' },
    left: { trigger: ['left'], desc: '留言系统', level: 'normal', params: '<trip|*nick> <内容>', example: '!left *sun 明天见' },
    loog: { trigger: ['loog'], desc: '查看完整消息', level: 'normal', params: '<ID>', example: '!loog 123' },
    sub: { trigger: ['sub'], desc: '订阅关键词', level: 'normal', params: '<关键词>', example: '!sub opencode' },
    unsub: { trigger: ['unsub'], desc: '取消订阅关键词', level: 'normal', params: '<关键词>', example: '!unsub opencode' },
    subs: { trigger: ['subs'], desc: '查看我的订阅', level: 'normal', params: '', example: '!subs' },
    vote: { trigger: ['vote'], desc: '投票系统', level: 'normal', params: '<子命令>', example: '!vote create 今晚吃什么' },
    topwords: { trigger: ['topwords'], desc: '热词统计', level: 'normal', params: '[数量]', example: '!topwords 10' },
    time: { trigger: ['time'], desc: '文学时钟', level: 'normal', params: '', example: '!time' },
    setu: { trigger: ['setu'], desc: '随机涩图', level: 'normal', params: '[参数]', example: '!setu tag=阿瓦' },
    kkme: { trigger: ['kkme'], desc: '踢出同识别码僵尸号', level: 'normal', params: '[昵称]', example: '!kkme', title: 'kick me' },
    // Mod 命令
    helpm: { trigger: ['helpm'], desc: '查询Mod命令详情', level: 'mod', params: '<命令名>', example: ';helpm kick' },
    kick: { trigger: ['kick'], desc: '踢出用户', level: 'mod', params: '<昵称>', example: ';kick sun' },
    addword: { trigger: ['addword'], desc: '添加封禁词', level: 'mod', params: '<正则>', example: ';addword 广告' },
    delword: { trigger: ['delword'], desc: '删除封禁词', level: 'mod', params: '<序号或词>', example: ';delword 1' },
    modlist: { trigger: ['modlist'], desc: 'Mod列表', level: 'mod', params: '', example: ';modlist' },
    list: { trigger: ['list'], desc: '查看频道在线用户', level: 'mod', params: '<频道>', example: ';list test' },
    sendmsg: { trigger: ['sendmsg'], desc: '向频道发消息', level: 'mod', params: '<频道> <内容>', example: ';sendmsg test 大家好' },
    enablecaptcha: { trigger: ['ec'], desc: '开启频道验证码', level: 'mod', params: '[频道]', example: ';ec test' },
    disablecaptcha: { trigger: ['dc'], desc: '关闭频道验证码', level: 'mod', params: '[频道]', example: ';dc' },
    lock: { trigger: ['lock'], desc: '锁房', level: 'mod', params: '', example: ';lock', title: 'lockroom' },
    unlock: { trigger: ['unlock'], desc: '解锁', level: 'mod', params: '', example: ';unlock', title: 'unlockroom' },
    slow: { trigger: ['slow'], desc: '慢速模式', level: 'mod', params: 'on/off [秒]', example: ';slow on 5' },
    save: { trigger: ['save'], desc: '导出聊天记录', level: 'mod', params: '', example: ';save' },
    clear: { trigger: ['clear'], desc: '清空本地历史', level: 'mod', params: '', example: ';clear' },
    whitelist: { trigger: ['whitelist'], desc: '白名单管理', level: 'mod', params: '<子命令> [trip]', example: ';whitelist list' },
    adminlog: { trigger: ['adminlog'], desc: '查看管理日志', level: 'mod', params: '[数量]', example: ';adminlog 10' },
    // Admin 命令
    helpadmin: { trigger: ['helpadmin'], desc: '查看管理员命令', level: 'admin', params: '[命令名]', example: '.helpadmin eval' },
    mod: { trigger: ['mod'], desc: '协管模式', level: 'admin', params: 'on|off', example: '.mod on' },
    addmod: { trigger: ['addmod'], desc: '添加Mod', level: 'admin', params: '<tripcode>', example: '.addmod AAAA+BB' },
    delmod: { trigger: ['delmod'], desc: '删除Mod', level: 'admin', params: '<tripcode>', example: '.delmod AAAA+BB' },
    prtt: { trigger: ['prtt'], desc: '绑定Nick与Trip', level: 'admin', params: '<nick> <trip>', example: '.prtt sun 2UE++I' },
    delp: { trigger: ['delp'], desc: '解绑Nick', level: 'admin', params: '<nick>', example: '.delp sun' },
    mute: { trigger: ['mute'], desc: '临时禁言', level: 'admin', params: '<用户> <分钟>', example: '.mute sun 5' },
    silence: { trigger: ['silence'], desc: '永久禁言', level: 'admin', params: '<用户> [分钟]', example: '.silence sun 10' },
    unsilence: { trigger: ['unsilence'], desc: '解除禁言', level: 'admin', params: '<用户>', example: '.unsilence sun' },
    ban: { trigger: ['ban'], desc: '封禁用户', level: 'admin', params: '<nick|trip|hash> <值>', example: '.ban nick sun' },
    unban: { trigger: ['unban'], desc: '解除封禁', level: 'admin', params: '<nick|trip|hash> <值>', example: '.unban nick sun' },
    tempban: { trigger: ['tempban'], desc: '临时封禁', level: 'admin', params: '<nick> <分钟>', example: '.tempban sun 5' },
    motd: { trigger: ['motd'], desc: '频道公告', level: 'admin', params: '<内容>|set <内容>|on|off|now', example: '.motd set 欢迎来到频道' },
    fakemotd: { trigger: ['fakemotd'], desc: '加入时私信自定义内容', level: 'admin', params: '<内容>|set <内容>|on|off', example: '.fakemotd set 本频道公告如下' },
    pann: { trigger: ['pann'], desc: '定时公告', level: 'admin', params: '<子命令>', example: '.pann add 60 喝水' },
    if: { trigger: ['if'], desc: '自动回复规则', level: 'admin', params: '<子命令>', example: '.if add 你好 你好呀 100' },
    talk: { trigger: ['talk'], desc: '发言开关', level: 'admin', params: 'on|off', example: '.talk off' },
    random: { trigger: ['random'], desc: '随机回复控制', level: 'admin', params: 'off/on/N', example: '.random 30' },
    v: { trigger: ['v'], desc: 'bot信息', level: 'admin', params: '', example: '.v' },
    status: { trigger: ['status'], desc: '运行时间', level: 'admin', params: '', example: '.status' },
    rl: { trigger: ['rl'], desc: '限流器管理', level: 'admin', params: '[子命令]', example: '.rl set 30 8' },
    backup: { trigger: ['backup'], desc: '备份管理', level: 'admin', params: 'list|remove|clear', example: '.backup list' },
    history: { trigger: ['history'], desc: '历史管理', level: 'admin', params: 'list|remove|clear|keep|keepmsg', example: '.history list' },
    cmd: { trigger: ['cmd'], desc: '设置命令等级', level: 'admin', params: '<命令> <normal|mod|admin|default>', example: '.cmd roll admin' },
    set: { trigger: ['set'], desc: '综合设置', level: 'admin', params: '<键> <值>', example: '.set placeholder (◍•ᴗ•◍)' },
    admin: { trigger: ['admin'], desc: '管理admin', level: 'admin', params: 'add|remove|list', example: '.admin list' },
    afkme: { trigger: ['afkme'], desc: '分身管理', level: 'admin', params: 'add <nick> <channel>|list|remove|clear', example: '.afkme sun test' },
    lists: { trigger: ['lists'], desc: '统一查看列表', level: 'admin', params: '<类型>', example: '.lists ban' },
    igno: { trigger: ['igno'], desc: '添加到忽略列表', level: 'admin', params: '<nick/trip/hash> <值>', example: '.igno nick sun' },
    unig: { trigger: ['unig'], desc: '从忽略列表移除', level: 'admin', params: '<nick/trip/hash> <值>', example: '.unig nick sun' },
    core: { trigger: ['core'], desc: '内核模式', level: 'admin', params: 'on|off', example: '.core on' },
    rejoin: { trigger: ['rejoin'], desc: '重新加入频道', level: 'admin', params: '', example: '.rejoin' },
    reload: { trigger: ['reload'], desc: '重载代码', level: 'admin', params: '', example: '.reload' },
    upd: { trigger: ['upd'], desc: '发出消息并延时更新', level: 'admin', params: '[起始] [结束] <秒>|<起始> <结束> <秒>', example: '.upd [稍等] [完成] 5' },
    con: { trigger: ['con'], desc: '直接输出', level: 'admin', params: '<文本>', example: '.con 大家好' },
    eval: { trigger: ['eval', 'code'], desc: '执行代码', level: 'admin', params: '<代码>', example: '.eval 1+1' },
    welcome: { trigger: ['welcome'], desc: '全局欢迎语管理', level: 'admin', params: 'on/off|add <内容>|remove <序号|内容>|list|clear', example: '.welcome add 欢迎 [nick] 来到频道' },
    wsr: { trigger: ['wsr'], desc: '设置各等级私信支持', level: 'admin', params: '<等级> <on|off>', example: '.wsr normal on', title: 'whisper' },
    ads: { trigger: ['ads'], desc: '定点报时广告', level: 'admin', params: 'on|off|<小时> <内容>|all <内容>', example: '.ads 3 喝口水吧' },
    run: { trigger: ['run'], desc: '批量执行多行命令', level: 'admin', params: '<多行命令>', example: '.run\n.con 1\n.con 2' },
    dataclear: { trigger: ['dataclear'], desc: '清空所有数据', level: 'admin', params: '', example: '.dataclear' },
    stop: { trigger: ['stop'], desc: '停止机器人', level: 'admin', params: '', example: '.stop' }
};

for (const [key, c] of Object.entries(CMD_CONFIG)) {
    c.defaultLevel = c.defaultLevel || c.level;
    c.defaultPos = c.defaultPos === undefined ? Object.keys(CMD_CONFIG).indexOf(key) : c.defaultPos;
    c.pos = c.pos === undefined ? c.defaultPos : c.pos;
}

const mainHandlers = {
    init() {
        this.validateConfig();
        this.initCmdMap();
        this.migrateFromOld();
        this.loadAllData();
        this.cleanOldLogs();
        this.setupLogging();
        this.connectWS();
        this.startKeepAlive();
        this.startTimers();
        this.startMemoryCleaner();
        this.setupErrorHandlers();
        this.startAutoSave();
        this.startAfkClients();
        console.log(`[${this.botNickWithTrip()}] 启动 | 频道: ${CONFIG.channel} | 协管模式：${this.modMode ? '开' : '关'}`);
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
        this.cmdMap.clear();
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

    sendUsage(cmdKey, msg, prefix) {
        const cfg = CMD_CONFIG[cmdKey];
        if (!cfg) return;
        const p = prefix || CONFIG.CONST.NORMAL_PREFIX;
        this.sendChat(`参数错误 正确用法：${p}${cfg.trigger[0]} ${cfg.params || ''}`);
    },

    getRawArgs(msg) {
        if (!msg || typeof msg.text !== 'string') return '';
        const text = msg.text.trim();
        const m = text.match(/^[!;.]\S+\s*([\s\S]*)$/);
        return m ? m[1] : '';
    },

    botNickWithTrip() {
        return CONFIG.botTrip ? `${CONFIG.botNick}#${CONFIG.botTrip}` : CONFIG.botNick;
    },

    hasAdminAuth(msg) {
        return msg && msg.trip && this.adminList.has(msg.trip);
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

    onRawMessage(msg) {
        try {
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
            const [cmdTrigger] = cleanText.split(/\s+/);
            this.handleCommands({ nick: from, trip: trip, text: cleanText, _whisper: true }, cleanText);
        } catch (err) {
            console.error('[私信处理错误]', err);
        }
    },

    updateOnlineUsers(data) {
        try {
            const newMap = new Map();
            for (const u of data.users) {
                newMap.set(u.nick, {
                    trip: u.trip || '',
                    hash: u.hash,
                    color: u.color || false,
                    level: u.level,
                    joinTime: u.time ? u.time * 1000 : Date.now()
                });
                if (u.isme && typeof u.level === 'number') this.botLevel = u.level;
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
                    this.userJoinTime.set(u.nick, u.time ? u.time * 1000 : Date.now());
                }
                if (u.nick !== CONFIG.botNick && u.color) {
                    this.joinColor.set(u.nick, u.color);
                }
            }
            this.pruneHashHistory();
            this.onlineUsers = newMap;
            this.inChannel = Array.from(this.onlineUsers.keys()).some(nick =>
                nick === CONFIG.botNick || nick.startsWith(CONFIG.botNick + '#')
            );
            if (this.pendingTransient) {
                if (this.pendingTransient.phase === 'go' && data.channel === this.pendingTransient.channel) {
                    this.handleTransientOnlineSet(data);
                } else if (this.pendingTransient.phase === 'return' && data.channel === this.pendingTransient.origChannel) {
                    if (this.transientTimer) clearTimeout(this.transientTimer);
                    const t = this.pendingTransient;
                    this.pendingTransient = null;
                    if (t.result && t.customId) {
                        this.sendWSMessage({ cmd: 'updateMessage', mode: 'overwrite', text: t.result, customId: t.customId }, true, true);
                    }
                }
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
            if (nick !== CONFIG.botNick && data.color) {
                this.joinColor.set(nick, data.color);
            }
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
                this.pruneHashHistory();
            }
            if (this.welcomeEnabled) {
                let welcomeMsg = null;
                if (userTrip && this.welcomeMessages.has(userTrip)) {
                    welcomeMsg = this.welcomeMessages.get(userTrip);
                } else if (this.globalWelcome.length) {
                    const tpl = this.globalWelcome[Math.floor(Math.random() * this.globalWelcome.length)];
                    if (tpl) welcomeMsg = tpl.replace(/\[nick\]/g, nick);
                } else {
                    welcomeMsg = CONFIG.CONST.welcomeMsg.replace(/\[nick\]/g, nick);
                }
                if (welcomeMsg) {
                    this.sendChat('\u200B' + welcomeMsg);
                }
            }
            this.deliverLeftMessages(nick, userTrip);
            if (this.fakemotdEnabled && this.fakemotdContent) {
                this.sendWhisper(nick, this.fakemotdContent);
            }
        } catch (err) {
            console.error('[用户加入错误]', err);
        }
    },

    onUserLeave(nick) {
        try {
            this.onlineUsers.delete(nick);
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
            const firstToken = text.split(/\s+/)[0];
            const isAfkCmd = this.cmdMap.get(firstToken)?.key === 'afk';
            if (!isAfkCmd && msg.nick !== CONFIG.botNick && this.afkUsers.has(msg.nick)) {
                const afkData = this.afkUsers.get(msg.nick);
                const afkMs = Date.now() - afkData.time;
                const duration = afkMs > 3600000 ? `${(afkMs/3600000).toFixed(1)}h` : `${Math.floor(afkMs/60000)}m`;
                this.afkUsers.delete(msg.nick);
                this.sendChat(`${msg.nick} ${afkData.reason || 'AFK'}了 ${duration}，欢迎回来。`);
            }
            if (msg.nick !== CONFIG.botNick) {
                this.deliverLeftMessages(msg.nick, msg.trip);
            }
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
            if (!this.isMuted && this.questionReply && !text.startsWith(CONFIG.CONST.NORMAL_PREFIX) && /[？?]/.test(text)) {
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
            if (msg.color) {
                this.lastUserColor.set(nick, msg.color);
                if (this.lastUserColor.size > 10000) {
                    const firstKey = this.lastUserColor.keys().next().value;
                    this.lastUserColor.delete(firstKey);
                }
            }

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
        this.scheduledIntervals.push(setInterval(() => this.checkMuteExpire(), CONFIG.CONST.muteCheckInterval));
        this.scheduledIntervals.push(setInterval(() => this.checkTempbanExpire(), 60000));
        this.scheduleHourly();
        this.ifTimer = setInterval(() => {
            if (this.isMuted) return;
            for (const rule of this.ifRules) {
                if (!rule.trigger && Math.random() <= rule.probability / 100) this.sendChat(rule.reply);
            }
        }, 10000);
        this.schedulePeriodicPost();
    },

    scheduleHourly() {
        const now = this.getLocalTime();
        const nextHour = new Date(now);
        nextHour.setHours(now.getHours() + 1, 0, 0, 0);
        const delay = nextHour.getTime() - now.getTime();
        this.hourlyTimeout = setTimeout(() => {
            if (!this.isMuted && this.hourlyReminder) {
                const hour = this.getLocalTime().getHours();
                const adText = (this.hourlyAds && this.hourlyAds.hours && this.hourlyAds.hours[hour]) || `${hour} 点了`;
                if (this.hourlyAds && this.hourlyAds.enabled) {
                    const adBottom = (this.hourlyAds.ads && this.hourlyAds.ads[hour]) || '广告位招租';
                    this.sendChat(`${adText}\n___\n${adBottom}`);
                } else {
                    this.sendChat(adText);
                }
            }
            if (!this.isMuted && this.motdEnabled) {
                this.pushMotd();
            }
            this.scheduleHourly();
        }, delay);
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
                    if (this.includeYiyan && Math.random() > 0.5) this.handleYiyan();
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
                const afkExpire = Date.now() - CONFIG.CONST.userActivityExpireHours * 3600 * 1000;
                for (const [user, afkData] of this.afkUsers.entries()) {
                    if (afkData.time < afkExpire) this.afkUsers.delete(user);
                }
                if (this.historyKeepMsgDays > 0) this.cleanOldMessages();
                if (this.cleanExpiredLeftMessages) this.cleanExpiredLeftMessages();
                if (this.cleanOldHistory) this.cleanOldHistory();
                if (this.pruneHashHistory) this.pruneHashHistory();
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

    formatHelp(cmdKey, prefix) {
        const cfg = CMD_CONFIG[cmdKey];
        if (!cfg) return null;
        const p = prefix || CONFIG.CONST.NORMAL_PREFIX;
        const esc = (s) => String(s == null ? '无' : s).replace(/\|/g, '｜');
        return [
            `# ${(cfg.title || cmdKey)} Of Commands:`,
            '||',
            '|:-:|',
            `| 参数: ${esc(cfg.params || '无')} |`,
            `| 描述: ${esc(cfg.desc)} |`,
            `| 例: ${esc(cfg.example || `${p}${cfg.trigger[0]} ${cfg.params || ''}`)} |`,
            `| 权限: ${esc(cfg.level)} |`
        ].join('\n');
    },

    formatCmdList(cmds) {
        const triggers = cmds.map(([_, c]) => c.trigger[0]);
        const perLine = this.helpColumns || 6;
        const lines = [];
        for (let i = 0; i < triggers.length; i += perLine) {
            lines.push('> ' + triggers.slice(i, i + perLine).join(', '));
        }
        return lines.join('\n');
    },

    handleCommands(msg, text) {
        try {
            const [cmdTrigger, ...params] = text.split(/\s+/);
            const cmdItem = this.cmdMap.get(cmdTrigger);
            if (!cmdItem) return;
            if (msg._whisper && this.privateCmd && this.privateCmd[cmdItem.level] === 'off') return;
            if (this.coreMode && cmdItem.key !== 'eval' && cmdItem.key !== 'core') return;
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
        if (this.transientTimer) clearTimeout(this.transientTimer);
        if (this.pendingTransient) this.pendingTransient = null;
        for (const c of this.afkmeClients.values()) c.close();
        this.afkmeClients.clear();
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
    },

    handleHelp(msg, params) {
        try {
            const target = msg.nick;
            const prefix = CONFIG.CONST.NORMAL_PREFIX;
            if (params.length === 0) {
                const normalCmds = Object.entries(CMD_CONFIG).filter(([_, c]) => c.level === 'normal').sort((a, b) => a[1].pos - b[1].pos);
                const modCmds = Object.entries(CMD_CONFIG).filter(([_, c]) => c.level === 'mod').sort((a, b) => a[1].pos - b[1].pos);
                const normalList = this.formatCmdList(normalCmds);
                const modList = this.formatCmdList(modCmds);
                const helpText = [
                    `${this.placeholder}`,
                    `普通命令 前缀==${prefix}==`,
                    normalList,
                    '',
                    `Mod命令 前缀==${CONFIG.CONST.MOD_PREFIX}==`,
                    modList,
                    '',
                    `发送==${prefix}help 命令名==获取详细帮助 Mod使用==${CONFIG.CONST.MOD_PREFIX}==`,
                    `管理员请使用==${CONFIG.CONST.ADMIN_PREFIX}helpadmin==`,
                    ...(this.showRepo && CONFIG.CONST.REPO ? [`开源：${CONFIG.CONST.REPO}`] : [])
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
                const adminCmds = Object.entries(CMD_CONFIG).filter(([_, c]) => c.level === 'admin').sort((a, b) => a[1].pos - b[1].pos);
                const adminList = this.formatCmdList(adminCmds);
                const helpText = [
                    `${this.placeholder}`,
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
                const msgText = Math.random() > 0.5
                    ? `${nick} 正在 ${reason}...，加油！`
                    : `${nick} 正在 ${reason}...，请不要打扰他。`;
                this.sendChat(msgText);
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
                const last = this.lastSeen.get(target);
                if (last) {
                    const diff = Date.now() - last.time;
                    const ago = diff > 86400000 ? `${Math.floor(diff/86400000)}天前`
                        : diff > 3600000 ? `${Math.floor(diff/3600000)}小时前`
                        : `${Math.floor(diff/60000)}分钟前`;
                    this.sendChat(`**${target}** | trip: 未知 | 在线: 否 | 最后发言 ${ago}：${last.msg.slice(0, 100)}`);
                } else {
                    this.sendChat(`无 ${target} 的数据`);
                }
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
            store.writeFileSync(`history/${filename}`, this.messageHistory);
            this.sendChat(`导出到 data/history/${filename}`);
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

    handleEval(msg, params) {
        try {
            const code = params.join(' ');
            if (!code) {
                this.sendChat('格式：.eval <JavaScript 代码>');
                return;
            }
            const result = eval(code);
            if (result && typeof result.then === 'function') {
                result
                    .then(v => this.sendOutput(v === undefined ? 'undefined' : String(v)))
                    .catch(e => this.sendChat(`执行错误: ${e.message}`));
            } else {
                this.sendOutput(result === undefined ? 'undefined' : String(result));
            }
        } catch (err) {
            this.sendChat(`执行错误: ${err.message}`);
        }
    },

    sendOutput(text) {
        if (text == null) return;
        const maxLen = 400;
        if (text.length <= maxLen) {
            this.sendChat(text);
            return;
        }
        const chunks = [];
        let current = '';
        const lines = text.split('\n');
        for (let li = 0; li < lines.length; li++) {
            const line = lines[li];
            for (let i = 0; i < line.length; i += maxLen) {
                const piece = line.slice(i, i + maxLen);
                if (current.length + piece.length + (current ? 1 : 0) > maxLen) {
                    chunks.push(current);
                    current = '';
                }
                current += (current ? '\n' : '') + piece;
            }
            if (li < lines.length - 1) {
                if (current.length >= maxLen) {
                    chunks.push(current);
                    current = '';
                }
                current += '\n';
            }
        }
        if (current) chunks.push(current);
        for (const c of chunks) {
            if (c.trim()) this.sendChat(c);
        }
    },

    handleColor(msg, params) {
        try {
            const target = this.stripAt(params[0] || msg.nick);
            const spoken = this.lastUserColor.get(target);
            if (spoken) {
                this.sendChat(`${target} 颜色: ${spoken}`);
                return;
            }
            const online = this.onlineUsers.get(target);
            if (online && online.color) {
                this.sendChat(`${target} 颜色: ${online.color}`);
                return;
            }
            const joined = this.joinColor.get(target);
            if (joined) {
                this.sendChat(`${target} 颜色: ${joined}`);
                return;
            }
            this.sendChat(`无 ${target} 的数据`);
        } catch (err) {
            this.sendChat('颜色查询失败');
        }
    },

    handleWelc(msg, params) {
        try {
            const trip = msg.trip;
            if (!trip) {
                this.sendWhisper(msg.nick, '无识别码，无法设置欢迎语');
                return;
            }
            const text = this.getRawArgs(msg).replace(/\\n/g, '\n').trim();
            if (!text) {
                if (this.welcomeMessages.has(trip)) {
                    this.welcomeMessages.delete(trip);
                    this.markDirty();
                    this.sendWhisper(msg.nick, '已取消自定义欢迎语，将使用默认欢迎语');
                } else {
                    this.sendWhisper(msg.nick, '未设置自定义欢迎语');
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

    handleWelcome(msg, params) {
        try {
            const sub = (params[0] || '').toLowerCase();
            if (sub === 'on') {
                this.welcomeEnabled = true;
                this.markDirty();
                this.sendChat('全局欢迎语已开启');
            } else if (sub === 'off') {
                this.welcomeEnabled = false;
                this.markDirty();
                this.sendChat('全局欢迎语已关闭');
            } else if (sub === 'add') {
                const text = params.slice(1).join(' ').trim().replace(/\\n/g, '\n');
                if (!text) {
                    this.sendChat('格式：.welcome add <内容>（用 [nick] 表示昵称）');
                    return;
                }
                this.globalWelcome.push(text);
                this.markDirty();
                this.sendChat(`已添加全局欢迎语（共 ${this.globalWelcome.length} 条）：${text}`);
            } else if (sub === 'remove') {
                const arg = params[1];
                if (!arg) {
                    this.sendChat('格式：.welcome remove <序号|内容>');
                    return;
                }
                let removed = null;
                if (/^\d+$/.test(arg)) {
                    const idx = parseInt(arg, 10) - 1;
                    if (idx >= 0 && idx < this.globalWelcome.length) {
                        removed = this.globalWelcome.splice(idx, 1)[0];
                    }
                } else {
                    const i = this.globalWelcome.indexOf(arg);
                    if (i >= 0) removed = this.globalWelcome.splice(i, 1)[0];
                }
                if (removed != null) {
                    this.markDirty();
                    this.sendChat(`已删除全局欢迎语：${removed}`);
                } else {
                    this.sendChat('未找到该全局欢迎语');
                }
            } else if (sub === 'list') {
                if (!this.globalWelcome.length) {
                    this.sendChat('暂无全局欢迎语，将使用默认 hi [nick]');
                    return;
                }
                const list = this.globalWelcome.map((t, i) => `${i + 1}. ${t}`).join('\n');
                this.sendChat(`全局欢迎语（${this.welcomeEnabled ? '开启' : '关闭'}）：\n${list}`);
            } else if (sub === 'clear') {
                this.globalWelcome = [];
                this.markDirty();
                this.sendChat('全局欢迎语已清空，将使用默认 hi [nick]');
            } else {
                const lines = [`全局欢迎语：${this.welcomeEnabled ? '开启' : '关闭'}`];
                if (this.globalWelcome.length) {
                    lines.push(this.globalWelcome.map((t, i) => `${i + 1}. ${t}`).join('\n'));
                } else {
                    lines.push('默认：hi [nick]');
                }
                this.sendChat(lines.join('\n'));
            }
        } catch (err) {
            this.sendChat('welcome 操作失败');
        }
    },

    handleSeen(msg, params) {
        try {
            const target = this.stripAt(params[0] || msg.nick);
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
            const target = this.stripAt(params[0] || msg.nick);
            const online = this.onlineUsers.get(target);
            const joinTime = this.userJoinTime.get(target);
            const activity = this.userActivity.get(target) || 0;
            const last = this.lastSeen.get(target);
            if (!online && !joinTime && !activity && !last) {
                this.sendChat(`无 ${target} 的数据`);
                return;
            }
            let text = `**${target}**\n在线：${online ? '是' : '否'}\n`;
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
            if (!online && last) {
                const diff = Date.now() - last.time;
                const ago = diff > 86400000 ? `${Math.floor(diff/86400000)}天前`
                    : diff > 3600000 ? `${Math.floor(diff/3600000)}小时前`
                    : `${Math.floor(diff/60000)}分钟前`;
                text += `最后发言：${ago}：${last.msg.slice(0, 50)}\n`;
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
            const fromTrip = msg.trip || '';
            const target = params[0];
            const rawLeft = this.getRawArgs(msg).replace(/\\n/g, '\n').trim();
            const content = rawLeft.replace(/^\S+\s*/, '');
            let toNick = null, toTrip = null;
            if (target.startsWith('*')) {
                toNick = target.slice(1);
            } else {
                toTrip = target;
            }
            this.leftMessages.push({ toNick, toTrip, fromNick, fromTrip, content, time: Date.now() });
            this.markDirty();
            this.sendChat(`留言已保存`);
        } catch (err) {
            this.sendChat('留言失败');
        }
    },

    deliverLeftMessages(nick, trip) {
        try {
            const msgs = this.leftMessages.filter(m => m.toNick === nick || (m.toTrip && m.toTrip === trip));
            if (!msgs.length) return;
const timeStr = (ts) => {
                const d = this.getLocalTime(ts);
                return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            };
            const list = msgs.map(m => {
                const via = m.toNick ? 'nick' : 'trip';
                return `${m.fromNick}${m.fromTrip ? '#' + m.fromTrip : ''} 在 ${timeStr(m.time)} 使用 ${via} 给你留言：${m.content}`;
            }).join('\n');
            this.sendWhisper(nick, `您有 ${msgs.length} 条留言:\n${list}`, true);
            this.leftMessages = this.leftMessages.filter(m => !msgs.includes(m));
            this.markDirty();
        } catch (err) {}
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
            if (this.serverModWarn('kick')) return;
            const args = [...params];
            const target = this.stripAt(args[0]);
            if (!target) {
                this.sendUsage('kick', msg, CONFIG.CONST.MOD_PREFIX);
                return;
            }
            if (target === CONFIG.botNick) {
                this.sendChat('不能踢自己');
                return;
            }
            const payload = { cmd: 'kick', nick: target };
            this.sendWSMessage(payload, true, true);
            this.addAdminLog('kick', target, msg.trip);
            if (this.opHint) this.sendChat(`已踢出 ${target} ${ADMIN_ACTION}`);
        } catch (err) {
            this.sendChat('踢出失败');
        }
    },

    handleDisablecaptcha(msg, params) {
        try {
            if (this.serverModWarn('disablecaptcha')) return;
            const channel = this.stripAt(params[0]) || CONFIG.channel;
            this.sendWSMessage({ cmd: 'disablecaptcha', channel }, true, true);
            if (this.opHint) this.sendChat(`已请求关闭 ${channel} 的验证码`);
        } catch (err) {
            this.sendChat('操作失败');
        }
    },

    handleEnablecaptcha(msg, params) {
        try {
            if (this.serverModWarn('enablecaptcha')) return;
            const channel = this.stripAt(params[0]) || CONFIG.channel;
            this.sendWSMessage({ cmd: 'enablecaptcha', channel }, true, true);
            if (this.opHint) this.sendChat(`已请求开启 ${channel} 的验证码`);
        } catch (err) {
            this.sendChat('操作失败');
        }
    },

    handleUpd(msg, params) {
        try {
            const raw = this.getRawArgs(msg).replace(/\\n/g, '\n').trim();
            const m = /^\[([\s\S]*?)\]\s*\[([\s\S]*?)\]\s+(-?\d+)$/.exec(raw);
            let a, b, delay;
            if (m) {
                a = m[1].trim();
                b = m[2].trim();
                delay = Math.max(0, Math.min(60, parseInt(m[3])));
                if (!a || !b) {
                    this.sendChat('格式：.upd [起始] [结束] <秒>');
                    return;
                }
            } else {
                const sRaw = parseInt(params[params.length - 1]);
                delay = isNaN(sRaw) ? 0 : Math.max(0, Math.min(60, sRaw));
                a = params[0];
                b = params.slice(1, -1).join(' ').trim();
                if (!a || !b || isNaN(sRaw)) {
                    this.sendChat('格式：.upd <起始> <结束> <秒>');
                    return;
                }
            }
            const seq = (this.updSeq = (this.updSeq || 0) + 1);
            const customId = 'upd' + seq.toString(36);
            this.sendMessage(a, customId);
            if (delay > 0) {
                setTimeout(() => {
                    this.sendWSMessage({ cmd: 'updateMessage', mode: 'overwrite', text: b, customId }, true, true);
                }, delay * 1000);
            } else {
                this.sendWSMessage({ cmd: 'updateMessage', mode: 'overwrite', text: b, customId }, true, true);
            }
        } catch (err) {
            this.sendChat('更新失败');
        }
    },

    handleList(msg, params) {
        try {
            const channel = this.stripAt(params[0]);
            if (!channel) {
                this.sendChat('格式：;list <频道>');
                return;
            }
            const seq = (this.listSeq = (this.listSeq || 0) + 1);
            const customId = 'list' + seq.toString(36);
            this.sendMessage('稍等，正在查询在线用户...', customId);
            const finish = (err, users) => {
                const text = err ? `查询失败：${err}` : this.formatChannelList(users || [], channel);
                setTimeout(() => {
                    this.sendWSMessage({ cmd: 'updateMessage', mode: 'overwrite', text, customId }, true, true);
                }, 300);
            };
            if (channel === CONFIG.channel) {
                const users = [...this.onlineUsers.entries()]
                    .filter(([nick]) => !(nick === CONFIG.botNick || nick.startsWith(CONFIG.botNick + '#')))
                    .map(([nick, info]) => ({ nick, trip: info.trip || '', hash: info.hash || '', level: info.level }));
                finish(null, users);
            } else {
                this.probeChannelList(channel, finish);
            }
        } catch (err) {
            this.sendChat('list 操作失败');
        }
    },

    probeChannelList(channel, cb) {
        try {
            let nick = 'list_' + Math.floor(1000 + Math.random() * 9000);
            let ws = null;
            let done = false;
            const timeout = setTimeout(() => finish('查询超时', null), 15000);
            const finish = (err, users) => {
                if (done) return;
                done = true;
                clearTimeout(timeout);
                if (ws) {
                    try {
                        ws.removeAllListeners();
                        ws.terminate();
                    } catch (e) {}
                    ws = null;
                }
                cb(err, users);
            };
            ws = new WebSocket(CONFIG.server);
            ws.on('open', () => {
                ws.send(JSON.stringify({ cmd: 'join', channel, nick }));
            });
            ws.on('message', (data) => {
                try {
                    const msg = JSON.parse(data.toString());
                    if (msg.cmd === 'onlineSet' && msg.channel === channel) {
                        finish(null, msg.users || []);
                    } else if (msg.cmd === 'warn' && msg.text === 'Nickname taken') {
                        nick = 'list_' + Math.floor(1000 + Math.random() * 9000);
                        ws.send(JSON.stringify({ cmd: 'join', channel, nick }));
                    }
                } catch (e) {}
            });
            ws.on('error', () => finish('连接错误', null));
            ws.on('close', () => {
                if (!done) finish('连接关闭', null);
            });
        } catch (err) {
            cb('查询失败', null);
        }
    },

    handleSendmsg(msg, params) {
        try {
            const channel = this.stripAt(params[0]);
            const content = params.slice(1).join(' ');
            if (!channel || !content) {
                this.sendChat('格式：;sendmsg <频道> <内容>');
                return;
            }
            const from = msg.trip ? `${msg.nick}#${msg.trip}` : msg.nick;
            const text = `来自 ${CONFIG.channel} 的 ${from}：${content}`;
            this.probeSendMessage(channel, text, (err, count) => {
                if (err) {
                    this.sendChat(`发送失败：${err}`);
                    return;
                }
                this.sendChat(`好的，有 ${count} 个用户会看到你的消息。`);
            });
        } catch (err) {
            this.sendChat('sendmsg 操作失败');
        }
    },

    probeSendMessage(channel, text, cb) {
        try {
            let nick = 'send_' + Math.floor(1000 + Math.random() * 9000);
            let ws = null;
            let done = false;
            const timeout = setTimeout(() => finish('发送超时', null), 15000);
            const finish = (err, count) => {
                if (done) return;
                done = true;
                clearTimeout(timeout);
                if (ws) {
                    try {
                        ws.removeAllListeners();
                        ws.terminate();
                    } catch (e) {}
                    ws = null;
                }
                cb(err, count);
            };
            ws = new WebSocket(CONFIG.server);
            ws.on('open', () => {
                ws.send(JSON.stringify({ cmd: 'join', channel, nick }));
            });
            ws.on('message', (data) => {
                try {
                    const msg = JSON.parse(data.toString());
                    if (msg.cmd === 'onlineSet' && msg.channel === channel) {
                        const count = Math.max(0, (msg.users || []).length - 1);
                        ws.send(JSON.stringify({ cmd: 'chat', text }));
                        finish(null, count);
                    } else if (msg.cmd === 'warn' && msg.text === 'Nickname taken') {
                        nick = 'send_' + Math.floor(1000 + Math.random() * 9000);
                        ws.send(JSON.stringify({ cmd: 'join', channel, nick }));
                    }
                } catch (e) {}
            });
            ws.on('error', () => finish('连接错误', null));
            ws.on('close', () => {
                if (!done) finish('连接关闭', null);
            });
        } catch (err) {
            cb('发送失败', null);
        }
    },

    handleMotd(msg, params) {
        try {
            const sub = params[0] || '';
            if (sub === 'set') {
                const content = params.slice(1).join(' ').trim();
                if (!content) {
                    this.motdLines = [];
                    this.motdEnabled = false;
                    this.markDirty();
                    this.sendChat('频道公告已取消');
                    return;
                }
                this.motdLines = content.replace(/\\n/g, '\n').split('\n').filter(l => l.trim() !== '' || true);
                this.markDirty();
                this.sendChat('已设置频道公告基础内容');
            } else if (sub === 'on') {
                this.motdEnabled = true;
                this.markDirty();
                this.sendChat('频道公告已开启（每小时推送，含活动统计）');
                this.pushMotd();
            } else if (sub === 'off') {
                this.motdEnabled = false;
                this.markDirty();
                this.sendChat('频道公告已关闭');
            } else if (sub === 'now') {
                this.pushMotd();
            } else if (!sub) {
                this.motdLines = [];
                this.motdEnabled = false;
                this.markDirty();
                this.sendChat('频道公告已取消');
            } else {
                this.motdLines = params.join(' ').replace(/\\n/g, '\n').split('\n').filter(l => l.trim() !== '' || true);
                this.markDirty();
                this.sendChat('已设置频道公告基础内容');
            }
        } catch (err) {
            this.sendChat('motd 操作失败');
        }
    },

    handleFakemotd(msg, params) {
        try {
            const sub = params[0] || '';
            if (sub === 'set') {
                const content = params.slice(1).join(' ').trim();
                if (!content) {
                    this.fakemotdContent = '';
                    this.fakemotdEnabled = false;
                    this.markDirty();
                    this.sendChat('加入提示已取消');
                    return;
                }
                this.fakemotdContent = content.replace(/\\n/g, '\n');
                this.markDirty();
                this.sendChat('已设置加入提示内容');
            } else if (sub === 'on') {
                this.fakemotdEnabled = true;
                this.markDirty();
                this.sendChat('加入提示已开启');
            } else if (sub === 'off') {
                this.fakemotdEnabled = false;
                this.markDirty();
                this.sendChat('加入提示已关闭');
            } else if (!sub) {
                this.fakemotdContent = '';
                this.fakemotdEnabled = false;
                this.markDirty();
                this.sendChat('加入提示已取消');
            } else {
                this.fakemotdContent = params.join(' ').replace(/\\n/g, '\n');
                this.markDirty();
                this.sendChat('已设置加入提示内容');
            }
        } catch (err) {
            this.sendChat('fakemotd 操作失败');
        }
    },

    buildMotd() {
        const lines = this.motdLines.length ? [...this.motdLines] : ['**Welcome to ' + CONFIG.channel + '**'];
        const now = Date.now();
        const hourAgo = now - 3600000;
        let hourMsgs = 0;
        const hourUsers = new Set();
        let todayMsgs = 0;
        const todayUsers = new Set();
        for (const m of this.messageHistory) {
            if (!m.time) continue;
            if (m.time >= hourAgo) {
                hourMsgs++;
                hourUsers.add(m.nick);
            }
            if (this.isToday(m.time)) {
                todayMsgs++;
                todayUsers.add(m.nick);
            }
        }
        const t = this.getLocalTime();
        const month = ['', 'Jan.', 'Feb.', 'Mar.', 'Apr.', 'May', 'June', 'July', 'Aug.', 'Sept.', 'Oct.', 'Nov.', 'Dec.'];
        const h12 = ((t.getHours() + 11) % 12) + 1;
        const ampm = t.getHours() < 12 ? 'a.m.' : 'p.m.';
        lines.push('---');
        lines.push(`Activity past hour / today (${h12}-${(h12 % 12) + 1} ${ampm} / ${month[t.getMonth()]} ${t.getDate()}):`);
        lines.push(`Messages: ${hourMsgs}/${todayMsgs}`);
        lines.push(`Users: ${hourUsers.size}/${todayUsers.size}`);
        return lines.join('\n');
    },

    pushMotd() {
        if (this.serverModWarn('setmotd')) return;
        this.sendWSMessage({ cmd: 'setmotd', motd: this.buildMotd() }, true, true);
        if (this.opHint) this.sendChat('频道公告已推送');
    },

    startTransient(msg, type, channel, customId) {
        if (this.pendingTransient) {
            this.sendChat('已有频道操作进行中，请稍候');
            return;
        }
        this.pendingTransient = { type, channel, nick: msg.nick, origChannel: CONFIG.channel, time: Date.now(), phase: 'go', customId: customId || null };
        if (this.transientTimer) clearTimeout(this.transientTimer);
        this.transientTimer = setTimeout(() => {
            if (this.pendingTransient) {
                const t = this.pendingTransient;
                if (t.phase === 'go') {
                    t.result = t.result || '频道操作超时，已取消';
                    this.sendWSMessage({ cmd: 'join', channel: t.origChannel, nick: this.botNickWithTrip(), clientId: this.clientId }, true, true);
                } else {
                    this.pendingTransient = null;
                }
            }
        }, 20000);
        this.sendWSMessage({ cmd: 'leave', channel: CONFIG.channel }, true, true);
        setTimeout(() => {
            if (!this.pendingTransient) return;
            this.sendWSMessage({ cmd: 'join', channel, nick: this.botNickWithTrip(), clientId: this.clientId }, true, true);
        }, 300);
    },

    handleTransientOnlineSet(data) {
        const t = this.pendingTransient;
        if (!t || t.phase !== 'go' || data.channel !== t.channel) return;
        if (t.type === 'sendmsg') {
            this.sendChat(this.transientMessage, true);
            this.transientMessage = null;
        }
        t.phase = 'return';
        this.sendWSMessage({ cmd: 'leave', channel: t.channel }, true, true);
        setTimeout(() => {
            if (this.pendingTransient !== t) return;
            this.sendWSMessage({ cmd: 'join', channel: t.origChannel, nick: this.botNickWithTrip(), clientId: this.clientId }, true, true);
        }, 300);
    },

    serverModWarn(cmdName) {
        if (this.botLevel === undefined || this.botLevel >= 9999) return false;
        this.sendChat(`bot 在服务器不是 Mod，${cmdName} 会被服务器忽略`);
        return true;
    },

    formatChannelList(users, channel) {
        if (!users.length) return `**0 Users Online:**\n频道 ${channel} 暂无用户`;
        const rows = users.map(u => {
            const hash = u.hash || '???';
            const trip = u.trip || '(none)';
            const nick = u.nick;
            const bold = u.level >= 9999;
            const line = ` ${hash}   ${trip}   ${nick}`;
            return bold ? `**${line.trim()}**` : line;
        });
        const lines = [`**${users.length} Users Online:**`, ...rows, '', 'The information for Mods is in **bold**'];
        return lines.join('\n');
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
                this.sendWhisper(msg.nick, `${this.placeholder}\nMod列表：${list.join(', ')}`, true);
            } else {
                this.sendWhisper(msg.nick, `${this.placeholder}\n暂无 Mod`, true);
            }
        } catch (err) {
            this.sendWhisper(msg.nick, '查询Mod列表失败');
        }
    },

    handleLock(msg) {
        try {
            this.sendChat('/lockroom', true);
            if (this.opHint) this.sendChat('频道已锁定');
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
                if (list.length) this.sendWhisper(msg.nick, `${this.placeholder}\n白名单：${list.join(', ')}`, true);
                else this.sendWhisper(msg.nick, `${this.placeholder}\n暂无白名单用户`, true);
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
            if (this.opHint) this.sendChat(`${type} ${target} 已被封禁 ${ADMIN_ACTION}`);
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
                    const rawAdd = this.getRawArgs(msg).replace(/\\n/g, '\n').trim();
                    const content = rawAdd.replace(/^add\s+\S+\s*/, '');
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
                        const found = this.scheduledAnnouncements.findIndex(a => a.content.includes(keyword));
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
                    let trigger = '', reply = '', prob;
                    const restAdd = params.slice(1).join(' ');
                    const braceMatch = restAdd.match(/^\[([\s\S]*?)\]\s*\[([\s\S]*?)\]\s*(\d+)\s*$/);
                    if (braceMatch) {
                        trigger = braceMatch[1].trim();
                        reply = braceMatch[2].trim();
                        prob = parseInt(braceMatch[3]);
                    } else {
                        prob = parseInt(params[params.length - 1]);
                        reply = params.slice(-2, -1).join(' ') || '';
                        trigger = params.slice(1, -2).join(' ') || '';
                    }
                    if (isNaN(prob) || prob < 0 || prob > 100) {
                        this.sendChat('概率0-100');
                        return;
                    }
                    if (!reply) {
                        this.sendChat('格式：.if add [触发词] [回复] <概率> 或 .if add <触发词> <回复> <概率>');
                        return;
                    }
                    this.ifRules.push({ trigger, reply, probability: prob, isRegex: false, id: Date.now() });
                    this.markDirty();
                    this.sendChat(`已添加：[${trigger || '空'}] -> [${reply}] (${prob}%)`);
                    break;
                }
                case 'addz': {
                    let regex = '', replyZ = '', probZ;
                    const restZ = params.slice(1).join(' ');
                    const braceZ = restZ.match(/^\[([\s\S]*?)\]\s*\[([\s\S]*?)\]\s*(\d+)\s*$/);
                    if (braceZ) {
                        regex = braceZ[1].trim();
                        replyZ = braceZ[2].trim();
                        probZ = parseInt(braceZ[3]);
                    } else {
                        probZ = parseInt(params[params.length - 1]);
                        replyZ = params.slice(-2, -1).join(' ') || '';
                        regex = params.slice(1, -2).join(' ') || '';
                    }
                    if (isNaN(probZ) || probZ < 0 || probZ > 100) {
                        this.sendChat('概率0-100');
                        return;
                    }
                    if (!replyZ) {
                        this.sendChat('格式：.if addz [正则] [回复] <概率> 或 .if addz <正则> <回复> <概率>');
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
                        const found = this.ifRules.findIndex(r => r.trigger.includes(keyword) || r.reply.includes(keyword));
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

    async handleV(msg) {
        try {
            const seq = (this.vMsgSeq = (this.vMsgSeq || 0) + 1);
            const customId = 'v' + seq.toString(36);
            this.sendMessage('稍等，正在获取运行信息...', customId);
            const mem = process.memoryUsage();
            const memStr = `${(mem.rss / 1024 / 1024).toFixed(1)}MB`;
            const ping = await this.measurePing();
            const pingStr = ping != null ? `${ping}ms` : 'N/A';
            let version = '1.2.2';
            try { version = require('./package.json').version; } catch(e) {}
            const text = `**AmaOka** v${version}\n内存：${memStr}\n延迟：${pingStr}`;
            setTimeout(() => {
                this.sendWSMessage({ cmd: 'updateMessage', mode: 'overwrite', text, customId }, true, true);
            }, 300);
        } catch (err) {
            this.sendChat('获取运行信息失败');
        }
    },

    handleStatus(msg) {
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

    handleBackup(msg, params) {
        try {
            const sub = (params[0] || 'list').toLowerCase();
            if (sub === 'list') {
                const files = store.listFiles('backup').sort();
                if (!files.length) { this.sendChat('暂无备份'); return; }
                this.sendChat(`备份文件：\n${files.map((f, i) => `[${i + 1}] ${f}`).join('\n')}`);
            } else if (sub === 'remove') {
                const arg = params[1];
                const files = store.listFiles('backup').sort();
                if (!arg) { this.sendChat('格式：.backup remove <序号或文件名>'); return; }
                const idx = parseInt(arg);
                let name = null;
                if (!isNaN(idx) && idx >= 1 && idx <= files.length) name = files[idx - 1];
                else if (files.includes(arg)) name = arg;
                if (!name) { this.sendChat('未找到该备份'); return; }
                fs.unlinkSync(path.join(BACKUP_DIR, name));
                this.sendChat(`已删除备份：${name}`);
            } else if (sub === 'clear') {
                for (const f of store.listFiles('backup')) {
                    fs.unlinkSync(path.join(BACKUP_DIR, f));
                }
                this.sendChat('已清空备份');
            } else {
                this.sendChat('格式：.backup list|remove|clear');
            }
        } catch (err) {
            this.sendChat('备份操作失败');
        }
    },

    handleHistory(msg, params) {
        try {
            const sub = (params[0] || 'list').toLowerCase();
            if (sub === 'list') {
                const files = store.listFiles('history').sort();
                if (!files.length) { this.sendChat('暂无历史文件'); return; }
                this.sendChat(`历史文件：\n${files.map((f, i) => `[${i + 1}] ${f}`).join('\n')}`);
            } else if (sub === 'remove') {
                const arg = params[1];
                const files = store.listFiles('history').sort();
                if (!arg) { this.sendChat('格式：.history remove <序号或文件名>'); return; }
                const idx = parseInt(arg);
                let name = null;
                if (!isNaN(idx) && idx >= 1 && idx <= files.length) name = files[idx - 1];
                else if (files.includes(arg)) name = arg;
                if (!name) { this.sendChat('未找到该历史文件'); return; }
                fs.unlinkSync(path.join(HISTORY_DIR, name));
                this.sendChat(`已删除历史文件：${name}`);
            } else if (sub === 'clear') {
                for (const f of store.listFiles('history')) {
                    fs.unlinkSync(path.join(HISTORY_DIR, f));
                }
                this.sendChat('已清空历史文件');
            } else if (sub === 'keep') {
                const days = parseInt(params[1]);
                if (isNaN(days) || days < 1) { this.sendChat('格式：.history keep <天数>'); return; }
                this.historyKeepDays = days;
                this.markDirty();
                this.cleanOldHistory();
                this.sendChat(`历史文件保留天数已设为 ${days} 天`);
            } else if (sub === 'keepmsg') {
                const days = parseInt(params[1]);
                if (isNaN(days) || days < 1) { this.sendChat('格式：.history keepmsg <天数>'); return; }
                this.historyKeepMsgDays = days;
                this.markDirty();
                this.cleanOldMessages();
                this.sendChat(`本地历史消息超过 ${days} 天将自动清理`);
            } else {
                this.sendChat('格式：.history list|remove|clear|keep|keepmsg');
            }
        } catch (err) {
            this.sendChat('历史操作失败');
        }
    },

    handleCmd(msg, params) {
        try {
            const name = params[0]?.toLowerCase();
            const level = params[1]?.toLowerCase();
            if (!name || !['normal', 'mod', 'admin', 'default'].includes(level)) {
                this.sendChat('格式：.cmd <命令名> <normal|mod|admin|default>');
                return;
            }
            let cmdKey = null;
            for (const [key, cfg] of Object.entries(CMD_CONFIG)) {
                if (key === name || cfg.trigger.includes(name)) { cmdKey = key; break; }
            }
            if (!cmdKey) {
                this.sendChat(`未找到命令：${name}`);
                return;
            }
            if (level === 'default') {
                CMD_CONFIG[cmdKey].level = CMD_CONFIG[cmdKey].defaultLevel || CMD_CONFIG[cmdKey].level;
                CMD_CONFIG[cmdKey].pos = CMD_CONFIG[cmdKey].defaultPos;
                this.initCmdMap();
                this.sendChat(`命令 ${CMD_CONFIG[cmdKey].trigger[0]} 已恢复默认等级：${CMD_CONFIG[cmdKey].level}`);
                return;
            }
            CMD_CONFIG[cmdKey].level = level;
            const sameLevel = Object.entries(CMD_CONFIG).filter(([k, c]) => c.level === level && k !== cmdKey).map(([_, c]) => c.pos);
            CMD_CONFIG[cmdKey].pos = (sameLevel.length ? Math.max(...sameLevel) : -1) + 1;
            this.initCmdMap();
            this.sendChat(`命令 ${CMD_CONFIG[cmdKey].trigger[0]} 已设为 ${level} 等级`);
        } catch (err) {
            this.sendChat('设置命令等级失败');
        }
    },

    handleSet(msg, params) {
        try {
            if (!params.length) {
                this.sendChat('格式：.set <键> <值>；键：placeholder|columns|repo|hour|question|hint|yiyan');
                return;
            }
            const key = params[0].toLowerCase();
            const val = params.slice(1).join(' ');
            if (!val) {
                this.sendChat('格式：.set <键> <值>');
                return;
            }
            switch (key) {
                case 'placeholder':
                    this.placeholder = val;
                    this.sendChat(`占位符已设为：${val}`);
                    break;
                case 'yiyan':
                    if (val === 'on' || val === 'off') {
                        this.includeYiyan = val === 'on';
                        this.sendChat(`随机一言已${this.includeYiyan ? '开启' : '关闭'}`);
                    } else this.sendChat('yiyan 需为 on|off');
                    break;
                case 'random': {
                    this.sendChat('random 请使用 .random 命令');
                    break;
                }
                case 'columns': {
                    const n = parseInt(val);
                    if (isNaN(n) || n < 1 || n > 10) { this.sendChat('columns 需为 1-10 的整数'); return; }
                    this.helpColumns = n;
                    this.sendChat(`帮助横向命令数已设为：${n}`);
                    break;
                }
                case 'repo':
                    if (val === 'on' || val === 'off') {
                        this.showRepo = val === 'on';
                        this.sendChat(`帮助中开源地址已${this.showRepo ? '显示' : '隐藏'}`);
                    } else this.sendChat('repo 需为 on|off');
                    break;
                case 'hour':
                    if (val === 'on' || val === 'off') {
                        this.hourlyReminder = val === 'on';
                        this.sendChat(`整点报时已${this.hourlyReminder ? '开启' : '关闭'}`);
                    } else this.sendChat('hour 需为 on|off');
                    break;
                case 'question':
                    if (val === 'on' || val === 'off') {
                        this.questionReply = val === 'on';
                        this.sendChat(`问号触发已${this.questionReply ? '开启' : '关闭'}`);
                    } else this.sendChat('question 需为 on|off');
                    break;
                case 'hint':
                    if (val === 'on' || val === 'off') {
                        this.opHint = val === 'on';
                        this.sendChat(`管理操作提示已${this.opHint ? '开启' : '关闭'}`);
                    } else this.sendChat('hint 需为 on|off');
                    break;
                case 'pm': {
                    this.sendChat('pm 请使用 .wsr 命令');
                    break;
                }
                default:
                    this.sendChat(`未知键：${key}；可用键：placeholder|columns|repo|hour|question|hint|yiyan`);
                    return;
            }
            this.markDirty();
        } catch (err) {
            this.sendChat('设置失败');
        }
    },

    handleAdmin(msg, params) {
        try {
            const sub = params[0]?.toLowerCase();
            if (!sub) {
                this.sendChat('格式：.admin add|remove|list');
                return;
            }
            if (sub === 'add') {
                const trip = params[1];
                if (!trip || !/^[A-Za-z0-9+/]{6}$/.test(trip)) { this.sendChat('无效 tripcode'); return; }
                this.adminList.add(trip);
                this.markDirty();
                this.sendChat(`已添加 admin：${trip}`);
                this.addAdminLog('addadmin', trip, msg.trip);
            } else if (sub === 'remove') {
                const trip = params[1];
                if (!trip) { this.sendChat('格式：.admin remove <tripcode>'); return; }
                if (!this.adminList.has(trip)) { this.sendChat(`未找到 admin：${trip}`); return; }
                if (this.adminList.size <= 1) { this.sendChat('至少需保留一个 admin'); return; }
                this.adminList.delete(trip);
                this.markDirty();
                this.sendChat(`已删除 admin：${trip}`);
                this.addAdminLog('deladmin', trip, msg.trip);
            } else if (sub === 'list') {
                this.sendChat(`admin 列表：${[...this.adminList].join(', ') || '无'}`);
            } else {
                this.sendChat('格式：.admin add|remove|list');
            }
        } catch (err) {
            this.sendChat('admin 管理失败');
        }
    },

    handleAfkme(msg, params) {
        try {
            const isWhisper = !!msg._whisper;
            const showNick = (a) => a.nick;
            const sub = params[0]?.toLowerCase();
            if (sub === 'list') {
                if (!this.afkme.length) { this.sendChat('暂无分身'); return; }
                const list = this.afkme.map((a, i) => {
                    const cli = this.afkmeClients.get(`${a.nick}#${a.trip}`);
                    const state = cli && cli.connected ? '在线' : '离线';
                    return `[${i + 1}] ${showNick(a)} -> ${a.channel} (${state})`;
                }).join('\n');
                this.sendChat(`分身列表：\n${list}`);
                return;
            }
            if (sub === 'remove') {
                let nick = null, trip = '';
                if (params.length >= 3) { nick = params[1]; trip = params[2]; }
                else if (params[1]) {
                    const [n, t] = params[1].split('#');
                    nick = n; trip = t || '';
                }
                if (trip && !isWhisper) {
                    this.sendChat('公屏调用不支持密码，请私信调用');
                    return;
                }
                if (!nick) { this.sendChat('格式：.afkme remove <nick> [trip]'); return; }
                const idx = this.afkme.findIndex(a => a.nick === nick && (a.trip || '') === trip);
                if (idx < 0) { this.sendChat(`未找到分身 ${nick}`); return; }
                this.stopAfkClient(nick, trip);
                this.afkme.splice(idx, 1);
                this.markDirty();
                this.sendChat(`已删除分身 ${nick}`);
                return;
            }
            if (sub === 'clear') {
                for (const c of this.afkmeClients.values()) c.close();
                this.afkmeClients.clear();
                this.afkme = [];
                this.markDirty();
                this.sendChat('已清空所有分身');
                return;
            }
            let nick = null, trip = '', channel = null;
            if (params.length >= 3) { nick = params[0]; trip = params[1]; channel = params[2]; }
            else if (params.length >= 2) {
                const [n, t] = params[0].split('#');
                nick = n; trip = t || ''; channel = params[1];
            }
            if (trip && !isWhisper) {
                this.sendChat('公屏调用不支持密码，请私信调用');
                return;
            }
            if (!nick || !channel) {
                this.sendChat(isWhisper
                    ? '格式：.afkme <nick#trip> <channel> 或 .afkme <nick> <trip> <channel>'
                    : '格式：.afkme <nick> <channel>');
                return;
            }
            if (this.afkme.length >= 10) { this.sendChat('分身已达上限 10 个'); return; }
            if (this.afkme.some(a => a.nick === nick && (a.trip || '') === trip)) {
                this.sendChat(`分身 ${nick} 已存在`);
                return;
            }
            this.afkme.push({ nick, trip, channel, createdAt: Date.now() });
            this.markDirty();
            this.startAfkClient(nick, trip, channel);
            this.sendChat(`已添加分身 ${nick} -> ${channel}`);
        } catch (err) {
            this.sendChat('afkme 操作失败');
        }
    },

    startAfkClient(nick, trip, channel) {
        const key = `${nick}#${trip}`;
        if (this.afkmeClients.has(key)) return;
        const cli = new AFKClient(this, { nick, trip, channel });
        this.afkmeClients.set(key, cli);
        cli.connect();
    },

    stopAfkClient(nick, trip) {
        const key = `${nick}#${trip}`;
        const cli = this.afkmeClients.get(key);
        if (cli) {
            cli.close();
            this.afkmeClients.delete(key);
        }
    },

    startAfkClients() {
        for (const a of this.afkme) {
            this.startAfkClient(a.nick, a.trip, a.channel);
        }
    },

    handleLists(msg, params) {
        try {
            const type = params[0]?.toLowerCase();
            if (!type) {
                this.sendChat('格式：.lists wht|ign|afks|word|ban|sil');
                return;
            }
            let result = '';
            switch (type) {
                case 'wht': result = `白名单：${[...this.whitelist].join(', ') || '无'}`; break;
                case 'ign': result = `忽略列表：${[...this.ignoreList].join(', ') || '无'}`; break;
                case 'afks': result = `AFK用户：${[...this.afkUsers.keys()].join(', ') || '无'}`; break;
                case 'word': result = `封禁词：${this.banWords.join(', ') || '无'}`; break;
                case 'ban': result = `封禁列表：${[...this.blackList].join(', ') || '无'}`; break;
                case 'sil': result = `禁言用户：${[...this.silencedUsers.keys()].join(', ') || '无'}`; break;
                default: this.sendChat('类型错误，可选：wht, ign, afks, word, ban, sil'); return;
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

    handleCore(msg, params) {
        try {
            const action = params[0]?.toLowerCase();
            if (!action || (action !== 'on' && action !== 'off')) {
                this.sendChat(`内核模式：${this.coreMode ? '开' : '关'}；格式：.core on|off`);
                return;
            }
            this.coreMode = action === 'on';
            this.markDirty();
            this.sendChat(`内核模式已${this.coreMode ? '开启' : '关闭'}${this.coreMode ? '' : ''}`);
        } catch (err) {
            this.sendChat('内核模式切换失败');
        }
    },

    handleRejoin(msg) {
        try {
            this.sendChat('正在重新加入频道...');
            setTimeout(() => this.connectWS(), 500);
        } catch (err) {
            this.sendChat('重新加入失败');
        }
    },

    handleReload(msg) {
        try {
            this.sendChat('正在重载代码...');
            this.cleanedUp = false;
            this.isStopping = false;
            this.cleanup();
            const statusFile = require.resolve('./status');
            for (const key of Object.keys(require.cache)) {
                if (key === statusFile) continue;
                if (key.startsWith(__dirname) && key.endsWith('.js')) {
                    delete require.cache[key];
                }
            }
            require('./main');
            console.log('[重载] 完成');
        } catch (err) {
            this.sendChat(`重载失败: ${err.message}`);
            console.error('[重载失败]', err);
            process.exit(1);
        }
    },

    handleTime(msg) {
        try {
            const t = this.getLocalTime();
            const hh = String(t.getHours()).padStart(2, '0');
            const mm = String(t.getMinutes()).padStart(2, '0');
            this.fetchWithTimeout(`https://literature-clock.jenevoldsen.com/times/${hh}_${mm}.json`, {}, 10000)
                .then(res => res.json())
                .then(data => {
                    const arr = Array.isArray(data) ? data : [];
                    if (!arr.length) {
                        this.sendChat('出错啦，请稍后再试');
                        return;
                    }
                    const chosen = arr[Math.floor(Math.random() * arr.length)];
                    if (!chosen) {
                        this.sendChat('出错啦，请稍后再试');
                        return;
                    }
                    let text = `>${chosen.quote_first || ''}**${chosen.quote_time_case || ''}**${chosen.quote_last || ''}\n\n\\- ${chosen.title || ''}, *${chosen.author || ''}*`;
                    text = text.replace(/<br\/>/g, '\n>');
                    this.sendChat(text);
                })
                .catch(() => this.sendChat('出错啦，请稍后再试'));
        } catch (err) {
            this.sendChat('获取文学时钟失败');
        }
    },

    handleSetu(msg, params) {
        try {
            if (this.setuRl.frisk('*', 1)) {
                this.sendChat('别涩涩了');
                return;
            }
            if (msg._whisper) {
                this.sendChat('你要偷着乐吗');
                return;
            }
            const args = params.join(' ').trim();
            const seq = (this.setuSeq = (this.setuSeq || 0) + 1);
            const customId = 'setu' + seq.toString(36);
            this.sendMessage('少女祈祷中...', customId);
            const url = args ? `https://api.lolicon.app/setu/v2?${args}` : 'https://api.lolicon.app/setu/v2';
            const upd = (text) => this.sendWSMessage({ cmd: 'updateMessage', mode: 'overwrite', text, customId }, true, true);
            this.fetchWithTimeout(url, {}, 15000)
                .then(res => res.json())
                .then(j => {
                    if (!j || j.error) {
                        upd('API出问题啦');
                        return;
                    }
                    if (!j.data || !j.data.length) {
                        upd('没有找到符合要求的涩图啦');
                        return;
                    }
                    const pic = j.data[0];
                    const tags = (pic.tags || []).filter(i => !/[乳魅内尻屁胸]/.test(i));
                    const url2 = (pic.urls && pic.urls.original) || '';
                    const pixiv = `https://www.pixiv.net/artworks/${pic.pid}`;
                    const text = `![qaq](${url2})\n原url：${pixiv}\n标题：${pic.title || ''}\n标签：${tags.join(', ') || '无'}\n作者：${pic.author || ''}`;
                    upd(text);
                })
                .catch(() => upd('出问题啦'));
        } catch (err) {
            this.sendChat('setu 出错啦');
        }
    },

    handleRun(msg, params) {
        try {
            if (!msg || typeof msg.text !== 'string') {
                this.sendChat('格式：.run 每条命令一行');
                return;
            }
            const raw = this.getRawArgs(msg).replace(/\\n/g, '\n').trim();
            const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
            if (!lines.length) {
                this.sendChat('格式：.run 每条命令一行');
                return;
            }
            const pub = [];
            const priv = [];
            const origChat = this.sendChat;
            const origWhisper = this.sendWhisper;
            const origMessage = this.sendMessage;
            this.sendChat = (...a) => { pub.push(String(a[0] == null ? '' : a[0])); };
            this.sendWhisper = (...a) => { priv.push(String(a[1] == null ? '' : a[1])); };
            this.sendMessage = (...a) => { pub.push(String(a[0] == null ? '' : a[0])); };
            try {
                for (const line of lines) {
                    try {
                        this.handleCommands(msg, line);
                    } catch (e) {
                        pub.push(`错误：${e.message}`);
                    }
                }
            } finally {
                this.sendChat = origChat;
                this.sendWhisper = origWhisper;
                this.sendMessage = origMessage;
            }
            if (pub.length) this.sendChat(pub.join('\n'));
            if (priv.length) this.sendWhisper(msg.nick, priv.join('\n'));
            if (!pub.length && !priv.length) this.sendChat('(无输出)');
        } catch (err) {
            this.sendChat('run 执行失败');
        }
    },

    handleAds(msg, params) {
        try {
            if (!this.hourlyAds) this.hourlyAds = { enabled: true, hours: {}, ads: {} };
            const arg = params[0];
            if (!arg) {
                const list = Object.entries(this.hourlyAds.hours || {}).map(([h, t]) => `${h}点：${t}${(this.hourlyAds.ads || {})[h] ? `\n  广告：${this.hourlyAds.ads[h]}` : ''}`);
                this.sendChat(`定点报时广告：${this.hourlyAds.enabled ? '开' : '关'}${list.length ? '\n' + list.join('\n') : '\n默认文案：x点了'}`);
                return;
            }
            if (arg === 'on') {
                this.hourlyAds.enabled = true;
                this.markDirty();
                this.sendChat('定点报时广告已开启');
                return;
            }
            if (arg === 'off') {
                this.hourlyAds.enabled = false;
                this.markDirty();
                this.sendChat('定点报时广告已关闭');
                return;
            }
            if (arg === 'all') {
                let content = params[1] === 'set' ? params.slice(2).join(' ') : params.slice(1).join(' ');
                if (!content.trim()) {
                    this.sendChat('格式：.ads all <内容> 或 .ads all set <广告内容>');
                    return;
                }
                if (params[1] === 'set') {
                    for (let h = 0; h < 24; h++) this.hourlyAds.ads[h] = content.trim();
                    this.markDirty();
                    this.sendChat(`已设置所有整点广告：${content.trim()}`);
                } else {
                    for (let h = 0; h < 24; h++) this.hourlyAds.hours[h] = content.trim();
                    this.markDirty();
                    this.sendChat(`已设置所有整点报时：${content.trim()}`);
                }
                return;
            }
            const hour = parseInt(arg);
            if (isNaN(hour) || hour < 0 || hour > 23) {
                this.sendChat('格式：.ads on|off|<0-23> <内容>|all <内容>');
                return;
            }
            let content = params[1] === 'set' ? params.slice(2).join(' ') : params.slice(1).join(' ');
            if (!content.trim()) {
                this.sendChat('格式：.ads <小时> <报时内容> 或 .ads <小时> set <广告内容>');
                return;
            }
            if (params[1] === 'set') {
                this.hourlyAds.ads[hour] = content.trim();
                this.markDirty();
                this.sendChat(`已设置 ${hour} 点的广告：${content.trim()}`);
            } else {
                this.hourlyAds.hours[hour] = content.trim();
                this.markDirty();
                this.sendChat(`已设置 ${hour} 点的报时：${content.trim()}`);
            }
        } catch (err) {
            this.sendChat('ads 操作失败');
        }
    },

    handleWsr(msg, params) {
        try {
            const arg = (params[0] || '').toLowerCase();
            const second = (params[1] || '').toLowerCase();
            const levels = ['normal', 'mod', 'admin'];
            const levelText = { normal: '普通', mod: 'Mod', admin: '管理员' };
            const supportText = { on: '支持', off: '不支持' };
            if (!levels.includes(arg) || !['on', 'off'].includes(second)) {
                const st = levels.map(lv => `${lv}:${this.privateCmd[lv] === 'off' ? '不支持' : '支持'}`).join(' ');
                this.sendChat(`私信：${st}；格式：.wsr <normal|mod|admin> <on|off>`);
                return;
            }
            this.privateCmd[arg] = second;
            this.markDirty();
            this.sendChat(`${levelText[arg]}等级命令已设为：${supportText[second]}`);
        } catch (err) {
            this.sendChat('wsr 操作失败');
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
            this.joinColor.clear();
            this.markDirty();
            this.sendChat('所有数据已清空');
        } catch (err) {
            this.sendChat('数据清空失败');
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
    }
};

Object.assign(bot, core);
Object.assign(bot, mainHandlers);

bot.init();

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
