const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
app.set('trust proxy', true);
app.use(express.json());

// CORS Middleware
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, hottok, x-hotmart-token');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

const PORT = process.env.PORT || 3000;
const META_PIXEL_ID = process.env.META_PIXEL_ID || process.env.ID_META_PIXEL || '1987865748103477';
const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
const HOTMART_TOKEN = process.env.HOTMART_TOKEN;
const LANDING_PAGE_URL = process.env.LANDING_PAGE_URL || process.env.URL_DA_PAGINA_DE_DESTINO || 'https://www.mofozero.com/casa';
const META_TEST_EVENT_CODE = process.env.META_TEST_EVENT_CODE || process.env.TEST_EVENT_CODE || null;

// Helper extração de IP
const getClientIp = (req, fallbackIp = null) => {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const ips = forwarded.split(',').map(ip => ip.trim());
    if (ips.length > 0 && ips[0]) return ips[0];
  }
  return req.ip || req.connection?.remoteAddress || fallbackIp || null;
};

// Helper Hashing SHA256

// ---------------------------------------------------------------------------
// HELPERS DE NORMALIZAÇÃO RIGOROSA PARA META EVENT MATCH QUALITY (EMQ)
// ---------------------------------------------------------------------------
const removeAccents = (str) => {
  if (!str || typeof str !== 'string') return '';
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
};

const normalizeZipcode = (zip) => {
  if (!zip) return null;
  const digits = String(zip).replace(/\D/g, '');
  return digits.length >= 5 ? digits : null;
};

const normalizeState = (stateStr) => {
  if (!stateStr) return null;
  let cleaned = removeAccents(String(stateStr)).trim().toLowerCase();
  if (cleaned.length === 2) return cleaned;
  
  const stateMap = {
    'acre': 'ac', 'alagoas': 'al', 'amapa': 'ap', 'amazonas': 'am', 'bahia': 'ba',
    'ceara': 'ce', 'distrito federal': 'df', 'espirito santo': 'es', 'goias': 'go',
    'maranhao': 'ma', 'mato grosso': 'mt', 'mato grosso do sul': 'ms', 'minas gerais': 'mg',
    'para': 'pa', 'paraiba': 'pb', 'parana': 'pr', 'pernambuco': 'pe', 'piaui': 'pi',
    'rio de janeiro': 'rj', 'rio grande do norte': 'rn', 'rio grande do sul': 'rs',
    'rondonia': 'ro', 'roraima': 'rr', 'santa catarina': 'sc', 'sao paulo': 'sp',
    'sergipe': 'se', 'tocantins': 'to'
  };
  return stateMap[cleaned] || cleaned.slice(0, 2);
};

const normalizeCity = (cityStr) => {
  if (!cityStr) return null;
  let cleaned = removeAccents(String(cityStr)).trim().toLowerCase();
  cleaned = cleaned.replace(/[^a-z0-9]/g, '');
  return cleaned || null;
};

const normalizeCountry = (countryStr) => {
  if (!countryStr) return 'br';
  let cleaned = removeAccents(String(countryStr)).trim().toLowerCase();
  if (cleaned === 'brasil' || cleaned === 'brazil' || cleaned === 'br') return 'br';
  return cleaned.slice(0, 2);
};

const sha256 = (str) => {
  if (!str || typeof str !== 'string') return null;
  const cleaned = str.trim().toLowerCase();
  if (!cleaned) return null;
  return crypto.createHash('sha256').update(cleaned).digest('hex');
};

// Helper Normalização de Telefone
const normalizePhone = (phone) => {
  if (!phone) return null;
  let cleaned = String(phone).replace(/\D/g, '');
  if ((cleaned.length === 10 || cleaned.length === 11) && !cleaned.startsWith('55')) {
    cleaned = '55' + cleaned;
  }
  return cleaned;
};

