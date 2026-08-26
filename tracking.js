// INICIALIZAÇÃO ULTRA-RÁPIDA DE FBP, FBC E EXTERNAL_ID PARA MAXIMIZAR VIEWCONTENT EMQ
(function preInitTrackingData() {
  try {
    const searchParams = new URLSearchParams(window.location.search);
    const fbclid = searchParams.get('fbclid');
    
    // 1. Garantir fbc instantâneo a partir do fbclid na URL
    if (fbclid) {
      const fbc = 'fb.1.' + Date.now() + '.' + fbclid;
      try {
        const host = window.location.hostname;
        const parts = host.split('.');
        const domain = parts.length > 1 ? '.' + parts.slice(-2).join('.') : '';
        document.cookie = '_fbc=' + encodeURIComponent(fbc) + '; path=/; max-age=7776000' + (domain ? '; domain=' + domain : '') + '; SameSite=Lax; Secure';
        window.localStorage.setItem('_fbc', fbc);
      } catch (_) {}
    }

    // 2. Garantir fbp instantâneo
    let fbp = '';
    const matchFbp = document.cookie.match(/(?:^|; )_fbp=([^;]*)/);
    if (matchFbp) fbp = decodeURIComponent(matchFbp[1]);
    if (!fbp) {
      try { fbp = window.localStorage.getItem('_fbp') || ''; } catch (_) {}
    }
    if (!fbp) {
      fbp = 'fb.1.' + Date.now() + '.' + Math.floor(Math.random() * 2147483647);
    }
    try {
      const host = window.location.hostname;
      const parts = host.split('.');
      const domain = parts.length > 1 ? '.' + parts.slice(-2).join('.') : '';
      document.cookie = '_fbp=' + encodeURIComponent(fbp) + '; path=/; max-age=63072000' + (domain ? '; domain=' + domain : '') + '; SameSite=Lax; Secure';
      window.localStorage.setItem('_fbp', fbp);
    } catch (_) {}
  } catch (_) {}
})();

const META_PIXEL_ID = '1987865748103477';
const TRACKING_API_URL = 'https://gui-4f-mofo-zero-production.up.railway.app/api/meta/events';
const CHECKOUT_URL = 'https://pay.hotmart.com/B106421355U?checkoutMode=10';
const PRODUCT_ID = 'mofo_zero_ebook';
const PRODUCT_VALUE = 67;
const CURRENCY = 'BRL';
const STANDARD_EVENT_DEDUPE_MS = 1500;
const EXTERNAL_ID_KEY = 'mofozero_external_id';
const EXTERNAL_ID_COOKIE = '_mofozero_eid';
const TRAFFIC_SESSION_KEY = 'mofozero_traffic_session_id';
const recentStandardEvents = new Map();
const trafficQualityState = {
  landingAt: Date.now(),
  maxScrollPercent: 0,
  interactionCount: 0,
  checkoutIntentCount: 0,
  visibilityChanges: 0,
  sessionId: getOrCreateTrafficSessionId(),
};

function getOrCreateTrafficSessionId() {
  let sessionId = '';
  try {
    sessionId = window.sessionStorage.getItem(TRAFFIC_SESSION_KEY) || '';
  } catch (_) {
    sessionId = '';
  }

  if (!sessionId) {
    const randomPart = window.crypto && window.crypto.randomUUID
      ? window.crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36);
    sessionId = 'mofozero-session-' + randomPart;
  }

  try {
    window.sessionStorage.setItem(TRAFFIC_SESSION_KEY, sessionId);
  } catch (_) {}

  return sessionId;
}

