/**
 * API调用封装模块
 * 数据源：
 * - A股：必盈API (biyingapi.com)
 * - 港股：Finnhub (优先) → Yahoo Finance + CORS代理 (备选)
 * - 美股：Finnhub API (finnhub.io)
 */

const APIManager = (function() {
    const API_BASE = {
        finnhub: 'https://finnhub.io/api/v1',
        biying: 'https://api.biyingapi.com',
        yahooChart: 'https://query1.finance.yahoo.com/v8/finance/chart',
        yahooQuote: 'https://query1.finance.yahoo.com/v7/finance/quote'
    };
    
    // 默认CORS代理列表（按优先级尝试）
    const DEFAULT_PROXIES = [
        'https://api.codetabs.com/v1/proxy?quest=',
        'https://api.allorigins.win/raw?url=',
        'https://corsproxy.io/?',
        'https://proxy.cors.sh/'
    ];
    
    function getConfig() {
        return StorageManager.getConfig();
    }
    
    // 获取当前代理URL
    function getProxyUrl() {
        const config = getConfig();
        return config.corsProxy || DEFAULT_PROXIES[0];
    }
    
    // 获取所有代理列表
    function getProxyList() {
        const config = getConfig();
        const list = [];
        if (config.corsProxy) list.push(config.corsProxy);
        list.push(...DEFAULT_PROXIES.filter(p => p !== config.corsProxy));
        return list;
    }
    
    // 检查错误是否为CORS相关
    function isCORSError(error) {
        if (!error || !error.message) return false;
        const msg = error.message.toLowerCase();
        return msg.includes('cors') || 
               msg.includes('networkerror') ||
               msg.includes('failed to fetch') ||
               msg.includes('typeerror');
    }
    
    // 通过代理URL获取
    function proxyURL(proxy, url) {
        // codetabs格式：?quest=URL
        if (proxy.includes('codetabs.com')) {
            return proxy + encodeURIComponent(url);
        }
        // allorigins格式：?url=URL
        if (proxy.includes('allorigins.win')) {
            return proxy + encodeURIComponent(url);
        }
        // 其他代理：假设直接在代理URL后拼接
        return proxy + encodeURIComponent(url);
    }
    
    // 通用fetch：直接调用 + CORS代理fallback
    async function fetchAPI(url) {
        // 先尝试直接调用
        try {
            const response = await fetch(url);
            if (!response.ok) {
                const text = await response.text().catch(() => '');
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            return await response.json();
        } catch (error) {
            // 如果是CORS错误，尝试通过代理
            if (isCORSError(error)) {
                console.log('直接调用失败（CORS），尝试通过代理...');
                return await fetchAPIviaProxy(url);
            }
            throw error;
        }
    }
    
    // 通过CORS代理调用
    async function fetchAPIviaProxy(url) {
        const proxies = getProxyList();
        let lastError = null;
        
        for (const proxy of proxies) {
            try {
                const proxyUrl = proxyURL(proxy, url);
                console.log('尝试代理:', proxyUrl.substring(0, 80) + '...');
                const response = await fetch(proxyUrl);
                if (!response.ok) {
                    const text = await response.text().catch(() => '');
                    throw new Error(`代理 HTTP ${response.status}: ${text}`);
                }
                const result = await response.json();
                
                // 处理codetabs返回格式：它把真实响应包在contents字段里
                if (proxy.includes('codetabs.com')) {
                    if (result.contents) {
                        try {
                            return JSON.parse(result.contents);
                        } catch (e) {
                            // contents可能是纯文本非JSON，原样返回
                            return result.contents;
                        }
                    }
                    return result;
                }
                // allorigins直接返回原始内容
                return result;
            } catch (e) {
                console.warn(`代理 ${proxy.substring(0, 40)}... 失败:`, e.message);
                lastError = e;
            }
        }
        
        throw new Error(`所有CORS代理均失败，该API不支持浏览器直接调用。` +
            `建议：1) 在设置中更换CORS代理URL 2) 自行部署Cloudflare Worker代理（见README）`);
    }
    
    // 获取文本响应（用于JSONP等）
    async function fetchText(url) {
        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return await response.text();
        } catch (error) {
            if (isCORSError(error)) {
                console.log('直接调用失败（CORS），尝试通过代理获取文本...');
                return await fetchTextViaProxy(url);
            }
            throw error;
        }
    }
    
    async function fetchTextViaProxy(url) {
        const proxies = getProxyList();
        let lastError = null;
        
        for (const proxy of proxies) {
            try {
                const proxyUrl = proxyURL(proxy, url);
                const response = await fetch(proxyUrl);
                if (!response.ok) {
                    throw new Error(`Proxy HTTP ${response.status}`);
                }
                const text = await response.text();
                
                // codetabs包装了原始响应，需要提取contents
                if (proxy.includes('codetabs.com')) {
                    try {
                        const data = JSON.parse(text);
                        return data.contents || text;
                    } catch (e) {
                        return text;
                    }
                }
                return text;
            } catch (e) {
                console.warn(`代理 ${proxy.substring(0, 40)}... 获取文本失败:`, e.message);
                lastError = e;
            }
        }
        
        throw new Error(`所有CORS代理均失败，请更换代理URL或自行部署代理`);
    }
    
    // 获取GBK编码的文本（腾讯财经等）
    async function fetchGBK(url) {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const buffer = await response.arrayBuffer();
        const decoder = new TextDecoder('gbk');
        return decoder.decode(buffer);
    }
    
    async function fetchGBKviaProxy(url) {
        // 通过代理获取GBK文本 — 代理返回的可能仍是GBK字节
        // 尝试直接用fetchGBK风格的解码
        const proxies = getProxyList();
        let lastError = null;
        for (const proxy of proxies) {
            try {
                const pUrl = proxyURL(proxy, url);
                const response = await fetch(pUrl);
                if (!response.ok) throw new Error(`Proxy HTTP ${response.status}`);
                const buffer = await response.arrayBuffer();
                const decoder = new TextDecoder('gbk');
                let text = decoder.decode(buffer);
                if (proxy.includes('codetabs.com')) {
                    try {
                        const data = JSON.parse(text);
                        text = data.contents || text;
                    } catch (e) {}
                }
                return text;
            } catch (e) {
                lastError = e;
            }
        }
        throw new Error(`所有代理均失败: ${lastError?.message}`);
    }
    
    // ==================== Finnhub API (美股) ====================
    
    async function getFinnhubQuote(symbol) {
        const config = getConfig();
        if (!config.finnhubKey) throw new Error('未配置Finnhub API Key');
        
        const url = `${API_BASE.finnhub}/quote?symbol=${symbol.toUpperCase()}&token=${config.finnhubKey}`;
        const data = await fetchAPI(url);
        
        if (!data) throw new Error('返回数据为空');
        if (data.c === 0 && data.pc === 0) throw new Error('未找到该美股数据');
        
        const price = data.c != null ? data.c : (data.pc || 0);
        return {
            price, change: data.d || 0, changePercent: data.dp || 0,
            high: data.h || price, low: data.l || price,
            open: data.o || price, previousClose: data.pc || price,
            timestamp: data.t ? data.t * 1000 : Date.now()
        };
    }
    
    async function getFinnhubCompanyProfile(symbol) {
        const config = getConfig();
        if (!config.finnhubKey) throw new Error('未配置Finnhub API Key');
        
        const url = `${API_BASE.finnhub}/stock/profile2?symbol=${symbol.toUpperCase()}&token=${config.finnhubKey}`;
        try {
            const data = await fetchAPI(url);
            if (data && data.name) return { name: data.name, ticker: data.ticker || symbol };
            return { name: symbol.toUpperCase(), ticker: symbol };
        } catch (e) {
            console.warn('获取美股名称失败:', e.message);
            return { name: symbol.toUpperCase(), ticker: symbol };
        }
    }
    
    // ==================== Finnhub (港股) ====================
    
    // 港股通过Finnhub API查询（与美股共用API Key，零额外成本）
    async function getFinnhubHKQuote(code) {
        const config = getConfig();
        if (!config.finnhubKey) throw new Error('未配置Finnhub API Key');
        
        const symbol = `${code.padStart(4, '0')}.HK`;
        const url = `${API_BASE.finnhub}/quote?symbol=${symbol}&token=${config.finnhubKey}`;
        const data = await fetchAPI(url);
        
        if (!data) throw new Error('返回数据为空');
        if (data.c === 0 && data.pc === 0) throw new Error(`未找到港股 ${code}，可能Finnhub免费套餐不覆盖该市场`);
        
        const price = data.c != null ? data.c : (data.pc || 0);
        return {
            price, change: data.d || 0, changePercent: data.dp || 0,
            high: data.h || price, low: data.l || price,
            open: data.o || price, previousClose: data.pc || price,
            timestamp: data.t ? data.t * 1000 : Date.now()
        };
    }
    
    async function getFinnhubHKName(code) {
        const config = getConfig();
        if (!config.finnhubKey) throw new Error('未配置Finnhub API Key');
        
        const symbol = `${code.padStart(4, '0')}.HK`;
        const url = `${API_BASE.finnhub}/stock/profile2?symbol=${symbol}&token=${config.finnhubKey}`;
        try {
            const data = await fetchAPI(url);
            if (data && data.name) return { name: data.name, code };
            return { name: code, code };
        } catch (e) {
            console.warn('Finnhub港股名称查询失败:', e.message);
            return { name: code, code };
        }
    }
    
    // ==================== 必盈API (A股) ====================
    
    async function getBiyingAStockQuote(code) {
        const config = getConfig();
        if (!config.biyingKey) throw new Error('未配置必盈API Licence');
        
        const url = `${API_BASE.biying}/hsrl/ssjy/${code}/${config.biyingKey}`;
        const data = await fetchAPI(url);
        
        if (!data || data.p === undefined) throw new Error(`未找到A股 ${code}`);
        return {
            price: data.p, changePercent: data.pc || 0,
            change: data.ud || (data.p - data.yc),
            high: data.h || data.p, low: data.l || data.p,
            open: data.o || data.p, previousClose: data.yc || data.p,
            volume: data.v, turnover: data.cje,
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
            return { name: data.name || code, code, market };
        } catch (e) {
            console.warn('获取A股名称失败:', e.message);
            return { name: code, code };
        }
    }
    
    // ==================== 港股 (Yahoo Finance → CORS代理) ====================
    
    async function getYahooHKQuote(code) {
        const paddedCode = code.padStart(4, '0');
        const symbol = `${paddedCode}.HK`;
        const url = `${API_BASE.yahooChart}/${symbol}?interval=1d&range=1d`;
        
        const data = await fetchAPI(url);
        
        const result = data?.chart?.result?.[0];
        if (!result || !result.meta) {
            throw new Error(`未找到港股 ${code}`);
        }
        
        const meta = result.meta;
        const price = meta.regularMarketPrice;
        if (!price) throw new Error(`港股 ${code} 暂无交易数据，可能休市`);
        
        return {
            price,
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
    
    async function getYahooHKName(code) {
        const paddedCode = code.padStart(4, '0');
        const symbol = `${paddedCode}.HK`;
        
        // 尝试v7 quote获取名称
        try {
            const url = `${API_BASE.yahooQuote}?symbols=${symbol}`;
            const data = await fetchAPI(url);
            const quote = data?.quoteResponse?.result?.[0];
            if (quote && (quote.shortName || quote.longName)) {
                return { name: quote.shortName || quote.longName, code };
            }
        } catch (e) {
            console.warn('港股名称v7查询失败:', e.message);
        }
        
        // 备用：用v8 chart获取
        try {
            const chartUrl = `${API_BASE.yahooChart}/${symbol}?interval=1d&range=1d`;
            const data = await fetchAPI(chartUrl);
            const meta = data?.chart?.result?.[0]?.meta;
            if (meta && meta.symbol) {
                return { name: meta.symbol.replace('.HK', ''), code };
            }
        } catch (e) {
            console.warn('港股名称v8查询失败:', e.message);
        }
        
        return { name: code, code };
    }
    
    // ==================== 腾讯财经 (A股/港股/美股，免API Key) ====================
    
    function getTencentCode(type, code) {
        switch (type) {
            case 'a-stock': return (code.startsWith('6') ? 'sh' : 'sz') + code;
            case 'hk-stock': return 'hk' + code;
            case 'us-stock': return 'us' + code.toUpperCase().replace('.', '');
            default: return code;
        }
    }
    
    async function getTencentQuote(type, code) {
        const tcode = getTencentCode(type, code);
        const url = `https://qt.gtimg.cn/q=${tcode}`;
        let text;
        try { text = await fetchGBK(url); }
        catch (e) { if (isCORSError(e)) text = await fetchGBKviaProxy(url); else throw e; }
        
        if (!text || text.trim() === '') throw new Error(`腾讯财经未返回 ${code} 数据`);
        
        // 解析格式：v_sh600519="1~贵州茅台~600519~1600.50~..."
        const pattern = new RegExp(`v_${tcode.replace('.', '\\\\.')}="([^"]*)"`);
        const m = text.match(pattern);
        if (!m) throw new Error(`无法解析 ${code} 数据`);
        
        const fields = m[1].split('~');
        // 字段索引：1=名称, 3=当前价, 4=昨收, 5=今开, 6=成交量, 32=涨跌幅, 33=最高, 34=最低, 43=涨跌额
        const name = fields[1] || code;
        const price = parseFloat(fields[3]) || 0;
        const prevClose = parseFloat(fields[4]) || price;
        const change = parseFloat(fields[43] || fields[32]) || (price - prevClose);
        const changePercent = parseFloat(fields[32]) || 0;
        
        if (!price) throw new Error(`腾讯财经 ${code} 无价格`);
        
        return {
            price, change, changePercent,
            high: parseFloat(fields[33]) || price,
            low: parseFloat(fields[34]) || price,
            open: parseFloat(fields[5]) || price,
            previousClose: prevClose,
            timestamp: Date.now()
        };
    }
    
    async function getTencentName(type, code) {
        const tcode = getTencentCode(type, code);
        const url = `https://qt.gtimg.cn/q=${tcode}`;
        try {
            let text;
            try { text = await fetchGBK(url); }
            catch (e) { if (isCORSError(e)) text = await fetchGBKviaProxy(url); else throw e; }
            const pattern = new RegExp(`v_${tcode.replace('.', '\\\\.')}="([^"]*)"`);
            const m = text.match(pattern);
            if (m) {
                const fields = m[1].split('~');
                return fields[1] || code;
            }
        } catch (e) {}
        return code;
    }
    
    // ==================== 基金 (天天基金网 → CORS代理) ====================
    
    async function getFundNav(code) {
        // 天天基金网仅支持HTTP，HTTPS页面会Mixed Content拦截，必须走代理
        const url = `http://fundgz.1234567.com.cn/js/${code}.js?rt=${Date.now()}`;
        const text = await fetchTextViaProxy(url);
        
        if (!text || text.trim() === '') {
            throw new Error(`未找到基金 ${code}，请检查代码（6位数字，如110022）`);
        }
        
        // 解析 JSONP: jsonpgz({...});
        let data = null;
        const m = text.match(/jsonpgz\s*\(\s*(\{[\s\S]*?\})\s*\)/);
        if (m) { try { data = JSON.parse(m[1]); } catch(e) {} }
        if (!data) { try { data = JSON.parse(text); } catch(e) {} }
        
        if (!data || !data.fundcode) {
            throw new Error(`无法解析基金 ${code} 的数据`);
        }
        
        const nav = parseFloat(data.dwjz) || 0;
        const estNav = parseFloat(data.gsz) || nav;
        
        return {
            code: data.fundcode,
            name: data.name || code,
            nav,
            estimateNav: estNav || nav,
            changePercent: parseFloat(data.gszzl) || 0,
            timestamp: Date.now(),
            price: estNav || nav
        };
    }
    
    // ==================== 统一接口 ====================
    
    async function getQuote(type, code) {
        const config = getConfig();
        if (config.demoMode) {
            console.log('演示模式');
            return getDemoQuote(type, code);
        }
        
        switch (type) {
            case 'us-stock': return config.useTencent ? await getTencentQuote(type, code) : await getFinnhubQuote(code);
            case 'a-stock': return config.useTencent ? await getTencentQuote(type, code) : await getBiyingAStockQuote(code);
            case 'hk-stock': {
                if (config.useTencent) return await getTencentQuote(type, code);
                // 优先用 Finnhub（与美股共用Key），失败回退 Yahoo
                try { return await getFinnhubHKQuote(code); }
                catch (e) { console.warn('Finnhub港股失败，Yahoo备选:', e.message); }
                return await getYahooHKQuote(code);
            }
            case 'fund': return await getFundNav(code);
            default: throw new Error(`不支持的资产类型: ${type}`);
        }
    }
    
    async function getName(type, code) {
        const config = getConfig();
        if (config.demoMode) return getDemoName(type, code);
        
        switch (type) {
            case 'us-stock': {
                if (config.useTencent) return await getTencentName(type, code);
                const p = await getFinnhubCompanyProfile(code);
                return p.name || code.toUpperCase();
            }
            case 'a-stock': {
                if (config.useTencent) return await getTencentName(type, code);
                const s = await getBiyingAStockName(code);
                return s.name || code;
            }
            case 'hk-stock': {
                if (config.useTencent) return await getTencentName(type, code);
                try {
                    const h = await getFinnhubHKName(code);
                    if (h.name !== code) return h.name;
                } catch(e) {}
                const h = await getYahooHKName(code);
                return h.name || code;
            }
            case 'fund': {
                const f = await getFundNav(code);
                return f.name || code;
            }
            default: return code;
        }
    }
    
    async function updateAllPrices(assets) {
        const results = [], errors = [];
        for (const asset of assets) {
            try {
                const quote = await getQuote(asset.type, asset.code);
                results.push({
                    id: asset.id,
                    price: quote.price || 0,
                    change: quote.change || 0,
                    changePercent: quote.changePercent || 0,
                    previousClose: quote.previousClose || quote.price || 0,
                    updateTime: quote.timestamp || Date.now()
                });
                await sleep(300);
            } catch (error) {
                console.error(`更新 ${asset.code} 失败:`, error);
                errors.push({ code: asset.code, error: error.message });
            }
        }
        return { results, errors };
    }
    
    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
    
    // ==================== 汇率转换 ====================
    
    let exchangeRates = { USD_CNY: 7.2, HKD_CNY: 0.92 }; // 默认汇率
    
    // 获取最新汇率（带缓存，每天更新一次）
    async function fetchExchangeRates() {
        try {
            const data = await fetchAPI('https://api.exchangerate-api.com/v4/latest/USD');
            if (data && data.rates) {
                const usdCny = data.rates.CNY || 7.2;
                // HKD via USD
                const hkdCny = usdCny / (data.rates.HKD || 7.83);
                exchangeRates = { USD_CNY: usdCny, HKD_CNY: hkdCny };
                console.log('汇率更新:', `1 USD = ${usdCny.toFixed(4)} CNY, 1 HKD = ${hkdCny.toFixed(4)} CNY`);
                return exchangeRates;
            }
        } catch (e) {
            console.warn('汇率获取失败，使用默认汇率:', e.message);
        }
        return exchangeRates;
    }
    
    function getExchangeRates() { return exchangeRates; }
    
    // 金额转换为人民币
    function toCNY(amount, currency) {
        if (!amount) return 0;
        switch (currency) {
            case 'USD': return amount * exchangeRates.USD_CNY;
            case 'HKD': return amount * exchangeRates.HKD_CNY;
            default: return amount; // CNY
        }
    }
    
    // 获取货币符号
    function getCurrencySymbol(currency) {
        switch (currency) { case 'USD': return '$'; case 'HKD': return 'HK$'; default: return '¥'; }
    }
    
    // 获取资产类型的货币
    function getAssetCurrency(type) {
        switch (type) { case 'us-stock': return 'USD'; case 'hk-stock': return 'HKD'; default: return 'CNY'; }
    }
    
    // ==================== 演示模式 ====================
    
    const DEMO_NAMES = {
        'AAPL':'Apple Inc.','TSLA':'Tesla, Inc.','MSFT':'Microsoft Corp.',
        'GOOGL':'Alphabet Inc.','AMZN':'Amazon.com','NVDA':'NVIDIA Corp.',
        'META':'Meta Platforms','JPM':'JPMorgan Chase',
        '000001':'平安银行','000002':'万科A','000858':'五粮液',
        '600000':'浦发银行','600036':'招商银行','600519':'贵州茅台',
        '601318':'中国平安','600276':'恒瑞医药',
        '00700':'腾讯控股','09988':'阿里巴巴-SW','00388':'香港交易所',
        '00939':'建设银行','01299':'友邦保险','03690':'美团-W',
        '01810':'小米集团-W','02318':'中国平安',
        '110022':'易方达消费行业','110023':'易方达医疗行业',
        '160119':'南方中证500ETF','161725':'招商中证白酒',
        '163406':'兴全合润','005827':'易方达蓝筹精选',
        '000751':'嘉实新兴产业','001475':'易方达国防军工'
    };
    
    const DEMO_BASE_PRICES = {
        'AAPL':150,'TSLA':200,'MSFT':300,'GOOGL':130,'AMZN':120,
        'NVDA':400,'META':250,'JPM':140,
        '000001':12,'000002':8,'000858':150,'600000':7,
        '600036':35,'600519':1600,'601318':45,'600276':50,
        '00700':320,'09988':80,'00388':300,'00939':5,
        '01299':70,'03690':100,'01810':15,'02318':40,
        '110022':4.5,'110023':2.8,'160119':7.2,'161725':1.2,
        '163406':1.5,'005827':2.3,'000751':2.1,'001475':1.8
    };
    
    function getDemoQuote(type, code) {
        const bp = DEMO_BASE_PRICES[code] || 50.0;
        const cp = (Math.random() - 0.5) * 4;
        const ch = bp * cp / 100;
        const p = bp + ch;
        return {
            price: p, change: ch, changePercent: cp,
            high: p*1.01, low: p*0.99, open: bp, previousClose: bp,
            volume: Math.floor(Math.random()*1000000), timestamp: Date.now()
        };
    }
    
    function getDemoName(type, code) { return DEMO_NAMES[code] || `${code} (演示)`; }
    
    return {
        getFinnhubQuote, getFinnhubCompanyProfile,
        getFinnhubHKQuote, getFinnhubHKName,
        getBiyingAStockQuote, getBiyingAStockName,
        getYahooHKQuote, getYahooHKName,
        getTencentQuote, getTencentName,
        getFundNav,
        getQuote, getName, updateAllPrices,
        fetchExchangeRates, getExchangeRates, toCNY,
        getCurrencySymbol, getAssetCurrency
    };
})();
