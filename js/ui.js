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
    
    // 格式化货币
    function formatCurrency(amount, decimals = 2) {
        if (amount === null || amount === undefined) return '--';
        return new Intl.NumberFormat('zh-CN', {
            style: 'currency',
            currency: 'CNY',
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals
        }).format(amount);
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
    
    // 渲染总览数据
    function renderOverview(assets) {
        let totalAssets = 0;
        let totalCost = 0;
        let totalProfit = 0;
        
        assets.forEach(asset => {
            const currentValue = (asset.currentPrice || 0) * asset.shares;
            const costValue = asset.cost * asset.shares;
            totalAssets += currentValue;
            totalCost += costValue;
            totalProfit += (currentValue - costValue);
        });
        
        const totalReturn = totalCost > 0 ? (totalProfit / totalCost * 100) : 0;
        
        document.getElementById('total-assets').textContent = formatCurrency(totalAssets);
        document.getElementById('total-profit').textContent = formatCurrency(totalProfit);
        document.getElementById('total-profit').className = `card-value ${totalProfit >= 0 ? 'positive' : 'negative'}`;
        document.getElementById('total-return').textContent = formatPercent(totalReturn);
        document.getElementById('total-return').className = `card-value ${totalReturn >= 0 ? 'positive' : 'negative'}`;
        document.getElementById('total-count').textContent = assets.length;
    }
    
    // 渲染资产列表
    function renderAssetsList(assets, filterType = 'all') {
        const container = document.getElementById('assets-list');
        const emptyState = document.getElementById('empty-state');
        
        // 过滤资产
        const filteredAssets = filterType === 'all' 
            ? assets 
            : assets.filter(a => a.type === filterType);
        
        if (filteredAssets.length === 0) {
            container.innerHTML = '';
            container.appendChild(emptyState);
            emptyState.style.display = 'block';
            return;
        }
        
        emptyState.style.display = 'none';
        
        // 生成资产卡片HTML
        const cardsHTML = filteredAssets.map(asset => {
            const typeInfo = TYPE_MAP[asset.type] || { name: '未知', badge: '?', class: '' };
            const currentValue = (asset.currentPrice || 0) * asset.shares;
            const costValue = asset.cost * asset.shares;
            const profit = currentValue - costValue;
            const profitPercent = costValue > 0 ? (profit / costValue * 100) : 0;
            
            return `
                <div class="asset-card" data-id="${asset.id}">
                    <div class="asset-card-header">
                        <div class="asset-info">
                            <div class="asset-code">
                                ${asset.code}
                                <span class="asset-type-badge ${typeInfo.class}">${typeInfo.badge}</span>
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
                            <span class="data-value">${formatCurrency(asset.cost)}</span>
                        </div>
                        <div class="data-item">
                            <span class="data-label">当前价</span>
                            <span class="data-value ${asset.currentPrice >= asset.cost ? 'positive' : 'negative'}">${formatCurrency(asset.currentPrice)}</span>
                        </div>
                        <div class="data-item">
                            <span class="data-label">持有量</span>
                            <span class="data-value">${asset.shares}</span>
                        </div>
                        <div class="data-item">
                            <span class="data-label">市值</span>
                            <span class="data-value">${formatCurrency(currentValue)}</span>
                        </div>
                        <div class="data-item">
                            <span class="data-label">盈亏</span>
                            <span class="data-value ${profit >= 0 ? 'positive' : 'negative'}">${formatCurrency(profit)}</span>
                        </div>
                        <div class="data-item">
                            <span class="data-label">收益率</span>
                            <span class="data-value ${profitPercent >= 0 ? 'positive' : 'negative'}">${formatPercent(profitPercent)}</span>
                        </div>
                    </div>
                    <div class="asset-footer">
                        <span>更新: ${formatDate(asset.lastUpdateTime)}</span>
                        <button class="btn btn-sm btn-info" onclick="App.refreshAsset('${asset.id}')">
                            <i class="fas fa-sync-alt"></i> 刷新
                        </button>
                    </div>
                </div>
            `;
        }).join('');
        
        container.innerHTML = cardsHTML;
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
        overlay.querySelector('p').textContent = message;
        overlay.style.display = 'flex';
    }
    
    // 隐藏加载动画
    function hideLoading() {
        const overlay = document.getElementById('loading-overlay');
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
        document.getElementById('last-update').textContent = timeStr;
    }
    
    // 公开API
    return {
        TYPE_MAP,
        formatCurrency,
        formatPercent,
        formatDate,
        renderOverview,
        renderAssetsList,
        renderTabs,
        showLoading,
        hideLoading,
        showToast,
        updateLastUpdateTime
    };
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
