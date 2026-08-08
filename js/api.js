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

    // 跨仓数据三级加速：jsdelivr CDN → 用户CORS代理 → raw直连（国内直连 GitHub 常超时）
    const GH_CROSS = {
        xxfi: 'https://raw.githubusercontent.com/homjanon/xiaoxu-fear/main/output/xxfi_report.json',
        cmb:  'https://raw.githubusercontent.com/homjanon/cmb-tracker/main/output/cmb_report.json',
        qiuge:'https://raw.githubusercontent.com/homjanon/xiaoxu-fear/main/output/qiuge_report.json'
    };
    const GH_RAW_OF = url => url.replace('https://raw.githubusercontent.com/homjanon/', 'https://cdn.jsdelivr.net/gh/homjanon/').replace('/main/', '@main/');
    async function fetchCrossRepo(id) {
        const raw = GH_CROSS[id];
        // ① jsdelivr CDN（快，国内可达）
        try {
            const r = await fetch(GH_RAW_OF(raw));
            if (r.ok) return await r.json();
        } catch(e) {}
        // ② 用户CORS代理（自建，稳定）
        try {
            const proxies = getProxyList();
            for (const p of proxies) {
                try {
                    const r = await fetch(proxyURL(p, raw));
                    if (r.ok) return await r.json();
                } catch(e) {}
            }
        } catch(e) {}
        // ③ raw 直连兜底
        return await fetchAPI(raw);
    }

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

            // 6(沪A/科创板)、5(沪市ETF/指数/债券)、9(沪市B股) 属上交所 sh；其余(0/1/2/3 等)属深交所 sz

            case 'a-stock': return (/^[569]/.test(code) ? 'sh' : 'sz') + code;

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

    

    // ==================== 基金 (东方财富 pingzhongdata 主源 + 蛋卷 djapi 备用) ====================

    // 注：天天基金(fundgz.1234567.com.cn)接口已于2026年失效(返回404)，相关代码已移除。

    

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

        // 东方财富「品种综述」脚本：含基金名称(fS_name)与完整净值历史(Data_netWorthTrend)

        // 这是 akshare 底层抓取净值的同源接口，浏览器可脚本直连、无需代理/鉴权

        const url = `https://fund.eastmoney.com/pingzhongdata/${code}.js?rt=${Date.now()}`;

        const { name, trend } = await new Promise((resolve, reject) => {

            const script = document.createElement('script');

            const timer = setTimeout(() => {

                cleanup();

                reject(new Error(`东方财富基金 ${code} 加载超时`));

            }, 8000);

            function cleanup() {

                clearTimeout(timer);

                if (script.parentNode) script.parentNode.removeChild(script);

            }

            script.onload = () => {

                cleanup();

                resolve({ name: window.fS_name || code, trend: window.Data_netWorthTrend });

            };

            script.onerror = () => {

                cleanup();

                reject(new Error(`东方财富基金 ${code} 加载失败`));

            };

            script.src = url;

            document.head.appendChild(script);

        });



        if (!trend || !trend.length) {

            throw new Error(`东方财富未返回基金 ${code} 净值数据`);

        }



        const last = trend[trend.length - 1];        // 最新一条单位净值

        const nav = parseFloat(last.y);

        if (!isFinite(nav)) throw new Error(`基金 ${code} 净值解析失败`);



        const navDate = last.x ? new Date(last.x).toISOString().slice(0, 10) : '';

        const changePercent = parseFloat(last.equityReturn) || 0;



        return {

            code,

            name,

            nav,

            estimateNav: nav,

            price: nav,

            navDate,

            changePercent,

            change: (nav * changePercent / 100),

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



    // ==================== 基金备用：蛋卷 djapi（经通用 CORS 代理） ====================

    // 蛋卷 danjuanfunds.com/djapi/fund/{code} 免登录/免 Referer，返回 UTF-8 干净 JSON（含名称/单位净值/日期/日涨幅）。

    // 但响应无 CORS 头，须经「通用 CORS 代理」(如 Cloudflare Worker，见 README) 转发。

    // 实测：源端 ~0.2s，覆盖全（含东财/新浪查不到的基金），数据质量优于新浪 fu_。

    async function getDanjuanFundNav(code) {

        const url = `https://danjuanfunds.com/djapi/fund/${code}`;

        const proxies = getProxyList();

        let data = null;

        for (const proxy of proxies) {

            try {

                const r = await fetch(proxyURL(proxy, url));

                if (!r.ok) continue;

                const json = await r.json();

                if (json && json.data && json.data.fund_derived) { data = json.data; break; }

            } catch (e) {

                console.warn(`蛋卷基金代理 ${proxy.substring(0, 40)} 失败:`, e.message);

            }

        }

        if (!data) throw new Error(`蛋卷基金代理全部失败（请在设置中配置 CORS 代理）`);



        const fd = data.fund_derived;

        const nav = parseFloat(fd.unit_nav);

        if (!isFinite(nav)) throw new Error(`蛋卷基金 ${code} 净值解析失败`);

        const navDate = fd.end_date || '';

        const changePercent = parseFloat(fd.nav_grtd) || 0;



        return {

            code, name: data.fd_name || code,

            nav, estimateNav: nav, price: nav, navDate,

            changePercent, change: nav * changePercent / 100,

            timestamp: Date.now()

        };

    }



    async function getDanjuanFundName(code) {

        try {

            const url = `https://danjuanfunds.com/djapi/fund/${code}`;

            const proxies = getProxyList();

            for (const proxy of proxies) {

                try {

                    const r = await fetch(proxyURL(proxy, url));

                    if (!r.ok) continue;

                    const json = await r.json();

                    if (json && json.data && json.data.fd_name) return json.data.fd_name;

                } catch (e) { /* 尝试下一个代理 */ }

            }

            return code;

        } catch (e) {

            return code;

        }

    }



    // 从腾讯财经返回的 tilde 字符串中读取「证券类型」字段（索引 61：GP-A=股票 / ETF / LOF 等）

    function getTencentSecType(fieldsStr) {

        if (!fieldsStr) return '';

        const fields = fieldsStr.split('~');

        const raw = (fields[61] || '').trim();

        if (raw) return raw;

        // 兜底：扫描已知类型 token（防止字段索引漂移）

        const KNOWN = ['ETF', 'LOF', 'GP-A', 'GP-B', 'KCB', 'CYB', 'INDEX', 'FUND', 'FUND-A', 'ZQ', 'KZZ', 'QZ'];

        for (const f of fields) {

            const t = (f || '').trim();

            if (KNOWN.includes(t)) return t;

        }

        return '';

    }



    // 自动识别资产类别：6位代码区分 场内ETF/LOF 与 普通A股（均并入"股票"a-stock）；纯字母→美股；≤5位数字→港股；场外基金→fund

    async function identifyAssetType(rawCode) {

        const code = (rawCode || '').trim().toUpperCase();

        if (/^[A-Z.]{1,6}$/.test(code)) return 'us-stock';

        if (/^\d{1,5}$/.test(code)) return 'hk-stock';

        if (!/^\d{6}$/.test(code)) return 'a-stock';



        // ① 腾讯财经：探测 沪(sh)/深(sz)，并读取「证券类型」字段作为识别依据

        for (const prefix of ['sh', 'sz']) {

            const tcode = prefix + code;

            try {

                const url = `https://qt.gtimg.cn/q=${tcode}&_=${Date.now()}`;

                let text;

                try { text = await fetchGBK(url); }

                catch (e) { if (isCORSError(e)) text = await fetchGBKviaProxy(url); else continue; }

                const m = text && text.match(new RegExp(`v_${tcode.replace('.', '\\.')}="([^"]*)"`));

                if (m) {

                    // 腾讯能返回即说明是交易所上市品种；场内ETF/LOF 与普通A股 均按用户决定并入「股票(a-stock)」

                    // （此前腾讯偶发失败时 563300 曾被误判为场外基金，导致净值计价 + 误显"分红自动复投"）

                    const secType = getTencentSecType(m[1]);

                    console.log(`[identify] ${code} 腾讯证券类型=${secType || '未知'} → a-stock`);

                    return 'a-stock';

                }

            } catch (e) { /* 尝试另一个交易所 */ }

        }



        // ①-b 腾讯无返回兜底：场内基金/ETF/LOF 代码前缀 直接判为 a-stock，避免误判为场外基金

        if (/^(5[0-9]|15|16)\d{4}$/.test(code)) return 'a-stock';



        // ② 东方财富：场外基金探测（按净值计价，仅 腾讯未覆盖的场外基金进入此分支）

        try {

            const name = await getEastMoneyFundName(code);

            if (name && name !== code) return 'fund';

        } catch (e) { /* 继续 */ }



        // 都没命中：默认 A股，用户可手动切换为基金

        return 'a-stock';

    }



    // ==================== 统一接口 ====================

    

    async function getQuote(type, code) {

        const config = getConfig();

        if (config.demoMode) {

            console.log('演示模式');

            return getDemoQuote(type, code);

        }

        

        // 线路一/线路二(腾讯+东财/蛋卷)：股票均走腾讯财经直连

        // 线路三(API Key模式)：两框均未勾选，走 Finnhub/必盈/Yahoo

        const useTencent = !!(config.useLine1 || config.useLine2);



        switch (type) {

            case 'us-stock': return useTencent ? await getTencentQuote(type, code) : await getFinnhubQuote(code);

            case 'a-stock': return useTencent ? await getTencentQuote(type, code) : await getBiyingAStockQuote(code);

            case 'hk-stock': {

                if (useTencent) return await getTencentQuote(type, code);

                // 港股通过Yahoo Finance + 代理

                return await getYahooHKQuote(code);

            }

            case 'fund': {

                // 主源：东方财富 pingzhongdata（浏览器直连，免代理）

                try { return await getEastMoneyFundNav(code); }

                catch (e) { console.log('东方财富失败，尝试蛋卷:', e.message); }

                // 备用：蛋卷 djapi（经 CORS 代理，免 Referer、UTF-8 干净 JSON）

                try { return await getDanjuanFundNav(code); }

                catch (e) { console.log('蛋卷基金失败:', e.message); }

                throw new Error(`基金 ${code} 所有数据源均失败`);

            }

            default: throw new Error(`不支持的资产类型: ${type}`);

        }

    }

    

    async function getName(type, code) {

        const config = getConfig();

        if (config.demoMode) return getDemoName(type, code);



        const useTencent = !!(config.useLine1 || config.useLine2);



        switch (type) {

            case 'us-stock': {

                if (useTencent) return await getTencentName(type, code);

                const p = await getFinnhubCompanyProfile(code);

                return p.name || code.toUpperCase();

            }

            case 'a-stock': {

                if (useTencent) return await getTencentName(type, code);

                const s = await getBiyingAStockName(code);

                return s.name || code;

            }

            case 'hk-stock': {

                if (useTencent) return await getTencentName(type, code);

                const h = await getYahooHKName(code);

                return h.name || code;

            }

            case 'fund': {

                // 主源：东方财富 pingzhongdata

                try { const n = await getEastMoneyFundName(code); if (n && n !== code) return n; } catch(e) {}

                // 备用：蛋卷 djapi

                try { const d = await getDanjuanFundName(code); if (d && d !== code) return d; } catch(e) {}

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

    

    // ==================== 市场估值指标（蛋卷/雪球+VIX） ====================

    

    const INDICATOR_CACHE_KEY = 'investment_indicator_cache';

    const DJ_INDEX_MAP = {

        csi300Pe:   'SH000300',

        star50:     'SZ399006',

        dividend:      'CSIH30269',

        nasdaqPe:   'NDX',

        sp500Pe:    'SP500'

    };

    

    const LEVEL_MAP = { low: '低估', middle: '正常', high: '高估' };

    

    function getCacheKey() {

        const now = new Date();

        const today = now.toISOString().slice(0, 10);

        const period = now.getHours() < 12 ? 'am' : 'pm';

        return today + '-' + period;

    }

    

    function getCachedIndicators() {

        try {

            const raw = localStorage.getItem(INDICATOR_CACHE_KEY);

            if (!raw) return null;

            const cached = JSON.parse(raw);

            if (cached.key === getCacheKey()) return cached.data;

        } catch (e) {}

        return null;

    }

    

    function saveCachedIndicators(data) {

        try { localStorage.setItem(INDICATOR_CACHE_KEY, JSON.stringify({ key: getCacheKey(), data })); } catch (e) {}

    }

    

    // 缓存完整（所有key都有值）则直接返回，不做任何网络请求

    function isCacheComplete(data) {

        if (!data || !data.vix) return false;  // VIX必须有（Yahoo不稳定允许缺失）

        // PE至少要有几个核心的

        const keys = ['csi300Pe', 'sp500Pe'];

        return keys.every(k => data[k] && data[k].value != null);

    }

    

    async function fetchIndicators() {

        const cached = getCachedIndicators();

        // 缓存仅用于VIX/PE（减少请求）；银行五维/秋哥/XXFI 每次实时拉取，不缓存

        const result = cached ? { ...cached, xxfi: null } : { vix: null, xxfi: null, sp500Pe: null, csi300Pe: null, star50: null, dividend: null };

        let hasNew = false;

        

        // VIX: Yahoo（仅在缺失或缓存过期时重试）

        if (!result.vix || !cached) {

            try {

                const d = await fetchAPI('https://query1.finance.yahoo.com/v8/finance/chart/%5EVIX?interval=1d&range=2d');

                const m = d?.chart?.result?.[0]?.meta;

                if (m?.regularMarketPrice) {

                    const p = m.regularMarketPrice, pp = m.chartPreviousClose || p;

                    result.vix = { value: p, changePercent: pp ? (p - pp) / pp * 100 : null };

                    hasNew = true;

                }

            } catch (e) { console.warn('VIX失败:', e.message); }

        }

        

        // 五大指数PE: 蛋卷/雪球API

        if (!cached || !result.csi300Pe) {

            try {

                const dj = await fetchAPI('https://danjuanfunds.com/djapi/index_eva/dj');

                const items = dj?.data?.items;

                if (items && Array.isArray(items)) {

                    for (const [key, code] of Object.entries(DJ_INDEX_MAP)) {

                        const item = items.find(i => i.index_code === code);

                        if (item && item.pe) {

                            // 红利低波：用股息率代替PE

                            if (key === 'dividend' && item.yeild != null) {

                                result[key] = { value: item.yeild, displayValue: item.yeild * 100, label: '%', level: '', changePercent: null };

                            } else {

                                result[key] = { value: item.pe, label: '倍', level: LEVEL_MAP[item.eva_type] || '', changePercent: null };

                            }

                            hasNew = true;

                        }

                    }

                }

            } catch (e) { console.warn('蛋卷PE失败:', e.message); }

        }

        

        // 小旭恐慌指数(XXFI): raw GitHub（独立获取，不依赖蛋卷）

        // 实时拉取，不缓存（与 cmb/秋哥一致；跨仓库产物可随时手动重跑，半天缓存会导致旧值卡死）

        {

            try {

                const xxfiData = await fetchCrossRepo('xxfi');

                if (xxfiData && xxfiData.XXFI != null) {

                    result.xxfi = {

                        value: xxfiData.XXFI,

                        signal: xxfiData.contrarian_signal || '',

                        level: xxfiData.level || '',

                        advice: xxfiData.advice || '',

                        dataDate: xxfiData._data_date || ''

                    };

                    hasNew = true;

                }

            } catch (e) { console.warn('XXFI失败:', e.message); }

        }

        

        // 银行五维(cmb-tracker): raw GitHub（实时拉取，不缓存）

        {

            try {

                const cmb = await fetchCrossRepo('cmb');

                if (cmb && Array.isArray(cmb.banks)) {

                    const sorted = [...cmb.banks].sort((a, b) => b.score_total - a.score_total);

                    // 招行(600036)买入区间

                    const zhStock = sorted.find(b => b.code === '600036');

                    // 第二、三名买入区间（排除第一名招商银行）

                    const top2_3 = sorted.slice(1, 3).map(b => ({

                        name: b.short || b.name,

                        zoneLow: b.zone_low,

                        zoneHigh: b.zone_high

                    }));

                    result.cmbFiveDim = {

                        dataDate: cmb.data_date || '',

                        count: cmb.summary.total_banks,

                        buys: cmb.summary.buy + cmb.summary.strong_buy,

                        zhPrice: zhStock ? zhStock.price : null,

                        zhZoneLow: zhStock ? zhStock.zone_low : null,

                        zhZoneHigh: zhStock ? zhStock.zone_high : null,

                        zhDivYield: zhStock ? zhStock.div_yield : null,

                        top2_3: top2_3,

                        banks: sorted.map(b => ({

                            name: b.short || b.name,

                            score: b.score_total,

                            signal: b.signal

                        }))

                    };

                    hasNew = true;

                }

            } catch (e) { console.warn('银行五维失败:', e.message); }

        }

        

        // 秋哥操作: raw GitHub（每次实时拉取，不缓存）

        {

            try {

                const qg = await fetchCrossRepo('qiuge');

                if (qg && qg.data_date && qg.index) {

                    result.qiuge = {

                        dataDate: qg.data_date,

                        reportType: qg.report_type || '',

                        indexName: qg.index.name || '上证指数',

                        indexClose: qg.index.close,

                        indexChange: qg.index.change_pct,

                        support: qg.levels.support,

                        pressure: qg.levels.pressure,

                        strongSupport: qg.levels.strong_support,

                        positionMax: qg.position_max,

                        picks: qg.picks_name || [],

                        picksDetail: qg.picks_detail || [],

                        watch: qg.watch || [],

                        avoid: qg.avoid || [],

                        outlook: qg.outlook || '',

                        summary: qg.summary || ''

                    };

                    hasNew = true;

                }

            } catch (e) { console.warn('秋哥操作失败:', e.message); }

        }

        

        if (hasNew) saveCachedIndicators(result);

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

    

    // ==================== 分红数据获取（东方财富） ====================

    

    // 获取指定A股的分红记录

    // 返回数组: [{perShare, exDate, recordDate, reportPeriod, assignProgress, planProfile, ...}]

    async function fetchDividends(securityCode) {

        const url = 'https://datacenter-web.eastmoney.com/api/data/v1/get'

            + '?sortColumns=PLAN_NOTICE_DATE&sortTypes=-1&pageSize=5&pageNumber=1'

            + '&reportName=RPT_SHAREBONUS_DET&columns=ALL&source=WEB&client=WEB'

            + '&filter=(SECURITY_CODE=%22' + securityCode + '%22)';

        

        const data = await fetchAPI(url);

        if (!data || !data.success || !data.result || !data.result.data) {

            console.warn('分红数据获取失败:', data);

            return [];

        }

        return data.result.data.map(item => ({

            securityCode: item.SECURITY_CODE,

            securityName: item.SECURITY_NAME_ABBR,

            perShare: item.PRETAX_BONUS_RMB ? item.PRETAX_BONUS_RMB / 10 : null,  // 每10股 → 每股

            exDate: item.EX_DIVIDEND_DATE ? item.EX_DIVIDEND_DATE.slice(0, 10) : null,

            recordDate: item.EQUITY_RECORD_DATE ? item.EQUITY_RECORD_DATE.slice(0, 10) : null,

            reportPeriod: item.REPORT_DATE ? item.REPORT_DATE.slice(0, 10) : null,

            assignProgress: item.ASSIGN_PROGRESS,  // 预披露 / 实施分配

            planProfile: item.IMPL_PLAN_PROFILE,

            dividendRatio: item.DIVIDENT_RATIO,

            basicEps: item.BASIC_EPS,

            noticeDate: item.NOTICE_DATE ? item.NOTICE_DATE.slice(0, 10) : null,

            currency: 'CNY'

        }));

    }

    

    // ==================== 基金分红数据获取 ====================

    

    // 获取指定基金的分红记录（从东方财富基金品种数据）

    // 返回: [{exDate, perUnit, navAfter, ...}]

    async function fetchFundDividends(code) {

        try {

            const url = `https://fund.eastmoney.com/pingzhongdata/${code}.js?rt=${Date.now()}`;

            const data = await injectScript(url, 'Data_netWorthTrend', 10000);

            if (!data || !Array.isArray(data)) return [];

            

            const dividends = [];

            for (const item of data) {

                if (item.unitMoney && item.unitMoney.includes('分红')) {

                    // 解析 "分红：每份派现金0.0110元"

                    const match = item.unitMoney.match(/([\d.]+)元/);

                    if (match && item.x) {

                        const perUnit = parseFloat(match[1]);

                        const exDate = new Date(item.x).toISOString().slice(0, 10);

                        const navAfter = item.y;  // 除权后净值

                        dividends.push({

                            perUnit,

                            exDate,

                            navAfter: navAfter || null,

                            currency: 'CNY'

                        });

                    }

                }

            }

            return dividends;

        } catch (e) {

            console.warn(`基金 ${code} 分红获取失败:`, e.message);

            return [];

        }

    }

    

    // 检查当前持仓是否有未记录的分红事件

    // 返回: [{assetId, code, name, perShare, exDate, type, currency, reportPeriod}]

    async function checkNewDividends() {

        const assets = StorageManager.getAssets();

        if (!assets.length) return [];

        

        const today = new Date().toISOString().slice(0, 10);

        // 分红提醒窗口：仅除权日 ±REMIND_WINDOW_DAYS 天内提醒，超出不再弹（避免历史分红反复提醒）

        const REMIND_WINDOW_DAYS = 3;

        const withinRemindWindow = (exDate) => {

            const diff = Math.abs(Math.round((new Date(exDate) - new Date(today)) / 86400000));

            return diff <= REMIND_WINDOW_DAYS;

        };

        const newDividends = [];

        

        // --- A股分红检测 ---

        const aStockCodes = [...new Set(

            assets.filter(a => a.type === 'a-stock').map(a => a.code)

        )];

        for (const code of aStockCodes) {

            try {

                const dividends = await fetchDividends(code);

                const implemented = dividends.filter(d => 

                    d.assignProgress === '实施分配' && d.perShare && d.exDate && withinRemindWindow(d.exDate)

                );

                for (const d of implemented) {

                    if (!StorageManager.isDividendRecorded(code, d.exDate)) {

                        for (const asset of assets.filter(a => a.code === code)) {

                            newDividends.push({

                                assetId: asset.id, type: 'a-stock',

                                code: d.securityCode,

                                name: d.securityName || asset.name,

                                perShare: d.perShare,

                                exDate: d.exDate,

                                recordDate: d.recordDate,

                                currency: 'CNY',

                                reportPeriod: d.reportPeriod

                            });

                        }

                    }

                }

            } catch (e) {

                console.warn(`检查 A股 ${code} 分红失败:`, e.message);

            }

        }

        

        // --- 基金分红检测 ---

        const fundCodes = [...new Set(

            assets.filter(a => a.type === 'fund').map(a => a.code)

        )];

        for (const code of fundCodes) {

            try {

                const dividends = await fetchFundDividends(code);

                const ready = dividends.filter(d => d.perUnit && d.exDate && withinRemindWindow(d.exDate));

                for (const d of ready) {

                    if (!StorageManager.isDividendRecorded(code, d.exDate)) {

                        for (const asset of assets.filter(a => a.code === code && a.type === 'fund')) {

                            newDividends.push({

                                assetId: asset.id, type: 'fund',

                                code, name: asset.name || code,

                                perShare: d.perUnit,  // 基金用 perShare 字段存 perUnit

                                exDate: d.exDate,

                                currency: 'CNY',

                                navAfter: d.navAfter,

                                source: 'auto'

                            });

                        }

                    }

                }

            } catch (e) {

                console.warn(`检查 基金 ${code} 分红失败:`, e.message);

            }

        }

        

        return newDividends;

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

    

    // ==================== 云端备份（JSONBin / Gitee / GitHub 三后端） ====================

    // 统一出口：cloudBackup(data, cfgOverride?) / cloudFetch(cfgOverride?)

    // cfgOverride 优先用调用方传入（设置弹窗里尚未保存的配置），否则读 getConfig()



    // UTF-8 安全的 base64（浏览器 btoa 仅支持 Latin1，中文必须走此通道）

    function utf8ToBase64(str) {

        return btoa(unescape(encodeURIComponent(str)));

    }

    function base64ToUtf8(b64) {

        return decodeURIComponent(escape(atob(b64.replace(/\s/g, ''))));

    }



    // ---- JSONBin（原有） ----

    async function jsonbinBackup(data, config) {

        const binId = config.cloudBinId;

        const headers = { 'X-Master-Key': config.cloudApiKey, 'Content-Type': 'application/json' };

        let resp;

        if (binId) {

            resp = await fetch(`https://api.jsonbin.io/v3/b/${binId}`, { method: 'PUT', headers, body: JSON.stringify(data) });

        } else {

            resp = await fetch('https://api.jsonbin.io/v3/b', { method: 'POST', headers, body: JSON.stringify(data) });

        }

        if (!resp.ok) { const err = await resp.text().catch(() => ''); throw new Error(`JSONBin ${resp.status}: ${err.substring(0, 200)}`); }

        const result = await resp.json();

        return result.metadata.id;   // 返回 binId 供后续拉取

    }

    async function jsonbinFetch(config) {

        const binId = config.cloudBinId;

        if (!binId) throw new Error('请先填写 JSONBin Bin ID（首次备份后获得）');

        const resp = await fetch(`https://api.jsonbin.io/v3/b/${binId}`, { headers: { 'X-Master-Key': config.cloudApiKey } });

        if (!resp.ok) { const err = await resp.text().catch(() => ''); throw new Error(`JSONBin ${resp.status}: ${err.substring(0, 200)}`); }

        const result = await resp.json();

        return result.record;

    }



    // ---- Gitee（私人仓，纯前端 Contents API 直连；无 branch 走默认分支） ----

    async function giteeBackup(data, config) {

        const { cloudRepo: repo, cloudPath: path, cloudToken: token } = config;

        if (!token || !repo) throw new Error('请填写 Gitee 私人令牌与仓库(owner/repo)');

        const content = utf8ToBase64(JSON.stringify(data, null, 2));

        const url = `https://gitee.com/api/v5/repos/${repo}/contents/${path}`;



        // 取当前文件 sha：优先 ?access_token= 查询串（免 CORS 预检最稳），不认再降级 Bearer 头（对齐 jingjishi 9.1）

        const getSha = async () => {

            // 1) 查询串方式

            try {

                const g = await fetch(`${url}?access_token=${encodeURIComponent(token)}`, { cache: 'no-store' });

                if (g.status === 401 || g.status === 403) throw new Error('Gitee 鉴权失败：令牌无效或权限不足（请确认勾选 projects 权限）');

                if (g.ok) {

                    const j = await g.json().catch(() => ({}));

                    if (Array.isArray(j)) return null;        // 空目录/不存在返回 []，按"无文件"处理

                    return j.sha || null;

                }

            } catch (e) { if (/鉴权失败/.test(e.message)) throw e; /* 否则落入降级 */ }

            // 2) 降级 Bearer 头

            try {

                const g = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` }, cache: 'no-store' });

                if (g.status === 401 || g.status === 403) throw new Error('Gitee 鉴权失败：令牌无效或权限不足（请确认勾选 projects 权限）');

                if (g.ok) {

                    const j = await g.json().catch(() => ({}));

                    if (Array.isArray(j)) return null;

                    return j.sha || null;

                }

            } catch (e) { if (/鉴权失败/.test(e.message)) throw e; }

            return null;

        };

        const putWith = (sha) => fetch(url, {

            method: 'PUT',

            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },

            body: JSON.stringify({ content, message: 'investment-tracker backup update', sha, access_token: token })

        });

        const postCreate = () => fetch(url, {

            method: 'POST',

            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },

            body: JSON.stringify({ content, message: 'investment-tracker backup init', access_token: token })

        });



        // SHA 冲突自动重试：循环最多 3 次（对齐 jingjishi 9.3）

        //   每次重拉最新 SHA → 有则 PUT 覆盖、无则 POST 新建；

        //   遇 400/409/422 视为冲突，continue 重拉再写；401/403 鉴权问题直接抛；其他错误直接抛。

        let lastErr = '';

        for (let attempt = 0; attempt < 3; attempt++) {

            const sha = await getSha();

            const resp = sha ? await putWith(sha) : await postCreate();

            if (resp.ok) return path;

            const status = resp.status;

            const errText = await resp.text().catch(() => '');

            lastErr = `Gitee ${status}: ${errText.substring(0, 200)}`;

            if (status === 401 || status === 403) throw new Error(lastErr);

            if (status === 400 || status === 409 || status === 422) continue;

            throw new Error(lastErr);

        }

        throw new Error(lastErr || 'Gitee 备份失败：重试 3 次仍冲突');

    }

    async function giteeFetch(config) {

        const { cloudRepo: repo, cloudPath: path, cloudToken: token } = config;

        if (!token || !repo) throw new Error('请填写 Gitee 私人令牌与仓库(owner/repo)');

        const url = `https://gitee.com/api/v5/repos/${repo}/contents/${path}`;



        // GET：优先 ?access_token= 查询串，401/403 降级 Bearer 头（对齐 jingjishi 9.1）

        const doGet = async () => {

            let resp = await fetch(`${url}?access_token=${encodeURIComponent(token)}`, { cache: 'no-store' });

            if (resp.status === 401 || resp.status === 403) {

                resp = await fetch(url, { headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' }, cache: 'no-store' });

            }

            if (resp.status === 404) throw new Error('Gitee 仓库中暂无备份文件，请先在「同步方式」下备份一次（或检查仓库/路径是否正确）');

            if (!resp.ok) { const err = await resp.text().catch(() => ''); throw new Error(`Gitee ${resp.status}: ${err.substring(0, 200)}`); }

            return await resp.json().catch(() => ({}));

        };

        let j = await doGet();

        if (!j || Array.isArray(j) || !j.content) j = await doGet();   // 空 body / [] 重试一次

        if (!j || Array.isArray(j) || !j.content) throw new Error('Gitee 读取成功但未返回文件内容，请检查仓库路径是否正确（应类似 data/user-data.json）');

        return JSON.parse(base64ToUtf8(j.content || ''));

    }



    // ---- GitHub（私人仓，细粒度 PAT 仅授权该仓 Contents 读写） ----

    async function githubBackup(data, config) {

        const { cloudRepo: repo, cloudPath: path, cloudToken: token } = config;

        if (!token || !repo) throw new Error('请填写 GitHub 私人令牌与仓库(owner/repo)');

        const content = utf8ToBase64(JSON.stringify(data, null, 2));

        const url = `https://api.github.com/repos/${repo}/contents/${path}`;

        const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };



        // SHA 冲突自动重试：循环最多 3 次（对齐 jingjishi 9.3）。GitHub 一律 PUT，遇 409 重拉 SHA 再写。

        let lastErr = '';

        for (let attempt = 0; attempt < 3; attempt++) {

            let sha = null;

            const r = await fetch(url, { headers });

            if (r.status === 404) { sha = null; }

            else if (r.ok) { const j = await r.json(); sha = j.sha || null; }

            else {

                const err = await r.text().catch(() => '');

                lastErr = `GitHub ${r.status}: ${err.substring(0, 200)}`;

                if (r.status === 401 || r.status === 403) throw new Error(lastErr);

                throw new Error(lastErr);

            }

            const body = sha

                ? { message: 'investment-tracker backup update', content, sha }

                : { message: 'investment-tracker backup init', content };

            const resp = await fetch(url, { method: 'PUT', headers, body: JSON.stringify(body) });

            if (resp.ok) return path;

            const errText = await resp.text().catch(() => '');

            lastErr = `GitHub ${resp.status}: ${errText.substring(0, 200)}`;

            if (resp.status === 409) continue;   // SHA 冲突，重拉最新 SHA 再写

            if (resp.status === 401 || resp.status === 403) throw new Error(lastErr);

            throw new Error(lastErr);

        }

        throw new Error(lastErr || 'GitHub 备份失败：重试 3 次仍冲突');

    }

    async function githubFetch(config) {

        const { cloudRepo: repo, cloudPath: path, cloudToken: token } = config;

        if (!token || !repo) throw new Error('请填写 GitHub 私人令牌与仓库(owner/repo)');

        const url = `https://api.github.com/repos/${repo}/contents/${path}`;

        const resp = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });

        if (resp.status === 404) throw new Error('GitHub 仓库中暂无备份文件，请先备份一次');

        if (!resp.ok) { const err = await resp.text().catch(() => ''); throw new Error(`GitHub ${resp.status}: ${err.substring(0, 200)}`); }

        const j = await resp.json();

        return JSON.parse(base64ToUtf8(j.content || ''));

    }



    // ---- 统一分发 ----

    async function cloudBackup(data, cfgOverride) {

        const config = cfgOverride || getConfig();

        const provider = config.cloudProvider || 'jsonbin';

        if (provider === 'gitee') return await giteeBackup(data, config);

        if (provider === 'github') return await githubBackup(data, config);

        return await jsonbinBackup(data, config);

    }

    async function cloudFetch(cfgOverride) {

        const config = cfgOverride || getConfig();

        const provider = config.cloudProvider || 'jsonbin';

        if (provider === 'gitee') return await giteeFetch(config);

        if (provider === 'github') return await githubFetch(config);

        return await jsonbinFetch(config);

    }

    

    return {

        getFinnhubQuote, getFinnhubCompanyProfile,

        getFinnhubHKQuote, getFinnhubHKName,

        getBiyingAStockQuote, getBiyingAStockName,

        getBiyingHKStockQuote, getBiyingHKStockName,

        getYahooHKQuote, getYahooHKName,

        getTencentQuote, getTencentName,

        getEastMoneyFundNav, getEastMoneyFundName, getDanjuanFundNav, getDanjuanFundName, identifyAssetType,

        getQuote, getName, updateAllPrices,

        fetchExchangeRates, getExchangeRates, toCNY,

        getCurrencySymbol, getAssetCurrency,

        cloudBackup, cloudFetch,

        fetchIndicators, fetchDividends, fetchFundDividends, checkNewDividends

    };

})();

