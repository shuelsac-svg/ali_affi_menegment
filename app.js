const $ = (selector) => document.querySelector(selector);
const productStorageKey = 'ae-affiliate-products-v1';
const sessionStorageKey = 'linkdesk-session-v1';
let products = readLocalProducts();
let generated = null;
let cloudMode = false;
let cloudConfig = null;
let authMode = 'login';
let session = readSession();
let captchaToken = '';
let captchaWidgetId = null;
let captchaLoader = null;

function readLocalProducts() { try { const value = JSON.parse(localStorage.getItem(productStorageKey) || '[]'); return Array.isArray(value) ? value : []; } catch { return []; } }
function readSession() { try { return JSON.parse(localStorage.getItem(sessionStorageKey) || 'null'); } catch { return null; } }
function saveSession(value) { session = value; if (value) localStorage.setItem(sessionStorageKey, JSON.stringify(value)); else localStorage.removeItem(sessionStorageKey); }
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function notice(message, ok = false) { const el = $('#notice'); el.textContent = message; el.className = `notice${ok ? ' ok' : ''}`; el.hidden = false; }
function authNotice(message, ok = false) { const el = $('#auth-notice'); el.textContent = message; el.className = `notice${ok ? ' ok' : ''}`; el.hidden = false; }
function apiError(data, fallback) { return data?.message || data?.msg || data?.error_description || data?.error || fallback; }
function appRedirectUrl() { return new URL(location.pathname, location.origin).href; }