function initTrafficQualitySensors() {
  const trackedScrolls = new Set();
  const updateScrollDepth = () => {
    const doc = document.documentElement;
    const body = document.body;
    const scrollTop = window.scrollY || doc.scrollTop || body.scrollTop || 0;
    const scrollable = Math.max(1, (doc.scrollHeight || body.scrollHeight || 0) - window.innerHeight);
    const percent = Math.max(0, Math.min(100, Math.round((scrollTop / scrollable) * 100)));
    trafficQualityState.maxScrollPercent = Math.max(trafficQualityState.maxScrollPercent, percent);

    // Dispara eventos discretos de Scroll (25%, 50%, 75%, 90%)
    [25, 50, 75, 90].forEach((milestone) => {
      if (percent >= milestone && !trackedScrolls.has(milestone)) {
        trackedScrolls.add(milestone);
        trackCustomEvent('Scroll' + milestone);
      }
    });
  };

  updateScrollDepth();
  window.addEventListener('scroll', updateScrollDepth, { passive: true });
  window.addEventListener('pointerdown', () => {
    trafficQualityState.interactionCount += 1;
  }, { passive: true });
  window.addEventListener('keydown', () => {
    trafficQualityState.interactionCount += 1;
  }, { passive: true });
  document.addEventListener('visibilitychange', () => {
    trafficQualityState.visibilityChanges += 1;
  });
}

function registerCheckoutIntent() {
  trafficQualityState.checkoutIntentCount += 1;
  trafficQualityState.interactionCount += 1;
}

function getTrafficQualitySignal() {
  return {
    ...trafficQualityState,
    timeOnPageMs: Date.now() - trafficQualityState.landingAt,
    pageHidden: document.hidden,
    hasFocus: document.hasFocus ? document.hasFocus() : undefined,
    language: navigator.language || '',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
    screenWidth: window.screen ? window.screen.width : window.innerWidth,
    screenHeight: window.screen ? window.screen.height : window.innerHeight,
    colorDepth: window.screen ? window.screen.colorDepth : undefined,
    devicePixelRatio: window.devicePixelRatio || 1,
    referrer: document.referrer || '',
    hasJavascript: true,
  };
}

// EXTRAÇÃO DE CORRESPONDÊNCIA AVANÇADA MANUAL DA META (ADVANCED MATCHING)
function getAdvancedMatchingData() {
  const searchParams = new URLSearchParams(window.location.search);
  const data = {
    external_id: getOrCreateExternalId(),
  };

  const fbp = getFbp();
  if (fbp) data.fbp = fbp;

  const fbc = getFbc();
  if (fbc) data.fbc = fbc;

  // Extrair Email se presente na URL ou localStorage
  let email = searchParams.get('email') || searchParams.get('em') || '';
  try { email = email || window.localStorage.getItem('user_email') || ''; } catch (_) {}
  if (email && email.includes('@')) {
    data.em = email.trim().toLowerCase();
  }

  // Extrair Telefone se presente na URL ou localStorage
  let phone = searchParams.get('phone') || searchParams.get('ph') || searchParams.get('telefone') || '';
  try { phone = phone || window.localStorage.getItem('user_phone') || ''; } catch (_) {}
  if (phone) {
    let cleanedPhone = phone.replace(/\D/g, '');
    if ((cleanedPhone.length === 10 || cleanedPhone.length === 11) && !cleanedPhone.startsWith('55')) {
      cleanedPhone = '55' + cleanedPhone;
    }
    if (cleanedPhone.length >= 10) {
      data.ph = cleanedPhone;
    }
  }

  // Extrair Nome / Sobrenome se presente
  let fn = searchParams.get('fn') || searchParams.get('first_name') || searchParams.get('nome') || '';
  if (fn) data.fn = fn.trim().toLowerCase();

  let ln = searchParams.get('ln') || searchParams.get('last_name') || searchParams.get('sobrenome') || '';
  if (ln) data.ln = ln.trim().toLowerCase();

  // Extrair e Normalizar CEP (zp)
  let zp = searchParams.get('zp') || searchParams.get('zip') || searchParams.get('cep') || searchParams.get('zipcode') || '';
  try { zp = zp || window.localStorage.getItem('user_cep') || ''; } catch (_) {}
  if (zp) {
    let cleanZp = zp.replace(/\D/g, '');
    if (cleanZp.length >= 5) data.zp = cleanZp;
  }

  // Extrair e Normalizar Estado (st)
  let st = searchParams.get('st') || searchParams.get('state') || searchParams.get('uf') || searchParams.get('estado') || '';
  try { st = st || window.localStorage.getItem('user_state') || ''; } catch (_) {}
  if (st) {
    let cleanSt = st.trim().toLowerCase().replace(/[^a-z]/g, '');
    if (cleanSt.length === 2) data.st = cleanSt;
  }

  // Extrair e Normalizar Cidade (ct)
  let ct = searchParams.get('ct') || searchParams.get('city') || searchParams.get('cidade') || '';
  try { ct = ct || window.localStorage.getItem('user_city') || ''; } catch (_) {}
  if (ct) {
    let cleanCt = ct.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
    if (cleanCt) data.ct = cleanCt;
  }

  data.country = 'br';

  return data;
}

