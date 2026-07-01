import { fetch } from 'wix-fetch';

const NOMBA_BASE_URL = 'https://sandbox.api.nomba.com/v1';
const RETRY_ATTEMPTS = 3;

let cachedToken = null;
let tokenExpiresAt = null;

async function fetchWithRetry(url, options) {
  let lastError;
  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(url, options);
      return response;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

export async function getAccessToken(parentAccountId, clientId, privateKey) {
  const now = Date.now();
  if (cachedToken && tokenExpiresAt && now < tokenExpiresAt) {
    return { success: true, data: { access_token: cachedToken } };
  }

  try {
    const response = await fetchWithRetry(`${NOMBA_BASE_URL}/auth/token/issue`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'accountId': parentAccountId
      },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: privateKey
      })
    });

    const result = await response.json();

    if (result.code !== '00') {
      return { success: false, error: 'Authentication failed' };
    }

    cachedToken = result.data.access_token;
    tokenExpiresAt = now + (25 * 60 * 1000);

    return { success: true, data: result.data };
  } catch (error) {
    return { success: false, error: 'Network error during authentication' };
  }
}

export async function validateCredentials(parentAccountId, clientId, privateKey) {
  const result = await getAccessToken(parentAccountId, clientId, privateKey);
  return result.success;
}

export async function createCheckout(params, accessToken, parentAccountId) {
  try {
    const response = await fetchWithRetry(`${NOMBA_BASE_URL}/checkout/order`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
        'accountId': parentAccountId,
        'X-Idempotent-key': params.order.orderReference
      },
      body: JSON.stringify({ order: params.order })
    });

    const result = await response.json();

    if (result.code !== '00') {
      return { success: false, error: result.description || 'Checkout creation failed' };
    }

    return { success: true, data: result.data };
  } catch (error) {
    return { success: false, error: 'Network error during checkout' };
  }
}

export async function processRefund(params, accessToken, parentAccountId) {
  try {
    const response = await fetchWithRetry(`${NOMBA_BASE_URL}/transactions/refund`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
        'accountId': parentAccountId
      },
      body: JSON.stringify({
        transactionId: params.transactionId,
        amount: params.amount,
        reason: params.reason || 'Customer requested refund'
      })
    });

    const result = await response.json();

    if (result.code !== '00') {
      return { success: false, error: result.description || 'Refund failed' };
    }

    return { success: true, data: result.data };
  } catch (error) {
    return { success: false, error: 'Network error during refund' };
  }
}
