/**
 * 主应用逻辑模块
 * 负责初始化应用、绑定事件、协调各模块工作
 */

const App = (function() {
    let currentFilter = 'all';
    let isEditing = false;
    let editingId = null;
    
    // 初始化应用
    function init() {
        console.log('个人投资管理系统初始化...');
        
        // 绑定事件
        bindEvents();
        
        // 渲染初始数据
        render();
        
        // 更新最后更新时间
        UIManager.updateLastUpdateTime();
        
        console.log('初始化完成');
    }
    
    // 绑定事件
    function bindEvents() {
        // 添加资产按钮
        document.getElementById('btn-add-asset').addEventListener('click', () => {
            showAddAssetModal();
        });
        
        // 刷新所有数据按钮
        document.getElementById('btn-refresh-all').addEventListener('click', () => {
            refreshAllAssets();
        });
        
        // 配置按钮
        document.getElementById('btn-config').addEventListener('click', () => {
            showConfigModal();
        });
        
        // 模态框关闭按钮
        document.getElementById('modal-close').addEventListener('click', () => {
            hideModal('modal-asset');
        });
        
        document.getElementById('config-close').addEventListener('click', () => {
            hideModal('modal-config');
        });
        
        // 取消按钮
        document.getElementById('btn-cancel').addEventListener('click', () => {
            hideModal('modal-asset');
        });
        
        document.getElementById('config-cancel').addEventListener('click', () => {
            hideModal('modal-config');
        });
        
        // 表单提交
        document.getElementById('form-asset').addEventListener('submit', (e) => {
            e.preventDefault();
            saveAsset();
        });
        
        document.getElementById('form-config').addEventListener('submit', (e) => {
            e.preventDefault();
            saveConfig();
        });
        
        // 查询按钮
        document.getElementById('btn-query-info').addEventListener('click', () => {
            queryAssetInfo();
        });
        
        // 标签页切换
        document.querySelectorAll('.tab').forEach(tab => {
            tab.addEventListener('click', () => {
                currentFilter = tab.dataset.tab;
                UIManager.renderTabs(currentFilter);
                render();
            });
        });
        
        // 点击模态框外部关闭
        document.getElementById('modal-asset').addEventListener('click', (e) => {
            if (e.target.id === 'modal-asset') {
                hideModal('modal-asset');
            }
        });
        
        document.getElementById('modal-config').addEventListener('click', (e) => {
            if (e.target.id === 'modal-config') {
                hideModal('modal-config');
            }
        });
    }
    
    // 渲染界面
    function render() {
        const assets = StorageManager.getAssets();
        UIManager.renderOverview(assets);
        UIManager.renderCharts(assets);
        UIManager.renderAssetsList(assets, currentFilter);
    }
    
    // 显示添加资产模态框
    function showAddAssetModal() {
        isEditing = false;
        editingId = null;
        
        // 重置表单
        document.getElementById('form-asset').reset();
        document.getElementById('modal-title').textContent = '添加资产';
        document.getElementById('query-result').textContent = '';
        
        // 显示模态框
        showModal('modal-asset');
    }
    
    // 显示编辑资产模态框
    function showEditAssetModal(id) {
        isEditing = true;
        editingId = id;
        
        const asset = StorageManager.getAssetById(id);
        if (!asset) {
            UIManager.showToast('未找到该资产', 'error');
            return;
        }
        
        // 填充表单
        document.getElementById('asset-type').value = asset.type;
        document.getElementById('asset-code').value = asset.code;
        document.getElementById('asset-name').value = asset.name;
        document.getElementById('asset-cost').value = asset.cost;
        document.getElementById('asset-shares').value = asset.shares;
        document.getElementById('asset-current-price').value = asset.currentPrice || '';
        
        document.getElementById('modal-title').textContent = '编辑资产';
        document.getElementById('query-result').textContent = '';
        
        // 显示模态框
        showModal('modal-asset');
    }
    
    // 显示配置模态框
    function showConfigModal() {
        const config = StorageManager.getConfig();
        
        document.getElementById('config-finnhub-key').value = config.finnhubKey || '';
        document.getElementById('config-biying-key').value = config.biyingKey || '';
        document.getElementById('config-demo-mode').checked = config.demoMode !== false;
        
        showModal('modal-config');
    }
    
    // 显示模态框
    function showModal(modalId) {
        document.getElementById(modalId).classList.add('active');
    }
    
    // 隐藏模态框
    function hideModal(modalId) {
        document.getElementById(modalId).classList.remove('active');
    }
    
    // 查询资产信息
    async function queryAssetInfo() {
        const type = document.getElementById('asset-type').value;
        const code = document.getElementById('asset-code').value.trim();
        
        if (!code) {
            UIManager.showToast('请输入代码', 'error');
            return;
        }
        
        UIManager.showLoading('正在查询...');
        
        try {
            // 查询名称
            const name = await APIManager.getName(type, code);
            document.getElementById('asset-name').value = name;
            
            // 查询价格
            const quote = await APIManager.getQuote(type, code);
            const price = quote.price || quote.estimateNav;
            document.getElementById('asset-current-price').value = price.toFixed(2);
            
            document.getElementById('query-result').textContent = `查询成功: ${name}, 当前价: ${price.toFixed(2)}`;
            document.getElementById('query-result').style.color = '#10b981';
            
            UIManager.showToast('查询成功', 'success');
        } catch (error) {
            console.error('查询失败:', error);
            document.getElementById('query-result').textContent = `查询失败: ${error.message}`;
            document.getElementById('query-result').style.color = '#ef4444';
            UIManager.showToast(`查询失败: ${error.message}`, 'error');
        } finally {
            UIManager.hideLoading();
        }
    }
    
    // 保存资产
    function saveAsset() {
        const type = document.getElementById('asset-type').value;
        const code = document.getElementById('asset-code').value.trim();
        const name = document.getElementById('asset-name').value.trim();
        const cost = parseFloat(document.getElementById('asset-cost').value);
        const shares = parseInt(document.getElementById('asset-shares').value);
        const currentPrice = document.getElementById('asset-current-price').value 
            ? parseFloat(document.getElementById('asset-current-price').value) 
            : null;
        
        if (!code || !name || isNaN(cost) || isNaN(shares)) {
            UIManager.showToast('请填写完整信息', 'error');
            return;
        }
        
        const assetData = {
            type,
            code,
            name,
            cost,
            shares,
            currentPrice,
            lastUpdateTime: currentPrice ? Date.now() : null
        };
        
        if (isEditing) {
            // 更新资产
            const result = StorageManager.updateAsset(editingId, assetData);
            if (result) {
                UIManager.showToast('更新成功', 'success');
            } else {
                UIManager.showToast('更新失败', 'error');
            }
        } else {
            // 添加资产
            StorageManager.addAsset(assetData);
            UIManager.showToast('添加成功', 'success');
        }
        
        // 关闭模态框
        hideModal('modal-asset');
        
        // 重新渲染
        render();
    }
    
    // 编辑资产 (供HTML onclick调用)
    function editAsset(id) {
        showEditAssetModal(id);
    }
    
    // 删除资产
    function deleteAsset(id) {
        if (!confirm('确定要删除该资产吗？')) {
            return;
        }
        
        const result = StorageManager.deleteAsset(id);
        if (result) {
            UIManager.showToast('删除成功', 'success');
        } else {
            UIManager.showToast('删除失败', 'error');
        }
        
        render();
    }
    
    // 刷新单个资产
    async function refreshAsset(id) {
        const asset = StorageManager.getAssetById(id);
        if (!asset) {
            UIManager.showToast('未找到该资产', 'error');
            return;
        }
        
        UIManager.showLoading(`正在刷新 ${asset.code}...`);
        
        try {
            const quote = await APIManager.getQuote(asset.type, asset.code);
            const price = quote.price || quote.estimateNav;
            
            StorageManager.updateAsset(id, {
                currentPrice: price,
                lastUpdateTime: Date.now()
            });
            
            UIManager.showToast('刷新成功', 'success');
            render();
        } catch (error) {
            console.error('刷新失败:', error);
            UIManager.showToast(`刷新失败: ${error.message}`, 'error');
        } finally {
            UIManager.hideLoading();
        }
    }
    
    // 刷新所有资产
    async function refreshAllAssets() {
        const assets = StorageManager.getAssets();
        if (assets.length === 0) {
            UIManager.showToast('暂无资产可刷新', 'info');
            return;
        }
        
        UIManager.showLoading('正在刷新所有资产...');
        
        try {
            const { results, errors } = await APIManager.updateAllPrices(assets);
            
            // 更新成功的资产
            results.forEach(result => {
                StorageManager.updateAsset(result.id, {
                    currentPrice: result.price,
                    lastUpdateTime: result.updateTime
                });
            });
            
            // 显示结果
            if (errors.length > 0) {
                UIManager.showToast(`刷新完成，${results.length}成功，${errors.length}失败`, 'info');
                console.warn('刷新失败的资产:', errors);
            } else {
                UIManager.showToast(`刷新完成，共${results.length}个资产`, 'success');
            }
            
            // 更新最后更新时间
            UIManager.updateLastUpdateTime();
            
            // 重新渲染
            render();
        } catch (error) {
            console.error('刷新失败:', error);
            UIManager.showToast(`刷新失败: ${error.message}`, 'error');
        } finally {
            UIManager.hideLoading();
        }
    }
    
    // 保存配置
    function saveConfig() {
        const finnhubKey = document.getElementById('config-finnhub-key').value.trim();
        const biyingKey = document.getElementById('config-biying-key').value.trim();
        const demoMode = document.getElementById('config-demo-mode').checked;
        
        const config = {
            finnhubKey,
            biyingKey,
            demoMode
        };
        
        StorageManager.saveConfig(config);
        UIManager.showToast('配置保存成功', 'success');
        hideModal('modal-config');
    }
    
    // 导出数据
    function exportData() {
        const data = StorageManager.exportData();
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `investment-data-${new Date().toISOString().slice(0,10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        
        UIManager.showToast('导出成功', 'success');
    }
    
    // 导入数据
    function importData(file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            const success = StorageManager.importData(e.target.result);
            if (success) {
                UIManager.showToast('导入成功', 'success');
                render();
            } else {
                UIManager.showToast('导入失败，请检查文件格式', 'error');
            }
        };
        reader.readAsText(file);
    }
    
    // 公开API (供HTML onclick调用)
    window.App = {
        init,
        editAsset,
        deleteAsset,
        refreshAsset,
        exportData,
        importData
    };
    
    // 页面加载完成后初始化
    document.addEventListener('DOMContentLoaded', init);
    
    return {
        init,
        editAsset,
        deleteAsset,
        refreshAsset,
        exportData,
        importData
    };
})();