function initMetaPixel() {
  if (window.fbq) return;

  !(function (f, b, e, v, n, t, s) {
    if (f.fbq) return;
    n = f.fbq = function () {
      n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
    };
    if (!f._fbq) f._fbq = n;
    n.push = n;
    n.loaded = true;
    n.version = '2.0';
    n.queue = [];
    t = b.createElement(e);
    t.async = true;
    t.src = v;
    s = b.getElementsByTagName(e)[0];
    s.parentNode.insertBefore(t, s);
  })(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');

  window.fbq('init', META_PIXEL_ID, {
    external_id: getOrCreateExternalId(),
  });
  trackStandardEvent('PageView', {
    content_name: 'Guia 3F Anti-Mofo',
    content_ids: [PRODUCT_ID],
    content_type: 'product',
  });
}

function hasFbq() {
  return typeof window.fbq === 'function';
}

function trackStandardEvent(eventName, payload = {}, overrideEventId = null) {
  if (wasStandardEventRecentlyTracked(eventName, payload)) return;
  const eventId = overrideEventId || buildEventId(eventName);
  
  // Extrai o test_event_code da URL se presente (e.g. ?test_event_code=TESTXXXXX)
  const testCode = new URLSearchParams(window.location.search).get('test_event_code') || (window.TRACKING_CONFIG && window.TRACKING_CONFIG.testEventCode) || undefined;
  
  const options = { eventID: eventId };
  if (testCode) {
    options.test_event_code = testCode;
  }
  
  // Anexa a variante de teste A/B ativa ao payload do Pixel
  const activeVariant = window.localStorage.getItem('ab_test_variant') || 'unknown';
  payload.ab_variant = activeVariant;
  
  // 1. Enviar pelo Pixel do Navegador (se disponível)
  if (hasFbq()) {
    try {
      window.fbq('track', eventName, payload, options);
    } catch (e) {
      console.warn('[Tracking Pixel Error]', e);
    }
  }
  
  // 2. Enviar SEMPRE pelo Server CAPI (Incondicional: garante 100% de cobertura de servidor mesmo com AdBlockers!)
  sendServerEvent(eventName, payload, eventId);
}

function trackCustomEvent(eventName, payload = {}) {
  if (!hasFbq()) return;
  window.fbq('trackCustom', eventName, payload);
}

function commonPayload(extra = {}) {
  return {
    content_name: 'Guia 3F Anti-Mofo',
    content_ids: [PRODUCT_ID],
    content_type: 'product',
    value: PRODUCT_VALUE,
    currency: CURRENCY,
    ...extra,
  };
}

function standardEventKey(eventName, payload) {
  return [
    eventName,
    payload.content_name || '',
    payload.source || '',
    payload.status || '',
  ].join('|');
}

function wasStandardEventRecentlyTracked(eventName, payload) {
  const now = Date.now();
  const key = standardEventKey(eventName, payload);
  const lastTrackedAt = recentStandardEvents.get(key) || 0;

  if (now - lastTrackedAt < STANDARD_EVENT_DEDUPE_MS) {
    return true;
  }

  recentStandardEvents.set(key, now);
  return false;
}

function trackCheckoutButtonClick(source) {
  trackCustomEvent('CheckoutButtonClick', commonPayload({
    destination: 'hotmart',
    source,
  }));
}

function getCookie(name) {
  const match = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/[.$?*|{}()[\]\\/+^]/g, '\\$&') + '=([^;]*)'));
  return match ? decodeURIComponent(match[1]) : '';
}