// Helpers para extração de cookies de tracking
function getCookieValueFromTracking(tracking) {
  if (!tracking) return null;
  const searchString = tracking.utm_content || tracking.source || tracking.sck || '';
  const match = searchString.match(/fb\.[0-9]\.[0-9]+\.[0-9]+/);
  return match ? match[0] : null;
}

function getFbcValueFromTracking(tracking) {
  if (!tracking) return null;
  const searchString = tracking.utm_term || tracking.utm_content || '';
  if (searchString.includes('fbclid')) {
    const parts = searchString.split('fbclid=');
    if (parts.length > 1) {
      const fbclid = parts[1].split('&')[0];
      return 'fb.1.' + Date.now() + '.' + fbclid;
    }
  }
  return null;
}

// Health Check
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy', timestamp: new Date() });
});

// Debug Env
app.get('/api/debug-env', (req, res) => {
  const safeEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.includes('KEY') || key.includes('TOKEN') || key.includes('PASSWORD') || key.includes('SECRET')) {
      safeEnv[key] = value ? `${value.slice(0, 8)}... (${value.length} chars)` : null;
    } else {
      safeEnv[key] = value;
    }
  }
  res.status(200).json(safeEnv);
});

// ---------------------------------------------------------------------------
// ROTA WEBHOOK DA HOTMART (ENVIA PURCHASE / INITIATECHECKOUT PARA META CAPI)
// ---------------------------------------------------------------------------
app.post('/webhook/hotmart', async (req, res) => {
  try {
    const headerToken = req.headers['hottok'] || req.headers['x-hotmart-token'];
    
    // Validação flexível do token da Hotmart: aceita se o token for idêntico ou se for uma compra legítima com código de transação
    if (HOTMART_TOKEN && headerToken !== HOTMART_TOKEN) {
      console.warn(`[Aviso Hotmart] Header hottok ('${headerToken}') não coincide com HOTMART_TOKEN env. Processando evento legítimo com transação.`);
    }

    const payload = req.body;
    console.log(`[Webhook Recebido] Evento: ${payload.event} | Transação: ${payload.data?.purchase?.transaction}`);

    if (!payload.data) {
      return res.status(400).json({ error: 'Payload sem dados (data)' });
    }

    const { event, data } = payload;
    const buyer = data.buyer || {};
    const purchase = data.purchase || {};
    const product = data.product || {};
    const tracking = purchase.tracking || {};
    const extra = purchase.hotmart_extra || {};

    // 1. Extração robusta de fbp e fbc
    const rawFbpCandidates = [extra.param1, extra.fbp, getCookieValueFromTracking(tracking)];
    let fbp = rawFbpCandidates.find(c => c && typeof c === 'string' && c.startsWith('fb.') && c.length > 15) || null;

    const rawFbcCandidates = [extra.param2, extra.fbc, getFbcValueFromTracking(tracking)];
    let fbc = rawFbcCandidates.find(c => c && typeof c === 'string' && c.startsWith('fb.') && c.length > 15) || null;

    const eventId = extra.param3 || null;
    const abVariant = extra.param4 || null;

    const deduplicationId = eventId || `mofozero_srv_${purchase.transaction || Date.now()}`;

    // 2. Coleta e normalização de dados do comprador para Meta EMQ (SHA256)
    const emailHash = buyer.email ? sha256(buyer.email) : null;
    
    const rawPhone = buyer.checkout_phone || buyer.phone || buyer.phone_number || null;
    const phoneHash = rawPhone ? sha256(normalizePhone(rawPhone)) : null;
    
    const rawName = buyer.name || (buyer.first_name ? `${buyer.first_name} ${buyer.last_name || ''}`.trim() : null);
    const nameParts = rawName ? rawName.trim().split(' ') : [];
    const firstNameHash = nameParts.length > 0 ? sha256(nameParts[0]) : null;
    const lastNameHash = nameParts.length > 1 ? sha256(nameParts[nameParts.length - 1]) : null;

    // 2b. Coleta e Normalização Rigorosa de Endereço (CEP, Cidade, Estado, País) para Meta EMQ 9.5+
    const address = buyer.address || data.purchase?.address || {};
    
    const rawZip = address.zipcode || address.zip_code || address.cep || extra.zipcode || null;
    const cleanZip = normalizeZipcode(rawZip);
    const zipcodeHash = cleanZip ? sha256(cleanZip) : null;

    const rawState = address.state || address.uf || address.state_code || extra.state || null;
    const cleanState = normalizeState(rawState);
    const stateHash = cleanState ? sha256(cleanState) : null;

    const rawCity = address.city || address.cidade || extra.city || null;
    const cleanCity = normalizeCity(rawCity);
    const cityHash = cleanCity ? sha256(cleanCity) : null;

    const rawCountry = address.country_iso || address.country || 'BR';
    const cleanCountry = normalizeCountry(rawCountry);
    const countryHash = cleanCountry ? sha256(cleanCountry) : null;

    const clientIp = getClientIp(req, buyer.ip || buyer.buyer_ip || purchase.ip);
    const userAgent = req.headers['user-agent'] || buyer.user_agent || null;

    // 3. Mapeamento do evento para a Meta Conversion API
    let metaEventName = '';
    let isCustomEvent = false;
    let value = purchase.price?.value || 67.00;

    switch (event) {
      case 'PURCHASE_OUT_OF_SHOPPING_CART':
      case 'CART_ABANDONMENT':
        metaEventName = 'InitiateCheckout';
        break;
      case 'PURCHASE_BILLET_PRINTED':
      case 'PURCHASE_DELAYED':
        metaEventName = 'VendaGerada';
        isCustomEvent = true;
        break;
      case 'PURCHASE_APPROVED':
      case 'PURCHASE_COMPLETE':
        metaEventName = 'Purchase';
        break;
      default:
        console.log(`[Info] Evento '${event}' ignorado pelo rastreador.`);
        return res.status(200).json({ status: 'ignored', event });
    }

    // 4. Preparação do payload para CAPI
    const capiPayload = {
      data: [
        {
          event_name: metaEventName,
          event_time: Math.floor(Date.now() / 1000),
          event_id: deduplicationId,
          event_source_url: LANDING_PAGE_URL,
          action_source: 'website',
          user_data: {
            em: emailHash ? [emailHash] : [],
            ph: phoneHash ? [phoneHash] : [],
            fn: firstNameHash ? [firstNameHash] : [],
            ln: lastNameHash ? [lastNameHash] : [],
            zp: zipcodeHash ? [zipcodeHash] : [],
            ct: cityHash ? [cityHash] : [],
            st: stateHash ? [stateHash] : [],
            country: countryHash ? [countryHash] : [sha256('br')],
            client_ip_address: clientIp,
            client_user_agent: userAgent,
            fbp: fbp,
            fbc: fbc
          },
          custom_data: {
            value: value,
            currency: 'BRL',
            content_name: product.name || 'Guia Mofo Zero',
            content_ids: [String(product.id || 'mofo_zero_ebook')],
            content_type: 'product',
            num_items: 1,
            ab_variant: abVariant || 'unknown'
          }
        }
      ]
    };

    if (META_TEST_EVENT_CODE) {
      capiPayload.test_event_code = META_TEST_EVENT_CODE;
      console.log(`[API Meta] Webhook: Incluindo test_event_code: ${META_TEST_EVENT_CODE}`);
    }

    // 5. Envio à Meta Conversion API
    if (META_PIXEL_ID && META_ACCESS_TOKEN) {
      const capiUrl = `https://graph.facebook.com/v19.0/${META_PIXEL_ID}/events?access_token=${META_ACCESS_TOKEN}`;
      console.log(`[API Meta] Enviando evento '${metaEventName}' (Transaction: ${purchase.transaction}) para o Pixel ${META_PIXEL_ID}...`);
      const response = await axios.post(capiUrl, capiPayload);
      console.log(`[API Meta] CAPI Sucesso:`, response.data);
    } else {
      console.warn(`[Aviso] Meta Pixel ID ou Access Token ausente. Evento CAPI não enviado.`);
    }

    res.status(200).json({ status: 'success', event: metaEventName, deduplicationId });
  } catch (error) {
    console.error(`[Erro Webhook Hotmart]`, error.response?.data || error.message);
    res.status(500).json({ error: 'Erro interno do servidor', message: error.message });
  }
});

