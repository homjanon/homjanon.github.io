/**
 * 本地存储管理模块
 * 负责资产的增删改查，数据保存在localStorage中
 */

const StorageManager = (function() {
    const STORAGE_KEY = 'investment_tracker_data';
    const CONFIG_KEY = 'investment_tracker_config';
    const CASH_KEY = 'investment_cash_balance';
    const DIVIDEND_KEY = 'investment_dividends';
    
    // 获取所有资产数据
    function getAssets() {
        try {
            const data = localStorage.getItem(STORAGE_KEY);
            return data ? JSON.parse(data) : [];
        } catch (e) {
            console.error('读取资产数据失败:', e);
            return [];
        }
    }
    
    // 保存所有资产数据
    function saveAssets(assets) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(assets));
            return true;
        } catch (e) {
            console.error('保存资产数据失败:', e);
            return false;
        }
    }
    
    // 添加资产
    function addAsset(asset) {
        const assets = getAssets();
        asset.id = generateId();
        asset.createTime = new Date().toISOString();
        asset.updateTime = new Date().toISOString();
        assets.push(asset);
        saveAssets(assets);
        return asset;
    }
    
    // 更新资产
    function updateAsset(id, updates) {
        const assets = getAssets();
        const index = assets.findIndex(a => a.id === id);
        if (index === -1) return null;
        
        assets[index] = { ...assets[index], ...updates, updateTime: new Date().toISOString() };
        saveAssets(assets);
        return assets[index];
    }
    
    // 删除资产
    function deleteAsset(id) {
        const assets = getAssets();
        const filtered = assets.filter(a => a.id !== id);
        if (filtered.length === assets.length) return false;
        saveAssets(filtered);
        return true;
    }
    
    // 根据ID获取资产
    function getAssetById(id) {
        const assets = getAssets();
        return assets.find(a => a.id === id) || null;
    }
    
    // 根据类型获取资产
    function getAssetsByType(type) {
        const assets = getAssets();
        if (type === 'all') return assets;
        return assets.filter(a => a.type === type);
    }
    
    // 生成唯一ID
    function generateId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
    }
    
    // 获取配置
    function getConfig() {
        try {
            const data = localStorage.getItem(CONFIG_KEY);
            return data ? JSON.parse(data) : getDefaultConfig();
        } catch (e) {
            console.error('读取配置失败:', e);
            return getDefaultConfig();
        }
    }
    
    // 保存配置
    function saveConfig(config) {
        try {
            localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
            return true;
        } catch (e) {
            console.error('保存配置失败:', e);
            return false;
        }
    }
    
    // 默认配置
    function getDefaultConfig() {
        return {
            finnhubKey: '',
            biyingKey: '',
            corsProxy: 'https://corsproxy.io/?',
            demoMode: false,
            useLine1: true,
            useLine2: false,
            cloudApiKey: '',
            cloudBinId: '',
            categories: ['红利', '纳指100', '标普500']
        };
    }
    
    // 清除所有数据
    function clearAllData() {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(CASH_KEY);
        localStorage.removeItem(DIVIDEND_KEY);
        return true;
    }
    
    // ==================== 现金余额管理 ====================
    
    function getCashBalance() {
        try {
            const data = localStorage.getItem(CASH_KEY);
            return data ? JSON.parse(data) : { CNY: 0, HKD: 0, USD: 0 };
        } catch (e) { return { CNY: 0, HKD: 0, USD: 0 }; }
    }
    
    function setCashBalance(balance) {
        try {
            localStorage.setItem(CASH_KEY, JSON.stringify(balance));
            return true;
        } catch (e) { return false; }
    }
    
    function addCash(amount, currency) {
        const bal = getCashBalance();
        bal[currency] = (bal[currency] || 0) + amount;
        return setCashBalance(bal);
    }
    
    function deductCash(amount, currency) {
        const bal = getCashBalance();
        if ((bal[currency] || 0) < amount) return false;
        bal[currency] -= amount;
        return setCashBalance(bal);
    }
    
    // ==================== 分红记录管理 ====================
    
    function getDividendRecords() {
        try {
            const data = localStorage.getItem(DIVIDEND_KEY);
            return data ? JSON.parse(data) : [];
        } catch (e) { return []; }
    }
    
    function saveDividendRecords(records) {
        try {
            localStorage.setItem(DIVIDEND_KEY, JSON.stringify(records));
            return true;
        } catch (e) { return false; }
    }
    
    function addDividendRecord(record) {
        const records = getDividendRecords();
        record.id = 'div_' + generateId();
        record.createDate = new Date().toISOString().slice(0, 10);
        records.push(record);
        saveDividendRecords(records);
        return record;
    }
    
    function updateDividendRecord(id, updates) {
        const records = getDividendRecords();
        const idx = records.findIndex(r => r.id === id);
        if (idx === -1) return null;
        records[idx] = { ...records[idx], ...updates };
        saveDividendRecords(records);
        return records[idx];
    }
    
    function deleteDividendRecord(id) {
        const records = getDividendRecords();
        const filtered = records.filter(r => r.id !== id);
        if (filtered.length === records.length) return false;
        saveDividendRecords(filtered);
        return true;
    }
    
    // 检查某只股票某次分红是否已记录（按代码+除权日去重）
    function isDividendRecorded(assetCode, exDate) {
        const records = getDividendRecords();
        return records.some(r => r.assetCode === assetCode && r.exDate === exDate);
    }
    
    // 获取某资产的所有分红记录
    function getDividendsByAsset(assetId) {
        const records = getDividendRecords();
        return records.filter(r => r.assetId === assetId);
    }
    
    // 导出数据
    function exportData() {
        const assets = getAssets();
        const config = getConfig();
        const cash = getCashBalance();
        const dividends = getDividendRecords();
        return JSON.stringify({ assets, config, cash, dividends, exportTime: new Date().toISOString() }, null, 2);
    }
    
    // 导入数据
    function importData(jsonStr) {
        try {
            const data = JSON.parse(jsonStr);
            if (data.assets && Array.isArray(data.assets)) {
                saveAssets(data.assets);
            }
            if (data.config) {
                saveConfig(data.config);
            }
            if (data.cash) {
                setCashBalance(data.cash);
            }
            if (data.dividends && Array.isArray(data.dividends)) {
                saveDividendRecords(data.dividends);
            }
            return true;
        } catch (e) {
            console.error('导入数据失败:', e);
            return false;
        }
    }
    
    // 历史净值快照
    function getHistory() {
        try {
            const data = localStorage.getItem('investment_history');
            return data ? JSON.parse(data) : [];
        } catch (e) { return []; }
    }
    function addHistorySnapshot(totalCNY) {
        const history = getHistory();
        const today = new Date().toISOString().slice(0, 10);
        const last = history[history.length - 1];
        if (last && last.date === today) {
            last.value = Math.round(totalCNY * 100) / 100;
        } else {
            history.push({ date: today, value: Math.round(totalCNY * 100) / 100 });
            if (history.length > 90) history.shift();
        }
        try { localStorage.setItem('investment_history', JSON.stringify(history)); } catch(e) {}
    }
    
    // 公开API
    return {
        getAssets,
        saveAssets,
        addAsset,
        updateAsset,
        deleteAsset,
        getAssetById,
        getAssetsByType,
        getConfig,
        saveConfig,
        clearAllData,
        exportData,
        importData,
        getHistory,
        addHistorySnapshot,
        // 现金
        getCashBalance,
        setCashBalance,
        addCash,
        deductCash,
        // 分红
        getDividendRecords,
        addDividendRecord,
        updateDividendRecord,
        deleteDividendRecord,
        isDividendRecorded,
        getDividendsByAsset
    };
})();