function getOrCreateFbp() {
  let fbp = getCookie('_fbp');
  if (!fbp) {
    try { fbp = window.localStorage.getItem('_fbp') || ''; } catch (_) {}
  }

  if (!fbp) {
    const creationTime = Date.now();
    const randomNumber = Math.floor(Math.random() * 2147483647);
    fbp = 'fb.1.' + creationTime + '.' + randomNumber;
  }

  try {
    const host = window.location.hostname;
    const parts = host.split('.');
    const domain = parts.length > 1 ? '.' + parts.slice(-2).join('.') : '';
    document.cookie = '_fbp=' + encodeURIComponent(fbp) + '; path=/; max-age=63072000' + (domain ? '; domain=' + domain : '') + '; SameSite=Lax; Secure';
    window.localStorage.setItem('_fbp', fbp);
  } catch (_) {}

  return fbp;
}

function getFbp() {
  return getOrCreateFbp();
}

function getFbc() {
  const fbclid = new URLSearchParams(window.location.search).get('fbclid');
  let fbc = getCookie('_fbc');
  if (!fbc) {
    try { fbc = window.localStorage.getItem('_fbc') || ''; } catch (_) {}
  }

  if (fbclid) {
    if (!fbc || !fbc.endsWith('.' + fbclid)) {
      fbc = 'fb.1.' + Date.now() + '.' + fbclid;
    }
  }

  if (fbc) {
    try {
      const host = window.location.hostname;
      const parts = host.split('.');
      const domain = parts.length > 1 ? '.' + parts.slice(-2).join('.') : '';
      document.cookie = '_fbc=' + encodeURIComponent(fbc) + '; path=/; max-age=7776000' + (domain ? '; domain=' + domain : '') + '; SameSite=Lax; Secure';
      window.localStorage.setItem('_fbc', fbc);
    } catch (_) {}
  }

  return fbc || '';
}

function buildVisitorId() {
  const randomPart = window.crypto && window.crypto.randomUUID
    ? window.crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);

  return 'mofozero-visitor-' + randomPart;
}

function getOrCreateExternalId() {
  let externalId = getCookie(EXTERNAL_ID_COOKIE);

  try {
    externalId = externalId || window.localStorage.getItem(EXTERNAL_ID_KEY) || '';
  } catch (_) {
    externalId = externalId || '';
  }

  if (!externalId) {
    externalId = buildVisitorId();
  }

  try {
    window.localStorage.setItem(EXTERNAL_ID_KEY, externalId);
  } catch (_) {}

  document.cookie = EXTERNAL_ID_COOKIE + '=' + encodeURIComponent(externalId) + '; path=/; max-age=15552000; SameSite=Lax; Secure';

  return externalId;
}

function buildEventId(eventName) {
  const randomPart = window.crypto && window.crypto.randomUUID
    ? window.crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);

  return 'mofozero-' + eventName + '-' + randomPart;
}

function normalizeServerPayload(payload) {
  return {
    value: typeof payload.value === 'number' ? payload.value : undefined,
    currency: payload.currency || CURRENCY,
    contentName: payload.content_name || payload.contentName || 'Guia 3F Anti-Mofo',
    contentIds: Array.isArray(payload.content_ids) ? payload.content_ids : [PRODUCT_ID],
  };
}

function sendServerEvent(eventName, payload, eventId) {
  const allowedEvents = ['PageView', 'ViewContent', 'InitiateCheckout', 'Lead', 'CompleteRegistration'];
  if (!allowedEvents.includes(eventName)) return;

  const serverPayload = normalizeServerPayload(payload);
  const body = {
    eventName,
    eventId,
    eventSourceUrl: window.location.href,
    externalId: getOrCreateExternalId(),
    fbp: getFbp(),
    fbc: getFbc(),
    testEventCode: new URLSearchParams(window.location.search).get('test_event_code') || (window.TRACKING_CONFIG && window.TRACKING_CONFIG.testEventCode) || undefined,
    value: serverPayload.value,
    currency: serverPayload.currency,
    contentName: serverPayload.contentName,
    contentIds: serverPayload.contentIds,
    abVariant: payload.ab_variant || window.localStorage.getItem('ab_test_variant') || 'unknown',
    trafficQuality: getTrafficQualitySignal(),
  };

  const serialized = JSON.stringify(body);

  fetch(TRACKING_API_URL, {
    method: 'POST',
    mode: 'cors',
    headers: { 'content-type': 'application/json' },
    body: serialized,
    keepalive: true,
  }).catch(() => {});
}

function getPageContext() {
  return {
    pageType: 'sales_page',
    contentName: 'Guia 3F Anti-Mofo - Pagina de Venda',
  };
}

