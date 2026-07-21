# 个人投资管理系统

纯前端单页应用，管理 **A股 / 港股 / 美股 / 场外基金** 的持仓和盈亏。大部分数据源零配置直连，开箱即用。

## 功能概览

- **四市场覆盖**：A股 / 港股 / 美股 / 场外基金
- **基金双源**：东方财富 pingzhongdata（主，浏览器直连） + 蛋卷 djapi（备用，经通用 CORS 代理，数据质量优于新浪 fu_）
- **市场估值指标**：VIX 恐慌指数 + 纳指100/标普500/沪深300/创业板/红利低波 PE（TTM），基于蛋卷/雪球历史百分位分类
- **智能代码识别**：字母→美股，1-5位→港股，6位自动探测 A股/场内ETF 与场外基金（腾讯财经命中→A股/ETF，东方财富命中→场外基金）
- **多币种换算**：美股 $ / 港股 HK$ / A股基金 ¥，总览统一人民币
- **当日收益**：含时区修正，非交易时段显示休市状态
- **自定义分类**：默认红利/纳指100/标普500，可自行添加
- **饼图**：市场分布 + 品种分布（人民币换算）
- **云端备份**：JSONBin 一键备份/导入，跨设备同步
- **数据导出/导入**：JSON 文件备份恢复
- **基金补仓**：按加仓金额与加仓当日单位净值加权计算新增份额与成本价，默认同步扣减对应币种现金余额；当天净值由东方财富自动获取（可修改），历史日期可手动输入净值
- **PWA**：可添加到主屏幕，离线缓存
- **响应式**：桌面 / 平板 / 手机自适应

---

## 快速开始

### GitHub Pages

1. Fork 或创建 Public 仓库，上传所有文件
2. Settings → Pages → 选 `main` 分支 → Save
3. 打开 `https://用户名.github.io/仓库名/`，直接使用

### 本地运行

```bash
# 任意静态服务器
python -m http.server 8080
# 或直接用浏览器打开 index.html（部分功能需 localhost）
```

---

## 数据路由

| 线路 | 勾选 | 股票 | 基金（主源→备用，自动切换） |
|------|------|------|------|
| **一（默认）** | 线路一 ✓ | 腾讯财经 qt.gtimg.cn | 东方财富 pingzhongdata → 蛋卷 djapi（需代理） |
| **二** | 线路二 ✓ | 腾讯财经 qt.gtimg.cn | 东方财富 pingzhongdata → 蛋卷 djapi（需代理） |
| **三** | 都不勾 | Finnhub(美股) + 必盈(A股) + Yahoo(港股) | 东方财富 pingzhongdata → 蛋卷 djapi（需代理） |

> 基金数据：主源东方财富 `pingzhongdata`（浏览器直连、免代理免鉴权）；备用蛋卷 `djapi/fund/{code}`（免登录/免 Referer、UTF-8 干净 JSON，但响应无 CORS 头，须经「通用 CORS 代理」转发，详见下方）。天天基金接口已于2026年全面失效(返回404)，已从代码中移除；新浪 `fu_` 因覆盖不全（部分基金返回空）且需 GB18030 解码，已弃用并替换为蛋卷。
> 线路一/二免 API Key 开箱即用（股票均走腾讯，基金源一致）。线路三需自行申请 Finnhub 和必盈 Key。

### 场外基金备用源：蛋卷 djapi（需自建代理）

蛋卷 `https://danjuanfunds.com/djapi/fund/{代码}` 免登录、免 Referer，返回干净的 UTF-8 JSON（含名称/单位净值/日期/日涨幅），覆盖全（含东方财富/新浪查不到的基金）。但服务端**不返回 CORS 头**，浏览器直连与公共 CORS 代理（codetabs/allorigins）均被跨域拦截。

**启用方法**：部署一个 Cloudflare Worker（约 15 行）作为通用 CORS 代理，把其地址填到设置页的「CORS 代理 URL」即可。Worker 示例：

```js
// Cloudflare Worker：通用 CORS 代理（蛋卷等无 CORS 头资源经此转发）
export default {
  async fetch(request) {
    const url = new URL(request.url);
    const target = url.searchParams.get('url');
    if (!target) return new Response('missing url', { status: 400 });
    const upstream = await fetch(target, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const resp = new Response(upstream.body, upstream);
    resp.headers.set('Access-Control-Allow-Origin', '*');
    return resp;
  }
};
```

