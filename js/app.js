/**
 * 主应用逻辑模块
 * 负责初始化应用、绑定事件、协调各模块工作
 */

const App = (function() {
    let currentFilter = 'all';
    let isEditing = false;
    let editingId = null;
    
    // 初始化应用
    async function init() {
        console.log('个人投资管理系统初始化...');
        bindEvents();
        
        // 注册数据变更钩子（自动同步：持仓/现金/分红改动后自动上传云端）
        StorageManager.onDataChanged(scheduleAutoUpload);
        
        // 获取汇率
        try { await APIManager.fetchExchangeRates(); } catch(e) {}
        
        render();
        UIManager.renderTabs('all');
        UIManager.updateLastUpdateTime();
        
        // 懒加载市场指标（非阻塞）
        try { await UIManager.renderIndicators(); } catch(e) { console.warn('指标加载失败:', e.message); }
        
        console.log('初始化完成');
        
        // 异步检测新股息（不阻塞页面）
        checkAutoDividends();
        
        // 打开时检查云端是否有更新（非阻塞，需确认后才拉取）
        checkCloudUpdate();
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
        
        // 导出导入
        document.getElementById('btn-export').addEventListener('click', () => exportData());
        document.getElementById('btn-import').addEventListener('click', () => document.getElementById('import-file').click());
        document.getElementById('btn-cloud-backup').addEventListener('click', () => cloudBackup());
        document.getElementById('btn-cloud-import').addEventListener('click', () => cloudImport());
        document.getElementById('config-clear-all').addEventListener('click', () => clearAllData());
        document.getElementById('import-file').addEventListener('change', (e) => {
            if (e.target.files[0]) importData(e.target.files[0]);
            e.target.value = '';
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
                renderFiltered();
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
        
        // 输入代码时自动识别资产类别（同步判断市场 + 6位代码异步探测 基金/ETF）
        let _identifyTimer = null;
        document.getElementById('asset-code').addEventListener('input', (e) => {
            const code = e.target.value.trim().toUpperCase();
            const typeSelect = document.getElementById('asset-type');
            const hint = document.getElementById('query-result');
            // 纯字母 → 美股；1-5位数字 → 港股（无需网络）
            if (/^[A-Z.]+$/.test(code)) {
                typeSelect.value = 'us-stock';
            } else if (/^\d{1,5}$/.test(code)) {
                typeSelect.value = 'hk-stock';
            } else if (/^\d{6}$/.test(code)) {
                typeSelect.value = 'a-stock'; // 默认，待异步探测后修正
            } else {
                return;
            }
            // 6位数字需联网区分 A股/场内ETF 与 场外基金
            if (!/^\d{6}$/.test(code)) return;
            if (hint) hint.textContent = '识别中…';
            clearTimeout(_identifyTimer);
            _identifyTimer = setTimeout(async () => {
                try {
                    const t = await APIManager.identifyAssetType(code);
                    // 仅当用户未继续输入时才更新，避免覆盖
                    if (e.target.value.trim().toUpperCase() === code) {
                        typeSelect.value = t;
                        if (hint) hint.textContent = t === 'fund' ? '✓ 已识别为基金' : '✓ 已识别为A股/ETF';
                    }
                } catch (err) {
                    if (hint) hint.textContent = '';
                }
            }, 400);
            // 代码变化（含市场/类型推断后）同步刷新复投勾选框可见性与默认值
            applyAutoReinvestVisibility();
        });

        // 类型/品种切换时同步刷新「分红自动复投」勾选框
        document.getElementById('asset-type').addEventListener('change', () => applyAutoReinvestVisibility());
        document.getElementById('asset-category').addEventListener('input', () => applyAutoReinvestVisibility());
        document.getElementById('asset-category').addEventListener('change', () => applyAutoReinvestVisibility());

        // ===== 分红相关事件 =====
        
        // 分红列表按钮
        document.getElementById('btn-dividend-list').addEventListener('click', () => {
            UIManager.renderDividendList();
            showModal('modal-dividend-list');
        });
        
        // 分红通知横幅：逐资产列表的「记录」「稍后提醒」按钮由 renderDividendAlert 内联 onclick 调用
        // App.recordPendingDividend / App.snoozePendingDividend
        
        // 分红模态框关闭
        document.getElementById('div-modal-close').addEventListener('click', () => hideModal('modal-dividend'));
        document.getElementById('div-btn-cancel').addEventListener('click', () => hideModal('modal-dividend'));
        document.getElementById('divlist-modal-close').addEventListener('click', () => hideModal('modal-dividend-list'));
        
        // 分红表单提交
        document.getElementById('form-dividend').addEventListener('submit', (e) => {
            e.preventDefault();
            submitDividend();
        });
        
        // 分红表单实时计算
        document.getElementById('div-per-share').addEventListener('input', calcDividendSummary);
        document.getElementById('div-tax-rate').addEventListener('input', calcDividendSummary);
        document.getElementById('div-asset').addEventListener('change', onDividendAssetChange);
        
        // 点击外部关闭分红模态框
        document.getElementById('modal-dividend').addEventListener('click', (e) => {
            if (e.target.id === 'modal-dividend') hideModal('modal-dividend');
        });
        document.getElementById('modal-dividend-list').addEventListener('click', (e) => {
            if (e.target.id === 'modal-dividend-list') hideModal('modal-dividend-list');
        });
        
        // 补仓模态框相关事件
        document.getElementById('bm-modal-close').addEventListener('click', () => hideModal('modal-buymore'));
        document.getElementById('bm-btn-cancel').addEventListener('click', () => hideModal('modal-buymore'));
        document.getElementById('form-buymore').addEventListener('submit', (e) => {
            e.preventDefault();
            submitBuyMore();
        });
        document.getElementById('bm-amount').addEventListener('input', calcBuyMoreSummary);
        document.getElementById('bm-date').addEventListener('input', onBuyMoreDateChange);
        document.getElementById('bm-nav-input').addEventListener('input', calcBuyMoreSummary);
        document.getElementById('modal-buymore').addEventListener('click', (e) => {
            if (e.target.id === 'modal-buymore') hideModal('modal-buymore');
        });
        
        // 现金卡片点击编辑
        document.getElementById('cash-card').addEventListener('click', () => {
            UIManager.showCashEditModal();
        });
        document.getElementById('cash-modal-close').addEventListener('click', () => hideModal('modal-cash-edit'));
        document.getElementById('cash-btn-cancel').addEventListener('click', () => hideModal('modal-cash-edit'));
        document.getElementById('modal-cash-edit').addEventListener('click', (e) => {
            if (e.target.id === 'modal-cash-edit') hideModal('modal-cash-edit');
        });
        
        // 现金编辑表单提交
        document.getElementById('form-cash-edit').addEventListener('submit', (e) => {
            e.preventDefault();
            saveCashEdit();
        });
        
        // 现金编辑实时预览
        ['edit-cny', 'edit-hkd', 'edit-usd'].forEach(id => {
            document.getElementById(id).addEventListener('input', () => {
                const cny = parseFloat(document.getElementById('edit-cny').value) || 0;
                const hkd = parseFloat(document.getElementById('edit-hkd').value) || 0;
                const usd = parseFloat(document.getElementById('edit-usd').value) || 0;
                const total = cny + APIManager.toCNY(hkd, 'HKD') + APIManager.toCNY(usd, 'USD');
                document.getElementById('edit-cash-cny').textContent = UIManager.formatCurrency(total, 'CNY');
            });
        });
    }
    
    // ==================== 分红业务逻辑 ====================
    
    // 保存待处理的分红检测结果
    window._pendingDividends = [];
    
    // 自动检测新股息
    async function checkAutoDividends() {
        console.log('检查分红...');
        try {
            const newDivs = await APIManager.checkNewDividends();
            if (!newDivs.length) return;
            
            const manual = [];
            for (const div of newDivs) {
                const asset = StorageManager.getAssetById(div.assetId);
                // 基金 + 开启自动复投 → 静默自动复投，不进提示列表
                if (asset && asset.autoReinvest && div.type === 'fund') {
                    await autoReinvestDividend(div);
                } else {
                    manual.push(div);
                }
            }
            
            // 过滤"稍后提醒"的
            const visible = manual.filter(d => !StorageManager.isDividendSnoozed(d.code, d.exDate));
            if (visible.length) {
                window._pendingDividends = visible;
                UIManager.renderDividendAlert(visible);
                console.log('发现未记录分红:', visible.map(d => d.name + ' ' + d.perShare));
            } else {
                window._pendingDividends = [];
                UIManager.renderDividendAlert([]);
            }
        } catch (e) {
            console.warn('分红检测异常:', e.message);
        }
    }

    // 红利低波等：分红自动复投（按除权后净值折算份额，直接增加持仓，不进现金）
    function autoReinvestDividend(div) {
        const asset = StorageManager.getAssetById(div.assetId);
        if (!asset) return;
        const perUnit = div.perShare;
        const holdingShares = asset.shares;
        const gross = perUnit * holdingShares;
        if (!(gross > 0)) return;
        
        const currency = div.currency || 'CNY';
        const navAfter = (div.navAfter && div.navAfter > 0) ? div.navAfter : (asset.currentPrice || 0);
        
        // 兜底：无复投价 → 退化为现金到账
        if (!navAfter || navAfter <= 0) {
            const rec = {
                assetId: asset.id, assetCode: asset.code, assetName: asset.name,
                perShare: perUnit, shares: holdingShares, totalAmount: gross, taxRate: 0,
                taxAmount: 0, netAmount: gross, currency, status: 'received',
                exDate: div.exDate || '', reportPeriod: div.reportPeriod || '', source: 'auto-fallback'
            };
            StorageManager.addDividendRecord(rec);
            StorageManager.addCash(gross, currency);
            UIManager.showToast(`(复投价缺失) ${asset.name}(${asset.code}) 分红已作为现金到账 ${UIManager.formatCurrency(gross, currency)}`, 'info');
            render();
            return;
        }
        
        // 基金支持小数份额
        const reinvestShares = Math.round((gross / navAfter) * 10000) / 10000;
        const reinvestCost = reinvestShares * navAfter;
        const oldShares = asset.shares;
        const oldCost = asset.cost;
        const newShares = oldShares + reinvestShares;
        const newCost = (oldShares * oldCost + reinvestCost) / newShares;
        
        StorageManager.updateAsset(asset.id, { shares: newShares, cost: newCost });
        
        StorageManager.addDividendRecord({
            assetId: asset.id, assetCode: asset.code, assetName: asset.name,
            perShare: perUnit, shares: holdingShares, totalAmount: gross, taxRate: 0,
            taxAmount: 0, netAmount: gross, currency,
            status: 'reinvested', exDate: div.exDate || '', reportPeriod: div.reportPeriod || '',
            source: 'auto', navAfter,
            reinvest: { shares: reinvestShares, price: navAfter, date: div.exDate || '' }
        });
        
        UIManager.showToast(
            `${asset.name}(${asset.code}) 分红自动复投 +${reinvestShares} 份 @${UIManager.formatCurrency(navAfter, currency)}`,
            'success'
        );
        render();
    }
    
    // 各资产类型默认税率：A股长持免税0%，港股通10%，美股30%，基金0%
    function getDefaultTaxRate(type) {
        switch (type) {
            case 'a-stock': return 0;
            case 'hk-stock': return 10;
            case 'us-stock': return 30;
            case 'fund': return 0;
            default: return 10;
        }
    }
    
    // 显示记录分红模态框（自动填入或手动）
    function showDividendModal(prefill = null) {
        // 填充资产下拉列表
        const select = document.getElementById('div-asset');
        const assets = StorageManager.getAssets();
        select.innerHTML = assets.map(a => 
            `<option value="${a.id}" data-type="${a.type}" data-currency="${APIManager.getAssetCurrency(a.type)}" data-shares="${a.shares}" data-name="${a.name || a.code}">${a.name || a.code} (${a.code})</option>`
        ).join('');
        
        if (prefill && prefill.assetId) {
            select.value = prefill.assetId;
            document.getElementById('div-per-share').value = prefill.perShare || '';
            // 根据资产类型设置默认税率：A股/基金 0%，港股 10%，美股 30%
            const prefillType = prefill.type || '';
            document.getElementById('div-tax-rate').value = getDefaultTaxRate(prefillType);
            // 存储基金除权净值供复投使用
            if (prefill.type === 'fund' && prefill.navAfter) {
                document.getElementById('div-per-share').dataset.navAfter = prefill.navAfter;
            }
            // 除权日（用于去重）与报告期：检测到的自动带入，可改
            document.getElementById('div-ex-date').value = prefill.exDate || '';
            window._dividendReportPeriod = prefill.reportPeriod || '';
        } else {
            select.selectedIndex = 0;
            document.getElementById('div-per-share').value = '';
            document.getElementById('div-tax-rate').value = 10;
            document.getElementById('div-ex-date').value = '';
            window._dividendReportPeriod = '';
        }
        
        onDividendAssetChange();
        calcDividendSummary();
        showModal('modal-dividend');
    }
    
    // 记录分红：从资产卡片调用
    function recordDividend(assetId) {
        const asset = StorageManager.getAssetById(assetId);
        if (!asset) { UIManager.showToast('未找到资产', 'error'); return; }
        showDividendModal({ assetId });
    }
    
    // 从分红横幅逐资产列表：记录指定待处理分红
    function recordPendingDividend(index) {
        const div = (window._pendingDividends || [])[index];
        if (!div) return;
        document.getElementById('dividend-alert').style.display = 'none';
        showDividendModal(div);
    }
    
    // 从分红横幅：稍后提醒（暂存，不再反复弹出）
    function snoozePendingDividend(index) {
        const div = (window._pendingDividends || [])[index];
        if (!div) return;
        StorageManager.snoozeDividend(div.code, div.exDate);
        window._pendingDividends = (window._pendingDividends || []).filter((_, i) => i !== index);
        if (!window._pendingDividends.length) {
            document.getElementById('dividend-alert').style.display = 'none';
        } else {
            UIManager.renderDividendAlert(window._pendingDividends);
        }
        UIManager.showToast('已稍后提醒，本次不再提示', 'info');
    }
    
    // 分红资产下拉切换时更新持股数和币种、标签文字
    function onDividendAssetChange() {
        const select = document.getElementById('div-asset');
        const opt = select.options[select.selectedIndex];
        const type = opt.dataset.type;
        document.getElementById('div-shares').value = opt.dataset.shares || '';
        document.getElementById('div-currency-hint').textContent = '币种：' + (opt.dataset.currency || 'CNY');
        // 基金：每份；股票：每股
        document.querySelector('label[for="div-per-share"]').textContent = type === 'fund' ? '每份分红（原币，税前）' : '每股分红（原币，税前）';
        document.getElementById('div-tax-rate').value = getDefaultTaxRate(type);
        document.getElementById('div-shares').previousElementSibling.textContent = type === 'fund' ? '持仓份额' : '持股数量';
        calcDividendSummary();
    }
    
    // 实时计算分红摘要
    function calcDividendSummary() {
        const perShare = parseFloat(document.getElementById('div-per-share').value) || 0;
        const shares = parseFloat(document.getElementById('div-shares').value) || 0;
        const taxRate = (parseFloat(document.getElementById('div-tax-rate').value) || 0) / 100;
        
        const total = perShare * shares;
        const tax = total * taxRate;
        const net = total - tax;
        
        if (perShare > 0 && shares > 0) {
            document.getElementById('div-summary').style.display = 'block';
            document.getElementById('div-pre-tax').textContent = UIManager.formatCurrency(total, 'CNY');
            document.getElementById('div-tax').textContent = '-' + UIManager.formatCurrency(tax, 'CNY');
            document.getElementById('div-net').textContent = UIManager.formatCurrency(net, 'CNY');
        } else {
            document.getElementById('div-summary').style.display = 'none';
        }
    }
    
    // 提交分红记录
    function submitDividend() {
        const select = document.getElementById('div-asset');
        const opt = select.options[select.selectedIndex];
        const assetId = select.value;
        const asset = StorageManager.getAssetById(assetId);
        if (!asset) { UIManager.showToast('未找到资产', 'error'); return; }
        
        const perShare = parseFloat(document.getElementById('div-per-share').value);
        const shares = parseFloat(document.getElementById('div-shares').value);
        const taxRate = parseFloat(document.getElementById('div-tax-rate').value) || getDefaultTaxRate(asset.type);
        const currency = opt.dataset.currency || 'CNY';
        
        if (!perShare || perShare <= 0 || !shares || shares <= 0) {
            UIManager.showToast('请填写完整的分红信息', 'error');
            return;
        }
        
        const totalAmount = perShare * shares;
        const taxAmount = totalAmount * (taxRate / 100);
        const netAmount = totalAmount - taxAmount;
        
        // 从分红检测中获取附加数据
        const perShareEl = document.getElementById('div-per-share');
        const navAfter = perShareEl.dataset.navAfter ? parseFloat(perShareEl.dataset.navAfter) : null;
        // 除权日：手动填写或检测带入；用于 isDividendRecorded 去重，避免反复弹出
        const exDate = document.getElementById('div-ex-date').value || '';
        const reportPeriod = window._dividendReportPeriod || '';
        
        const record = {
            assetId, assetCode: asset.code, assetName: asset.name,
            perShare, shares, totalAmount, taxRate,
            taxAmount: Math.round(taxAmount * 100) / 100,
            netAmount: Math.round(netAmount * 100) / 100,
            currency, status: 'received',
            exDate, reportPeriod, source: navAfter ? 'auto' : 'manual',
            navAfter, reinvest: null
        };
        
        const saved = StorageManager.addDividendRecord(record);
        StorageManager.addCash(netAmount, currency);
        UIManager.showToast(`分红到账 ${UIManager.formatCurrency(netAmount, currency)}`, 'success');
        
        hideModal('modal-dividend');
        render();
    }
    
    // 复投分红
    function reinvestDividend(dividendId) {
        const record = StorageManager.getDividendRecords().find(r => r.id === dividendId);
        if (!record) { UIManager.showToast('未找到分红记录', 'error'); return; }
        if (record.reinvest) { UIManager.showToast('该分红已复投', 'info'); return; }
        
        const asset = StorageManager.getAssetById(record.assetId);
        if (!asset) { UIManager.showToast('未找到对应资产', 'error'); return; }
        
        // 基金有除权净值时自动填入
        const defaultPrice = record.navAfter || asset.currentPrice;
        const priceStr = prompt(`复投价格（${APIManager.getCurrencySymbol(record.currency)}${record.navAfter ? '，除权净值' : '，当前价'} ${formatNumber(defaultPrice, 4)}）:`, defaultPrice);
        if (!priceStr) return;
        const reinvestPrice = parseFloat(priceStr);
        if (isNaN(reinvestPrice) || reinvestPrice <= 0) { UIManager.showToast('价格无效', 'error'); return; }
        
        const unit = asset.type === 'fund' ? '份' : '股';
        const maxShares = Math.floor(record.netAmount / reinvestPrice);
        const sharesStr = prompt(`复投${unit}数（最多 ${maxShares} ${unit}）:`, maxShares);
        if (!sharesStr) return;
        const reinvestShares = parseInt(sharesStr);
        if (isNaN(reinvestShares) || reinvestShares <= 0 || reinvestShares > maxShares) {
            UIManager.showToast(`${unit}数无效（1~${maxShares}）`, 'error');
            return;
        }
        
        const totalCost = reinvestPrice * reinvestShares;
        if (!StorageManager.deductCash(totalCost, record.currency)) {
            UIManager.showToast('现金余额不足', 'error');
            return;
        }
        
        // 加权平均计算新成本
        const oldShares = asset.shares;
        const oldTotalCost = asset.cost * oldShares;
        const newShares = oldShares + reinvestShares;
        const newCost = (oldTotalCost + totalCost) / newShares;
        
        StorageManager.updateAsset(record.assetId, {
            shares: newShares,
            cost: newCost
        });
        
        StorageManager.updateDividendRecord(dividendId, {
            status: 'reinvested',
            reinvest: { shares: reinvestShares, price: reinvestPrice, date: new Date().toISOString().slice(0, 10) }
        });
        
        UIManager.showToast(`复投成功：${reinvestShares}${unit} @${UIManager.formatCurrency(reinvestPrice, record.currency)}`, 'success');
        render();
    }
    
    // 删除分红记录
    function deleteDividend(dividendId) {
        const record = StorageManager.getDividendRecords().find(r => r.id === dividendId);
        if (!record) return;
        if (record.reinvest) {
            UIManager.showToast('已复投的分红不可删除', 'error');
            return;
        }
        if (!confirm(`确定删除 ${record.assetName} 的分红记录吗？（现金不会退回）`)) return;
        StorageManager.deleteDividendRecord(dividendId);
        UIManager.showToast('已删除', 'success');
        UIManager.renderDividendList();
        render();
    }
    
    // ==================== 基金补仓 ====================
    
    function getTodayStr() {
        return new Date().toISOString().slice(0, 10);
    }

    // 显示补仓模态框（从基金卡片调用）
    function showBuyMoreModal(assetId) {
        const asset = StorageManager.getAssetById(assetId);
        if (!asset) { UIManager.showToast('未找到资产', 'error'); return; }
        if (asset.type !== 'fund') { UIManager.showToast('补仓功能仅支持基金', 'error'); return; }
        
        document.getElementById('bm-asset-id').value = asset.id;
        document.getElementById('bm-asset-name').textContent = `${asset.name || asset.code} (${asset.code})`;
        document.getElementById('bm-currency').textContent = asset.currency || 'CNY';
        document.getElementById('bm-amount').value = '';
        document.getElementById('bm-date').value = getTodayStr();
        document.getElementById('bm-deduct-cash').checked = true;
        document.getElementById('bm-summary').style.display = 'none';
        showModal('modal-buymore');
        onBuyMoreDateChange();
    }
    
    // 日期变化：当天自动拉取净值，历史清空待手填
    async function onBuyMoreDateChange() {
        const assetId = document.getElementById('bm-asset-id').value;
        const asset = StorageManager.getAssetById(assetId);
        const date = document.getElementById('bm-date').value;
        const navInput = document.getElementById('bm-nav-input');
        const navHint = document.getElementById('bm-nav-hint');
        if (!asset || !date) { calcBuyMoreSummary(); return; }

        if (date === getTodayStr()) {
            // 当天：自动拉取最新单位净值（东方财富 pingzhongdata，浏览器直连）
            navHint.textContent = '当天净值由东方财富自动获取（可修改）';
            try {
                const info = await APIManager.getEastMoneyFundNav(asset.code);
                const nav = info.nav > 0 ? info.nav : (info.estimateNav || 0);
                if (nav > 0) {
                    navInput.value = nav.toFixed(4);
                } else {
                    navInput.value = '';
                    navHint.textContent = '当天净值自动获取失败，请手动输入';
                }
            } catch (e) {
                navInput.value = '';
                navHint.textContent = '当天净值自动获取失败，请手动输入（' + e.message + '）';
            }
        } else {
            // 历史日期：清空，提示手动输入
            navInput.value = '';
            navHint.textContent = '历史净值请手动输入加仓当日单位净值';
        }
        calcBuyMoreSummary();
    }

    // 实时计算补仓摘要（净值取自输入框）
    function calcBuyMoreSummary() {
        const assetId = document.getElementById('bm-asset-id').value;
        const asset = StorageManager.getAssetById(assetId);
        const amount = parseFloat(document.getElementById('bm-amount').value);
        const nav = parseFloat(document.getElementById('bm-nav-input').value);
        const summary = document.getElementById('bm-summary');
        if (!asset || !amount || amount <= 0 || !(nav > 0)) {
            summary.style.display = 'none';
            return;
        }
        const addShares = amount / nav;
        const oldShares = asset.shares || 0;
        const oldTotal = (asset.cost || 0) * oldShares;
        const newShares = oldShares + addShares;
        const newCost = (oldTotal + amount) / newShares;
        const newVal = (asset.currentPrice || 0) * newShares;
        document.getElementById('bm-new-shares').textContent = '+' + addShares.toFixed(2) + ' 份';
        document.getElementById('bm-new-cost').textContent = UIManager.formatCurrency(newCost, asset.currency);
        document.getElementById('bm-new-value').textContent = UIManager.formatCurrency(newVal, asset.currency);
        summary.style.display = 'block';
    }

    // 提交补仓：按加仓日期净值加权计算新份额与成本价，默认同步扣减现金
    async function submitBuyMore() {
        const assetId = document.getElementById('bm-asset-id').value;
        const asset = StorageManager.getAssetById(assetId);
        const amount = parseFloat(document.getElementById('bm-amount').value);
        const date = document.getElementById('bm-date').value;
        const nav = parseFloat(document.getElementById('bm-nav-input').value);
        const deductCash = document.getElementById('bm-deduct-cash').checked;

        if (!asset) { UIManager.showToast('未找到资产', 'error'); return; }
        if (!amount || amount <= 0) { UIManager.showToast('请输入加仓金额', 'error'); return; }
        if (!date) { UIManager.showToast('请选择加仓日期', 'error'); return; }
        if (!(nav > 0)) { UIManager.showToast('请填写加仓当日单位净值', 'error'); return; }

        // 默认同步扣减对应币种现金余额
        if (deductCash) {
            if (!StorageManager.deductCash(amount, asset.currency)) {
                UIManager.showToast('现金余额不足', 'error');
                return;
            }
        }

        const addShares = amount / nav;
        const oldShares = asset.shares || 0;
        const oldTotal = (asset.cost || 0) * oldShares;
        const newShares = oldShares + addShares;
        const newCost = (oldTotal + amount) / newShares;

        StorageManager.updateAsset(assetId, { shares: newShares, cost: newCost });
        UIManager.showToast(`补仓成功：+${addShares.toFixed(2)} 份 @净值 ${nav.toFixed(4)}（${date}）`, 'success');
        hideModal('modal-buymore');
        render();
    }
    
    // 保存现金编辑
    function saveCashEdit() {
        const cny = parseFloat(document.getElementById('edit-cny').value) || 0;
        const hkd = parseFloat(document.getElementById('edit-hkd').value) || 0;
        const usd = parseFloat(document.getElementById('edit-usd').value) || 0;
        StorageManager.setCashBalance({ CNY: cny, HKD: hkd, USD: usd });
        hideModal('modal-cash-edit');
        UIManager.showToast('现金余额已更新', 'success');
        render();
    }
    
    function formatNumber(n, dec = 4) {
        if (n === null || n === undefined) return '--';
        return parseFloat(n).toFixed(dec);
    }
    
    // 渲染界面
    function render() {
        const assets = StorageManager.getAssets();
        UIManager.renderOverview(assets);
        UIManager.renderCharts(assets);
        UIManager.renderAssetsList(assets, currentFilter);
        // 记录净值快照
        recordSnapshot(assets);
    }
    
    // 记录净值快照
    function recordSnapshot(assets) {
        if (assets.length === 0) return;
        let total = 0;
        assets.forEach(a => {
            const c = a.currency || APIManager.getAssetCurrency(a.type);
            const v = (a.currentPrice || 0) * a.shares;
            total += APIManager.toCNY(v, c);
        });
        const cash = StorageManager.getCashBalance();
        total += APIManager.toCNY(cash.CNY || 0, 'CNY') + APIManager.toCNY(cash.HKD || 0, 'HKD') + APIManager.toCNY(cash.USD || 0, 'USD');
        StorageManager.addHistorySnapshot(total);
    }
    
    // 仅切换筛选（饼图不变）
    function renderFiltered() {
        const assets = StorageManager.getAssets();
        UIManager.renderOverview(assets);
        UIManager.renderAssetsList(assets, currentFilter);
    }
    
    // 显示添加资产模态框
    function showAddAssetModal() {
        isEditing = false;
        editingId = null;
        
        document.getElementById('form-asset').reset();
        document.getElementById('modal-title').textContent = '添加资产';
        document.getElementById('query-result').textContent = '';
        document.getElementById('asset-category').value = '未分类';
        document.getElementById('asset-platform').value = '';
        // 基金复投勾选框：默认隐藏，按类型显示
        applyAutoReinvestVisibility();
        
        // 更新品种列表
        updateCategoryDatalist();
        
        showModal('modal-asset');
    }
    
    // 更新品种下拉列表
    function updateCategoryDatalist() {
        const config = StorageManager.getConfig();
        const list = document.getElementById('category-list');
        list.innerHTML = (config.categories || ['红利','纳指100','标普500'])
            .map(c => `<option value="${c}">`).join('');
    }
    
    // 基金专属「分红自动复投」勾选框：仅基金类型显示；默认按品种/代码推断
    function applyAutoReinvestVisibility(asset) {
        const wrap = document.getElementById('asset-autoreinvest-wrap');
        const cb = document.getElementById('asset-auto-reinvest');
        const type = document.getElementById('asset-type').value;
        if (type !== 'fund') {
            wrap.style.display = 'none';
            cb.checked = false;
            return;
        }
        wrap.style.display = 'block';
        const code = document.getElementById('asset-code').value.trim();
        const category = document.getElementById('asset-category').value.trim();
        const isLowVol = (category && category.includes('红利低波')) || code === '020602';
        if (asset && asset.type === 'fund') {
            // 编辑已有：以已存值优先，未存则按默认规则
            cb.checked = (asset.autoReinvest !== undefined && asset.autoReinvest !== null)
                ? !!asset.autoReinvest
                : isLowVol;
        } else {
            // 新增：按默认规则
            cb.checked = isLowVol;
        }
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
        document.getElementById('asset-category').value = asset.category || '未分类';
        document.getElementById('asset-platform').value = asset.platform || '';
        document.getElementById('asset-cost').value = asset.cost;
        document.getElementById('asset-shares').value = asset.shares;
        document.getElementById('asset-current-price').value = asset.currentPrice || '';
        
        // 基金复投勾选框
        applyAutoReinvestVisibility(asset);
        
        updateCategoryDatalist();
        
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
        document.getElementById('config-cors-proxy').value = config.corsProxy || '';
        document.getElementById('config-demo-mode').checked = config.demoMode !== false;
        document.getElementById('config-use-line1').checked = config.useLine1 === true;
        document.getElementById('config-use-line2').checked = config.useLine2 === true;
        document.getElementById('config-auto-sync').checked = config.autoSync === true;
        document.getElementById('config-cloud-apikey').value = config.cloudApiKey || '';
        document.getElementById('config-cloud-binid').value = config.cloudBinId || '';
        
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
        const category = document.getElementById('asset-category').value.trim() || '未分类';
        const platform = document.getElementById('asset-platform').value.trim() || '';
        const cost = parseFloat(document.getElementById('asset-cost').value);
        const shares = parseFloat(document.getElementById('asset-shares').value);
        const currentPrice = document.getElementById('asset-current-price').value 
            ? parseFloat(document.getElementById('asset-current-price').value) 
            : null;
        
        if (!code || !name || isNaN(cost) || isNaN(shares)) {
            UIManager.showToast('请填写完整信息', 'error');
            return;
        }
        
        const currency = APIManager.getAssetCurrency(type);

        // 分红自动复投：仅基金有意义，其余类型强制 false
        const autoReinvest = type === 'fund'
            ? document.getElementById('asset-auto-reinvest').checked
            : false;

        const assetData = {
            type, code, name, category, currency, cost, shares, currentPrice, platform,
            autoReinvest,
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
        
        let success = false;
        try {
            const quote = await APIManager.getQuote(asset.type, asset.code);
            const price = quote.price || 0;
            
            const result = StorageManager.updateAsset(id, {
                currentPrice: price,
                change: quote.change || 0,
                changePercent: quote.changePercent || 0,
                previousClose: quote.previousClose || price,
                lastUpdateTime: Date.now()
            });
            
            if (!result) throw new Error('保存数据失败');
            success = true;
        } catch (error) {
            console.error('刷新失败:', error);
            UIManager.showToast(`刷新失败: ${error.message}`, 'error');
        } finally {
            UIManager.hideLoading();
        }
        
        if (success) {
            render();
            UIManager.showToast('刷新成功', 'success');
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
        
        let successCount = 0;
        let errorCount = 0;
        let errors = [];
        
        try {
            const result = await APIManager.updateAllPrices(assets);
            errors = result.errors;
            
            result.results.forEach(r => {
                StorageManager.updateAsset(r.id, {
                    currentPrice: r.price,
                    change: r.change || 0,
                    changePercent: r.changePercent || 0,
                    previousClose: r.previousClose || r.price,
                    lastUpdateTime: r.updateTime,
                    navDate: r.navDate || ''
                });
            });
            successCount = result.results.length;
            errorCount = errors.length;
            UIManager.updateLastUpdateTime();
        } catch (error) {
            console.error('刷新失败:', error);
            UIManager.showToast(`刷新失败: ${error.message}`, 'error');
        } finally {
            UIManager.hideLoading();
        }
        
        if (successCount > 0) {
            render();
            try { await UIManager.renderIndicators(); } catch(e) {}
            if (errorCount > 0) {
                UIManager.showToast(`刷新完成，${successCount}成功，${errorCount}失败`, 'info');
                console.warn('刷新失败的资产:', errors);
            } else {
                UIManager.showToast(`刷新完成，共${successCount}个资产`, 'success');
            }
        }
    }
    
    // 保存配置
    function saveConfig() {
        const finnhubKey = document.getElementById('config-finnhub-key').value.trim();
        const biyingKey = document.getElementById('config-biying-key').value.trim();
        const corsProxy = document.getElementById('config-cors-proxy').value.trim();
        const demoMode = document.getElementById('config-demo-mode').checked;
        const useLine1 = document.getElementById('config-use-line1').checked;
        const useLine2 = document.getElementById('config-use-line2').checked;
        const cloudApiKey = document.getElementById('config-cloud-apikey').value.trim();
        const cloudBinId = document.getElementById('config-cloud-binid').value.trim();
        const autoSync = document.getElementById('config-auto-sync').checked;
        
        const existing = StorageManager.getConfig();
        const config = { ...existing, finnhubKey, biyingKey, corsProxy, demoMode, useLine1, useLine2, cloudApiKey, cloudBinId, autoSync };
        
        StorageManager.saveConfig(config);
        UIManager.showToast('配置保存成功', 'success');
        hideModal('modal-config');
    }
    
    // 清除所有数据
    function clearAllData() {
        if (!confirm('确定要清除所有资产和配置数据吗？此操作不可恢复！')) return;
        StorageManager.clearAllData();
        const keys = ['investment_tracker_config', 'investment_indicator_cache'];
        keys.forEach(k => { try { localStorage.removeItem(k); } catch(e) {} });
        UIManager.showToast('已清除所有数据', 'success');
        render();
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
    
    // 云端备份
    async function cloudBackup() {
        const apiKey = document.getElementById('config-cloud-apikey').value.trim();
        if (!apiKey) { UIManager.showToast('请先填写 JSONBin API Key', 'error'); return; }
        
        const btn = document.getElementById('btn-cloud-backup');
        btn.disabled = true; btn.textContent = '备份中...';
        
        try {
            const raw = JSON.parse(StorageManager.exportData());
            const data = StorageManager.stripSecrets(raw);   // 上传前剥离 Key（本地不受影响）
            const binId = await APIManager.cloudBackup(data, apiKey);
            
            const config = StorageManager.getConfig();
            config.cloudBinId = binId;
            config.cloudApiKey = apiKey;
            config.lastSyncTime = raw.syncTime;   // 记录本次同步时间，避免下次误判云端更新
            StorageManager.saveConfig(config);
            
            document.getElementById('config-cloud-binid').value = binId;
            UIManager.showToast(`备份成功！BinID: ${binId.slice(0, 8)}...`, 'success');
        } catch (e) {
            console.error('云端备份失败:', e);
            UIManager.showToast(`备份失败: ${e.message}`, 'error');
        }
        btn.disabled = false; btn.textContent = '☁️ 备份到云端';
    }
    
    // 云端导入
    async function cloudImport() {
        const apiKey = document.getElementById('config-cloud-apikey').value.trim();
        const binId = document.getElementById('config-cloud-binid').value.trim();
        if (!apiKey) { UIManager.showToast('请先填写 JSONBin API Key', 'error'); return; }
        if (!binId) { UIManager.showToast('请填写 Bin ID（首次备份后获得）', 'error'); return; }
        
        const btn = document.getElementById('btn-cloud-import');
        btn.disabled = true; btn.textContent = '导入中...';
        
        try {
            const data = await APIManager.cloudFetch(apiKey, binId);
            if (!data.assets || !Array.isArray(data.assets)) {
                throw new Error('云端数据格式不正确');
            }
            if (!confirm(`将导入云端数据（${data.assets.length} 个资产），当前数据将被覆盖，确认？`)) {
                btn.disabled = false; btn.textContent = '📥 从云端导入';
                return;
            }
            _suppressAutoSync = true;   // 导入期间抑制自动上传，防回环
            StorageManager.clearAllData();
            let success = false;
            try {
                success = StorageManager.importData(JSON.stringify(data));
            } catch (e) {
                console.warn('JSON序列化异常，尝试直接导入:', e.message);
                success = StorageManager.importData(JSON.stringify({ assets: data.assets, config: data.config }));
            }
            _suppressAutoSync = false;
            if (success) {
                // 对齐本次同步时间，避免打开时重复弹"云端有更新"
                const c = StorageManager.getConfig();
                c.lastSyncTime = data.syncTime || Date.now();
                StorageManager.saveConfig(c);
                UIManager.showToast(`导入成功：${data.assets.length} 个资产`, 'success');
                render();
            } else {
                UIManager.showToast('导入失败', 'error');
            }
        } catch (e) {
            console.error('云端导入失败:', e);
            UIManager.showToast(`导入失败: ${e.message}`, 'error');
        }
        btn.disabled = false; btn.textContent = '📥 从云端导入';
    }
    
    // ==================== 自动同步（#1） ====================
    // 说明：仅同步持仓数据（assets/cash/dividends），上传前剥离所有 Key；
    // 拉取需用户确认，不静默覆盖；默认关闭，须在设置中开启且已配 Key。
    
    let _autoUploadTimer = null;      // debounce 定时器
    let _suppressAutoSync = false;    // 拉取/导入期间抑制自动上传，防回环
    
    // 数据变更后触发：debounce 3 秒合并上传一次
    function scheduleAutoUpload() {
        if (_suppressAutoSync) return;
        const config = StorageManager.getConfig();
        if (!config.autoSync || !config.cloudApiKey) return;  // 未开启或未配 Key 直接跳过
        if (_autoUploadTimer) clearTimeout(_autoUploadTimer);
        _autoUploadTimer = setTimeout(doAutoUpload, 3000);
    }
    
    // 执行自动上传（复用 cloudBackup，上传前剥离密钥）
    async function doAutoUpload() {
        const config = StorageManager.getConfig();
        if (!config.autoSync || !config.cloudApiKey) return;
        try {
            const raw = JSON.parse(StorageManager.exportData());
            const safe = StorageManager.stripSecrets(raw);   // 剥离 Key
            const binId = await APIManager.cloudBackup(safe, config.cloudApiKey);
            // 回填 binId + 记录本次同步时间（对齐云端 syncTime，避免下次误判云端更新）
            const c = StorageManager.getConfig();
            c.cloudBinId = binId;
            c.lastSyncTime = raw.syncTime;
            StorageManager.saveConfig(c);
            UIManager.showToast('☁️ 已自动同步到云端', 'success');
        } catch (e) {
            console.warn('自动同步失败:', e.message);
            UIManager.showToast(`自动同步失败: ${e.message}`, 'error');
        }
    }
    
    // 打开页面时检查云端是否更新（比对 syncTime，需确认后拉取）
    async function checkCloudUpdate() {
        const config = StorageManager.getConfig();
        if (!config.autoSync || !config.cloudApiKey || !config.cloudBinId) return;
        try {
            const data = await APIManager.cloudFetch(config.cloudApiKey, config.cloudBinId);
            if (!data || !data.assets || !Array.isArray(data.assets)) return;
            const remoteTime = data.syncTime || 0;
            const localTime = config.lastSyncTime || 0;
            if (remoteTime <= localTime) return;  // 云端不比本地新，无需处理
            
            const when = new Date(remoteTime).toLocaleString('zh-CN');
            if (!confirm(`云端有更新（${data.assets.length} 个资产，同步于 ${when}）。\n是否拉取并覆盖本地当前数据？`)) return;
            
            _suppressAutoSync = true;  // 拉取期间不触发自动上传
            try {
                StorageManager.clearAllData();
                StorageManager.importData(JSON.stringify(data));  // config 会保留本地 Key
                const c = StorageManager.getConfig();
                c.lastSyncTime = remoteTime;  // 对齐云端时间
                StorageManager.saveConfig(c);
                render();
                try { await UIManager.renderIndicators(); } catch(e) {}
                UIManager.showToast('☁️ 已从云端拉取最新数据', 'success');
            } finally {
                _suppressAutoSync = false;
            }
        } catch (e) {
            console.warn('检查云端更新失败:', e.message);
        }
    }
    
    // 公开API (供HTML onclick调用)
    window.App = {
        init,
        editAsset,
        deleteAsset,
        refreshAsset,
        recordDividend,
        reinvestDividend,
        deleteDividend,
        showBuyMoreModal,
        submitBuyMore,
        exportData,
        importData,
        recordPendingDividend,
        snoozePendingDividend,
        autoReinvestDividend
    };

    // 页面加载完成后初始化
    document.addEventListener('DOMContentLoaded', init);
    
    // 注册Service Worker (PWA)
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js').catch(() => {});
    }
    
    return {
        init,
        editAsset,
        deleteAsset,
        refreshAsset,
        recordDividend,
        reinvestDividend,
        deleteDividend,
        showBuyMoreModal,
        submitBuyMore,
        exportData,
        importData,
        recordPendingDividend,
        snoozePendingDividend,
        autoReinvestDividend
    };
})();
