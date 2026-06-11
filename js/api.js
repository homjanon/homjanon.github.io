/**
 * API调用封装模块
 * 负责调用各种金融数据API获取实时行情
 */

const APIManager = (function() {
    // API基础URL
    const API_BASE = {
        finnhub: 'https://finnhub.io/api/v1',
        biying: 'https://api.biyingapi.com',
        yahoo: 'https://query1.finance.yahoo.com/v8/finance',
        tiantianFund: 'http://fundgz.1234567.com.cn/js'
    };
    
    // 获取配置
    function getConfig() {
        return StorageManager.getConfig();
    }
    
    // 通用fetch封装，处理CORS问题
    async function fetchWithCORS(url, options = {}) {
        const defaultOptions = {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                ...options.headers
            },
            mode: 'cors',
            ...options
        };
        
        try {
            const response = await fetch(url, defaultOptions);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            return await response.json();
        } catch (error) {
            console.warn('CORS或网络错误，尝试使用代理:', error.message);
            // 如果CORS失败，返回一个标记，让调用者知道需要代理
            throw new Error(`CORS_ERROR:${url}`);
        }
    }
    
    // ==================== Finnhub API (美股) ====================
    
    // 获取美股行情
    async function getFinnhubQuote(symbol) {
        const config = getConfig();
        if (!config.finnhubKey) {
            throw new Error('未配置Finnhub API Key');
        }
        
        const url = `${API_BASE.finnhub}/quote?symbol=${symbol}&token=${config.finnhubKey}`;
        
        try {
            const data = await fetchWithCORS(url);
            // Finnhub返回格式: { c: 当前价, d: 涨跌额, dp: 涨跌幅%, h: 最高, l: 最低, o: 开盘, pc: 昨收, t: 时间戳 }
            if (!data || data.c === null || data.c === undefined) {
                throw new Error('未找到该股票数据');
            }
            return {
                price: data.c,
                change: data.d,
                changePercent: data.dp,
                high: data.h,
                low: data.l,
                open: data.o,
                previousClose: data.pc,
                timestamp: data.t * 1000
            };
        } catch (error) {
            if (error.message.startsWith('CORS_ERROR:')) {
                // CORS错误，返回模拟数据或抛出特定错误
                throw new Error(`CORS受限: Finnhub API需要从服务器代理调用，或直接访问 https://finnhub.io 获取支持CORS的API Key`);
            }
            throw error;
        }
    }
    
    // 获取美股公司信息
    async function getFinnhubCompanyProfile(symbol) {
        const config = getConfig();
        if (!config.finnhubKey) {
            throw new Error('未配置Finnhub API Key');
        }
        
        const url = `${API_BASE.finnhub}/stock/profile2?symbol=${symbol}&token=${config.finnhubKey}`;
        
        try {
            const data = await fetchWithCORS(url);
            return {
                name: data.name || symbol,
                ticker: data.ticker,
                exchange: data.exchange,
                industry: data.finnhubIndustry
            };
        } catch (error) {
            console.warn('获取公司信息失败:', error);
            return { name: symbol, ticker: symbol };
        }
    }
    
    // ==================== 必盈API (A股) ====================
    
    // 获取A股实时行情
    async function getBiyingAStockQuote(code) {
        const config = getConfig();
        if (!config.biyingKey) {
            throw new Error('未配置必盈API Licence');
        }
        
        // 必盈API格式: https://api.biyingapi.com/hsrl/ssjy/股票代码/licence
        const url = `${API_BASE.biying}/hsrl/ssjy/${code}/${config.biyingKey}`;
        
        try {
            const data = await fetchWithCORS(url);
            // 必盈返回格式: { p: 当前价, pc: 涨跌幅%, yc: 昨收, t: 时间, o: 开盘, h: 最高, l: 最低 }
            if (!data || data.p === undefined) {
                throw new Error('未找到该股票数据');
            }
            return {
                price: data.p,
                changePercent: data.pc,
                change: data.ud || (data.p - data.yc),
                high: data.h,
                low: data.l,
                open: data.o,
                previousClose: data.yc,
                volume: data.v,
                turnover: data.cje,
                timestamp: data.t ? new Date(data.t).getTime() : Date.now()
            };
        } catch (error) {
            if (error.message.startsWith('CORS_ERROR:')) {
                throw new Error(`CORS受限: 必盈API需要从服务器代理调用`);
            }
            throw error;
        }
    }
    
    // 获取A股股票名称
    async function getBiyingAStockName(code) {
        const config = getConfig();
        if (!config.biyingKey) {
            throw new Error('未配置必盈API Licence');
        }
        
        // 必盈API格式: https://api.biyingapi.com/hsstock/instrument/股票代码.SZ/licence
        const market = code.startsWith('6') ? 'SH' : 'SZ';
        const url = `${API_BASE.biying}/hsstock/instrument/${code}.${market}/${config.biyingKey}`;
        
        try {
            const data = await fetchWithCORS(url);
            return {
                name: data.name || code,
                code: code,
                market: market
            };
        } catch (error) {
            console.warn('获取股票名称失败:', error);
            return { name: code, code: code };
        }
    }
    
    // ==================== Yahoo Finance API (港股) ====================
    
    // 获取港股行情 (Yahoo Finance)
    async function getYahooQuote(symbol) {
        // Yahoo Finance格式: 港股加.HK后缀，如0700.HK
        const yahooSymbol = symbol.includes('.') ? symbol : `${symbol}.HK`;
        const url = `${API_BASE.yahoo}/chart/${yahooSymbol}?interval=1d&range=1d`;
        
        try {
            const data = await fetchWithCORS(url);
            const result = data.chart?.result?.[0];
            if (!result) {
                throw new Error('未找到该股票数据');
            }
            
            const meta = result.meta;
            const quote = result.indicators?.quote?.[0];
            const timestamp = result.timestamp?.[result.timestamp.length - 1] * 1000;
            
            return {
                price: meta.regularMarketPrice,
                change: meta.regularMarketPrice - meta.previousClose,
                changePercent: ((meta.regularMarketPrice - meta.previousClose) / meta.previousClose * 100),
                high: meta.regularMarketDayHigh,
                low: meta.regularMarketDayLow,
                open: meta.regularMarketDayOpen,
                previousClose: meta.previousClose,
                volume: quote?.volume?.[quote.volume.length - 1],
                timestamp: timestamp
            };
        } catch (error) {
            if (error.message.startsWith('CORS_ERROR:')) {
                throw new Error(`CORS受限: Yahoo Finance API需要从服务器代理调用，或考虑使用其他数据源`);
            }
            throw error;
        }
    }
    
    // ==================== 天天基金网API (基金) ====================
    
    // 获取基金净值 (天天基金网)
    async function getTiandianFundNav(code) {
        const url = `${API_BASE.tiantianFund}/${code}.js?rt=${Date.now()}`;
        
        try {
            // 天天基金网返回的是JSONP格式，需要解析
            const response = await fetch(url, { mode: 'cors' });
            const text = await response.text();
            
            // 解析JSONP: jsonpgz({"fundcode":"110022",...});
            const match = text.match(/jsonpgz\((.*)\)/);
            if (!match) {
                throw new Error('解析基金数据失败');
            }
            
            const data = JSON.parse(match[1]);
            return {
                code: data.fundcode,
                name: data.name,
                nav: parseFloat(data.dwjz),  // 单位净值
                estimateNav: parseFloat(data.gsz),  // 估算净值
                estimateTime: data.gztime,
                changePercent: parseFloat(data.gszzl),  // 估算涨跌幅
                timestamp: new Date(data.gztime).getTime()
            };
        } catch (error) {
            console.warn('获取基金净值失败:', error);
            // 如果CORS失败，尝试不使用CORS模式
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
                return await getYahooQuote(code);
            case 'fund':
                return await getTiandianFundNav(code);
            default:
                throw new Error(`不支持的资产类型: ${type}`);
        }
    }
    
    // 根据资产类型获取名称
    async function getName(type, code) {
        // 演示模式：返回模拟名称
        const config = getConfig();
        if (config.demoMode) {
            return getDemoName(type, code);
        }
        
        switch (type) {
            case 'us-stock':
                const profile = await getFinnhubCompanyProfile(code);
                return profile.name || code;
            case 'a-stock':
                const stockInfo = await getBiyingAStockName(code);
                return stockInfo.name || code;
            case 'hk-stock':
                // Yahoo Finance不提供名称查询，返回代码
                return code;
            case 'fund':
                const fundInfo = await getTiandianFundNav(code);
                return fundInfo.name || code;
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
                    price: quote.price || quote.estimateNav,
                    change: quote.change,
                    changePercent: quote.changePercent,
                    updateTime: quote.timestamp || Date.now()
                });
                
                // 添加延迟避免API限流
                await sleep(100);
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
    
    // 模拟数据：股票/基金名称映射
    const DEMO_NAMES = {
        'AAPL': 'Apple Inc.',
        'TSLA': 'Tesla, Inc.',
        'MSFT': 'Microsoft Corporation',
        'GOOGL': 'Alphabet Inc.',
        'AMZN': 'Amazon.com, Inc.',
        '000001': '平安银行',
        '000002': '万科A',
        '600000': '浦发银行',
        '600036': '招商银行',
        '600519': '贵州茅台',
        '0700': '腾讯控股',
        '9988': '阿里巴巴-SW',
        '0388': '香港交易所',
        '0939': '建设银行',
        '1299': '友邦保险',
        '110022': '易方达消费行业',
        '110023': '易方达医疗行业',
        '160119': '南方中证500ETF',
        '161725': '招商中证白酒',
        '163406': '兴全合润'
    };
    
    // 模拟数据：股票/基金基础价格
    const DEMO_BASE_PRICES = {
        'AAPL': 150.0,
        'TSLA': 200.0,
        'MSFT': 300.0,
        'GOOGL': 130.0,
        'AMZN': 120.0,
        '000001': 12.0,
        '000002': 8.0,
        '600000': 7.0,
        '600036': 35.0,
        '600519': 1600.0,
        '0700': 320.0,
        '9988': 80.0,
        '0388': 300.0,
        '0939': 5.0,
        '1299': 70.0,
        '110022': 4.5,
        '110023': 2.8,
        '160119': 7.2,
        '161725': 1.2,
        '163406': 1.5
    };
    
    // 获取演示模式的行情数据
    function getDemoQuote(type, code) {
        const basePrice = DEMO_BASE_PRICES[code] || (type === 'fund' ? 1.0 : 50.0);
        const changePercent = (Math.random() - 0.5) * 4; // -2% ~ +2%
        const change = basePrice * changePercent / 100;
        const price = basePrice + change;
        
        return {
            price: type === 'fund' ? basePrice : price,
            change: type === 'fund' ? change : change,
            changePercent: type === 'fund' ? (Math.random() - 0.5) * 2 : changePercent,
            high: price * 1.01,
            low: price * 0.99,
            open: basePrice,
            previousClose: basePrice,
            volume: Math.floor(Math.random() * 1000000),
            timestamp: Date.now(),
            // 基金特有字段
            estimateNav: type === 'fund' ? price : undefined,
            nav: type === 'fund' ? basePrice : undefined
        };
    }
    
    // 获取演示模式的名称
    function getDemoName(type, code) {
        return DEMO_NAMES[code] || `${code} (演示)`;
    }
    
    // 公开API
    return {
        getFinnhubQuote,
        getFinnhubCompanyProfile,
        getBiyingAStockQuote,
        getBiyingAStockName,
        getYahooQuote,
        getTiandianFundNav,
        getQuote,
        getName,
        updateAllPrices
    };
})();