> 若不部署该代理，蛋卷备用会静默失败，基金仍由东方财富主源提供（无副作用）。该 Worker 同时可作为通用 CORS 代理提升整体可靠性。

### 市场估值指标

| 指标 | 数据源 | 刷新策略 |
|------|--------|----------|
| **VIX 恐慌指数** | Yahoo Finance v8 | 半天缓存（同 am/pm 时段不重拉） |
| **小旭恐惧指数(XXFI)** | raw GitHub 跨仓库 `homjanon/xiaoxu-fear/main/output/xxfi_report.json` | **实时拉取，不缓存**（每次刷新取最新，卡片显示数据日期） |
| **纳指100 PE** | 蛋卷/雪球 danjuanfunds.com | 半天缓存（同 am/pm 时段不重拉） |
| **标普500 PE** | 蛋卷/雪球 | 同上 |
| **沪深300 PE** | 蛋卷/雪球 | 同上 |
| **创业板 PE** | 蛋卷/雪球 | 同上 |
| **红利低波 PE** | 蛋卷/雪球 | 同上 |

> **刷新策略说明**：VIX 与五大指数 PE 来自 Yahoo / 蛋卷，按自身节奏更新，采用「日期 + 上午/下午」半天缓存以减少请求，同半天内刷新浏览器不重新拉取；**小旭恐惧指数(XXFI) 为跨仓库产物（xiaoxu-fear 可随时手动重跑），故改为实时拉取、不缓存**，每次刷新都取 `xxfi_report.json` 最新值，卡片显示其 `数据日期` 便于判断新鲜度。银行五维、秋哥操作同理为实时拉取、不缓存。
>
> PE 分位直接使用蛋卷/雪球内置 `eva_type` 分类（低估 / 正常 / 高估）。

---

## 设置

### API Key（线路三）

| 配置项 | 用途 | 获取方式 |
|--------|------|---------|
| Finnhub API Key | 美股行情 | [finnhub.io](https://finnhub.io) 免费注册 |
| 必盈 API Licence | A股行情 | [biyingapi.com](https://www.biyingapi.com) |
| CORS 代理 URL | 港股 + 基金回退 | 默认 corsproxy.io，或自建 Cloudflare Worker |

> 线路一、二无需任何 API Key。

### 云端备份

1. 注册 [JSONBin.io](https://jsonbin.io) → API Keys 获取 Master Key
2. 在设置页填入 Key，点击「☁️ 备份到云端」
3. Bin ID 自动保存。换设备时粘贴同一个 Key + Bin ID 即可导入

### 清除数据

设置页底部的「🗑️ 清除所有数据」会清除全部资产、配置和指标缓存。

---

## 使用

1. 点击「添加资产」，输入代码自动识别市场
2. 点击「查询」获取名称和最新价
3. 填写成本价和持有数量，保存
4. 卡片上的「刷新」更新单个资产
5. 顶部「刷新数据」批量刷新全部资产 + 市场指标
6. 基金卡片上的「补仓」可按加仓金额与加仓当日单位净值加权计算份额与成本价；当天净值由东方财富自动获取（可修改），历史日期请手动输入当日净值，默认同步扣减对应币种现金
7. 📥 导出 / 📤 导入 JSON 文件备份恢复

---

## 文件结构

```
├── index.html          # 主页
├── manifest.json       # PWA 配置
├── sw.js              # Service Worker
├── css/style.css      # 样式
├── js/
│   ├── storage.js     # 本地存储（localStorage）
│   ├── api.js         # API 层（腾讯/东方财富pingzhongdata/蛋卷djapi/雪球/Yahoo/JSONBin）
│   ├── ui.js          # UI 渲染（资产列表/饼图/指标卡）
│   └── app.js         # 主逻辑（初始化/事件/刷新/导入导出）
└── README.md
```

---

## 注意事项

- 数据保存在浏览器 localStorage，清缓存会丢失，请定期云端或文件备份
- 数据接口均为公开免费来源，不保证永久可用
- 市场估值仅供投资参考，不构成任何买卖建议
- **免责声明：本工具不构成投资建议，投资有风险，决策需谨慎**
