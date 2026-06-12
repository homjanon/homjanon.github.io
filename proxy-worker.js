/**
 * Cloudflare Worker — CORS代理
 * 
 * 免费部署，解决浏览器调用金融API时的跨域限制。
 * 部署后得到类似 https://your-name.workers.dev 的URL，
 * 填入网站的"API配置 → CORS代理URL"中即可。
 * 
 * 部署步骤：
 * 1. 注册 https://workers.cloudflare.com （免费）
 * 2. 创建新Worker，粘贴此代码
 * 3. 点击"部署"，获得 *.workers.dev 域名
 * 4. 将域名填入网站设置中的"CORS代理URL"
 */

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request))
})

async function handleRequest(request) {
  const url = new URL(request.url);
  const targetUrl = url.searchParams.get('url') || url.searchParams.get('quest');
  
  if (!targetUrl) {
    return new Response('Missing ?url= parameter', { 
      status: 400,
      headers: { 'Access-Control-Allow-Origin': '*' }
    });
  }
  
  try {
    const decodedUrl = decodeURIComponent(targetUrl);
    
    const response = await fetch(decodedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; InvestmentTracker/1.0)'
      }
    });
    
    const body = await response.text();
    
    // 返回原响应内容，并附加CORS头
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': '*',
        'Content-Type': response.headers.get('Content-Type') || 'text/plain'
      }
    });
  } catch (error) {
    return new Response(`Proxy Error: ${error.message}`, {
      status: 502,
      headers: { 'Access-Control-Allow-Origin': '*' }
    });
  }
}