async function authRequest(path, body, method = 'POST', token) {
  const headers = { apikey: cloudConfig.supabaseKey, 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(`${cloudConfig.supabaseUrl}/auth/v1/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(apiError(data, 'שירות ההתחברות לא זמין כרגע.'));
  return data;
}

async function accessToken() {
  if (!session?.access_token) throw new Error('יש להתחבר כדי להמשיך.');
  if (session.expires_at && session.expires_at > Date.now() + 60_000) return session.access_token;
  if (!session.refresh_token) { saveSession(null); throw new Error('פג תוקף ההתחברות. יש להתחבר שוב.'); }
  try {
    const refreshed = await authRequest('token?grant_type=refresh_token', { refresh_token: session.refresh_token });
    saveSession({ ...refreshed, expires_at: Date.now() + Number(refreshed.expires_in || 3600) * 1000 });
    return session.access_token;
  } catch { saveSession(null); throw new Error('פג תוקף ההתחברות. יש להתחבר שוב.'); }
}

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}), apikey: cloudConfig.supabaseKey };
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (cloudMode) headers.authorization = `Bearer ${await accessToken()}`;
  const endpoint = `${cloudConfig.functionUrl}${path.replace(/^\/api/, '')}`;
  const response = await fetch(endpoint, { ...options, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401 && cloudMode) { saveSession(null); showAuth('יש להתחבר שוב כדי להמשיך.'); }
  if (!response.ok) throw new Error(apiError(data, 'הפעולה נכשלה. נסה שוב.'));
  return data;
}

function render() {
  $('#count').textContent = `${products.length} ${products.length === 1 ? 'מוצר' : 'מוצרים'}`;
  $('#empty').hidden = products.length > 0;
  $('#product-list').innerHTML = products.map((p, i) => {
    const link = p.affiliate_url || p.link || '';
    return `<article class="product"><div><b>${escapeHtml(p.name)}</b><small>${escapeHtml(link)}</small></div><div class="actions"><button data-copy="${i}">העתקה</button><button class="remove" data-remove="${i}">מחיקה</button></div></article>`;
  }).join('');
}

function showAuth(message) {
  $('#app-shell').dataset.locked = 'true';
  $('#auth-screen').hidden = false;
  $('#sign-out').hidden = true;
  if (message) authNotice(message);
}

async function loadProducts() {
  if (cloudMode) products = await api('/api/products');
  else products = readLocalProducts();
  render();
}

async function showApp() {
  $('#auth-screen').hidden = true;
  delete $('#app-shell').dataset.locked;
  $('#sign-out').hidden = !cloudMode;
  $('#footer-note').textContent = cloudMode ? 'המוצרים שלך נשמרים בחשבון הענן הפרטי שלך.' : 'המוצרים נשמרים בדפדפן הזה בלבד.';
  $('#settings-intro').textContent = cloudMode ? 'המפתחות מוצפנים ונשמרים בענן. רק החשבון שלך יכול להשתמש בהם.' : 'המפתחות נשמרים בקובץ מקומי במחשב הזה, ואינם מוצגים שוב.';
  $('.secure span:last-child').textContent = cloudMode ? 'פרטי הגישה מוצפנים ונשמרים בענן\nרק בחשבון שלך.' : 'פרטי הגישה נשמרים מקומית\nבמחשב שלך בלבד.';
  try { await loadProducts(); }
  catch (error) { products = []; render(); notice(error.message); }
  try {
    const settings = await api('/api/settings');
    $('#account-status').textContent = settings.configured ? 'חשבון שותפים מחובר' : 'נדרש חיבור חשבון';
    $('.status').classList.toggle('connected', settings.configured);
  } catch (error) { notice(error.message); }
}

function setAuthMode(mode) {
  if (mode === 'signup' && cloudMode && !cloudConfig.signupEnabled) {
    authNotice('ההרשמה חסומה כרגע עד להגדרת CAPTCHA באתר.');
    return;
  }
  authMode = mode;
  $('#auth-title').textContent = mode === 'signup' ? 'יצירת חשבון' : 'התחברות';
  $('#auth-submit').innerHTML = mode === 'signup' ? 'יצירת חשבון <span>←</span>' : 'התחברות <span>←</span>';
  $('#auth-password').autocomplete = mode === 'signup' ? 'new-password' : 'current-password';
  $('#auth-toggle').textContent = mode === 'signup' ? 'כבר יש לך חשבון? התחברות' : 'אין לך חשבון? הרשמה';
  $('#auth-notice').hidden = true;
  setupCaptcha();
}

async function loadCaptcha() {
  if (window.turnstile) return window.turnstile;
  if (!captchaLoader) captchaLoader = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true; script.defer = true;
    script.onload = () => resolve(window.turnstile);
    script.onerror = () => reject(new Error('לא ניתן לטעון בדיקת אבטחה.'));
    document.head.append(script);
  });
  return captchaLoader;
}

async function setupCaptcha() {
  const container = $('#turnstile-widget');
  const needed = cloudMode && authMode === 'signup' && Boolean(cloudConfig?.captchaSiteKey);
  captchaToken = '';
  if (!needed) {
    container.hidden = true;
    if (captchaWidgetId !== null && window.turnstile) window.turnstile.remove(captchaWidgetId);
    captchaWidgetId = null; container.replaceChildren(); return;
  }
  container.hidden = false;
  try {
    const turnstile = await loadCaptcha();
    if (authMode !== 'signup' || !container.isConnected) return;
    if (captchaWidgetId !== null) turnstile.remove(captchaWidgetId);
    container.replaceChildren();
    captchaWidgetId = turnstile.render(container, {
      sitekey: cloudConfig.captchaSiteKey,
      callback: token => { captchaToken = token; },
      'expired-callback': () => { captchaToken = ''; },
      'error-callback': () => { captchaToken = ''; authNotice('בדיקת האבטחה נכשלה. נסה שוב.'); }
    });
  } catch (error) { authNotice(error.message); }
}

$('#auth-toggle').addEventListener('click', () => setAuthMode(authMode === 'login' ? 'signup' : 'login'));
$('#auth-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = $('#auth-submit'); button.disabled = true; button.textContent = authMode === 'signup' ? 'יוצר חשבון…' : 'מתחבר…';
  $('#auth-notice').hidden = true;
  try {
    const email = $('#auth-email').value.trim();
    const password = $('#auth-password').value;
    if (authMode === 'signup') {
      if (cloudMode && cloudConfig.captchaSiteKey && !captchaToken) throw new Error('השלם תחילה את בדיקת האבטחה.');
      const redirect = encodeURIComponent(appRedirectUrl());
      const data = await authRequest(`signup?redirect_to=${redirect}`, { email, password, ...(captchaToken ? { captcha_token: captchaToken } : {}) });
      if (!data.access_token) {
        authNotice('החשבון נוצר. אשר את כתובת האימייל דרך ההודעה שנשלחה אליך ואז התחבר.', true);
        return;
      }
      saveSession({ ...data, expires_at: Date.now() + Number(data.expires_in || 3600) * 1000 });
    } else {
      const data = await authRequest('token?grant_type=password', { email, password });
      saveSession({ ...data, expires_at: Date.now() + Number(data.expires_in || 3600) * 1000 });
    }
    $('#auth-password').value = '';
    await showApp();
  } catch (error) { authNotice(error.message); }
  finally {
    button.disabled = false; button.innerHTML = authMode === 'signup' ? 'יצירת חשבון <span>←</span>' : 'התחברות <span>←</span>';
    if (authMode === 'signup' && captchaWidgetId !== null && window.turnstile) window.turnstile.reset(captchaWidgetId);
  }
});

$('#auth-recovery').addEventListener('click', async () => {
  const email = $('#auth-email').value.trim();
  if (!email) { authNotice('הזן תחילה את כתובת האימייל שלך.'); $('#auth-email').focus(); return; }
  try {
    await authRequest(`recover?redirect_to=${encodeURIComponent(appRedirectUrl())}`, { email });
    authNotice('אם הכתובת רשומה, נשלח אליה קישור לאיפוס הסיסמה.', true);
  } catch (error) { authNotice(error.message); }
});

$('#reset-form').addEventListener('submit', async event => {
  event.preventDefault();
  const password = $('#new-password').value;
  try {
    await authRequest('user', { password }, 'PUT', session?.access_token);
    saveSession(null); $('#reset-form').hidden = true; $('#auth-form').hidden = false; $('#auth-toggle').hidden = false; $('#auth-recovery').hidden = false;
    authNotice('הסיסמה עודכנה. אפשר להתחבר.', true);
  } catch (error) { authNotice(error.message); }
});

$('#sign-out').addEventListener('click', async () => {
  try { if (session?.access_token) await authRequest('logout', undefined, 'POST', session.access_token); } catch {}
  saveSession(null); products = []; render(); showAuth('יצאת מהחשבון.');
});

$('#generate').addEventListener('click', async () => {
  const button = $('#generate'); $('#result').hidden = true; $('#notice').hidden = true; generated = null;
  button.disabled = true; button.textContent = 'יוצר קישור…';
  try {
    const data = await api('/api/affiliate-link', { method: 'POST', body: { url: $('#product-url').value.trim() } });
    generated = data.link; $('#affiliate-link').href = generated; $('#affiliate-link').textContent = generated; $('#result').hidden = false;
  } catch (error) { notice(error.message); }
  finally { button.disabled = false; button.innerHTML = 'צור קישור <span>←</span>'; }
});

$('#copy').addEventListener('click', async () => { if (!generated) return; await navigator.clipboard.writeText(generated); $('#copy').textContent = 'הועתק'; setTimeout(() => $('#copy').textContent = 'העתקה', 1400); });

$('#save').addEventListener('click', async () => {
  if (!generated) return;
  const name = $('#product-name').value.trim() || 'מוצר חדש';
  try {
    if (cloudMode) {
      const saved = await api('/api/products', { method: 'POST', body: { name, source_url: $('#product-url').value.trim(), affiliate_url: generated } });
      products.unshift(saved);
    } else {
      products.unshift({ name, link: generated, source: $('#product-url').value.trim(), created: Date.now() });
      localStorage.setItem(productStorageKey, JSON.stringify(products));
    }
    render(); notice('המוצר נשמר ברשימה שלך.', true); $('#result').hidden = true; $('#product-name').value = '';
  } catch (error) { notice(error.message); }
});

$('#product-list').addEventListener('click', async event => {
  const copy = event.target.closest('[data-copy]'); const remove = event.target.closest('[data-remove]');
  if (copy) {
    const product = products[Number(copy.dataset.copy)];
    await navigator.clipboard.writeText(product.affiliate_url || product.link);
    copy.textContent = 'הועתק'; setTimeout(() => copy.textContent = 'העתקה', 1200);
  }
  if (remove) {
    const index = Number(remove.dataset.remove);
    try {
      if (cloudMode) await api(`/api/products/${encodeURIComponent(products[index].id)}`, { method: 'DELETE' });
      products.splice(index, 1);
      if (!cloudMode) localStorage.setItem(productStorageKey, JSON.stringify(products));
      render();
    } catch (error) { notice(error.message); }
  }
});

const modal = $('#settings-modal');
const openSettings = () => { modal.hidden = false; $('#app-key').focus(); };
$('#open-settings').addEventListener('click', openSettings);
$('#open-settings-secondary').addEventListener('click', openSettings);
modal.addEventListener('click', event => { if (event.target.hasAttribute('data-close')) modal.hidden = true; });
document.addEventListener('keydown', event => { if (event.key === 'Escape') modal.hidden = true; });

$('#settings-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = $('#save-settings'); button.disabled = true; button.textContent = 'שומר…'; $('#settings-notice').hidden = true;
  try {
    await api('/api/settings', { method: 'POST', body: { appKey: $('#app-key').value, appSecret: $('#app-secret').value, trackingId: $('#tracking-id').value } });
    $('#app-key').value = ''; $('#app-secret').value = ''; $('#tracking-id').value = '';
    $('#account-status').textContent = 'חשבון שותפים מחובר'; $('.status').classList.add('connected');
    const note = $('#settings-notice'); note.textContent = 'הפרטים נשמרו. אפשר ליצור קישורים.'; note.className = 'notice ok'; note.hidden = false;
    setTimeout(() => { modal.hidden = true; }, 900);
  } catch (error) { const note = $('#settings-notice'); note.textContent = error.message; note.className = 'notice'; note.hidden = false; }
  finally { button.disabled = false; button.innerHTML = 'שמור פרטי חשבון <span>←</span>'; }
});

async function start() {
  try {
    const config = window.APP_CONFIG || {};
    if (!config.supabaseUrl || !config.supabaseKey || !config.functionUrl) throw new Error('האתר עדיין לא חובר ל־Supabase. הגדר את app-config.js לפי הוראות הפריסה.');
    cloudMode = true; cloudConfig = { ...config, functionUrl: config.functionUrl.replace(/\/$/, ''), signupEnabled: true };
    const hash = new URLSearchParams(location.hash.slice(1));
    if (hash.has('access_token') && hash.has('refresh_token')) {
      const tokens = { access_token: hash.get('access_token'), refresh_token: hash.get('refresh_token'), expires_in: hash.get('expires_in') || 3600 };
      saveSession({ ...tokens, expires_at: Date.now() + Number(tokens.expires_in) * 1000 });
      history.replaceState(null, '', location.pathname + location.search);
      if (hash.get('type') === 'recovery') {
        showAuth(); $('#auth-form').hidden = true; $('#auth-toggle').hidden = true; $('#auth-recovery').hidden = true; $('#reset-form').hidden = false;
        authNotice('בחר סיסמה חדשה לחשבון שלך.', true); return;
      }
    }
    if (cloudMode) {
      setAuthMode('login');
      if (!session?.access_token) { showAuth(); return; }
      try { await accessToken(); await showApp(); }
      catch { saveSession(null); showAuth('התחבר מחדש כדי להמשיך.'); }
    } else {
      $('#auth-screen').hidden = true; delete $('#app-shell').dataset.locked;
      $('#sign-out').hidden = true; await showApp();
    }
  } catch (error) {
    showAuth(error.message);
  }
}

start();
