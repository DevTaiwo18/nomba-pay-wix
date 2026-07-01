import { createHmac } from 'crypto';

export function verifyWebhookSignature(payload, receivedSignature, secret, nombaTimestamp) {
  try {
    const body = typeof payload === 'string' ? JSON.parse(payload) : payload;
    const data = body.data || {};
    const merchant = data.merchant || {};
    const transaction = data.transaction || {};
    const eventType = body.event_type || '';
    const requestId = body.requestId || '';
    const userId = merchant.userId || '';
    const walletId = merchant.walletId || '';
    const transactionId = transaction.transactionId || '';
    const transactionType = transaction.type || '';
    const transactionTime = transaction.time || '';
    let responseCode = transaction.responseCode || '';
    if (responseCode === 'null') { responseCode = ''; }
    const hashingPayload = `${eventType}:${requestId}:${userId}:${walletId}:${transactionId}:${transactionType}:${transactionTime}:${responseCode}:${nombaTimestamp}`;
    const hmac = createHmac('sha256', secret);
    hmac.update(hashingPayload);
    const generatedSignature = hmac.digest('base64');
    return generatedSignature.toLowerCase() === receivedSignature.toLowerCase();
  } catch { return false; }
}
