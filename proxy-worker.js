/**
 * Cloudflare Worker — CORS 代理（支持 POST + 透传请求头）
 *
 * 用途：让 GitHub Pages 等静态站点（*.github.io）能够跨域调用
 *       需要 Authorization 的 LLM /chat/completions 接口。
 *
 * 调用方式：浏览器向本 Worker 发请求，目标地址放在 ?url= 参数里（需 encodeURIComponent）：
 *   https://cors-proxy.homjanon.workers.dev/?url=https%3A%2F%2Fintegrate.api.nvidia.com%2Fv1%2Fchat%2Fcompletions
 *
 * 本 Worker 会：
 *   1. 处理浏览器 CORS 预检（OPTIONS），放行 POST 与 Authorization
 *   2. 透传 POST 请求体（含 base64 图片）与请求头（含 Authorization / Content-Type）
 *   3. 把上游响应原样回传，并补上 CORS 响应头
 *
 * 部署：
 *   方式 A（推荐）：wrangler deploy（仓库根目录放 wrangler.toml + 本文件）
 *   方式 B：Cloudflare 控制台 → Workers → 新建/编辑 → 粘贴本代码 → Deploy
 *   部署后域名即 https://cors-proxy.homjanon.workers.dev
 */

export default {
  async fetch(request) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': '*',
    };

    // 1) 预检请求：直接返回 CORS 头，不放行具体逻辑
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // 2) 解析目标地址
    const url = new URL(request.url);
    const targetParam = url.searchParams.get('url') || url.searchParams.get('quest');
    if (!targetParam) {
      return new Response('Missing ?url= parameter', { status: 400, headers: corsHeaders });
    }
    const targetUrl = decodeURIComponent(targetParam);

    try {
      // 3) 只转发必要的请求头，丢弃 hop-by-hop / 浏览器私有头
      //    （host / origin / referer / content-length / accept-encoding 等由运行时自动处理）
      const skip = new Set([
        'host', 'origin', 'referer', 'connection', 'content-length',
        'accept-encoding', 'sec-fetch-site', 'sec-fetch-mode', 'sec-fetch-dest',
        'cf-connecting-ip', 'cf-ray', 'cf-visitor', 'cf-request-id'
      ]);
      const headers = new Headers();
      for (const [k, v] of request.headers) {
        if (skip.has(k.toLowerCase())) continue;
        headers.set(k, v);
      }

      // 4) 构造转发请求：透传方法、头；非 GET/OPTIONS 时透传请求体（流式）
      const init = { method: request.method, headers };
      if (request.method !== 'GET' && request.method !== 'OPTIONS') {
        init.body = request.body;
      }

      const resp = await fetch(targetUrl, init);

      // 5) 回传响应：补 CORS 头，删除会与流式 body 冲突的响应头
      const out = new Headers(resp.headers);
      out.set('Access-Control-Allow-Origin', '*');
      out.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      out.set('Access-Control-Allow-Headers', '*');
      out.delete('content-length');
      out.delete('content-encoding');

      return new Response(resp.body, {
        status: resp.status,
        statusText: resp.statusText,
        headers: out,
      });
    } catch (error) {
      return new Response(`Proxy Error: ${error.message}`, { status: 502, headers: corsHeaders });
    }
  }
};