function trackViewContent() {
  const context = getPageContext();

  trackStandardEvent('ViewContent', commonPayload({
    content_name: context.contentName,
    page_type: context.pageType,
  }));
}

function buildTrackedCheckoutUrl(baseUrl) {
  if (!baseUrl) return baseUrl;
  try {
    const currentParams = new URLSearchParams(window.location.search);
    const target = new URL(baseUrl, window.location.origin);

    // 1. Repassar parâmetros UTM originais sem sobrescrever src/sck com fbp
    currentParams.forEach((value, key) => {
      if (key !== 'src' && key !== 'sck' && !target.searchParams.has(key)) {
        target.searchParams.set(key, value);
      }
    });

    // 2. Injetar fbp limpo em fbp e param1
    const fbp = getFbp();
    if (fbp && fbp !== 'null' && fbp !== 'undefined') {
      target.searchParams.set('fbp', fbp);
      target.searchParams.set('param1', fbp);
    }

    // 3. Injetar fbc limpo em fbc e param2
    const fbc = getFbc();
    if (fbc && fbc !== 'null' && fbc !== 'undefined') {
      target.searchParams.set('fbc', fbc);
      target.searchParams.set('param2', fbc);
    }

    // 4. Injetar fbclid puro
    const fbclid = currentParams.get('fbclid');
    if (fbclid) {
      target.searchParams.set('fbclid', fbclid);
    }

    // 5. Garantir src e sck limpos (origem do tráfego, JAMAIS fbp!)
    const utmSource = currentParams.get('utm_source') || currentParams.get('src') || 'meta_ads';
    target.searchParams.set('src', utmSource);
    target.searchParams.set('sck', utmSource);

    // 6. External ID
    if (!target.searchParams.has('external_id')) {
      target.searchParams.set('external_id', getOrCreateExternalId());
    }

    // 7. Variante A/B no param4
    const variant = window.localStorage.getItem('ab_test_variant') || 'unknown';
    target.searchParams.set('param4', variant);

    return target.toString();
  } catch (e) {
    return baseUrl;
  }
}

let lastCheckoutIntentAt = 0;

function trackCheckoutIntent(source = 'checkout_cta', options = {}) {
  registerCheckoutIntent();
  const now = Date.now();
  const shouldTrackStandardIntent = now - lastCheckoutIntentAt >= STANDARD_EVENT_DEDUPE_MS;

  if (shouldTrackStandardIntent) {
    lastCheckoutIntentAt = now;
    const eventId = options.eventId || buildEventId('InitiateCheckout');
    trackStandardEvent('InitiateCheckout', commonPayload({
      num_items: 1,
      source,
    }), eventId);
  }

  if (options.includeButtonClick !== false) {
    trackCheckoutButtonClick(source);
  }
}

function prepareCheckoutLinks() {
  document.querySelectorAll('a[href*="pay.hotmart.com"]').forEach((link) => {
    link.href = buildTrackedCheckoutUrl(link.href);
    link.setAttribute('data-checkout-link', 'true');
  });
}

function interceptCheckoutClicks() {
  // Prepara links imediatamente e em eventos de toque/mouse
  document.addEventListener('pointerdown', (event) => {
    const link = event.target.closest && event.target.closest('a[href*="pay.hotmart.com"], a[data-checkout-link="true"]');
    if (!link) return;
    
    // Atualiza o link instantaneamente no toque do dedo antes da navegação
    const eventId = buildEventId('InitiateCheckout');
    link.dataset.eventId = eventId;
    link.href = buildTrackedCheckoutUrl(link.href);
    
    // Anexa param3 (eventId) na URL para deduplicação CAPI
    try {
      const u = new URL(link.href);
      u.searchParams.set('param3', eventId);
      link.href = u.toString();
    } catch (_) {}
  }, { passive: true });

  // Ao clicar, dispara o evento no Pixel/CAPI de forma assíncrona SEM travar a navegação nativa do navegador
  document.addEventListener('click', (event) => {
    const link = event.target.closest && event.target.closest('a[href*="pay.hotmart.com"], a[data-checkout-link="true"]');
    if (!link) return;

    // Garante URL 100% decorada
    const eventId = link.dataset.eventId || buildEventId('InitiateCheckout');
    link.href = buildTrackedCheckoutUrl(link.href);
    try {
      const u = new URL(link.href);
      u.searchParams.set('param3', eventId);
      link.href = u.toString();
    } catch (_) {}

    // Dispara InitiateCheckout no Pixel e CAPI (assíncrono)
    trackCheckoutIntent(link.dataset.checkoutSource || 'checkout_cta', { 
      includeButtonClick: true,
      eventId: eventId 
    });

    trackCustomEvent('CTA_Click', { 
      source: link.dataset.checkoutSource || 'checkout_cta',
      destination: 'hotmart'
    });
  }, { passive: true });
}

