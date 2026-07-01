import { ok, badRequest } from 'wix-http-functions';
import { getSecret } from 'wix-secrets-backend';
import { submitEvent } from 'wix-payment-provider-backend';
import { verifyWebhookSignature } from 'backend/utils/crypto-utils';

const processedRequests = new Set();

export async function post_updateTransaction(request) {
  try {
    const body = await request.body.text();
    const signature = request.headers['nomba-signature'];
    const nombaTimestamp = request.headers['nomba-timestamp'];

    const webhookSecret = await getSecret('NOMBA_WEBHOOK_SECRET');
    const isValid = verifyWebhookSignature(body, signature, webhookSecret, nombaTimestamp);

    if (!isValid) {
      return { status: 401 };
    }

    const payload = JSON.parse(body);
    const requestId = payload.requestId;

    if (processedRequests.has(requestId)) {
      return ok({ headers: { 'Content-Type': 'application/json' }, body: { status: 200 } });
    }
    processedRequests.add(requestId);

    const eventType = payload.event_type;
    const transaction = payload.data?.transaction || {};
    const transactionId = transaction.transactionId || '';

    const statusMap = {
      'payment_success': 'APPROVED',
      'payment_failed': 'DECLINED',
      'payment_pending': 'PENDING'
    };

    const wixStatus = statusMap[eventType] || 'PENDING';

    await submitEvent({
      event: {
        transaction: {
          wixTransactionId: payload.requestId,
          pluginTransactionId: transactionId,
          status: wixStatus
        }
      }
    });

    return ok({ headers: { 'Content-Type': 'application/json' }, body: { status: 200 } });
  } catch {
    return ok({ headers: { 'Content-Type': 'application/json' }, body: { status: 200 } });
  }
}

export async function post_updateRefund(request) {
  try {
    const body = await request.body.text();
    const signature = request.headers['nomba-signature'];
    const nombaTimestamp = request.headers['nomba-timestamp'];

    const webhookSecret = await getSecret('NOMBA_WEBHOOK_SECRET');
    const isValid = verifyWebhookSignature(body, signature, webhookSecret, nombaTimestamp);

    if (!isValid) {
      return { status: 401 };
    }

    const payload = JSON.parse(body);
    const requestId = payload.requestId;

    if (processedRequests.has(requestId)) {
      return ok({ headers: { 'Content-Type': 'application/json' }, body: { status: 200 } });
    }
    processedRequests.add(requestId);

    const eventType = payload.event_type;
    const transaction = payload.data?.transaction || {};

    const refundStatusMap = {
      'payout_refund': 'REFUNDED',
      'payment_failed': 'REFUND_FAILED'
    };

    const wixStatus = refundStatusMap[eventType] || 'REFUNDED';

    await submitEvent({
      event: {
        refund: {
          wixTransactionId: payload.requestId,
          wixRefundId: payload.requestId,
          pluginRefundId: transaction.transactionId || '',
          status: wixStatus
        }
      }
    });

    return ok({ headers: { 'Content-Type': 'application/json' }, body: { status: 200 } });
  } catch {
    return ok({ headers: { 'Content-Type': 'application/json' }, body: { status: 200 } });
  }
}

export async function get_health(request) {
  return ok({ headers: { 'Content-Type': 'application/json' }, body: { status: 'ok' } });
}
