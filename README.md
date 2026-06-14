# 个人投资管理系统

纯前端单页应用，管理 **A股、港股、美股、基金** 的持仓和盈亏。大部分数据源零配置直连，开箱即用。

## 数据源

| 模式 | 股票 | 基金 |
|------|------|------|
| **默认** | 腾讯财经 qt.gtimg.cn (HTTPS直连) | 天天基金 JSONP → 失败回退东方财富历史净值 → 再回退代理 |
| **备选** | 同上 | 东方财富历史净值 (`<script>` 注入) |
| **备用API** | Finnhub(美股) + 必盈(A股) + Yahoo(港股) | 天天基金 → 代理 |

> ⚙️ 设置中取消勾选默认即切换为备用 API。基金备选覆盖 006327/006328 等天天基金不支持的 QDII 联接基金。

## 功能

- **四市场覆盖**：A股 / 港股 / 美股 / 场外基金
- **零配置开箱即用**：默认腾讯财经 + 天天基金 JSONP，无需 API Key
- **基金兜底**：天天基金不支持 006327/006328 时自动回退东方财富历史净值
- **智能识别**：输入代码自动判断市场（字母→美股，1-5位→港股，6位→A股）
- **港股模糊输入**：`3968` 和 `03968` 都能查到招商银行
- **多币种显示**：美股 $ / 港股 HK$ / A股基金 ¥，总览统一人民币
- **当日收益**：含时区修正，非交易时段置灰
- **自定义品种分类**：默认红利/纳指100/标普500，可自行添加
- **净值走势图**：每日自动快照（最多 90 天折线图）
- **饼图**：市场分布 + 品种分布（人民币换算）
- **数据导出/导入**：JSON 备份恢复
- **PWA**：可添加到主屏幕，离线缓存
- **响应式**：桌面 4 列 / 平板 2-3 列 / 手机 1 列

## 快速开始

### GitHub Pages

1. 创建 Public 仓库，上传所有文件
2. Settings → Pages → 选 `main` 分支 → Save
3. 打开 `https://用户名.github.io/仓库名/`，直接使用

### 本地运行

```bash
python -m http.server 8080
# 或直接用浏览器打开 index.html
```

## 设置

默认模式**无需任何配置**。

### 基金备选（东方财富历史净值）

在 ⚙️ 设置中勾选「基金备选：东方财富历史净值」后，所有基金改走东方财富 `<script>` 注入方式。适用于天天基金不支持的 QDII 联接基金。

### 备用 API（取消默认勾选后启用）

| 配置项 | 用途 | 获取方式 |
|--------|------|---------|
| Finnhub API Key | 美股 | [finnhub.io](https://finnhub.io) 免费注册 |
| 必盈API Licence | A股 | [biyingapi.com](https://www.biyingapi.com) |
| CORS代理URL | 港股 + 基金 | 默认 corsproxy.io，或自建 Worker |

### CORS 代理（选填）

基金 JSONP 优先直连，失败时自动回退到代理。默认 corsproxy.io，也可自建 Cloudflare Worker：

```javascript
// proxy-worker.js
export default {
  async fetch(request) {
    const url = new URL(request.url);
    const target = url.searchParams.get('url');
    if (!target) return new Response('Missing ?url=', { status: 400 });
    const resp = await fetch(target, {
      headers: { 'Referer': new URL(target).origin + '/' }
    });
    return new Response(resp.body, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': resp.headers.get('Content-Type') || 'text/plain'
      }
    });
  }
};
```

## 使用

1. 点击「添加资产」，输入代码，自动识别市场
2. 点击「查询」获取名称和最新价
3. 填写成本价和持有数量，保存
4. 卡片上的「刷新」更新单个资产
5. 顶部「刷新数据」批量刷新
6. 📥 导出 / 📤 导入 备份恢复数据

## 文件结构

```
├── index.html          # 主页
├── manifest.json       # PWA 配置
├── sw.js              # Service Worker
├── proxy-worker.js    # Cloudflare Worker 代码
├── css/style.css      # 样式
├── js/
│   ├── storage.js     # 本地存储
│   ├── api.js         # API（腾讯/天天基金/东方财富/必盈/Finnhub）
│   ├── ui.js          # UI 渲染
│   └── app.js         # 主逻辑
└── README.md
```

## 注意事项

- 数据保存在 localStorage，清缓存会丢失，请定期导出
- 天天基金和东方财富均为免费公开接口，不保证永久可用
- **免责声明：不构成投资建议，仅供参考**
