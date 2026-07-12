/**
 * UI渲染模块
 * 负责渲染各种UI组件
 */

const UIManager = (function() {
    // 资产类型映射
    const TYPE_MAP = {
        'a-stock': { name: 'A股', badge: 'A股', class: 'badge-a-stock' },
        'hk-stock': { name: '港股', badge: '港股', class: 'badge-hk-stock' },
        'us-stock': { name: '美股', badge: '美股', class: 'badge-us-stock' },
        'fund': { name: '基金', badge: '基金', class: 'badge-fund' }
    };
    
    // 格式化货币（支持多币种，去除尾部无意义0）
    function formatCurrency(amount, currency = 'CNY', maxDec = 2) {
        if (amount === null || amount === undefined) return '--';
        const fixed = parseFloat(amount.toFixed(maxDec));
        const symbol = APIManager.getCurrencySymbol(currency);
        try {
            const locale = currency === 'USD' ? 'en-US' : 'zh-CN';
            return new Intl.NumberFormat(locale, {
                style: 'currency', currency: currency === 'HKD' ? 'HKD' : currency,
                minimumFractionDigits: 0, maximumFractionDigits: maxDec
            }).format(fixed).replace('CN¥', '¥');
        } catch(e) { return `${symbol}${fixed}`; }
    }
    
    function formatNumber(n, maxDec = 4) {
        if (n === null || n === undefined) return '--';
        return parseFloat(parseFloat(n).toFixed(maxDec)).toString();
    }
    
    // 格式化金额（原币 + 人民币）
    function formatPriceWithCNY(amount, currency, maxDec = 2) {
        if (amount === null || amount === undefined) return '--';
        const local = formatCurrency(amount, currency, maxDec);
        const cny = APIManager.toCNY(amount, currency);
        if (currency === 'CNY') return local;
        return `${local} <small style="color:#94a3b8">(≈${formatCurrency(cny, 'CNY', 0)})</small>`;
    }
    
    // 当日盈亏计算（处理各市场非交易日/非交易时段）
    function getDailyPnL(asset) {
        const change = asset.change || 0;
        const amount = change * asset.shares;
        const prevPrice = asset.previousClose;
        const rate = prevPrice && prevPrice > 0 ? (change / prevPrice * 100) : 0;
        
        const bj = new Date();
        const day = bj.getDay(); // 0=周日 1=周一 ... 6=周六
        const hour = bj.getHours();
        const min = bj.getMinutes();
        
        if (asset.type === 'us-stock') {
            if (day === 0) return { amount: 0, rate: 0, label: '周日休市' };
            if (day === 6) return { amount, rate, label: '周五收盘' };
            if (day === 1 && (hour < 21 || (hour === 21 && min < 30))) return { amount: 0, rate: 0, label: '开盘前' };
            return { amount, rate, label: '' };
        }
        
        // A股/港股/基金：周末休市
        if (day === 0 || day === 6) return { amount: 0, rate: 0, label: '周末休市' };
        // A股/港股/基金：交易日9:30前显示0
        if (hour < 9 || (hour === 9 && min < 30)) return { amount: 0, rate: 0, label: '开盘前' };
        
        return { amount, rate, label: '' };
    }
    
    // 创建空状态元素
    function createEmptyState() {
        const div = document.createElement('div');
        div.className = 'empty-state';
        div.id = 'empty-state';
        div.innerHTML = '<i class="fas fa-inbox"></i><p>暂无资产</p>';
        return div;
    }
    
    // 格式化百分比
    function formatPercent(percent) {
        if (percent === null || percent === undefined) return '--';
        const sign = percent >= 0 ? '+' : '';
        return `${sign}${percent.toFixed(2)}%`;
    }
    
    // 格式化日期
    function formatDate(timestamp) {
        if (!timestamp) return '--';
        const date = new Date(timestamp);
        return date.toLocaleString('zh-CN', {
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
    }
    
    // 渲染总览数据（全部换算为人民币，含现金）
    function renderOverview(assets) {
        let totalAssets = 0, totalCost = 0, totalProfit = 0, todayPnL = 0;
        
        assets.forEach(asset => {
            const currency = asset.currency || APIManager.getAssetCurrency(asset.type);
            const currentValue = (asset.currentPrice || 0) * asset.shares;
            const costValue = asset.cost * asset.shares;
            totalAssets += APIManager.toCNY(currentValue, currency);
            totalCost += APIManager.toCNY(costValue, currency);
            totalProfit += APIManager.toCNY(currentValue - costValue, currency);
            // 当日收益
            const daily = getDailyPnL(asset);
            todayPnL += APIManager.toCNY(daily.amount, currency);
        });
        
        // 计入现金余额
        const cash = StorageManager.getCashBalance();
        const cashCNY = APIManager.toCNY(cash.CNY, 'CNY') + APIManager.toCNY(cash.HKD, 'HKD') + APIManager.toCNY(cash.USD, 'USD');
        totalAssets += cashCNY;
        // 总盈亏不含现金（现金算成本=现金额）
        totalProfit += cashCNY;
        totalCost += cashCNY;
        
        const totalReturn = totalCost > 0 ? (totalProfit / totalCost * 100) : 0;
        const prevAssets = totalAssets - todayPnL;
        const todayReturn = prevAssets > 0 ? (todayPnL / prevAssets * 100) : 0;
        
        document.getElementById('total-assets').textContent = formatCurrency(totalAssets, 'CNY');
        document.getElementById('total-count').textContent = assets.length;
        document.getElementById('today-pnl').textContent = formatCurrency(todayPnL, 'CNY');
        document.getElementById('today-pnl').className = `card-value ${todayPnL >= 0 ? 'positive' : 'negative'}`;
        document.getElementById('today-return').textContent = formatPercent(todayReturn);
        document.getElementById('today-return').className = `card-value ${todayReturn >= 0 ? 'positive' : 'negative'}`;
        document.getElementById('total-profit').textContent = formatCurrency(totalProfit, 'CNY');
        document.getElementById('total-profit').className = `card-value ${totalProfit >= 0 ? 'positive' : 'negative'}`;
        document.getElementById('total-return').textContent = formatPercent(totalReturn);
        document.getElementById('total-return').className = `card-value ${totalReturn >= 0 ? 'positive' : 'negative'}`;
        
        // 渲染可用现金卡片
        document.getElementById('cash-balance').textContent = formatCurrency(cashCNY, 'CNY');
    }
    
    // 渲染资产列表
    function renderAssetsList(assets, filterType = 'all') {
        const container = document.getElementById('assets-list');
        let emptyState = document.getElementById('empty-state');
        
        // 重新创建被 innerHTML 销毁的 emptyState
        if (!emptyState) {
            emptyState = createEmptyState();
        }
        
        // 过滤资产
        const filteredAssets = filterType === 'all' 
            ? assets 
            : assets.filter(a => a.type === filterType);
        
        if (filteredAssets.length === 0) {
            container.innerHTML = '';
            emptyState.style.display = 'block';
            container.appendChild(emptyState);
            return;
        }
        
        // 市场汇总（筛选时显示）
        let summaryHTML = '';
        if (filterType !== 'all') {
            const totalValue = filteredAssets.reduce((s, a) => s + (a.currentPrice || 0) * a.shares, 0);
            const dailyPnl = filteredAssets.reduce((s, a) => s + getDailyPnL(a).amount, 0);
            const currency = filteredAssets[0] ? (filteredAssets[0].currency || APIManager.getAssetCurrency(filteredAssets[0].type)) : 'CNY';
            const typeLabel = TYPE_MAP[filterType]?.name || filterType;
            summaryHTML = `<div class="market-summary">
                <span class="market-summary-label">${typeLabel} · ${filteredAssets.length}个</span>
                <span>市值 ${formatPriceWithCNY(totalValue, currency, 2)}</span>
                <span class="${dailyPnl >= 0 ? 'positive' : 'negative'}">当日 ${dailyPnl >= 0 ? '+' : ''}${formatPriceWithCNY(dailyPnl, currency, 2)}</span>
            </div>`;
        }
        
        // 构建资产卡片
        const cardsHTML = filteredAssets.map(asset => {
            const typeInfo = TYPE_MAP[asset.type] || { name: '未知', badge: '?', class: '' };
            const currency = asset.currency || APIManager.getAssetCurrency(asset.type);
            const currentValue = (asset.currentPrice || 0) * asset.shares;
            const costValue = asset.cost * asset.shares;
            const profit = currentValue - costValue;
            const profitPercent = costValue > 0 ? (profit / costValue * 100) : 0;
            const cat = asset.category || '未分类';
            const platform = asset.platform || '';
            const navDate = asset.type === 'fund' && asset.navDate ? ` (${asset.navDate.slice(5)})` : '';
            const daily = getDailyPnL(asset);
            const dailyClass = daily.amount >= 0 ? 'positive' : 'negative';
            const priceClass = (asset.currentPrice || 0) >= asset.cost ? 'positive' : 'negative';
            const dec = 4;
            
            return `
                <div class="asset-card" data-id="${asset.id}">
                    <div class="asset-card-header">
                        <div class="asset-info">
                            <div class="asset-code">
                                ${asset.code}
                                <span class="asset-type-badge ${typeInfo.class}">${typeInfo.badge}</span>
                                <span class="category-tag">${cat}</span>
                                ${platform ? `<span class="platform-tag">${platform}</span>` : ''}
                            </div>
                            <div class="asset-name">${asset.name || '未知'}</div>
                        </div>
                        <div class="asset-actions">
                            <button class="asset-action-btn" onclick="App.editAsset('${asset.id}')" title="编辑">
                                <i class="fas fa-edit"></i>
                            </button>
                            <button class="asset-action-btn" onclick="App.deleteAsset('${asset.id}')" title="删除">
                                <i class="fas fa-trash"></i>
                            </button>
                        </div>
                    </div>
                    <div class="asset-data">
                        <div class="data-item">
                            <span class="data-label">成本价</span>
                            <span class="data-value">${formatPriceWithCNY(asset.cost, currency, dec)}</span>
                        </div>
                        <div class="data-item">
                            <span class="data-label">当前价</span>
                            <span class="data-value ${priceClass}">${formatPriceWithCNY(asset.currentPrice, currency, dec)}${navDate}</span>
                        </div>
                        <div class="data-item">
                            <span class="data-label">当日收益${daily.label ? '('+daily.label+')' : ''}</span>
                            <span class="data-value ${dailyClass}">${formatPriceWithCNY(daily.amount, currency, dec)}</span>
                        </div>
                        <div class="data-item">
                            <span class="data-label">当日收益率</span>
                            <span class="data-value ${dailyClass}">${formatPercent(daily.rate)}</span>
                        </div>
                        <div class="data-item">
                            <span class="data-label">持有量</span>
                            <span class="data-value">${formatNumber(asset.shares, 4)}</span>
                        </div>
                        <div class="data-item">
                            <span class="data-label">市值</span>
                            <span class="data-value">${formatPriceWithCNY(currentValue, currency, dec)}</span>
                        </div>
                        <div class="data-item">
                            <span class="data-label">累计盈亏</span>
                            <span class="data-value ${profit >= 0 ? 'positive' : 'negative'}">${formatPriceWithCNY(profit, currency, dec)}</span>
                        </div>
                        <div class="data-item">
                            <span class="data-label">累计收益率</span>
                            <span class="data-value ${profitPercent >= 0 ? 'positive' : 'negative'}">${formatPercent(profitPercent)}</span>
                        </div>
                    </div>
                    <div class="asset-footer">
                        <span>更新: ${formatDate(asset.lastUpdateTime)}</span>
                        <div class="asset-footer-actions">
                            <button class="btn btn-sm btn-success" onclick="App.recordDividend('${asset.id}')" title="记录分红">
                                <i class="fas fa-gift"></i> 分红
                            </button>
                            <button class="btn btn-sm btn-info" onclick="App.refreshAsset('${asset.id}')">
                                <i class="fas fa-sync-alt"></i> 刷新
                            </button>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
        
        container.innerHTML = summaryHTML + cardsHTML;
    }
    
    // 渲染标签页
    function renderTabs(activeTab = 'all') {
        const tabs = document.querySelectorAll('.tab');
        tabs.forEach(tab => {
            if (tab.dataset.tab === activeTab) {
                tab.classList.add('active');
            } else {
                tab.classList.remove('active');
            }
        });
    }
    
    // 显示加载动画
    function showLoading(message = '正在加载数据...') {
        const overlay = document.getElementById('loading-overlay');
        if (!overlay) return;
        const p = overlay.querySelector('p');
        if (p) p.textContent = message;
        overlay.style.display = 'flex';
    }
    
    // 隐藏加载动画
    function hideLoading() {
        const overlay = document.getElementById('loading-overlay');
        if (!overlay) return;
        overlay.style.display = 'none';
    }
    
    // 显示提示消息
    function showToast(message, type = 'info') {
        // 创建toast元素
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.innerHTML = `
            <i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : 'info-circle'}"></i>
            <span>${message}</span>
        `;
        
        // 添加样式
        toast.style.cssText = `
            position: fixed;
            top: 80px;
            right: 20px;
            background: ${type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#2563eb'};
            color: white;
            padding: 12px 20px;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            display: flex;
            align-items: center;
            gap: 8px;
            z-index: 3000;
            animation: slideIn 0.3s ease-out;
            max-width: 400px;
        `;
        
        document.body.appendChild(toast);
        
        // 3秒后移除
        setTimeout(() => {
            toast.style.animation = 'slideOut 0.3s ease-out';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }
    
    // 更新最后更新时间
    function updateLastUpdateTime() {
        const now = new Date();
        const timeStr = now.toLocaleString('zh-CN');
        const rates = APIManager.getExchangeRates();
        const rateStr = `USD/CNY ${rates.USD_CNY.toFixed(2)} | HKD/CNY ${rates.HKD_CNY.toFixed(2)}`;
        document.getElementById('last-update').innerHTML = `${timeStr} · ${rateStr}`;
    }
    
    // 饼图实例（用于销毁重绘）
    let assetTypeChart = null;
    let marketChart = null;
    let historyChart = null;
    
    // 渲染净值走势折线图
    async function renderIndicators() {
        const section = document.getElementById('indicators-section');
        if (!section) return;
        
        const data = await APIManager.fetchIndicators();
        if (!data) return;
        
        const setCard = (id, datum) => {
            const elVal = document.getElementById(id + '-value');
            const elChg = document.getElementById(id + '-change');
            if (!elVal) return;
            
            if (datum && datum.value != null) {
                const lbl = datum.label || '';
                const num = datum.displayValue != null ? datum.displayValue : datum.value;
                let text = num.toFixed(2) + lbl;
                if (datum.level) text += ' · ' + datum.level;
                elVal.textContent = text;
                
                if (elChg && datum.changePercent != null) {
                    const sign = datum.changePercent >= 0 ? '+' : '';
                    const cls = datum.changePercent >= 0 ? 'up' : 'down';
                    elChg.textContent = `${sign}${datum.changePercent.toFixed(2)}%`;
                    elChg.className = `indicator-change ${cls}`;
                }
            }
        };
        
        setCard('ind-vix', data.vix);
        
        // XXFI: 自定义渲染（值 + 信号徽章）
        {
            const elVal = document.getElementById('ind-xxfi-value');
            const elSig = document.getElementById('ind-xxfi-signal');
            const d = data.xxfi;
            if (d && d.value != null) {
                elVal.textContent = `XXFI = ${d.value.toFixed(1)}`;
                // 信号颜色映射
                const signalMap = {
                    'BUY':         { text: '🔴 BUY · 分批低吸', cls: 'signal-buy' },
                    'ACCUMULATE':  { text: '🟠 ACCUMULATE · 逢低吸纳', cls: 'signal-accumulate' },
                    'HOLD':        { text: '⚫ HOLD · 按策略持有', cls: 'signal-hold' },
                    'REDUCE':      { text: '🟡 REDUCE · 逢高减仓', cls: 'signal-reduce' },
                    'SELL':        { text: '🟢 SELL · 减仓避险', cls: 'signal-sell' }
                };
                const sig = signalMap[d.signal] || { text: d.signal, cls: '' };
                elSig.textContent = sig.text;
                elSig.className = `indicator-change ${sig.cls}`;
            } else {
                elVal.textContent = '--';
                elSig.textContent = '';
                elSig.className = 'indicator-change';
            }
        }
        
        // 银行五维: 自定义渲染（6行得分全量+信号摘要）
        {
            const elVal = document.getElementById('ind-bank-value');
            const elTop = document.getElementById('ind-bank-top');
            const elDate = document.getElementById('ind-bank-date');
            const d = data.cmbFiveDim;
            if (d && d.banks && d.banks.length) {
                elVal.textContent = `${d.buys}/${d.count}行 BUY`;
                elVal.className = d.buys >= d.count ? 'indicator-value positive' : 'indicator-value';
                elTop.textContent = d.banks.map(b => `${b.name}${b.score.toFixed(1)}`).join(' · ');
                elTop.className = 'indicator-change';
                elDate.textContent = `数据: ${d.dataDate}`;
            } else {
                elVal.textContent = '--';
                elTop.textContent = '';
                elDate.textContent = '';
            }
        }
        
        // 秋哥操作: 自定义渲染（大盘点位+关键位+操作指引+推荐标的）
        {
            const elVal = document.getElementById('ind-qiuge-value');
            const elLv = document.getElementById('ind-qiuge-levels');
            const elGuide = document.getElementById('ind-qiuge-guide');
            const elPicks = document.getElementById('ind-qiuge-picks');
            const elDate = document.getElementById('ind-qiuge-date');
            const d = data.qiuge;
            if (d && d.indexClose != null) {
                const pct = d.indexChange != null ? d.indexChange : 0;
                const sign = pct >= 0 ? '+' : '';
                elVal.textContent = `${d.indexName} ${d.indexClose.toFixed(2)}(${sign}${pct.toFixed(2)}%)`;
                elLv.textContent = `${d.support}生命线 · ${d.pressure}压力`;
                
                // 按当前点位动态显示操作指引
                let guideHtml = '';
                const close = d.indexClose;
                if (close > d.pressure) {
                    guideHtml = '<span class="positive">🟢 &gt;' + d.pressure + ' 加至7成</span> · <span class="up">📈 反弹升级</span>';
                } else if (close >= d.support) {
                    guideHtml = '<span style="color:#d97706">🟡 仓位≤' + (d.positionMax * 100) + '成</span> · ' +
                                '<span style="color:#d97706">⚠️ 跌破' + d.support + '则降仓</span>';
                } else {
                    guideHtml = '<span class="negative">🔴 有效跌破' + d.support + '</span> · ' +
                                '<span class="negative">🏠 全面降仓留招行</span>';
                }
                elGuide.innerHTML = guideHtml;
                elGuide.className = 'indicator-change';
                
                // 推荐标的（紧凑展示）
                const picks = d.picks.join(' · ');
                const watchStr = d.watch.length ? ` · ${d.watch.join('·')}(等)` : '';
                elPicks.textContent = picks + watchStr;
                
                elDate.textContent = `${d.dataDate} · ${d.outlook}`;
            } else {
                elVal.textContent = '--';
                elLv.textContent = '';
                elGuide.textContent = '';
                elPicks.textContent = '';
                elDate.textContent = '';
            }
        }
        
        setCard('ind-sp500', data.sp500Pe);
        setCard('ind-csi300', data.csi300Pe);
        setCard('ind-star50', data.star50);
        setCard('ind-dividend', data.dividend);
    }
    
    function renderHistoryChart() {
        const section = document.getElementById('history-section');
        const history = StorageManager.getHistory();
        if (history.length < 2) {
            if (section) section.style.display = 'none';
            return;
        }
        if (section) section.style.display = 'block';
        
        const canvas = document.getElementById('chart-history');
        if (!canvas) return;
        if (historyChart) historyChart.destroy();
        
        const ctx = canvas.getContext('2d');
        historyChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: history.map(h => h.date.slice(5)), // MM-DD
                datasets: [{
                    label: '总资产 (¥)',
                    data: history.map(h => h.value),
                    borderColor: '#2563eb',
                    backgroundColor: 'rgba(37,99,235,0.05)',
                    fill: true,
                    borderWidth: 2,
                    pointRadius: 2,
                    pointHoverRadius: 5,
                    tension: 0.3
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: { duration: 400 },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: ctx => ` ¥${ctx.parsed.y.toLocaleString('zh-CN')}`
                        }
                    }
                },
                scales: {
                    x: { grid: { display: false }, ticks: { maxTicksLimit: 12, font: { size: 11 } } },
                    y: { grid: { color: '#f1f5f9' }, ticks: { font: { size: 11 }, callback: v => '¥' + (v/10000).toFixed(1) + '万' } }
                }
            }
        });
    }
    function renderCharts(assets) {
        if (assets.length === 0) {
            destroyCharts();
            return;
        }
        
        // 计算各市场市值（人民币）
        const marketDataCNY = { 'A股': 0, '港股': 0, '美股': 0, '基金': 0 };
        const categoryDataCNY = {};
        
        assets.forEach(a => {
            const currency = a.currency || APIManager.getAssetCurrency(a.type);
            const value = (a.currentPrice || 0) * a.shares;
            const valueCNY = APIManager.toCNY(value, currency);
            
            // 按市场分类
            if (a.type === 'a-stock') marketDataCNY['A股'] += valueCNY;
            else if (a.type === 'hk-stock') marketDataCNY['港股'] += valueCNY;
            else if (a.type === 'us-stock') marketDataCNY['美股'] += valueCNY;
            else if (a.type === 'fund') marketDataCNY['基金'] += valueCNY;
            
            // 按品种分类
            const cat = a.category || '未分类';
            categoryDataCNY[cat] = (categoryDataCNY[cat] || 0) + valueCNY;
        });
        
        // 计入现金
        const cash = StorageManager.getCashBalance();
        const cashCNY = APIManager.toCNY(cash.CNY, 'CNY') + APIManager.toCNY(cash.HKD, 'HKD') + APIManager.toCNY(cash.USD, 'USD');
        if (cashCNY > 0) {
            marketDataCNY['现金'] = cashCNY;
            categoryDataCNY['现金'] = (categoryDataCNY['现金'] || 0) + cashCNY;
        }
        
        const marketColors = ['#dc2626', '#f59e0b', '#2563eb', '#8b5cf6', '#10b981'];
        const catColors = ['#2563eb', '#f59e0b', '#10b981', '#8b5cf6', '#ef4444', '#ec4899', '#14b8a6', '#f97316', '#84cc16'];
        
        // 图1：市场分布（人民币市值）
        renderPieChart('chart-asset-type', {
            labels: ['A股', '港股', '美股', '基金', '现金'],
            values: [marketDataCNY['A股'], marketDataCNY['港股'], marketDataCNY['美股'], marketDataCNY['基金'], marketDataCNY['现金']],
            colors: marketColors
        }, 'assetTypeChart');
        
        // 图2：品种分布（人民币市值）
        const catEntries = Object.entries(categoryDataCNY)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 8);
        renderPieChart('chart-market', {
            labels: catEntries.map(e => e[0]),
            values: catEntries.map(e => e[1]),
            colors: catColors.slice(0, catEntries.length)
        }, 'marketChart');
    }
    
    // 销毁所有图表
    function destroyCharts() {
        if (assetTypeChart) { assetTypeChart.destroy(); assetTypeChart = null; }
        if (marketChart) { marketChart.destroy(); marketChart = null; }
    }
    
    function renderPieChart(canvasId, data, chartVar) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;
        
        // 过滤掉值为0的数据
        const filtered = data.labels.map((label, i) => ({
            label, value: data.values[i], color: data.colors[i]
        })).filter(item => item.value > 0);
        
        if (filtered.length === 0) {
            // 无数据时清理
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            return;
        }
        
        // 销毁旧图表
        if (chartVar === 'assetTypeChart' && assetTypeChart) assetTypeChart.destroy();
        if (chartVar === 'marketChart' && marketChart) marketChart.destroy();
        
        const ctx = canvas.getContext('2d');
        const total = filtered.reduce((sum, item) => sum + item.value, 0);
        
        const newChart = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: filtered.map(item => item.label),
                datasets: [{
                    data: filtered.map(item => item.value),
                    backgroundColor: filtered.map(item => item.color),
                    borderColor: '#ffffff',
                    borderWidth: 3,
                    hoverBorderWidth: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                animation: { duration: 400 },
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: {
                            usePointStyle: false,
                            boxWidth: 4,
                            padding: 16,
                            font: { size: 12 },
                            generateLabels: function(chart) {
                                const data = chart.data;
                                return data.labels.map((label, i) => ({
                                    text: `${label}  ${(data.datasets[0].data[i] / total * 100).toFixed(1)}%`,
                                    fillStyle: data.datasets[0].backgroundColor[i],
                                    strokeStyle: data.datasets[0].backgroundColor[i],
                                    lineWidth: 0,
                                    hidden: false,
                                    index: i,
                                    pointStyle: 'circle'
                                }));
                            }
                        }
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                const value = context.parsed;
                                const pct = (value / total * 100).toFixed(1);
                                return ` ${context.label}: ¥${value.toLocaleString('zh-CN', {minimumFractionDigits: 2})} (${pct}%)`;
                            }
                        }
                    }
                }
            }
        });
        
        if (chartVar === 'assetTypeChart') assetTypeChart = newChart;
        if (chartVar === 'marketChart') marketChart = newChart;
    }
    
    // 公开API
    return {
        TYPE_MAP,
        formatCurrency,
        formatPercent,
        formatDate,
        renderOverview,
        renderAssetsList,
        renderCharts,
        renderIndicators,
        renderTabs,
        showLoading,
        hideLoading,
        showToast,
        updateLastUpdateTime,
        renderDividendAlert,
        renderDividendList,
        showCashEditModal
    };
    
    // ==================== 分红相关渲染 ====================
    
    // 渲染分红检测通知横幅
    function renderDividendAlert(newDividends) {
        const alert = document.getElementById('dividend-alert');
        if (!alert) return;
        if (!newDividends || !newDividends.length) {
            alert.style.display = 'none';
            return;
        }
        const names = [...new Set(newDividends.map(d => d.name))].join('、');
        const unit = newDividends[0].type === 'fund' ? '份' : '股';
        document.getElementById('dividend-alert-text').textContent = 
            `检测到 ${names} 有未记录的分红（每${unit} ${newDividends[0].perShare.toFixed(4)} 元）`;
        alert.style.display = 'block';
    }
    
    // 渲染分红记录列表
    function renderDividendList() {
        const records = StorageManager.getDividendRecords();
        const container = document.getElementById('dividend-records-list');
        if (!container) return;
        
        // 汇总
        let totalCNY = 0, reinvestedCNY = 0, pendingCNY = 0;
        records.forEach(r => {
            const cny = APIManager.toCNY(r.netAmount || r.totalAmount, r.currency || 'CNY');
            totalCNY += cny;
            if (r.reinvest) {
                reinvestedCNY += cny;
            } else {
                pendingCNY += cny;
            }
        });
        document.getElementById('sum-total').textContent = formatCurrency(totalCNY, 'CNY');
        document.getElementById('sum-reinvested').textContent = formatCurrency(reinvestedCNY, 'CNY');
        document.getElementById('sum-pending').textContent = formatCurrency(pendingCNY, 'CNY');
        
        if (!records.length) {
            container.innerHTML = '<div class="empty-state"><p>暂无分红记录</p></div>';
            return;
        }
        
        container.innerHTML = records.map(r => {
            const cny = APIManager.toCNY(r.netAmount || r.totalAmount, r.currency || 'CNY');
            const symbol = APIManager.getCurrencySymbol(r.currency);
            const isFund = r.navAfter != null;
            const unit = isFund ? '份' : '股';
            const reinvestInfo = r.reinvest 
                ? `<span class="badge-reinvested">已复投 ${r.reinvest.shares}${unit} @${symbol}${formatNumber(r.reinvest.price, 2)}</span>`
                : `<span class="badge-pending">待复投</span>`;
            return `
            <div class="dividend-record-card">
                <div class="dividend-record-header">
                    <strong>${r.assetName} (${r.assetCode})</strong>
                    <span class="dividend-record-date">${r.exDate || r.createDate}</span>
                </div>
                <div class="dividend-record-body">
                    <span>每${unit} ${symbol}${formatNumber(r.perShare, 4)} × ${r.shares}${unit}</span>
                    <span>税后到账 ${formatCurrency(r.netAmount, r.currency)} (≈${formatCurrency(cny, 'CNY')})</span>
                    ${reinvestInfo}
                    ${r.reportPeriod ? `<small>报告期: ${r.reportPeriod.slice(0,7)}</small>` : ''}
                </div>
                <div class="dividend-record-actions">
                    ${!r.reinvest ? `<button class="btn btn-sm btn-success" onclick="App.reinvestDividend('${r.id}')">💰 复投</button>` : ''}
                    <button class="btn btn-sm btn-danger" onclick="App.deleteDividend('${r.id}')">🗑️</button>
                </div>
            </div>`;
        }).reverse().join('');
    }
    
    // 显示现金编辑模态框
    function showCashEditModal() {
        const cash = StorageManager.getCashBalance();
        document.getElementById('edit-cny').value = cash.CNY || 0;
        document.getElementById('edit-hkd').value = cash.HKD || 0;
        document.getElementById('edit-usd').value = cash.USD || 0;
        updateCashEditPreview();
        document.getElementById('modal-cash-edit').classList.add('active');
    }
    
    function updateCashEditPreview() {
        const cny = parseFloat(document.getElementById('edit-cny').value) || 0;
        const hkd = parseFloat(document.getElementById('edit-hkd').value) || 0;
        const usd = parseFloat(document.getElementById('edit-usd').value) || 0;
        const total = cny + APIManager.toCNY(hkd, 'HKD') + APIManager.toCNY(usd, 'USD');
        document.getElementById('edit-cash-cny').textContent = formatCurrency(total, 'CNY');
    }
})();

// 添加Toast动画样式
const toastStyle = document.createElement('style');
toastStyle.textContent = `
    @keyframes slideIn {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
    }
    @keyframes slideOut {
        from { transform: translateX(0); opacity: 1; }
        to { transform: translateX(100%); opacity: 0; }
    }
`;
document.head.appendChild(toastStyle);