function trackCheckoutHoverIntent() {
  document.addEventListener('pointerdown', (event) => {
    const link = event.target.closest && event.target.closest('a[href*="pay.hotmart.com"], a[data-checkout-link="true"]');
    if (!link) return;
    trackCheckoutIntent(link.dataset.checkoutSource || 'checkout_pointerdown', { includeButtonClick: false });
  }, true);
}

// Rastreamento Adicional de Eventos Customizados
function initTimeOnPageTracker() {
  window.setTimeout(() => {
    trackCustomEvent('ViewContent30s');
  }, 30000);
}

function initSectionViewTrackers() {
  if (!('IntersectionObserver' in window)) return;

  const observerOptions = { threshold: 0.15 };
  const viewObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        if (entry.target.classList.contains('hero')) {
          trackCustomEvent('HeroViewed');
          viewObserver.unobserve(entry.target);
        } else if (entry.target.id === 'oferta' || entry.target.classList.contains('offer')) {
          trackCustomEvent('OfferViewed');
          viewObserver.unobserve(entry.target);
        } else if (entry.target.classList.contains('guarantee')) {
          trackCustomEvent('GuaranteeViewed');
          viewObserver.unobserve(entry.target);
        }
      }
    });
  }, observerOptions);

  const hero = document.querySelector('.hero');
  if (hero) viewObserver.observe(hero);

  const offer = document.querySelector('#oferta, .offer');
  if (offer) viewObserver.observe(offer);

  const guarantee = document.querySelector('.guarantee');
  if (guarantee) {
    viewObserver.observe(guarantee);
    guarantee.addEventListener('click', () => {
      trackCustomEvent('Guarantee_Click');
    }, { once: true });
  }
}

function initFaqClickTracker() {
  document.querySelectorAll('.faq-item').forEach((item) => {
    item.addEventListener('click', () => {
      const questionText = item.querySelector('h3') ? item.querySelector('h3').textContent : 'FAQ Dúvida';
      trackCustomEvent('FAQ_Click', { question: questionText });
    }, { once: true });
  });
}

function initUpsellTrackers() {
  const currentPath = window.location.pathname.toLowerCase();
  const currentSearch = window.location.search.toLowerCase();
  if (currentPath.includes('upsell') || currentSearch.includes('upsell')) {
    trackCustomEvent('UpsellViewed');

    document.querySelectorAll('a[href*="pay.hotmart.com/upsell"], .btn-upsell-accept').forEach((btn) => {
      btn.addEventListener('click', () => {
        trackCustomEvent('UpsellAccepted');
      });
    });
  }
}

// Inicialização
initMetaPixel();

document.addEventListener('DOMContentLoaded', () => {
  initTrafficQualitySensors();
  trackViewContent();
  prepareCheckoutLinks();
  interceptCheckoutClicks();
  trackCheckoutHoverIntent();
  initTimeOnPageTracker();
  initSectionViewTrackers();
  initFaqClickTracker();
  initUpsellTrackers();
});

// REFORÇO DE EXCELÊNCIA EM EVENT MATCH QUALITY (fbp / fbc 100% GARANTIDOS)
function startContinuousLinkDecoration() {
  prepareCheckoutLinks();
  setInterval(prepareCheckoutLinks, 1000);
  document.addEventListener('mouseover', (e) => {
    const link = e.target.closest && e.target.closest('a[href*="pay.hotmart.com"]');
    if (link) {
      link.href = buildTrackedCheckoutUrl(link.href);
    }
  }, { passive: true });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startContinuousLinkDecoration);
} else {
  startContinuousLinkDecoration();
}