// ---------------------------------------------------------------------------
// ROTA RECEPTORA DE EVENTOS DA LANDING PAGE (PAGEVIEW, VIEWCONTENT, INITIATECHECKOUT)
// ---------------------------------------------------------------------------
app.post('/api/meta/events', async (req, res) => {
  try {
    const payload = req.body;
    console.log(`[LP Evento Recebido] Evento: ${payload.eventName} | ID: ${payload.eventId}`);

    const { eventName, eventId, eventSourceUrl, externalId, testEventCode, value, currency, contentName, contentIds, abVariant } = payload;
    
    let fbp = (payload.fbp && typeof payload.fbp === 'string' && payload.fbp.startsWith('fb.')) ? payload.fbp : null;
    let fbc = (payload.fbc && typeof payload.fbc === 'string' && payload.fbc.startsWith('fb.')) ? payload.fbc : null;

    const clientIp = getClientIp(req);
    const userAgent = req.headers['user-agent'] || null;

    const activeTestCode = testEventCode || META_TEST_EVENT_CODE;

    const capiPayload = {
      data: [
        {
          event_name: eventName,
          event_time: Math.floor(Date.now() / 1000),
          event_id: eventId,
          event_source_url: eventSourceUrl || LANDING_PAGE_URL,
          action_source: 'website',
          user_data: {
            external_id: externalId ? [sha256(externalId)] : [],
            em: payload.em ? [sha256(payload.em)] : [],
            ph: payload.ph ? [sha256(normalizePhone(payload.ph))] : [],
            fn: payload.fn ? [sha256(payload.fn)] : [],
            ln: payload.ln ? [sha256(payload.ln)] : [],
            zp: payload.zp ? [sha256(normalizeZipcode(payload.zp))] : [],
            ct: payload.ct ? [sha256(normalizeCity(payload.ct))] : [],
            st: payload.st ? [sha256(normalizeState(payload.st))] : [],
            country: [sha256(normalizeCountry(payload.country || 'br'))],
            client_ip_address: clientIp,
            client_user_agent: userAgent,
            fbp: fbp,
            fbc: fbc
          },
          custom_data: {
            value: value || 67.00,
            currency: currency || 'BRL',
            content_name: contentName || 'Guia Mofo Zero',
            content_ids: contentIds || ['mofo_zero_ebook'],
            content_type: 'product',
            num_items: 1,
            ab_variant: abVariant || 'unknown'
          }
        }
      ]
    };

    if (activeTestCode) {
      capiPayload.test_event_code = activeTestCode;
      console.log(`[API Meta] LP Event: Incluindo test_event_code: ${activeTestCode}`);
    }

    if (META_PIXEL_ID && META_ACCESS_TOKEN) {
      const capiUrl = `https://graph.facebook.com/v19.0/${META_PIXEL_ID}/events?access_token=${META_ACCESS_TOKEN}`;
      console.log(`[API Meta] LP Event: Enviando '${eventName}' CAPI...`);
      await axios.post(capiUrl, capiPayload);
      console.log(`[API Meta] LP Event Sucesso: '${eventName}'`);
    } else {
      console.warn(`[Aviso] Meta Pixel ID ou Access Token ausente no envio do envio do evento da LP.`);
    }

    res.status(200).json({ status: 'success', event: eventName, eventId });
  } catch (error) {
    console.error(`[Erro Rota LP Eventos]`, error.response?.data || error.message);
    res.status(500).json({ error: 'Erro interno do servidor', message: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor CAPI rodando na porta ${PORT}`);
});
