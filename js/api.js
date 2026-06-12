/**
 * API调用封装模块
 * 负责调用各种金融数据API获取实时行情
 * 
 * 数据源：
 * - A股：必盈API (biyingapi.com)
 * - 港股：Yahoo Finance (query1.finance.yahoo.com) — 免费，支持浏览器CORS
 * - 美股：Finnhub API (finnhub.io)
 * - 基金：天天基金网 (fundgz.1234567.com.cn)
 */

const APIManager = (function() {
    // API基础URL
    const API_BASE = {
        finnhub: 'https://finnhub.io/api/v1',
        biying: 'https://api.biyingapi.com',
        yahooChart: 'https://query1.finance.yahoo.com/v8/finance/chart',
        yahooQuote: 'https://query1.finance.yahoo.com/v7/finance/quote',
        tiantianFund: 'https://fundgz.1234567.com.cn/js'
    };
    
    // 获取配置
    function getConfig() {
        return StorageManager.getConfig();
    }
    
    // 通用fetch封装
    async function fetchAPI(url) {
        try {
            const response = await fetch(url);
            if (!response.ok) {
                const text = await response.text().catch(() => '');
                throw new Error(`HTTP ${response.status}: ${response.statusText} ${text}`);
            }
            return await response.json();
        } catch (error) {
            if (error.name === 'TypeError' && (error.message.includes('fetch') || error.message.includes('NetworkError'))) {
                throw new Error('网络连接失败，该API可能不支持浏览器直接调用（CORS限制）。可以尝试在设置中开启演示模式。');
            }
            throw error;
        }
    }
    
    // 简单fetch文本（用于JSONP等非JSON响应）
    async function fetchText(url) {
        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            return await response.text();
        } catch (error) {
            if (error.name === 'TypeError' && (error.message.includes('fetch') || error.message.includes('NetworkError'))) {
                throw new Error('CORS限制：该API不允许浏览器直接调用');
            }
            throw error;
        }
    }
    
    // ==================== Finnhub API (美股) ====================
    
    async function getFinnhubQuote(symbol) {
        const config = getConfig();
        if (!config.finnhubKey) {
            throw new Error('未配置Finnhub API Key，请在设置中填入Finnhub API Key');
        }
        
        const url = `${API_BASE.finnhub}/quote?symbol=${symbol.toUpperCase()}&token=${config.finnhubKey}`;
        const data = await fetchAPI(url);
        
        if (!data) throw new Error('返回数据为空');
        if (data.c === 0 && data.pc === 0) {
            throw new Error('未找到该美股数据，请检查代码是否正确（如：AAPL、TSLA、MSFT）');
        }
        
        const price = data.c != null ? data.c : (data.pc || 0);
        return {
            price: price,
            change: data.d || 0,
            changePercent: data.dp || 0,
            high: data.h || price,
            low: data.l || price,
            open: data.o || price,
            previousClose: data.pc || price,
            timestamp: data.t ? data.t * 1000 : Date.now()
        };
    }
    
    async function getFinnhubCompanyProfile(symbol) {
        const config = getConfig();
        if (!config.finnhubKey) throw new Error('未配置Finnhub API Key');
        
        const url = `${API_BASE.finnhub}/stock/profile2?symbol=${symbol.toUpperCase()}&token=${config.finnhubKey}`;
        try {
            const data = await fetchAPI(url);
            if (data && data.name) return { name: data.name, ticker: data.ticker || symbol, exchange: data.exchange || '' };
            return { name: symbol.toUpperCase(), ticker: symbol };
        } catch (error) {
            console.warn('获取美股公司信息失败:', error.message);
            return { name: symbol.toUpperCase(), ticker: symbol };
        }
    }
    
    // ==================== 必盈API (A股) ====================
    
    async function getBiyingAStockQuote(code) {
        const config = getConfig();
        if (!config.biyingKey) {
            throw new Error('未配置必盈API Licence，请在设置中填入必盈API Licence');
        }
        
        const url = `${API_BASE.biying}/hsrl/ssjy/${code}/${config.biyingKey}`;
        const data = await fetchAPI(url);
        
        if (!data || data.p === undefined) {
            throw new Error(`未找到A股 ${code} 的数据，请检查代码是否正确`);
        }
        
        return {
            price: data.p,
            changePercent: data.pc || 0,
            change: data.ud || (data.p - data.yc),
            high: data.h || data.p,
            low: data.l || data.p,
            open: data.o || data.p,
            previousClose: data.yc || data.p,
            volume: data.v,
            turnover: data.cje,
            timestamp: data.t ? new Date(data.t).getTime() : Date.now()
        };
    }
    
    async function getBiyingAStockName(code) {
        const config = getConfig();
        if (!config.biyingKey) throw new Error('未配置必盈API Licence');
        
        const market = code.startsWith('6') ? 'SH' : 'SZ';
        const url = `${API_BASE.biying}/hsstock/instrument/${code}.${market}/${config.biyingKey}`;
        
        try {
            const data = await fetchAPI(url);
            return { name: data.name || code, code: code, market: market };
        } catch (error) {
            console.warn('获取A股名称失败:', error.message);
            return { name: code, code: code };
        }
    }
    
    // ==================== Yahoo Finance (港股) — 免费，支持CORS ====================
    
    // 获取港股行情（Yahoo Finance v8 chart API — 免费，浏览器CORS友好）
    async function getYahooHKQuote(code) {
        // 港股代码格式：补零到4位 + .HK，如 700 → 0700.HK
        const paddedCode = code.padStart(4, '0');
        const symbol = `${paddedCode}.HK`;
        
        // Yahoo Finance v8 chart API: 免费，已验证支持浏览器CORS
        const url = `${API_BASE.yahooChart}/${symbol}?interval=1d&range=1d`;
        
        const data = await fetchAPI(url);
        
        const result = data?.chart?.result?.[0];
        if (!result || !result.meta) {
            throw new Error(`未找到港股 ${code} 的数据。港股代码应为纯数字（如700代表腾讯），系统会自动补零为0700.HK`);
        }
        
        const meta = result.meta;
        const price = meta.regularMarketPrice;
        
        if (!price || price === 0) {
            throw new Error(`港股 ${code} 暂无交易数据，可能今日休市或代码错误`);
        }
        
        return {
            price: price,
            change: meta.regularMarketPrice - meta.previousClose || 0,
            changePercent: ((meta.regularMarketPrice - meta.previousClose) / meta.previousClose * 100) || 0,
            high: meta.regularMarketDayHigh || price,
            low: meta.regularMarketDayLow || price,
            open: meta.chartPreviousClose || price,
            previousClose: meta.previousClose || price,
            volume: meta.regularMarketVolume || 0,
            timestamp: result.timestamp ? result.timestamp[result.timestamp.length - 1] * 1000 : Date.now()
        };
    }
    
    // 获取港股名称（Yahoo Finance v7 quote API）
    async function getYahooHKName(code) {
        const paddedCode = code.padStart(4, '0');
        const symbol = `${paddedCode}.HK`;
        
        try {
            const url = `${API_BASE.yahooQuote}?symbols=${symbol}`;
            const data = await fetchAPI(url);
            
            const quote = data?.quoteResponse?.result?.[0];
            if (quote && (quote.shortName || quote.longName)) {
                return {
                    name: quote.shortName || quote.longName,
                    code: code,
                    exchange: quote.fullExchangeName || 'HKEX'
                };
            }
        } catch (error) {
            console.warn('获取港股名称失败（v7 API），尝试v8备用方案:', error.message);
        }
        
        // 备用方案：从v8 chart API获取名称
        try {
            const chartUrl = `${API_BASE.yahooChart}/${symbol}?interval=1d&range=1d`;
            const data = await fetchAPI(chartUrl);
            const meta = data?.chart?.result?.[0]?.meta;
            if (meta && meta.symbol) {
                return { name: meta.symbol.replace('.HK', ''), code: code };
            }
        } catch (e) {
            console.warn('获取港股名称失败（v8 API）:', e.message);
        }
        
        return { name: code, code: code };
    }
    
    // ==================== 必盈API (港股备用) ====================
    
    async function getBiyingHKQuote(code) {
        const config = getConfig();
        if (!config.biyingKey) return null; // 无licence时静默跳过
        
        const paddedCode = code.padStart(5, '0');
        const url = `${API_BASE.biying}/hkrl/ssjy/${paddedCode}/${config.biyingKey}`;
        
        try {
            const data = await fetchAPI(url);
            if (!data || (data.p === undefined && data.P === undefined)) return null;
            
            const price = data.p != null ? data.p : data.P || 0;
            return {
                price: price,
                changePercent: data.pc != null ? data.pc : (data.PC || 0),
                change: data.ud || (price - (data.yc || data.YC || price)),
                high: data.h || data.H || price,
                low: data.l || data.L || price,
                open: data.o || data.O || price,
                previousClose: data.yc || data.YC || price,
                timestamp: data.t ? new Date(data.t).getTime() : Date.now()
            };
        } catch (error) {
            console.warn('必盈API港股查询失败:', error.message);
            return null;
        }
    }
    
    // ==================== 天天基金网API (基金) ====================
    
    // 获取基金净值（天天基金网 — 免费）
    async function getTiandianFundNav(code) {
        const errors = [];
        
        // 先尝试HTTPS
        try {
            const result = await tryTiantianFund('https', code);
            if (result) return result;
        } catch (e) {
            errors.push('HTTPS: ' + e.message);
        }
        
        // 再尝试HTTP（某些浏览器/环境下HTTPS可能被拦截）
        try {
            const result = await tryTiantianFund('http', code);
            if (result) return result;
        } catch (e) {
            errors.push('HTTP: ' + e.message);
        }
        
        throw new Error(`无法获取基金 ${code} 的数据。可能原因：1) 代码错误（基金代码为6位数字，如110022） 2) 网络问题 3) 天天基金网接口限制。` + (errors.length ? ` [${errors.join('; ')}]` : ''));
    }
    
    async function tryTiantianFund(protocol, code) {
        const url = `${protocol}://fundgz.1234567.com.cn/js/${code}.js?rt=${Date.now()}`;
        
        // 天天基金网返回JSONP格式：jsonpgz({"fundcode":"110022",...});
        const text = await fetchText(url);
        
        if (!text || text.includes('404') || text.includes('Not Found') || text.trim() === '') {
            throw new Error(`基金代码 ${code} 不存在`);
        }
        
        // 尝试多种JSONP格式
        let data = null;
        
        // 格式1: jsonpgz({...});
        const match1 = text.match(/jsonpgz\s*\(\s*(\{.*?\})\s*\)/s);
        if (match1) {
            data = JSON.parse(match1[1]);
        }
        
        // 格式2: 直接JSON
        if (!data) {
            try { data = JSON.parse(text); } catch (e) {}
        }
        
        if (!data || !data.fundcode) {
            throw new Error(`无法解析基金 ${code} 的数据，返回格式异常`);
        }
        
        const nav = parseFloat(data.dwjz) || 0;
        const estimateNav = parseFloat(data.gsz) || nav;
        
        return {
            code: data.fundcode,
            name: data.name || code,
            nav: nav,                              // 单位净值
            estimateNav: estimateNav || nav,       // 估算净值
            estimateTime: data.gztime || '',
            changePercent: parseFloat(data.gszzl) || 0,
            timestamp: Date.now(),
            price: estimateNav || nav  // 统一price字段
        };
    }
    
    // ==================== 统一接口 ====================
    
    async function getQuote(type, code) {
        const config = getConfig();
        if (config.demoMode) {
            console.log('演示模式：使用模拟数据');
            return getDemoQuote(type, code);
        }
        
        switch (type) {
            case 'us-stock':
                return await getFinnhubQuote(code);
            case 'a-stock':
                return await getBiyingAStockQuote(code);
            case 'hk-stock': {
                // 优先使用免费的Yahoo Finance
                try {
                    return await getYahooHKQuote(code);
                } catch (yahooError) {
                    console.warn('Yahoo Finance港股查询失败，尝试必盈API备用...', yahooError.message);
                    // 备用：必盈API
                    const biyingResult = await getBiyingHKQuote(code);
                    if (biyingResult) return biyingResult;
                    throw yahooError;
                }
            }
            case 'fund':
                return await getTiandianFundNav(code);
            default:
                throw new Error(`不支持的资产类型: ${type}`);
        }
    }
    
    async function getName(type, code) {
        const config = getConfig();
        if (config.demoMode) return getDemoName(type, code);
        
        switch (type) {
            case 'us-stock': {
                const profile = await getFinnhubCompanyProfile(code);
                return profile.name || code.toUpperCase();
            }
            case 'a-stock': {
                const stockInfo = await getBiyingAStockName(code);
                return stockInfo.name || code;
            }
            case 'hk-stock': {
                const hkInfo = await getYahooHKName(code);
                return hkInfo.name || code;
            }
            case 'fund': {
                const fundInfo = await getTiandianFundNav(code);
                return fundInfo.name || code;
            }
            default:
                return code;
        }
    }
    
    async function updateAllPrices(assets) {
        const results = [];
        const errors = [];
        
        for (const asset of assets) {
            try {
                const quote = await getQuote(asset.type, asset.code);
                results.push({
                    id: asset.id,
                    price: quote.price || quote.estimateNav || 0,
                    change: quote.change || 0,
                    changePercent: quote.changePercent || 0,
                    updateTime: quote.timestamp || Date.now()
                });
                await sleep(200);
            } catch (error) {
                console.error(`更新 ${asset.code} 失败:`, error);
                errors.push({ code: asset.code, error: error.message });
            }
        }
        return { results, errors };
    }
    
    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    
    // ==================== 演示模式（模拟数据） ====================
    
    const DEMO_NAMES = {
        'AAPL': 'Apple Inc.',    'TSLA': 'Tesla, Inc.',
        'MSFT': 'Microsoft Corp.','GOOGL': 'Alphabet Inc.',
        'AMZN': 'Amazon.com',    'NVDA': 'NVIDIA Corp.',
        'META': 'Meta Platforms','JPM': 'JPMorgan Chase',
        '000001': '平安银行',     '000002': '万科A',
        '000858': '五粮液',       '600000': '浦发银行',
        '600036': '招商银行',     '600519': '贵州茅台',
        '601318': '中国平安',     '600276': '恒瑞医药',
        '00700': '腾讯控股',      '09988': '阿里巴巴-SW',
        '00388': '香港交易所',    '00939': '建设银行',
        '01299': '友邦保险',      '03690': '美团-W',
        '01810': '小米集团-W',    '02318': '中国平安',
        '110022': '易方达消费行业','110023': '易方达医疗行业',
        '160119': '南方中证500ETF','161725': '招商中证白酒',
        '163406': '兴全合润',      '005827': '易方达蓝筹精选',
        '000751': '嘉实新兴产业', '001475': '易方达国防军工'
    };
    
    const DEMO_BASE_PRICES = {
        'AAPL': 150, 'TSLA': 200, 'MSFT': 300, 'GOOGL': 130,
        'AMZN': 120, 'NVDA': 400, 'META': 250, 'JPM': 140,
        '000001': 12, '000002': 8,  '000858': 150, '600000': 7,
        '600036': 35, '600519': 1600, '601318': 45, '600276': 50,
        '00700': 320, '09988': 80, '00388': 300, '00939': 5,
        '01299': 70, '03690': 100, '01810': 15, '02318': 40,
        '110022': 4.5, '110023': 2.8, '160119': 7.2, '161725': 1.2,
        '163406': 1.5, '005827': 2.3, '000751': 2.1, '001475': 1.8
    };
    
    function getDemoQuote(type, code) {
        const basePrice = DEMO_BASE_PRICES[code] || (type === 'fund' ? 1.0 : 50.0);
        const changePercent = (Math.random() - 0.5) * 4;
        const change = basePrice * changePercent / 100;
        const price = basePrice + change;
        return {
            price: type === 'fund' ? basePrice : price,
            change: change,
            changePercent: changePercent,
            high: price * 1.01, low: price * 0.99,
            open: basePrice, previousClose: basePrice,
            volume: Math.floor(Math.random() * 1000000),
            timestamp: Date.now(),
            estimateNav: type === 'fund' ? price : undefined,
            nav: type === 'fund' ? basePrice : undefined
        };
    }
    
    function getDemoName(type, code) {
        return DEMO_NAMES[code] || `${code} (演示)`;
    }
    
    return {
        getFinnhubQuote,
        getFinnhubCompanyProfile,
        getBiyingAStockQuote,
        getBiyingAStockName,
        getYahooHKQuote,
        getYahooHKName,
        getBiyingHKQuote,
        getTiandianFundNav,
        getQuote,
        getName,
        updateAllPrices
    };
})();
