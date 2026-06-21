const META_PIXEL_ID = '1987865748103477';
const TRACKING_API_URL = 'https://gui-4f-mofo-zero-production.up.railway.app/api/meta/events';
const CHECKOUT_URL = 'https://pay.hotmart.com/B106421355U?checkoutMode=10';
const PRODUCT_ID = 'mofo_zero_ebook';
const PRODUCT_VALUE = 37;
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
  const updateScrollDepth = () => {
    const doc = document.documentElement;
    const body = document.body;
    const scrollTop = window.scrollY || doc.scrollTop || body.scrollTop || 0;
    const scrollable = Math.max(1, (doc.scrollHeight || body.scrollHeight || 0) - window.innerHeight);
    const percent = Math.max(0, Math.min(100, Math.round((scrollTop / scrollable) * 100)));
    trafficQualityState.maxScrollPercent = Math.max(trafficQualityState.maxScrollPercent, percent);
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
  if (!hasFbq()) return;
  if (wasStandardEventRecentlyTracked(eventName, payload)) return;
  const eventId = overrideEventId || buildEventId(eventName);
  
  // Extrai o test_event_code da URL se presente (e.g. ?test_event_code=TESTXXXXX)
  const testCode = new URLSearchParams(window.location.search).get('test_event_code') || (window.TRACKING_CONFIG && window.TRACKING_CONFIG.testEventCode) || undefined;
  
  const options = { eventID: eventId };
  if (testCode) {
    options.test_event_code = testCode;
  }
  
  window.fbq('track', eventName, payload, options);
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

function getFbp() {
  return getCookie('_fbp');
}

function getFbc() {
  const fbclid = new URLSearchParams(window.location.search).get('fbclid');
  const cookieValue = getCookie('_fbc');
  if (!fbclid) return cookieValue || '';

  if (cookieValue && cookieValue.endsWith('.' + fbclid)) {
    return cookieValue;
  }

  const fbc = 'fb.1.' + Date.now() + '.' + fbclid;
  document.cookie = '_fbc=' + encodeURIComponent(fbc) + '; path=/; max-age=7776000; SameSite=Lax; Secure';
  return fbc;
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
  const currentParams = new URLSearchParams(window.location.search);
  const target = new URL(baseUrl);

  currentParams.forEach((value, key) => {
    if (!target.searchParams.has(key)) {
      target.searchParams.set(key, value);
    }
  });

  if (!target.searchParams.has('external_id')) {
    target.searchParams.set('external_id', getOrCreateExternalId());
  }

  const fbp = getFbp();
  if (fbp) {
    if (!target.searchParams.has('fbp')) target.searchParams.set('fbp', fbp);
    if (!target.searchParams.has('param1')) target.searchParams.set('param1', fbp);
  }

  const fbc = getFbc();
  if (fbc) {
    if (!target.searchParams.has('fbc')) target.searchParams.set('fbc', fbc);
    if (!target.searchParams.has('param2')) target.searchParams.set('param2', fbc);
  }

  return target.toString();
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
  document.addEventListener('click', (event) => {
    const link = event.target.closest && event.target.closest('a[href*="pay.hotmart.com"], a[data-checkout-link="true"]');
    if (!link) return;

    event.preventDefault();
    
    // Geramos um único eventId para a tag do navegador e para enviar no webhook da Hotmart via param3
    const eventId = buildEventId('InitiateCheckout');
    
    trackCheckoutIntent(link.dataset.checkoutSource || 'checkout_cta', { 
      includeButtonClick: true,
      eventId: eventId 
    });

    let destination = buildTrackedCheckoutUrl(link.href);
    try {
      const url = new URL(destination);
      url.searchParams.set('param3', eventId);
      destination = url.toString();
    } catch (_) {
      destination += (destination.includes('?') ? '&' : '?') + 'param3=' + eventId;
    }

    setTimeout(() => {
      window.location.href = destination;
    }, 900);
  }, true);
}

function trackCheckoutHoverIntent() {
  document.addEventListener('pointerdown', (event) => {
    const link = event.target.closest && event.target.closest('a[href*="pay.hotmart.com"], a[data-checkout-link="true"]');
    if (!link) return;
    trackCheckoutIntent(link.dataset.checkoutSource || 'checkout_pointerdown', { includeButtonClick: false });
  }, true);
}

// Inicialização
initMetaPixel();

document.addEventListener('DOMContentLoaded', () => {
  initTrafficQualitySensors();
  trackViewContent();
  prepareCheckoutLinks();
  interceptCheckoutClicks();
  trackCheckoutHoverIntent();
});
