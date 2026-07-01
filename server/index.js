const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
app.set('trust proxy', true);
app.use(express.json());

// Middleware para habilitar CORS (Evita bloqueios no navegador ao enviar eventos da LP)
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
const META_PIXEL_ID = process.env.META_PIXEL_ID || process.env.ID_META_PIXEL;
const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
const HOTMART_TOKEN = process.env.HOTMART_TOKEN;
const LANDING_PAGE_URL = process.env.LANDING_PAGE_URL || process.env.URL_DA_PAGINA_DE_DESTINO || process.env.URL_DA_PÁGINA_DE_DESTINO || 'http://localhost';
const META_TEST_EVENT_CODE = process.env.META_TEST_EVENT_CODE || process.env.TEST_EVENT_CODE || null;

// Helper para criar hash SHA256 exigido pela Meta CAPI
const sha256 = (str) => {
  if (!str) return null;
  return crypto.createHash('sha256').update(str.trim().toLowerCase()).digest('hex');
};

// Normalização de telefone para o padrão DDI 55 + DDD + Número
const normalizePhone = (phone) => {
  if (!phone) return null;
  let cleaned = phone.replace(/\D/g, '');
  if ((cleaned.length === 10 || cleaned.length === 11) && !cleaned.startsWith('55')) {
    cleaned = '55' + cleaned;
  }
  return cleaned;
};

// Rota de status do servidor
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy', timestamp: new Date() });
});

// Rota temporária de debug para recuperação de credenciais da Meta
app.get('/api/debug-token', (req, res) => {
  res.status(200).json({ 
    token: process.env.META_ACCESS_TOKEN || null,
    pixelId: process.env.META_PIXEL_ID || null,
    adAccountId: process.env.META_AD_ACCOUNT_ID || null
  });
});

