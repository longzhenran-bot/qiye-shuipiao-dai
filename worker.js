// 企业税票贷：微信申请专用、受限 Supabase HTTPS 转发入口。
// /api/auth-health 检查代理到 Supabase Auth 的连通性。
// 不包含任何 service_role / secret key；后台仍由 Supabase Auth + RLS 验证。
const SUPABASE_ORIGIN = 'https://verzesghsasjhpbozmgw.supabase.co';
const SITE_ORIGIN = 'https://longzhenran-bot.github.io';
const PUBLIC_KEY = 'sb_publishable_mEsqewvVT_kVKzdFaXyEwA_M17G4Dyy';
const MAX_JSON_BYTES = 64 * 1024;
const MAX_UPLOAD_BYTES = 16 * 1024 * 1024;
const AUTH_PATHS = new Map([
  ['/auth/v1/signup', new Set(['POST'])],
  ['/auth/v1/token', new Set(['POST'])],
  ['/auth/v1/user', new Set(['GET'])],
  ['/auth/v1/logout', new Set(['POST'])],
  ['/auth/v1/health', new Set(['GET'])],
]);
const FUNCTION_ROUTES = new Map([
  ['/applications/secure', new Set(['POST'])],
  ['/applications', new Set(['GET'])],
  ['/notifications', new Set(['GET'])],
  ['/notifications/read', new Set(['POST'])],
]);
const ALLOWED_FORWARD_HEADERS = [
  'apikey','authorization','content-type','accept','x-client-info',
  'x-supabase-api-version','x-upsert','cache-control','prefer',
  'x-supabase-client-platform','x-supabase-client-platform-version',
  'x-supabase-client-runtime','x-supabase-client-runtime-version'
];

function corsHeaders() {
  return {
    'access-control-allow-origin': SITE_ORIGIN,
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': ALLOWED_FORWARD_HEADERS.join(','),
    'access-control-max-age': '600',
    'access-control-expose-headers': 'content-range,etag,x-total-count',
    'vary': 'Origin',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  };
}
function json(data, status=200, cors=false) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type':'application/json; charset=utf-8',
      'cache-control':'no-store',
      'x-content-type-options':'nosniff',
      ...(cors ? corsHeaders() : {}),
    }
  });
}
function permittedRoute(path, method) {
  if (AUTH_PATHS.get(path)?.has(method)) return true;
  const fPrefix = '/functions/v1/qiye-api';
  if (path.startsWith(fPrefix + '/')) {
    const route = path.slice(fPrefix.length);
    return FUNCTION_ROUTES.get(route)?.has(method) || false;
  }
  if (path === '/storage/v1/object/list/loan-documents-private') {
    return method === 'POST';
  }
  if (method === 'POST' && path.startsWith('/storage/v1/object/loan-documents-private/')) {
    const item = path.slice('/storage/v1/object/loan-documents-private/'.length);
    // Uploads only under <anonymous_user_uuid>/<application_uuid>/<document_kind>.<extension>
    return /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/(?:id-front|id-back|business-license)\.(?:jpg|jpeg|png|webp|pdf)$/i.test(item);
  }
  return false;
}

export default {
  async fetch(request, env) {
    const incoming = new URL(request.url);
    if (incoming.pathname === '/api/health' && request.method === 'GET') {
      return json({status:'ok',service:'qiye-shuipiao-dai'});
    }
    // Probe the configured project's Auth endpoint with its public API key.
    if (incoming.pathname === '/api/auth-health' && request.method === 'GET') {
      const aborter = new AbortController();
      const timer = setTimeout(() => aborter.abort(), 4000);
      try {
        const response = await fetch(SUPABASE_ORIGIN + '/auth/v1/health', {
          method:'GET', redirect:'manual', signal: aborter.signal,
          headers: {accept:'application/json', apikey:PUBLIC_KEY},
        });
        return json({
          worker:'ok',
          authentication_upstream: response.ok ? 'reachable' : 'upstream_error',
          upstream_http_status: response.status,
        }, response.ok ? 200 : 502, true);
      } catch (_) {
        return json({worker:'ok',authentication_upstream:'unreachable'}, 503, true);
      } finally { clearTimeout(timer); }
    }
    // Preserve old diagnostic endpoint; no database secret in frontend or output.
    if (incoming.pathname === '/api/db-health' && request.method === 'GET') {
      if (!env.SUPABASE_SECRET_KEY) {
        return json({status:'unavailable'},503);
      }
      try {
        const response = await fetch(SUPABASE_ORIGIN + '/rest/v1/loan_applications?select=id&limit=0', {
          headers:{apikey:env.SUPABASE_SECRET_KEY}, redirect:'manual',
        });
        return json({database:response.ok?'connected':'unavailable'},response.ok?200:503);
      } catch (_) { return json({database:'unavailable'},503); }
    }

    // Accept the published GitHub Pages routes and the older /proxy/ prefix.
    const path = incoming.pathname.startsWith('/proxy/')
      ? incoming.pathname.slice('/proxy'.length)
      : incoming.pathname;
    const method = request.method === 'OPTIONS'
      ? request.headers.get('access-control-request-method')
      : request.method;
    const origin = request.headers.get('origin');
    // This only restricts ordinary browser access; it is not a substitute for Auth/RLS.
    if (origin !== SITE_ORIGIN) return json({error:'origin_not_allowed'},403);
    if (!permittedRoute(path,method)) return json({error:'route_not_allowed'},404,true);
    if (request.method === 'OPTIONS') {
      return new Response(null,{status:204,headers:corsHeaders()});
    }
    if (request.headers.get('apikey') !== PUBLIC_KEY) return json({error:'invalid_public_key'},401,true);
    if (!path.startsWith('/auth/v1/') && !/^Bearer\s+[^\s]+$/i.test(request.headers.get('authorization')||'')) {
      return json({error:'authentication_required'},401,true);
    }
    const isUpload = path.startsWith('/storage/v1/object/loan-documents-private/');
    const maxBytes = isUpload ? MAX_UPLOAD_BYTES : MAX_JSON_BYTES;
    const bodyLength = Number(request.headers.get('content-length'));
    if (Number.isFinite(bodyLength) && bodyLength > maxBytes) return json({error:'payload_too_large'},413,true);

    // Fixed upstream only: no user-supplied target URL, no admin/service key forwarding.
    const target = SUPABASE_ORIGIN + path + incoming.search;
    const headers = new Headers();
    for (const name of ALLOWED_FORWARD_HEADERS) {
      const value = request.headers.get(name);
      if (value != null) headers.set(name,value);
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(),isUpload?45000:18000);
    try {
      const upstream = await fetch(target,{
        method:request.method,
        headers,
        body:(request.method === 'GET'||request.method === 'HEAD')?undefined:request.body,
        redirect:'manual',signal:controller.signal,
      });
      const out = new Headers(upstream.headers);
      for (const name of ['access-control-allow-origin','access-control-allow-credentials',
        'access-control-allow-methods','access-control-allow-headers','access-control-expose-headers',
        'access-control-max-age','set-cookie','content-length']) out.delete(name);
      for (const [name,value] of Object.entries(corsHeaders())) out.set(name,value);
      return new Response(upstream.body,{status:upstream.status,headers:out});
    } catch (_) {
      return json({error:'upstream_unavailable',message:'认证或上传服务器暂时无法连接，请稍后重试'},503,true);
    } finally {clearTimeout(timeout);}
  }
};
