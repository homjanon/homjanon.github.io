# 个人投资管理系统

纯前端单页应用，管理 **A股、港股、美股、基金** 的持仓和盈亏，支持实时行情查询。数据保存在浏览器本地，无需后端。

## 功能

- **四市场覆盖**：A股 / 港股 / 美股 / 场外基金
- **智能识别**：输入代码自动判断市场类型（字母→美股，1-5位数字→港股）
- **港股模糊输入**：`3968` 和 `03968` 都能查到招商银行
- **多币种显示**：美股 $、港股 HK$、A股/基金 ¥，总览统一换算人民币
- **当日收益**：每个资产和总览显示当日收益额/收益率，美股做时区修正
- **自定义品种分类**：默认红利/纳指100/标普500，可自行添加
- **净值走势图**：每日自动记录总资产快照，折线图展示（最多90天）
- **饼图**：市场分布 + 品种分布（按汇率换算为人民币）
- **数据导出/导入**：一键备份恢复，防丢失
- **PWA 支持**：手机可添加到主屏幕，离线可用
- **响应式**：桌面端 4 列，平板 2-3 列，手机 1 列
- **演示模式**：无 API Key 时使用模拟数据完整体验

## 数据源

| 资产类型 | 默认数据源 | 费用 | 需要代理 |
|----------|-----------|------|----------|
| A股 | 腾讯财经 (qt.gtimg.cn) | 免费 | 否 |
| 港股 | 腾讯财经 (qt.gtimg.cn) | 免费 | 否 |
| 美股 | 腾讯财经 (qt.gtimg.cn) | 免费 | 否 |
| 基金 | 天天基金网 (fundgz.1234567.com.cn) | 免费 | **是** |

> 在 ⚙️ 设置中可关闭"腾讯财经"，改回 Finnhub / 必盈 API。

## 快速开始

### GitHub Pages 部署

1. 创建一个 Public 仓库，上传所有文件
2. Settings → Pages → Source 选 `main` 分支 → Save
3. 访问 `https://你的用户名.github.io/仓库名/`

### 本地运行

直接用浏览器打开 `index.html`，或：

```bash
python -m http.server 8080
# http://localhost:8080
```

## 配置

### 腾讯财经（推荐，零配置）

打开 ⚙️ 设置 → 勾选「使用腾讯财经」。A股/港股/美股行情直接可用，无需 API Key。

### Cloudflare Worker 代理（基金必需）

1. 注册 [Cloudflare Workers](https://workers.cloudflare.com)（免费，每日 10 万次请求）
2. 创建 Worker，贴入以下代码：

```javascript
export default {
  async fetch(request) {
    const url = new URL(request.url);
    const target = url.searchParams.get('url') || url.searchParams.get('quest');
    if (!target) return new Response('Missing url parameter', { status: 400 });
    const resp = await fetch(decodeURIComponent(target), {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    return new Response(await resp.text(), {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': resp.headers.get('Content-Type') || 'text/plain'
      }
    });
  }
};
```

3. 部署后获得 `https://xxx.workers.dev` 地址
4. 在 ⚙️ 设置的 **CORS代理URL** 中填入 `https://xxx.workers.dev/?url=`

### 备用 API（可选）

| 配置项 | 用途 | 获取方式 |
|--------|------|---------|
| Finnhub API Key | 美股 + 港股（腾讯财经备选） | [finnhub.io](https://finnhub.io) 免费注册 |
| 必盈API Licence | A股（腾讯财经备选） | [biyingapi.com](https://www.biyingapi.com) |

## 使用说明

1. 点击「添加资产」
2. 输入代码（自动识别市场），点击「查询」获取名称和最新价
3. 填写成本价、持有数量，选择投资品种，保存
4. 资产卡片上的「刷新」按钮更新单个价格
5. 顶部「刷新数据」批量刷新全部持仓
6. 📥 导出 / 📤 导入 可备份和恢复数据

## 文件结构

```
├── index.html          # 主页
├── manifest.json       # PWA 配置
├── sw.js              # Service Worker（离线缓存）
├── proxy-worker.js    # Cloudflare Worker 代码
├── css/style.css      # 样式
├── js/
│   ├── storage.js     # 本地存储
│   ├── api.js         # API 调用（Finnhub/必盈/腾讯/天天基金）
│   ├── ui.js          # UI 渲染
│   └── app.js         # 主逻辑
└── README.md
```

## 注意事项

- 数据保存在浏览器 localStorage，清缓存会丢失，请定期导出备份
- 基金需要通过 Cloudflare Worker 代理访问天天基金网
- 免费 API 数据可能有延迟，仅供参考
- **免责声明：本工具不构成投资建议**
