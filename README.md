# 个人投资管理系统

一个纯前端的个人投资管理工具，帮助用户管理A股、港股、美股、基金等资产，支持实时行情查询。

## 🌟 功能特性

- **多市场支持**：A股、港股、美股、基金
- **实时行情**：自动获取最新价格、涨跌幅
- **资产组合**：支持添加、编辑、删除资产
- **盈亏计算**：自动计算持仓盈亏、收益率
- **数据持久化**：使用浏览器LocalStorage保存数据
- **响应式设计**：支持手机、电脑访问

## 📦 项目结构

```
investment-tracker/
├── index.html          # 主页面
├── css/
│   └── style.css      # 样式文件
├── js/
│   ├── storage.js     # 本地存储管理
│   ├── api.js         # API调用封装
│   ├── ui.js          # UI渲染
│   └── app.js         # 主逻辑
└── README.md          # 说明文档
```

## 🚀 部署到GitHub Pages

### 方法一：通过GitHub网页界面（推荐）

1. **创建GitHub仓库**
   - 登录GitHub，点击右上角"+"号，选择"New repository"
   - 仓库名填写：`investment-tracker`（或其他你喜欢的名字）
   - 选择"Public"（必须是Public才能使用GitHub Pages免费服务）
   - 勾选"Add a README file"
   - 点击"Create repository"

2. **上传文件**
   - 进入刚创建的仓库
   - 点击"Add file" -> "Upload files"
   - 将本项目的所有文件（`index.html`、`css/`文件夹、`js/`文件夹）拖拽上传
   - 在提交信息中填写"Initial commit"
   - 点击"Commit changes"

3. **启用GitHub Pages**
   - 进入仓库，点击"Settings"
   - 在左侧菜单找到"Pages"
   - 在"Build and deployment" -> "Branch"下，选择"main"分支
   - 点击"Save"
   - 等待1-2分钟，GitHub会生成一个访问链接，格式为：`https://你的用户名.github.io/investment-tracker/`

### 方法二：通过Git命令行

```bash
# 1. 克隆仓库到本地
git clone https://github.com/你的用户名/investment-tracker.git
cd investment-tracker

# 2. 复制项目文件到仓库目录
cp -r /path/to/investment-tracker/* .

# 3. 提交并推送
git add .
git commit -m "Initial commit"
git push origin main

# 4. 在GitHub网页上启用Pages（同方法一的步骤3）
```

## ⚙️ 配置API Key

部署完成后，打开网站，点击右上角的⚙️按钮，填入以下API Key：

### 1. Finnhub API Key（美股数据）

- **用途**：获取美股实时行情
- **获取方式**：访问 [Finnhub官网](https://finnhub.io) 注册免费账号，获取API Key
- **免费额度**：60 calls/minute

### 2. 必盈API Licence（A股数据）

- **用途**：获取A股实时行情
- **获取方式**：访问 [必盈API官网](https://www.bioringapi.com) 购买Licence
- **注意**：必盈API是付费服务

### 3. Yahoo Finance（港股数据）

- **用途**：获取港股实时行情
- **获取方式**：无需API Key，直接使用
- **注意**：Yahoo Finance是免费数据源，但可能不稳定

### 4. 天天基金网API（基金数据）

- **用途**：获取基金净值
- **获取方式**：无需API Key，直接使用
- **注意**：天天基金网是免费数据源

## ⚠️ CORS问题说明

由于本项目是纯前端应用，直接从浏览器调用API可能会遇到**CORS（跨域资源共享）**限制。以下是几种解决方案：

### 方案A：使用支持CORS的API（推荐）

部分API支持CORS，可以直接从浏览器调用：
- Finnhub：需要在API Key设置中启用"CORS Access"
- 必盈API：需要联系客服开通CORS支持

### 方案B：使用Cloudflare Workers作为代理

1. 注册 [Cloudflare Workers](https://workers.cloudflare.com/) 免费账号
2. 创建一个新的Worker，代码如下：

```javascript
addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request))
})

async function handleRequest(request) {
  const url = new URL(request.url)
  const targetUrl = url.searchParams.get('url')
  
  if (!targetUrl) {
    return new Response('Missing url parameter', { status: 400 })
  }
  
  const response = await fetch(targetUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0'
    }
  })
  
  const responseBody = await response.text()
  
  return new Response(responseBody, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Content-Type': response.headers.get('Content-Type') || 'application/json'
    }
  })
}
```

3. 部署Worker，获得一个`*.workers.dev`的URL
4. 修改`js/api.js`文件，将API调用改为通过Worker代理

### 方案C：使用本地代理（开发环境）

在本地运行一个简单的代理服务器：

```javascript
// proxy.js
const express = require('express');
const request = require('request');
const app = express();

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  next();
});

app.get('/proxy', (req, res) => {
  const url = req.query.url;
  request(url).pipe(res);
});

app.listen(3000, () => console.log('Proxy running on port 3000'));
```

然后在`js/api.js`中将API URL改为`http://localhost:3000/proxy?url=编码后的URL`

## 📱 使用说明

1. **添加资产**：点击"添加资产"按钮，选择资产类型，输入代码，点击"查询"自动获取名称和价格，填写成本价和持有数量，点击"保存"

2. **查看资产**：资产按类型分类显示，点击顶部标签页可切换查看

3. **刷新价格**：点击资产卡片右下角的"刷新"按钮可单独刷新该资产，或点击顶部"刷新数据"按钮批量刷新所有资产

4. **编辑/删除资产**：点击资产卡片右上角的✏️或🗑️按钮

5. **数据导出/导入**：目前需要通过浏览器开发者工具操作，后续版本会添加界面按钮

## 🔧 本地运行

由于是纯静态网站，可以直接用浏览器打开`index.html`文件，或使用简单的HTTP服务器：

```bash
# 使用Python
cd investment-tracker
python -m http.server 8080

# 使用Node.js
npx serve

# 然后使用浏览器访问 http://localhost:8080
```

## 📝 注意事项

1. **数据安全**：所有数据保存在浏览器LocalStorage中，清除浏览器数据会导致数据丢失，请定期导出备份

2. **API限制**：免费API通常有调用频率限制，请合理使用

3. **数据延迟**：免费API的数据可能有延迟，请以官方数据为准

4. **免责声明**：本工具仅供参考，不构成投资建议

## 🐛 已知问题

1. **CORS限制**：部分API可能因CORS限制无法直接调用，需要使用代理方案
2. **港股名称查询**：目前无法自动获取港股名称，需要手动输入
3. **基金净值更新频率**：基金净值通常每天更新一次，盘中显示的是估算净值

## 🔄 后续计划

- [ ] 添加数据导出/导入界面
- [ ] 添加资产组合分析图表
- [ ] 支持更多数据源
- [ ] 添加价格提醒功能
- [ ] 支持多币种显示

## 📄 许可证

MIT License

## 🙏 致谢

- [Finnhub](https://finnhub.io) - 美股数据API
- [必盈API](https://www.biyingapi.com) - A股数据API
- [Yahoo Finance](https://finance.yahoo.com) - 港股数据
- [天天基金网](https://fund.eastmoney.com) - 基金净值数据
