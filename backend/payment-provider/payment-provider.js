import { getSecret } from 'wix-secrets-backend';
import { getAccessToken, createCheckout, processRefund } from 'backend/utils/nomba-api';

export async function connectAccount(options) {
  try {
    const { clientId, privateKey, parentAccountId } = options.credentials;
    return {
      credentials: { clientId, privateKey, parentAccountId },
      accountId: parentAccountId,
      accountName: 'Nomba Pay'
    };
  } catch {
    return {
      errorCode: 'INVALID_CREDENTIALS',
      errorMessage: 'Invalid API credentials. Check your Nomba dashboard.'
    };
  }
}

export async function createTransaction(options) {
  try {
    const parentAccountId = await getSecret('NOMBA_PARENT_ACCOUNT_ID');
    const clientId = await getSecret('NOMBA_CLIENT_ID');
    const privateKey = await getSecret('NOMBA_PRIVATE_KEY');
    const tokenResult = await getAccessToken(parentAccountId, clientId, privateKey);
    if (!tokenResult.success) {
      return { errorCode: 'PROVIDER_ERROR', errorMessage: 'Payment could not be initiated. Please try again.' };
    }
    const checkoutResult = await createCheckout({
      order: {
        orderReference: options.wixTransactionId,
        amount: options.order.description.totalAmount,
        currency: 'NGN',
        callbackUrl: 'https://adeyemitaiwo24434.wixsite.com/nomba-pay-demo/_functions/post_updateTransaction',
        customerId: options.order.description.buyerInfo?.buyerId || '',
        customerEmail: options.order.description.billingAddress?.email || ''
      }
    }, tokenResult.data.access_token, parentAccountId);
    if (!checkoutResult.success) {
      return { errorCode: 'PROVIDER_ERROR', errorMessage: 'Payment could not be initiated. Please try again.' };
    }
    return {
      pluginTransactionId: checkoutResult.data.orderReference,
      redirectUrl: checkoutResult.data.checkoutUrl
    };
  } catch {
    return { errorCode: 'PROVIDER_ERROR', errorMessage: 'Payment could not be completed. Please try again.' };
  }
}

export async function refundTransaction(options) {
  try {
    const parentAccountId = await getSecret('NOMBA_PARENT_ACCOUNT_ID');
    const clientId = await getSecret('NOMBA_CLIENT_ID');
    const privateKey = await getSecret('NOMBA_PRIVATE_KEY');
    const tokenResult = await getAccessToken(parentAccountId, clientId, privateKey);
    if (!tokenResult.success) {
      return { errorCode: 'PROVIDER_ERROR', errorMessage: 'Refund could not be processed. Please try again.' };
    }
    const refundResult = await processRefund({
      transactionId: options.pluginTransactionId,
      amount: options.refundAmount,
      reason: 'Customer requested refund'
    }, tokenResult.data.access_token, parentAccountId);
    if (!refundResult.success) {
      return { errorCode: 'REFUND_FAILED', errorMessage: `Refund could not be processed. Reason: ${refundResult.error}` };
    }
    return {
      pluginRefundId: refundResult.data.transactionId || options.pluginTransactionId
    };
  } catch {
    return { errorCode: 'REFUND_FAILED', errorMessage: 'Refund could not be processed. Please try again.' };
  }
}
