const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;
const DATA_FILE = path.join(__dirname, 'db.json');
const ADMIN_PASSWORD = "admin"; 
const FORCE_UPDATE = true; 

app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// 默认接口配置 (保持你的 30+ 个接口不变)
const DEFAULT_SITES = [
    { key: "ffzy", name: "非凡影视", api: "https://替换接口 一行一条", active: true },]

if (!fs.existsSync(DATA_FILE) || FORCE_UPDATE) {
    // 只有在没有文件时，或者强制更新开启时，才重置配置
    // 但为了不覆盖你可能手动添加的，我们这里只在文件不存在时写入，或者你确认要重置
    if(!fs.existsSync(DATA_FILE)) {
        fs.writeFileSync(DATA_FILE, JSON.stringify({ sites: DEFAULT_SITES }, null, 2));
    }
}

function getDB() { 
    try {
        const data = JSON.parse(fs.readFileSync(DATA_FILE));
        // 简单的合并逻辑：确保代码里的30多个接口都在数据库里
        if(FORCE_UPDATE) {
            const dbSites = data.sites || [];
            DEFAULT_SITES.forEach(defSite => {
                if(!dbSites.find(s => s.key === defSite.key)) {
                    dbSites.push(defSite);
                }
            });
            return { sites: dbSites };
        }
        return data;
    } catch(e) {
        return { sites: DEFAULT_SITES };
    }
}
function saveDB(data) { fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2)); }

// === ★ 新增：真实测速接口 ★ ===
app.get('/api/check', async (req, res) => {
    const { key } = req.query;
    const sites = getDB().sites;
    const site = sites.find(s => s.key === key);
    
    if (!site) return res.json({ latency: 9999 });

    const start = Date.now();
    try {
        // 尝试请求该接口的首页（只请求一页，极简模式）
        await axios.get(`${site.api}?ac=list&pg=1`, { timeout: 3000 });
        const latency = Date.now() - start;
        res.json({ latency: latency });
    } catch (e) {
        res.json({ latency: 9999 }); // 超时或错误
    }
});

// === 热门接口 ===
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

// === 搜索接口 (为了速度，搜索阶段不测速) ===
app.get('/api/search', async (req, res) => {
    const { wd } = req.query;
    console.log(`[Search] ${wd}`);
    if (!wd) return res.json({ list: [] });
    
    const sites = getDB().sites.filter(s => s.active);
    
    const promises = sites.map(async (site) => {
        try {
            const response = await axios.get(`${site.api}?ac=list&wd=${encodeURIComponent(wd)}&out=json`, { timeout: 6000 });
            const data = response.data;
            const list = data.list || data.data;
            if (list && Array.isArray(list)) {
                return list.map(item => ({
                    ...item, 
                    site_key: site.key, 
                    site_name: site.name,
                    // 这里先不测速，给个默认值，点击详情再测
                    latency: 0 
                }));
            }
        } catch (e) {}
        return [];
    });
    
    const results = await Promise.all(promises);
    res.json({ list: results.flat() });
});

// === 详情接口 ===
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

app.listen(PORT, () => { console.log(`服务已启动: http://localhost:${PORT}`); });
