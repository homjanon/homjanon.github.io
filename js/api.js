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
        'https://corsproxy.io/?',
        'https://api.allorigins.win/raw?url=',
        'https://api.codetabs.com/v1/proxy?quest='
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
        // 已知含 ?param= 的代理 → 编码拼接
        if (proxy.includes('codetabs.com') || proxy.includes('allorigins.win')
            || proxy.includes('?quest=') || proxy.includes('?url=') || proxy.includes('?')) {
            return proxy + encodeURIComponent(url);
        }
        // 纯域名如 workers.dev → 追加 ?url=
        if (proxy.endsWith('/')) proxy = proxy.slice(0, -1);
        return proxy + '?url=' + encodeURIComponent(url);
    }
    
    // 通用fetch：直接调用 + CORS代理fallback，自动防缓存
    async function fetchAPI(url) {
        const hash = url.indexOf('#');
        const base = hash >= 0 ? url.slice(0, hash) : url;
        const tail = hash >= 0 ? url.slice(hash) : '';
        const cacheUrl = base.includes('?') ? `${base}&_=${Date.now()}${tail}` : `${base}?_=${Date.now()}${tail}`;
        try {
            const response = await fetch(cacheUrl);
            if (!response.ok) {
                const text = await response.text().catch(() => '');
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            return await response.json();
        } catch (error) {
            if (isCORSError(error)) {
                console.log('直接调用失败（CORS），尝试通过代理...');
                return await fetchAPIviaProxy(cacheUrl);
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
    
    // 标准化港股代码：3968/03968 → 3968
    function normHK(code) {
        return String(parseInt(code, 10));
    }
    
    // 港股通过Finnhub API查询（与美股共用API Key，零额外成本）
    async function getFinnhubHKQuote(code) {
        const config = getConfig();
        if (!config.finnhubKey) throw new Error('未配置Finnhub API Key');
        
        const symbol = `${normHK(code).padStart(4, '0')}.HK`;
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
        
        const symbol = `${normHK(code).padStart(4, '0')}.HK`;
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
    
    // 港股通过必盈API (与A股共用Licence)
    async function getBiyingHKStockQuote(code) {
        const config = getConfig();
        if (!config.biyingKey) throw new Error('未配置必盈API Licence');
        const padded = normHK(code).padStart(5, '0');
        const url = `${API_BASE.biying}/hk/hslhq/${padded}/${config.biyingKey}`;
        const data = await fetchAPI(url);
        if (!data || data.p === undefined) throw new Error(`未找到港股 ${code}`);
        return {
            price: data.p, changePercent: data.pc || 0,
            change: data.ud || (data.p - data.yc),
            high: data.h || data.p, low: data.l || data.p,
            open: data.o || data.p, previousClose: data.yc || data.p,
            volume: data.v, timestamp: Date.now()
        };
    }
    
    async function getBiyingHKStockName(code) {
        const config = getConfig();
        if (!config.biyingKey) return { name: code, code };
        try {
            const padded = normHK(code).padStart(5, '0');
            const url = `${API_BASE.biying}/hk/sszjmx/${padded}/${config.biyingKey}`;
            const data = await fetchAPI(url);
            return { name: data.name || code, code };
        } catch (e) {
            console.warn('获取港股名称失败:', e.message);
            return { name: code, code };
        }
    }
    
    // ==================== 港股 (Yahoo Finance → CORS代理，备选) ====================
    
    async function getYahooHKQuote(code) {
        const paddedCode = normHK(code).padStart(4, '0');
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
        const paddedCode = normHK(code).padStart(4, '0');
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
            case 'hk-stock': return 'hk' + normHK(code).padStart(5, '0');
            case 'us-stock': return 'us' + code.toUpperCase().replace('.', '');
            default: return code;
        }
    }
    
    async function getTencentQuote(type, code) {
        const tcode = getTencentCode(type, code);
        const url = `https://qt.gtimg.cn/q=${tcode}&_=${Date.now()}`;
        let text;
        try { text = await fetchGBK(url); }
        catch (e) { if (isCORSError(e)) text = await fetchGBKviaProxy(url); else throw e; }
        
        if (!text || text.trim() === '') throw new Error(`腾讯财经未返回 ${code} 数据`);
        
        // 解析格式：v_sh600519="1~贵州茅台~600519~1600.50~..."
        const pattern = new RegExp(`v_${tcode.replace('.', '\\\\.')}="([^"]*)"`);
        const m = text.match(pattern);
        if (!m) throw new Error(`无法解析 ${code} 数据`);
        
        const fields = m[1].split('~');
        // 字段索引(0-based): 1=名称, 3=当前价, 4=昨收, 5=今开, 31=涨跌额, 32=涨跌幅, 33=最高, 34=最低
        const name = fields[1] || code;
        const price = parseFloat(fields[3]) || 0;
        const prevClose = parseFloat(fields[4]) || price;
        
        if (!price) throw new Error(`腾讯财经 ${code} 无价格`);
        
        // 涨跌幅/涨跌额用 price - prevClose 计算（跨市场一致，避免字段偏移）
        const change = price - prevClose;
        const changePercent = prevClose > 0 ? (change / prevClose * 100) : 0;
        
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
        const url = `https://qt.gtimg.cn/q=${tcode}&_=${Date.now()}`;
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
    
    // 基金JSONP直连（无需代理）
    // 天天基金 JSONP 固定回调名为 jsonpgz，不能用自定义名称
    function getFundJSONP(code) {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            const timeout = setTimeout(() => {
                cleanup();
                reject(new Error(`基金 ${code} 请求超时`));
            }, 8000);
            
            const previous = window.jsonpgz;
            const cleanup = () => {
                clearTimeout(timeout);
                window.jsonpgz = previous;
                if (script.parentNode) script.parentNode.removeChild(script);
            };
            
            window.jsonpgz = function(data) {
                cleanup();
                if (!data || !data.fundcode) {
                    reject(new Error(`未找到基金 ${code}`));
                    return;
                }
                const nav = parseFloat(data.dwjz) || 0;
                const gszVal = parseFloat(data.gsz);
                const estNav = gszVal > 0 ? gszVal : nav;
                const changePct = parseFloat(data.gszzl) || 0;
                // 日期：有实时估值时用估值时间，否则用结算日期
                const navDate = gszVal > 0 ? (data.gztime || data.jzrq || '') : (data.jzrq || '');
                resolve({
                    code: data.fundcode, name: data.name || code,
                    nav, estimateNav: estNav, navDate,
                    change: estNav - nav,
                    changePercent: changePct,
                    timestamp: Date.now(), price: estNav
                });
            };
            
            script.src = `https://fundgz.1234567.com.cn/js/${code}.js?rt=${Date.now()}`;
            script.onerror = () => { cleanup(); reject(new Error(`基金 ${code} 加载失败`)); };
            document.head.appendChild(script);
        });
    }
    
    // 基金走代理（备用）
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
        const gszVal = parseFloat(data.gsz);
        const estNav = gszVal > 0 ? gszVal : nav;
        const navDate = gszVal > 0 ? (data.gztime || data.jzrq || '') : (data.jzrq || '');
        
        return {
            code: data.fundcode,
            name: data.name || code,
            nav, estimateNav: estNav || nav,
            change: estNav - nav,
            navDate,
            changePercent: parseFloat(data.gszzl) || 0,
            timestamp: Date.now(),
            price: estNav || nav
        };
    }
    
    // ==================== 基金 (东方财富历史净值，天天基金备选) ====================
    
    // 注入 <script> 并读取全局变量（无需代理、无需 CORS）
    function injectScript(url, varName, timeoutMs = 8000) {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            const previous = window[varName];
            delete window[varName];
            
            const timer = setTimeout(() => {
                cleanup();
                reject(new Error(`加载超时: ${url.substring(0, 60)}`));
            }, timeoutMs);
            
            function cleanup() {
                clearTimeout(timer);
                if (script.parentNode) script.parentNode.removeChild(script);
            }
            
            script.onload = () => {
                const val = window[varName];
                window[varName] = previous;
                cleanup();
                resolve(val);
            };
            
            script.onerror = () => {
                window[varName] = previous;
                cleanup();
                reject(new Error(`加载失败: ${url.substring(0, 60)}`));
            };
            
            script.src = url;
            document.head.appendChild(script);
        });
    }
    
    async function getEastMoneyFundNav(code) {
        const url = `https://fundf10.eastmoney.com/F10DataApi.aspx?type=lsjz&code=${code}&page=1&per=1&rt=${Date.now()}`;
        const apidata = await injectScript(url, 'apidata');
        
        if (!apidata || !apidata.content) {
            throw new Error(`东方财富未返回基金 ${code} 数据`);
        }
        
        let nav, navDate, changePercent;
        const raw = apidata.content;
        
        // 1. 尝试HTML表格格式（旧版API）
        const rowMatch = raw.match(/<tr[^>]*>\s*<td[^>]*>([^<]+)<\/td>\s*<td[^>]*>([^<]+)<\/td>\s*<td[^>]*>([^<]+)<\/td>\s*<td[^>]*>([^<]+)<\/td>/);
        if (rowMatch) {
            nav = parseFloat(rowMatch[2]) || 0;
            navDate = (rowMatch[1] || '').trim();
            const changeStr = (rowMatch[4] || '').replace('%', '').trim();
            changePercent = parseFloat(changeStr) || 0;
        } else {
            // 2. 纯文本格式（新版API）：7个表头+7个数据，空格/换行分隔
            const parts = raw.trim().split(/[\s]+/);
            // 找第一个日期格式的值作为数据起始点
            let dataStart = -1;
            for (let i = 0; i < parts.length; i++) {
                if (/^\d{4}-\d{2}-\d{2}$/.test(parts[i])) { dataStart = i; break; }
            }
            if (dataStart < 0) throw new Error(`无法解析基金 ${code} 净值`);
            navDate = parts[dataStart];
            nav = parseFloat(parts[dataStart + 1]) || 0;
            const changeStr = (parts[dataStart + 3] || '').replace('%', '').trim();
            changePercent = parseFloat(changeStr) || 0;
        }
        
        return {
            code, name: code,
            nav, estimateNav: nav, price: nav, navDate,
            changePercent, change: (nav * changePercent / 100),
            timestamp: Date.now()
        };
    }
    
    async function getEastMoneyFundName(code) {
        try {
            const fS_name = await injectScript(
                `https://fund.eastmoney.com/pingzhongdata/${code}.js?rt=${Date.now()}`, 'fS_name', 5000
            );
            return fS_name || code;
        } catch (e) {
            return code;
        }
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
                // 港股通过Yahoo Finance + 代理
                return await getYahooHKQuote(code);
            }
            case 'fund': {
                if (config.useEastMoneyFund) {
                    // 路线二：天天基金JSONP直连
                    try { return await getFundJSONP(code); }
                    catch (e) { console.log('天天基金失败，回退东方财富:', e.message); }
                }
                // 路线一/三：东方财富历史净值
                try { return await getEastMoneyFundNav(code); }
                catch (e) { console.log('东方财富失败，回退代理:', e.message); }
                return await getFundNav(code);
            }
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
                const h = await getYahooHKName(code);
                return h.name || code;
            }
            case 'fund': {
                if (config.useEastMoneyFund) {
                    // 路线二：天天基金
                    try { const f = await getFundJSONP(code); return f.name || code; } catch(e) {}
                }
                // 路线一/三：东方财富
                try { const n = await getEastMoneyFundName(code); if (n !== code) return n; } catch(e) {}
                return code;
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
                    updateTime: quote.timestamp || Date.now(),
                    navDate: quote.navDate || ''
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
    
    // ==================== 市场指标（VIX + 估值） ====================
    
    let indicatorCache = null;
    let indicatorDate = '';
    
    async function fetchIndicators() {
        const today = new Date().toISOString().slice(0, 10);
        if (indicatorDate === today && indicatorCache) return indicatorCache;
        
        const result = { vix: null, nasdaqPe: null, sp500Pe: null, csi300Pe: null };
        
        // VIX: Yahoo v8 chart
        try {
            const vixUrl = `https://query1.finance.yahoo.com/v8/finance/chart/%5EVIX?interval=1d&range=2d`;
            const vixData = await fetchAPI(vixUrl);
            const m = vixData?.chart?.result?.[0]?.meta;
            if (m?.regularMarketPrice) {
                result.vix = {
                    value: m.regularMarketPrice,
                    changePercent: m.chartPreviousClose ? ((m.regularMarketPrice - m.chartPreviousClose) / m.chartPreviousClose * 100) : null
                };
            }
        } catch (e) { console.warn('VIX获取失败:', e.message); }
        
        // 纳指100(QQQ) + 标普500(SPY): Yahoo v8 chart 价格数据
        try {
            const qqqData = await fetchAPI('https://query1.finance.yahoo.com/v8/finance/chart/QQQ?interval=1d&range=1d');
            const qqqM = qqqData?.chart?.result?.[0]?.meta;
            if (qqqM?.regularMarketPrice) {
                result.nasdaqPe = {
                    value: qqqM.regularMarketPrice,
                    label: '点',
                    changePercent: qqqM.chartPreviousClose ? ((qqqM.regularMarketPrice - qqqM.chartPreviousClose) / qqqM.chartPreviousClose * 100) : null
                };
            }
        } catch (e) { console.warn('纳指获取失败:', e.message); }
        
        try {
            const spyData = await fetchAPI('https://query1.finance.yahoo.com/v8/finance/chart/SPY?interval=1d&range=1d');
            const spyM = spyData?.chart?.result?.[0]?.meta;
            if (spyM?.regularMarketPrice) {
                result.sp500Pe = {
                    value: spyM.regularMarketPrice,
                    label: '点',
                    changePercent: spyM.chartPreviousClose ? ((spyM.regularMarketPrice - spyM.chartPreviousClose) / spyM.chartPreviousClose * 100) : null
                };
            }
        } catch (e) { console.warn('标普获取失败:', e.message); }
        
        // 沪深300 PE: 东方财富 stock/get
        try {
            const csiUrl = `https://push2.eastmoney.com/api/qt/stock/get?secid=1.000300&fields=f43,f115,f170`;
            const csiData = await fetchAPI(csiUrl);
            const d = csiData?.data;
            if (d && (d.f43 || d.f115)) {
                result.csi300Pe = {
                    value: d.f115 || 0,
                    label: '倍',
                    price: (d.f43 || 0) / 100,
                    changePercent: d.f170 != null ? d.f170 / 100 : null
                };
            }
        } catch (e) { console.warn('沪深300 PE获取失败:', e.message); }
        
        indicatorCache = result;
        indicatorDate = today;
        return result;
    }
    
    // ==================== 汇率转换 ====================
    
    let exchangeRates = { USD_CNY: 7.2, HKD_CNY: 0.92 }; // 默认汇率
    let exchangeRateDate = ''; // 格式 YYYY-MM-DD，每天仅获取一次
    
    // 获取最新汇率（每天仅更新一次）
    async function fetchExchangeRates() {
        const today = new Date().toISOString().slice(0, 10);
        if (exchangeRateDate === today) return exchangeRates; // 今天已获取过
        
        try {
            const data = await fetchAPI('https://api.exchangerate-api.com/v4/latest/USD');
            if (data && data.rates) {
                const usdCny = data.rates.CNY || 7.2;
                const hkdCny = usdCny / (data.rates.HKD || 7.83);
                exchangeRates = { USD_CNY: usdCny, HKD_CNY: hkdCny };
                exchangeRateDate = today;
                console.log('汇率更新:', `1 USD = ${usdCny.toFixed(4)} CNY, 1 HKD = ${hkdCny.toFixed(4)} CNY`);
            }
        } catch (e) {
            console.warn('汇率获取失败，使用已有汇率:', e.message);
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
    
    // ==================== JSONBin 云端备份 ====================
    
    async function cloudBackup(data, apiKey) {
        const config = getConfig();
        const binId = config.cloudBinId;
        const headers = {
            'X-Master-Key': apiKey,
            'Content-Type': 'application/json'
        };
        
        let resp, result;
        if (binId) {
            resp = await fetch(`https://api.jsonbin.io/v3/b/${binId}`, {
                method: 'PUT', headers,
                body: JSON.stringify(data)
            });
        } else {
            resp = await fetch('https://api.jsonbin.io/v3/b', {
                method: 'POST', headers,
                body: JSON.stringify(data)
            });
        }
        
        if (!resp.ok) {
            const err = await resp.text().catch(() => '');
            throw new Error(`JSONBin ${resp.status}: ${err.substring(0, 200)}`);
        }
        result = await resp.json();
        return result.metadata.id;
    }
    
    async function cloudFetch(apiKey, binId) {
        if (!binId) throw new Error('请输入云端 Bin ID（首次备份成功后获得）');
        
        const resp = await fetch(`https://api.jsonbin.io/v3/b/${binId}`, {
            headers: { 'X-Master-Key': apiKey }
        });
        if (!resp.ok) {
            const err = await resp.text().catch(() => '');
            throw new Error(`JSONBin ${resp.status}: ${err.substring(0, 200)}`);
        }
        const result = await resp.json();
        return result.record;
    }
    
    return {
        getFinnhubQuote, getFinnhubCompanyProfile,
        getFinnhubHKQuote, getFinnhubHKName,
        getBiyingAStockQuote, getBiyingAStockName,
        getBiyingHKStockQuote, getBiyingHKStockName,
        getYahooHKQuote, getYahooHKName,
        getTencentQuote, getTencentName,
        getFundJSONP, getFundNav,
        getEastMoneyFundNav, getEastMoneyFundName,
        getQuote, getName, updateAllPrices,
        fetchExchangeRates, getExchangeRates, toCNY,
        getCurrencySymbol, getAssetCurrency,
        cloudBackup, cloudFetch,
        fetchIndicators
    };
})();