// Rota receptora de Webhooks da Hotmart
app.post('/webhook/hotmart', async (req, res) => {
  try {
    const headerToken = req.headers['hottok'] || req.headers['x-hotmart-token'];
    
    // Validação de token de segurança
    if (HOTMART_TOKEN && headerToken !== HOTMART_TOKEN) {
      console.warn(`[Aviso] Requisição bloqueada: Token Hotmart inválido.`);
      return res.status(401).json({ error: 'Não autorizado' });
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

    // 1. Extração de parâmetros e cookies passados do checkout da Hotmart
    const fbp = extra.param1 || getCookieValueFromTracking(tracking) || null;
    const fbc = extra.param2 || getFbcValueFromTracking(tracking) || null;
    const eventId = extra.param3 || null; // event_id gerado na LP para deduplicação
    const abVariant = extra.param4 || null; // Variante do A/B test (copy1 ou copy2)

    // Se o webhook não recebeu um event_id gerado no clique, usamos o código da transação para deduplicação
    const deduplicationId = eventId || `mofozero_srv_${purchase.transaction}`;

    // 2. Coleta e normalização de dados do comprador para o Meta Event Match Quality (EMQ)
    const emailHash = buyer.email ? sha256(buyer.email) : null;
    
    const rawPhone = buyer.checkout_phone || buyer.phone || buyer.phone_number || null;
    const phoneHash = rawPhone ? sha256(normalizePhone(rawPhone)) : null;
    
    const rawName = buyer.name || (buyer.first_name ? `${buyer.first_name} ${buyer.last_name || ''}`.trim() : null);
    const nameParts = rawName ? rawName.trim().split(' ') : [];
    const firstNameHash = nameParts.length > 0 ? sha256(nameParts[0]) : null;
    const lastNameHash = nameParts.length > 1 ? sha256(nameParts[nameParts.length - 1]) : null;

    // Dados de endereço se disponíveis no checkout para enriquecer o EMQ
    const address = buyer.address || {};
    const zipcodeHash = address.zipcode ? sha256(address.zipcode.replace(/\D/g, '').trim().toLowerCase()) : null;
    const stateHash = address.state ? sha256(address.state.trim().toLowerCase()) : null;
    const countryHash = address.country_iso ? sha256(address.country_iso.trim().toLowerCase()) : null;

    const clientIp = buyer.ip || buyer.buyer_ip || purchase.ip || null;
    const userAgent = req.headers['user-agent'] || null;

    // 3. Mapeamento do evento da Hotmart para o Meta Pixel / Conversion API
    let metaEventName = '';
    let isCustomEvent = false;
    let value = purchase.price?.value || 37.00;

    switch (event) {
      case 'PURCHASE_OUT_OF_SHOPPING_CART':
      case 'CART_ABANDONMENT':
        metaEventName = 'InitiateCheckout';
        break;
      case 'PURCHASE_BILLET_PRINTED':
      case 'PURCHASE_DELAYED':
        // Pix Gerado / Boleto Impresso -> Venda Gerada
        metaEventName = 'VendaGerada';
        isCustomEvent = true;
        break;
      case 'PURCHASE_APPROVED':
        metaEventName = 'Purchase';
        break;
      default:
        console.log(`[Info] Evento '${event}' ignorado pelo rastreador.`);
        return res.status(200).json({ status: 'ignored', event });
    }

    // 4. Preparação do payload para a API de Conversão da Meta (CAPI)
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
            st: stateHash ? [stateHash] : [],
            country: countryHash ? [countryHash] : [],
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
            ab_variant: abVariant
          }
        }
      ]
    };

    if (META_TEST_EVENT_CODE) {
      capiPayload.test_event_code = META_TEST_EVENT_CODE;
      console.log(`[API Meta] Incluindo test_event_code: ${META_TEST_EVENT_CODE}`);
    }

    // 5. Envio à Meta Conversion API
    if (META_PIXEL_ID && META_ACCESS_TOKEN) {
      const capiUrl = `https://graph.facebook.com/v19.0/${META_PIXEL_ID}/events?access_token=${META_ACCESS_TOKEN}`;
      
      console.log(`[API Meta] Enviando evento '${metaEventName}' CAPI para o Pixel ${META_PIXEL_ID}...`);
      const response = await axios.post(capiUrl, capiPayload);
      console.log(`[API Meta] Sucesso:`, response.data);
    } else {
      console.log(`[Aviso] Meta Pixel ID ou Access Token ausente. Evento CAPI não enviado.`);
    }

    res.status(200).json({ status: 'success', event: metaEventName, deduplicationId });
  } catch (error) {
    console.error(`[Erro Webhook]`, error.response?.data || error.message);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Rota receptora de Eventos de Servidor da Landing Page (CAPI Híbrida)
app.post('/api/meta/events', async (req, res) => {
  try {
    const payload = req.body;
    console.log(`[LP Evento Recebido] Evento: ${payload.eventName} | ID: ${payload.eventId} | Variant: ${payload.abVariant}`);

    const { eventName, eventId, eventSourceUrl, externalId, fbp, fbc, testEventCode, value, currency, contentName, contentIds, abVariant } = payload;

    // Se houver um test_event_code na requisição (enviado pela LP em testes), usamos ele.
    // Caso contrário, usamos a variável de ambiente do servidor.
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
            external_id: externalId ? [sha256(externalId) || externalId] : [], // Meta aceita external_id bruto ou hasheado
            client_ip_address: req.ip || null,
            client_user_agent: req.headers['user-agent'] || null,
            fbp: fbp,
            fbc: fbc
          },
          custom_data: {
            value: value || 37.00,
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
      console.log(`[API Meta] LP Event: Enviando '${eventName}' para o Pixel ${META_PIXEL_ID} via CAPI...`);
      await axios.post(capiUrl, capiPayload);
      console.log(`[API Meta] LP Event: Sucesso ao enviar '${eventName}'`);
    } else {
      console.warn(`[Aviso] Meta Pixel ID ou Access Token ausente no envio do evento da LP.`);
    }

    res.status(200).json({ status: 'success', event: eventName, eventId });
  } catch (error) {
    console.error(`[Erro Rota LP Eventos]`, error.response?.data || error.message);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Helpers para tentar extrair cookies de parâmetros UTM/Source se vierem concatenados
function getCookieValueFromTracking(tracking) {
  if (!tracking) return null;
  // Verifica se o _fbp veio anexado no utm_content ou em outros campos de tracking
  const searchString = tracking.utm_content || tracking.source || '';
  const match = searchString.match(/fb\.[0-9]\.[0-9]+\.[0-9]+/);
  return match ? match[0] : null;
}

function getFbcValueFromTracking(tracking) {
  if (!tracking) return null;
  // Procura por um fbclid nos campos de tracking
  const searchString = tracking.utm_term || tracking.utm_content || '';
  if (searchString.includes('fbclid')) {
    const parts = searchString.split('fbclid=');
    if (parts.length > 1) return parts[1].split('&')[0];
  }
  return null;
}

// Inicializa o servidor Express
app.listen(PORT, () => {
  console.log(`🚀 Servidor Webhook Mofo Zero rodando na porta ${PORT}`);
});
