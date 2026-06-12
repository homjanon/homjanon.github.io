/**
 * API调用封装模块
 * 负责调用各种金融数据API获取实时行情
 * 
 * 数据源：
 * - A股：必盈API (biyingapi.com)
 * - 港股：必盈API (biyingapi.com)
 * - 美股：Finnhub API (finnhub.io)
 * - 基金：天天基金网 (1234567.com.cn)
 */

const APIManager = (function() {
    // API基础URL
    const API_BASE = {
        finnhub: 'https://finnhub.io/api/v1',
        biying: 'https://api.biyingapi.com',
        tiantianFund: 'http://fundgz.1234567.com.cn/js'
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
            // 区分网络错误和CORS错误
            if (error.name === 'TypeError' && error.message.includes('fetch')) {
                throw new Error('网络连接失败，请检查网络或该API可能不支持浏览器直接调用（CORS限制）');
            }
            throw error;
        }
    }
    
    // ==================== Finnhub API (美股) ====================
    
    // 获取美股行情
    async function getFinnhubQuote(symbol) {
        const config = getConfig();
        if (!config.finnhubKey) {
            throw new Error('未配置Finnhub API Key，请在设置中填入Finnhub API Key');
        }
        
        // Finnhub免费套餐需要API Key启用后等待一段时间才能生效
        const url = `${API_BASE.finnhub}/quote?symbol=${symbol.toUpperCase()}&token=${config.finnhubKey}`;
        
        const data = await fetchAPI(url);
        
        // Finnhub返回格式: { c: 当前价, d: 涨跌额, dp: 涨跌幅%, h: 最高, l: 最低, o: 开盘, pc: 昨收, t: 时间戳 }
        if (!data) {
            throw new Error('返回数据为空');
        }
        
        // 如果c为0且pc也为0，说明该股票无数据（可能是退市、代码错误等）
        if (data.c === 0 && data.pc === 0) {
            throw new Error('未找到该美股数据，请检查代码是否正确（如：AAPL、TSLA、MSFT）');
        }
        
        // 如果c为null/undefined，使用pc(昨收)作为当前价
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
    
    // 获取美股公司信息
    async function getFinnhubCompanyProfile(symbol) {
        const config = getConfig();
        if (!config.finnhubKey) {
            throw new Error('未配置Finnhub API Key');
        }
        
        const url = `${API_BASE.finnhub}/stock/profile2?symbol=${symbol.toUpperCase()}&token=${config.finnhubKey}`;
        
        try {
            const data = await fetchAPI(url);
            if (data && data.name) {
                return {
                    name: data.name,
                    ticker: data.ticker || symbol,
                    exchange: data.exchange || '',
                    industry: data.finnhubIndustry || ''
                };
            }
            return { name: symbol.toUpperCase(), ticker: symbol };
        } catch (error) {
            console.warn('获取美股公司信息失败（将使用代码作为名称）:', error.message);
            return { name: symbol.toUpperCase(), ticker: symbol };
        }
    }
    
    // ==================== 必盈API (A股) ====================
    
    // 获取A股实时行情
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
    
    // 获取A股股票名称
    async function getBiyingAStockName(code) {
        const config = getConfig();
        if (!config.biyingKey) {
            throw new Error('未配置必盈API Licence');
        }
        
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
    
    // ==================== 必盈API (港股) ====================
    
    // 获取港股实时行情（通过必盈API）
    async function getBiyingHKStockQuote(code) {
        const config = getConfig();
        if (!config.biyingKey) {
            throw new Error('未配置必盈API Licence，请在设置中填入必盈API Licence');
        }
        
        // 港股代码统一补零到5位：0700、9988、0388、0939、1299
        const paddedCode = code.length < 5 ? code.padStart(5, '0') : code;
        
        // 尝试港股实时行情接口
        // 必盈API港股实时格式：/hkrl/ssjy/股票代码/licence
        const url = `${API_BASE.biying}/hkrl/ssjy/${paddedCode}/${config.biyingKey}`;
        
        const data = await fetchAPI(url);
        
        if (!data || (data.p === undefined && data.P === undefined)) {
            throw new Error(`未找到港股 ${code} 的数据，请检查代码是否正确（港股代码通常为5位数字，如00700、09988）`);
        }
        
        const price = data.p != null ? data.p : data.P || 0;
        const open = data.o != null ? data.o : data.O || price;
        const high = data.h != null ? data.h : data.H || price;
        const low = data.l != null ? data.l : data.L || price;
        const previousClose = data.yc != null ? data.yc : data.YC || price;
        const changePercent = data.pc != null ? data.pc : data.PC || 0;
        
        return {
            price: price,
            changePercent: changePercent,
            change: data.ud || (price - previousClose),
            high: high,
            low: low,
            open: open,
            previousClose: previousClose,
            volume: data.v || data.V,
            timestamp: data.t ? new Date(data.t).getTime() : Date.now()
        };
    }
    
    // 获取港股股票名称（通过必盈API）
    async function getBiyingHKStockName(code) {
        const config = getConfig();
        if (!config.biyingKey) {
            throw new Error('未配置必盈API Licence');
        }
        
        const paddedCode = code.length < 5 ? code.padStart(5, '0') : code;
        const url = `${API_BASE.biying}/hkstock/instrument/${paddedCode}/${config.biyingKey}`;
        
        try {
            const data = await fetchAPI(url);
            return { name: data.name || code, code: code };
        } catch (error) {
            console.warn('获取港股名称失败（将使用代码作为名称）:', error.message);
            return { name: code, code: code };
        }
    }
    
    // ==================== 天天基金网API (基金) ====================
    
    // 获取基金净值 (天天基金网)
    async function getTiandianFundNav(code) {
        const url = `${API_BASE.tiantianFund}/${code}.js?rt=${Date.now()}`;
        
        try {
            const response = await fetch(url);
            const text = await response.text();
            
            if (!text || text.includes('404') || text.includes('Not Found')) {
                throw new Error(`未找到基金 ${code}，请检查代码是否正确（如110022、161725）`);
            }
            
            // 解析JSONP: jsonpgz({"fundcode":"110022",...});
            const match = text.match(/jsonpgz\((.*)\)/);
            if (!match) {
                throw new Error('解析基金数据失败，天天基金网可能不支持当前代码格式');
            }
            
            const data = JSON.parse(match[1]);
            return {
                code: data.fundcode,
                name: data.name,
                nav: parseFloat(data.dwjz) || 0,        // 单位净值
                estimateNav: parseFloat(data.gsz) || 0,  // 估算净值
                estimateTime: data.gztime || '',
                changePercent: parseFloat(data.gszzl) || 0,
                timestamp: Date.now()
            };
        } catch (error) {
            console.warn('获取基金净值失败:', error.message);
            throw new Error(`获取基金数据失败: ${error.message}`);
        }
    }
    
    // ==================== 统一接口 ====================
    
    // 根据资产类型获取行情
    async function getQuote(type, code) {
        // 演示模式：返回模拟数据
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
            case 'hk-stock':
                return await getBiyingHKStockQuote(code);
            case 'fund':
                return await getTiandianFundNav(code);
            default:
                throw new Error(`不支持的资产类型: ${type}`);
        }
    }
    
    // 根据资产类型获取名称
    async function getName(type, code) {
        const config = getConfig();
        if (config.demoMode) {
            return getDemoName(type, code);
        }
        
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
                const hkInfo = await getBiyingHKStockName(code);
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
    
    // 批量更新所有资产的价格
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
                
                // 添加延迟避免API限流
                await sleep(200);
            } catch (error) {
                console.error(`更新 ${asset.code} 失败:`, error);
                errors.push({
                    code: asset.code,
                    error: error.message
                });
            }
        }
        
        return { results, errors };
    }
    
    // 辅助函数：延迟
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
            high: price * 1.01,
            low: price * 0.99,
            open: basePrice,
            previousClose: basePrice,
            volume: Math.floor(Math.random() * 1000000),
            timestamp: Date.now(),
            estimateNav: type === 'fund' ? price : undefined,
            nav: type === 'fund' ? basePrice : undefined
        };
    }
    
    function getDemoName(type, code) {
        return DEMO_NAMES[code] || `${code} (演示)`;
    }
    
    // 公开API
    return {
        getFinnhubQuote,
        getFinnhubCompanyProfile,
        getBiyingAStockQuote,
        getBiyingAStockName,
        getBiyingHKStockQuote,
        getBiyingHKStockName,
        getTiandianFundNav,
        getQuote,
        getName,
        updateAllPrices
    };
})();
