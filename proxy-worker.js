/**
 * Cloudflare Worker — CORS代理
 * 
 * 支持通过 ?url=TARGET_URL 参数代理任意HTTP/HTTPS请求。
 * 部署后填入网站的"API配置 → CORS代理URL"中使用。
 * 
 * 部署步骤：
 * 1. 注册 https://workers.cloudflare.com（免费）
 * 2. 创建Worker，粘贴此代码
 * 3. 部署，获得 https://xxx.workers.dev 域名
 * 4. 将域名填入设置中的 CORS代理URL（直接填域名，不带 ?url=）
 */

export default {
  async fetch(request) {
    // 处理预检请求
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': '*'
        }
      });
    }

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
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });

      const body = await response.text();
      return new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
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
};
