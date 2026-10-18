import { createClient } from 'npm:@supabase/supabase-js@2';
import CryptoJS from 'npm:crypto-js@4.2.0';

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info',
  'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
  'access-control-max-age': '86400',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});
const fail = (message: string, status = 400) => json({ error: message }, status);
const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
function getPublishableKey() {
  const namedKeys = Deno.env.get('SUPABASE_PUBLISHABLE_KEYS');
  if (namedKeys) {
    try {
      const keys = JSON.parse(namedKeys);
      if (keys.default) return keys.default;
    } catch { /* fall back to the legacy environment variable */ }
  }
  return Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('SUPABASE_PUBLISHABLE_KEY') || '';
}
const supabaseKey = getPublishableKey();
const encryptionKey = await importEncryptionKey(Deno.env.get('APP_ENCRYPTION_KEY') || '');
const endpoint = Deno.env.get('TOP_ENDPOINT') || 'https://api.taobao.com/router/rest';

function fromBase64(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
function toBase64(value: Uint8Array) {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary);
}
async function importEncryptionKey(value: string) {
  if (!value) return null;
  let raw: Uint8Array;
  if (/^[a-f\d]{64}$/i.test(value)) raw = Uint8Array.from(value.match(/.{2}/g)!, (byte) => parseInt(byte, 16));
  else {
    try { raw = fromBase64(value); } catch { raw = new TextEncoder().encode(value); }
    if (raw.length !== 32) raw = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  }
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
async function sealCredentials(credentials: Record<string, string>) {
  if (!encryptionKey) throw new Error('הצפנת פרטי החשבון לא הוגדרה בשרת.');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, encryptionKey, new TextEncoder().encode(JSON.stringify(credentials))));
  const ciphertext = encrypted.slice(0, -16);
  const tag = encrypted.slice(-16);
  return { secret_iv: toBase64(iv), secret_ciphertext: toBase64(ciphertext), secret_tag: toBase64(tag) };
}
async function openCredentials(row: Record<string, string>) {
  if (!encryptionKey) throw new Error('הצפנת פרטי החשבון לא הוגדרה בשרת.');
  const encrypted = new Uint8Array([...fromBase64(row.secret_ciphertext), ...fromBase64(row.secret_tag)]);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(row.secret_iv), tagLength: 128 }, encryptionKey, encrypted);
  return JSON.parse(new TextDecoder().decode(plaintext));
}
async function readJson(req: Request) {
  const text = await req.text();
  if (text.length > 32_000) throw Object.assign(new Error('בקשה גדולה מדי.'), { status: 413 });
  try { return JSON.parse(text || '{}'); } catch { throw Object.assign(new Error('תוכן הבקשה אינו תקין.'), { status: 400 }); }
}
async function requireUser(req: Request) {
  const token = req.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) throw Object.assign(new Error('יש להתחבר כדי להמשיך.'), { status: 401 });
  const client = createClient(supabaseUrl, supabaseKey, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) throw Object.assign(new Error('פג תוקף ההתחברות. יש להתחבר שוב.'), { status: 401 });
  return { client, user: data.user };
}
function topTimestamp() {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', dateStyle: 'short', timeStyle: 'medium', hour12: false }).format(new Date()).replace(',', '');
}
async function createAffiliateLink(sourceUrl: string, credentials: Record<string, string>) {
  let productUrl: URL;
  try { productUrl = new URL(sourceUrl); } catch { throw Object.assign(new Error('הדבק כתובת מוצר תקינה.'), { status: 400 }); }
  if (!['https:', 'http:'].includes(productUrl.protocol) || productUrl.username || productUrl.password || !(productUrl.hostname === 'aliexpress.com' || productUrl.hostname.endsWith('.aliexpress.com')))
    throw Object.assign(new Error('הכתובת חייבת להיות כתובת מוצר של AliExpress.'), { status: 400 });
  const params: Record<string, string> = {
    app_key: credentials.appKey, format: 'json', method: 'aliexpress.affiliate.link.generate', sign_method: 'hmac', timestamp: topTimestamp(), v: '2.0',
    promotion_link_type: '0', source_values: productUrl.href, tracking_id: credentials.trackingId,
  };
  const base = Object.keys(params).sort().map((key) => key + params[key]).join('');
  params.sign = CryptoJS.HmacMD5(base, credentials.appSecret).toString().toUpperCase();
  let response: Response;
  let data: any;
  try {
    response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded;charset=utf-8' }, body: new URLSearchParams(params), signal: AbortSignal.timeout(15_000) });
    data = await response.json();
  } catch { throw Object.assign(new Error('לא ניתן להתחבר ל־AliExpress API כרגע.'), { status: 502 }); }
  const result = data?.aliexpress_affiliate_link_generate_response?.resp_result;
  const entry = result?.result?.promotion_links?.promotion_link;
  const first = Array.isArray(entry) ? entry[0] : entry;
  if (!response.ok || result?.resp_code !== 200 || !first?.promotion_link) {
    const apiError = data?.error_response?.sub_msg || data?.error_response?.msg || result?.resp_msg;
    throw Object.assign(new Error(`AliExpress לא יצר קישור: ${apiError || 'תשובה לא צפויה מה־API.'}`), { status: 502 });
  }
  let promoted: URL;
  try { promoted = new URL(first.promotion_link); } catch { throw Object.assign(new Error('AliExpress החזיר כתובת קישור לא תקינה.'), { status: 502 }); }
  if (!['http:', 'https:'].includes(promoted.protocol) || promoted.hostname !== 's.click.aliexpress.com')
    throw Object.assign(new Error('AliExpress החזיר כתובת קישור לא צפויה.'), { status: 502 });
  return { link: promoted.href, source: first.source_value || productUrl.href };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const url = new URL(req.url);
    const path = url.pathname.split('/').filter(Boolean).slice(-1)[0];
    const { client, user } = await requireUser(req);

    if (req.method === 'GET' && path === 'settings') {
      const { data, error } = await client.from('affiliate_credentials').select('user_id').eq('user_id', user.id).maybeSingle();
      if (error) throw error;
      return json({ configured: Boolean(data) });
    }
    if (req.method === 'POST' && path === 'settings') {
      const input = await readJson(req);
      const { data: current, error: readError } = await client.from('affiliate_credentials').select('secret_iv,secret_ciphertext,secret_tag').eq('user_id', user.id).maybeSingle();
      if (readError) throw readError;
      const existing = current ? await openCredentials(current) : {};
      const credentials = {
        appKey: String(input.appKey || '').trim() || existing.appKey || '',
        appSecret: String(input.appSecret || '').trim() || existing.appSecret || '',
        trackingId: String(input.trackingId || '').trim() || existing.trackingId || '',
      };
      if (!credentials.appKey || !credentials.appSecret || !credentials.trackingId) return fail('צריך למלא את שלושת הפרטים בפעם הראשונה.');
      const encrypted = await sealCredentials(credentials);
      const { error } = await client.from('affiliate_credentials').upsert({ user_id: user.id, ...encrypted, updated_at: new Date().toISOString() });
      if (error) throw error;
      return json({ configured: true });
    }
    if (req.method === 'POST' && path === 'affiliate-link') {
      const input = await readJson(req);
      const { data, error } = await client.from('affiliate_credentials').select('secret_iv,secret_ciphertext,secret_tag').eq('user_id', user.id).maybeSingle();
      if (error) throw error;
      if (!data) return fail('חבר תחילה את חשבון האפילייט שלך בהגדרות.', 400);
      return json(await createAffiliateLink(String(input.url || ''), await openCredentials(data)));
    }
    if (req.method === 'GET' && path === 'products') {
      const { data, error } = await client.from('products').select('id,name,source_url,affiliate_url,created_at').eq('user_id', user.id).order('created_at', { ascending: false });
      if (error) throw error;
      return json(data || []);
    }
    if (req.method === 'POST' && path === 'products') {
      const input = await readJson(req);
      if (typeof input.name !== 'string' || !input.name.trim() || typeof input.source_url !== 'string' || typeof input.affiliate_url !== 'string') return fail('פרטי המוצר חסרים.');
      const { data, error } = await client.from('products').insert({ user_id: user.id, name: input.name.trim().slice(0, 180), source_url: input.source_url, affiliate_url: input.affiliate_url }).select('id,name,source_url,affiliate_url,created_at').single();
      if (error) throw error;
      return json(data, 201);
    }
    const deleteMatch = url.pathname.match(/\/products\/([0-9a-f-]{36})$/i);
    if (req.method === 'DELETE' && deleteMatch) {
      const { error } = await client.from('products').delete().eq('id', deleteMatch[1]).eq('user_id', user.id);
      if (error) throw error;
      return json({ deleted: true });
    }
    return fail('לא נמצא.', 404);
  } catch (error) {
    const status = Number((error as { status?: number }).status) || 500;
    const message = status === 500 ? 'אירעה שגיאה. נסה שוב.' : (error as Error).message;
    return fail(message, status);
  }
});
