const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const cookieParser = require('cookie-parser');

const app = express();
// 修复：确保端口从环境变量获取，适配云端
const PORT = process.env.PORT || 3000;

// 修复：确保在挂载硬盘的情况下也能正确处理目录
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
    try {
        fs.mkdirSync(dataDir, { recursive: true });
    } catch (err) {
        console.error("创建 data 目录失败:", err);
    }
}

const DATA_FILE = path.join(dataDir, 'db.json');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin"; 
const FORCE_UPDATE = true; 
const SITE_PASSWORD = process.env.SITE_PASSWORD || "123456"; 

app.use(cors());
app.use(cookieParser());
app.use(bodyParser.json());

// 1. 登录接口 (必须放在中间件之前，否则会被拦截)
app.post('/api/login', (req, res) => {
    const { password } = req.body;
    if (password === SITE_PASSWORD) {
        res.cookie('auth_token', 'verified', { maxAge: 7 * 24 * 60 * 60 * 1000, httpOnly: true });
        res.json({ success: true });
    } else {
        res.status(401).json({ success: false, message: "密码错误" });
    }
});

// 2. 全局访问控制中间件
app.use((req, res, next) => {
    // 排除登录页、接口以及静态资源文件(css/js/images)
    const publicPaths = ['/login.html', '/api/login'];
    const isStaticFile = req.path.includes('.');

    if (publicPaths.includes(req.path) || isStaticFile || req.cookies.auth_token === 'verified') {
        return next();
    } else {
        res.redirect('/login.html');
    }
});

// 3. 静态文件托管 (放在中间件之后)
app.use(express.static('public'));

// 默认配置
const DEFAULT_SITES = [
    { key: "ffzy", name: "非凡影视", api: "https://api.ffzyapi.com/api.php/provide/vod", active: true }
];

// 初始化数据库
if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ sites: DEFAULT_SITES }, null, 2));
}

function getDB() { 
    try {
        const data = JSON.parse(fs.readFileSync(DATA_FILE));
        if(FORCE_UPDATE) {
            const dbSites = data.sites || [];
            DEFAULT_SITES.forEach(defSite => {
                if(!dbSites.find(s => s.key === defSite.key)) dbSites.push(defSite);
            });
            return { sites: dbSites };
        }
        return data;
    } catch(e) {
        return { sites: DEFAULT_SITES };
    }
}

function saveDB(data) { fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2)); }

// API 接口部分保持不变...
app.get('/api/check', async (req, res) => {
    const { key } = req.query;
    const sites = getDB().sites;
    const site = sites.find(s => s.key === key);
    if (!site) return res.json({ latency: 9999 });
    const start = Date.now();
    try {
        await axios.get(`${site.api}?ac=list&pg=1`, { timeout: 3000 });
        res.json({ latency: Date.now() - start });
    } catch (e) { res.json({ latency: 9999 }); }
});

app.get('/api/hot', async (req, res) => {
    const sites = getDB().sites.filter(s => ['ffzy', 'bfzy', 'lzi', 'dbzy'].includes(s.key));
    for (const site of sites) {
        try {
            const response = await axios.get(`${site.api}?ac=list&pg=1&h=24&out=json`, { timeout: 3000 });
            const list = response.data.list || response.data.data;
            if(list && list.length > 0) return res.json({ list: list.slice(0, 12) });
        } catch (e) { continue; }
    }
    res.json({ list: [] });
});

app.get('/api/search', async (req, res) => {
    const { wd } = req.query;
    if (!wd) return res.json({ list: [] });
    const sites = getDB().sites.filter(s => s.active);
    const promises = sites.map(async (site) => {
        try {
            const response = await axios.get(`${site.api}?ac=list&wd=${encodeURIComponent(wd)}&out=json`, { timeout: 6000 });
            const data = response.data;
            const list = data.list || data.data;
            if (list && Array.isArray(list)) {
                return list.map(item => ({ ...item, site_key: site.key, site_name: site.name, latency: 0 }));
            }
        } catch (e) {}
        return [];
    });
    const results = await Promise.all(promises);
    res.json({ list: results.flat() });
});

app.get('/api/detail', async (req, res) => {
    const { site_key, id } = req.query;
    const targetSite = getDB().sites.find(s => s.key === site_key);
    if (!targetSite) return res.status(404).json({ error: "Site not found" });
    try {
        const response = await axios.get(`${targetSite.api}?ac=detail&ids=${id}&out=json`, { timeout: 6000 });
        res.json(response.data);
    } catch (e) { res.status(500).json({ error: "Source Error" }); }
});

app.post('/api/admin/login', (req, res) => req.body.password === ADMIN_PASSWORD ? res.json({ success: true }) : res.status(403).json({ success: false }));
app.get('/api/admin/sites', (req, res) => res.json(getDB().sites));
app.post('/api/admin/sites', (req, res) => { saveDB({sites: req.body.sites}); res.json({ success: true }); });

// 启动服务
app.listen(PORT, '0.0.0.0', () => { 
    console.log(`服务已启动，监听地址: 0.0.0.0:${PORT}`); 
});
