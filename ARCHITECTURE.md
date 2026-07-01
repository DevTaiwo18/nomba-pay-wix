# ARCHITECTURE.md — Nomba Pay for Wix

Complete technical blueprint. Every file, every function, every API call, every
data flow mapped before a single line of production code is written.

> **BEFORE PUSHING ON JULY 1:**
> Fill in all placeholders marked "confirmed June 23" with real values from the
> Nomba sandbox docs and onboarding sessions. Delete the Open Items section at
> the bottom once every question is answered. Push only the clean final version.

---

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        WIX STORE                                │
│                                                                 │
│  Customer           Wix Checkout          Wix Backend (Velo)   │
│  ────────           ────────────          ─────────────────     │
│  Browse store  ──►  Place order      ──►  createTransaction()  │
│  Pay on Nomba  ◄──  Redirect to URL  ◄──  (returns Nomba URL)  │
│  Complete pay       ▲                                           │
│                     │                                           │
│                     └── submitEvent() ◄── post_updateTransaction│
│                         (order=PAID)       (Nomba webhook)      │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
                    ┌───────────────────────┐
                    │      NOMBA API        │
                    │                       │
                    │  POST /checkout       │
                    │  POST /refunds        │
                    │  GET  /accounts/me    │
                    │  Webhooks (HMAC-256)  │
                    └───────────────────────┘
```

---

## File Map

### `backend/payment-provider/payment-provider.js`
The SPI core. Wix calls these three functions directly.
This file contains business logic only — all HTTP calls go through `nomba-api.js`.

```
exports:
  connectAccount(options)       ← called when merchant clicks Connect
  createTransaction(options)    ← called when customer clicks Pay Now
  refundTransaction(options)    ← called when merchant clicks Refund
```

### `backend/http-functions.js`
The webhook receiver. Wix exposes this file as public HTTP endpoints automatically.
File must be named exactly `http-functions.js` at the root of `backend/`.

```
exports:
  post_updateTransaction(request)   ← Nomba calls this after payment
  post_updateRefund(request)        ← Nomba calls this after refund
  get_health(request)               ← judges hit this to confirm plugin is live
```

### `backend/utils/nomba-api.js`
The only place in the entire codebase where Nomba HTTP calls are made.
All other files import from here — never call fetch() directly elsewhere.

```
exports:
  getAccessToken(parentAccountId, clientId, privateKey)   ← POST /auth/token/issue, cached 55min
  validateCredentials(parentAccountId, clientId, privateKey)   ← calls getAccessToken, returns true/false
  createCheckout(params, accessToken, parentAccountId)    ← logs merchantTxRef on every call
  processRefund(params, accessToken, parentAccountId)     ← logs merchantTxRef on every call

Logging rule: every Nomba API call logs { merchantTxRef, endpoint, status, timestamp }
Never log: accessToken, clientSecret, webhookSecret, customer card data
```

### `backend/utils/crypto-utils.js`
Webhook signature verification only. One function, one responsibility.

```
exports:
  verifyWebhookSignature(payload, receivedSignature, webhookSecret, nombaTimestamp)

Signature is NOT raw body HMAC. It is HMAC-SHA256 of a constructed string:
  `${event_type}:${requestId}:${userId}:${walletId}:${transactionId}:${transactionType}:${transactionTime}:${transactionResponseCode}:${nombaTimestamp}`
Output encoded as BASE64 — not hex.
Compare with nomba-signature header case-insensitively.
```

---

## Data Flows

### Flow 1: Merchant Connects Account

```
Merchant types parentAccountId + clientId + privateKey
        │
        ▼
Wix calls connectAccount({ credentials: { parentAccountId, clientId, privateKey } })
        │
        ▼
nomba-api.validateCredentials(parentAccountId, clientId, privateKey)
  → POST https://sandbox.api.nomba.com/v1/auth/token/issue
  → Headers: { Content-Type: application/json, accountId: parentAccountId }
  → Body: { grant_type: "client_credentials", client_id: clientId, client_secret: privateKey }
        │
        ├── 200 OK → { data: { access_token } }
        │     │
        │     ▼
        │   token is valid — credentials are good
        │   wixSecretsBackend.set('NOMBA_PARENT_ACCOUNT_ID', parentAccountId)
        │   wixSecretsBackend.set('NOMBA_CLIENT_ID', clientId)
        │   wixSecretsBackend.set('NOMBA_PRIVATE_KEY', privateKey)
        │     │
        │     ▼
        │   return { accountId, businessName }   ← Wix shows "Connected as: [name]"
        │
        └── 401/error → return { error: "Invalid API credentials. Check your Nomba dashboard." }
```

### Auth Token Strategy

```
Every Nomba API call requires two headers:
  Authorization: Bearer <access_token>
  accountId: <merchant accountId>

Token lifetime: 30 minutes (confirmed from docs — training said 60, docs say 30, trust docs)
Cache strategy: get token once, reuse for 25 minutes, then refresh using refresh_token
Refresh endpoint: POST https://sandbox.api.nomba.com/v1/auth/token/refresh

Token request:
  POST https://sandbox.api.nomba.com/v1/auth/token/issue
  Headers: { Content-Type: application/json, accountId: <accountId> }
  Body: { grant_type: "client_credentials", client_id: <clientId>, client_secret: <clientSecret> }

Never request a fresh token on every API call — cache and reuse.
```

### Flow 2: Customer Pays

```
Customer clicks Pay Now
        │
        ▼
Wix calls createTransaction({
  orderId,          ← use as idempotency key
  amount,           ← in kobo already (Wix sends smallest unit)
  currency,         ← must be 'NGN' — reject anything else
  merchantCredentials: { accountId },
  customer: { email, name },
  returnUrl,        ← Wix provides this — send customer here after payment
  cancelUrl         ← Wix provides this — send customer here if they abandon
})
        │
        ▼
GUARD: if currency !== 'NGN' → throw "This store only accepts NGN payments."
        │
        ▼
wixSecretsBackend.getSecret('NOMBA_ACCOUNT_ID')
wixSecretsBackend.getSecret('NOMBA_CLIENT_ID')
wixSecretsBackend.getSecret('NOMBA_CLIENT_SECRET')
        │
        ▼
nomba-api.getAccessToken(accountId, clientId, clientSecret)
  → POST https://sandbox.api.nomba.com/v1/auth/token/issue
  → cache token for 55 minutes
        │
        ▼
nomba-api.createCheckout({
  order: {
    orderReference: orderId,      ← idempotency key — nested under "order"
    amount: amount,               ← kobo — Wix sends kobo already, no conversion needed
    currency: 'NGN',
    callbackUrl: 'https://[site]/_functions/post_updateTransaction',
    customerId: customer.id,
    customerEmail: customer.email
  }
}, accessToken, accountId)
  → POST https://sandbox.api.nomba.com/v1/checkout/order
  → Response: { data: { checkoutUrl, orderReference } }
        │
        ├── success → { checkoutUrl: 'https://checkout.nomba.com/pay/xyz' }
        │     │
        │     ▼
        │   return { pluginTransactionId: orderId, redirectUrl: checkoutUrl }
        │   Wix redirects customer to Nomba payment page
        │
        └── failure → return { errorCode: 'PROVIDER_ERROR', errorMessage: "Payment could not be initiated. Please try again." }
```

### Flow 3: Webhook Updates Order

```
Nomba POSTs to https://[site]/_functions/post_updateTransaction
  Body: {
    reference,    ← this is the orderId we sent
    status,       ← 'successful' | 'failed' | 'pending'
    amount,
    transactionId
  }
  Headers: { 'nomba-signature': '<hmac-sha256-hex>' }   ← CONFIRMED header name
        │
        ▼
crypto-utils.verifyWebhookSignature(rawBody, signature, webhookSecret)
        │
        ├── invalid → return { status: 401 } — stop processing
        │
        └── valid → continue
                │
                ▼
        parse: { event, requestId, data: { merchantTxRef, amount, currency } }
        ← event type is 'payment_success'
        ← use requestId for duplicate detection
                │
                ▼
        check duplicate: has event.requestId already been processed?
        ├── yes → return { status: 200 } silently — never process twice
        └── no  → store requestId, continue
                │
                ▼
        map status:
          'successful' → 'APPROVED'
          'failed'     → 'DECLINED'
          'pending'    → 'PENDING'
                │
                ▼
        wixPaymentProviderBackend.submitEvent({
          event: {
            transaction: {
              wixTransactionId: reference,
              pluginTransactionId: transactionId,
              status: mappedStatus
            }
          }
        })
                │
                ▼
        return { status: 200 }   ← must return 200 or Nomba retries
```

### Flow 4: Merchant Refunds

```
Merchant clicks Refund in Wix dashboard
        │
        ▼
Wix calls refundTransaction({
  pluginTransactionId,    ← original Nomba transaction reference
  refundAmount,           ← amount to refund in kobo (may be less than original)
  merchantCredentials: { accountId }
})
        │
        ▼
wixSecretsBackend.getSecret('NOMBA_API_KEY')
wixSecretsBackend.getSecret('NOMBA_API_SECRET')
        │
        ▼
nomba-api.processRefund({
  transactionId: pluginTransactionId,
  amount: refundAmount
}, apiKey, apiSecret)
  → POST https://api.nomba.com/v1/refunds   ← exact endpoint confirmed June 23
        │
        ├── success → return { refundStatus: 'PENDING' }
        │   (Nomba confirms final status via post_updateRefund webhook)
        │
        └── failure → return { refundStatus: 'FAILED', errorMessage: "Refund could not be processed. Reason: [X]" }
```

### Flow 5: Refund Webhook

```
Nomba POSTs to https://[site]/_functions/post_updateRefund
  Body: {
    reference,
    status,       ← 'successful' | 'failed'
    amount,
    reason        ← present on failure
  }
        │
        ▼
verifyWebhookSignature()   ← same as payment webhook
        │
        ▼
map status:
  'successful' → 'REFUNDED'
  'failed'     → 'REFUND_FAILED'
        │
        ▼
wixPaymentProviderBackend.submitEvent({ event: { refund: { ... } } })
        │
        ▼
return { status: 200 }
```

---

## API Contracts — ALL CONFIRMED

### Nomba Auth — CONFIRMED
```
OAuth 2.0 client_credentials flow

Token expires in 30 minutes (NOT 60 — confirmed from docs). Refresh 5 minutes before expiry.

Step 1 — Issue token:
POST https://sandbox.api.nomba.com/v1/auth/token/issue
Headers: { Content-Type: application/json, accountId: <parentAccountId> }
Body: { grant_type: "client_credentials", client_id: <clientId>, client_secret: <privateKey> }
Response: { code: "00", data: { access_token, refresh_token, expiresAt } }
Check: if code !== "00" → throw authentication failed

Step 2 — Use token on every call:
Headers: { Authorization: "Bearer <access_token>", accountId: <parentAccountId>, Content-Type: application/json }

For checkout and transfer calls also add:
Headers: { X-Idempotent-key: <unique UUID per request> }
This prevents duplicate charges if the network drops and the request is retried.

Step 3 — Refresh at 25-minute mark (5 min before 30-min expiry):
POST https://sandbox.api.nomba.com/v1/auth/token/refresh
Headers: { Authorization: "Bearer <access_token>", Content-Type: application/json, accountId: <parentAccountId> }
Body: { grant_type: "refresh_token", refresh_token: <refresh_token> }
Response: { code: "00", data: { access_token } }
```

### Webhook Headers — CONFIRMED FROM DOCS
```
Nomba sends these headers on every webhook:
  nomba-signature: <base64 encoded HMAC signature>
  nomba-sig-value: <same as nomba-signature>
  nomba-signature-algorithm: HmacSHA256
  nomba-signature-version: 1.0.0
  nomba-timestamp: 2023-03-31T05:56:47Z
```

### Webhook Signature Verification — CONFIRMED FROM DOCS
```
CRITICAL: Nomba does NOT sign the raw body. It signs a constructed string of specific fields.

The hashing payload is constructed as:
  `${event_type}:${requestId}:${userId}:${walletId}:${transactionId}:${transactionType}:${transactionTime}:${transactionResponseCode}:${nombaTimestamp}`

Where nombaTimestamp comes from the nomba-timestamp header.

Algorithm: HMAC-SHA256, output encoded as BASE64 (not hex)

Verification steps:
1. Extract fields from webhook payload body
2. Construct the hashing string in exact order above
3. Generate HMAC-SHA256 of that string using webhook secret
4. Encode result as base64
5. Compare with nomba-signature header (case insensitive)

WARNING: This is completely different from standard raw-body HMAC.
The training module showed hex of raw body — the actual docs show base64 of a constructed string.
Use the docs version — it is authoritative.
```

### Webhook Payload — payment_success — CONFIRMED FROM DOCS
```json
{
  "event_type": "payment_success",
  "requestId": "49e11b44-909b-4f83-82b4-9a83aXXXXXX",
  "data": {
    "merchant": {
      "walletId": "693e907aad9ea59616XXXX",
      "walletBalance": 539.4,
      "userId": "613bb620-c8e5-45f6-9c00-XXXXXXXX"
    },
    "transaction": {
      "transactionId": "API-VACT_TRA-...",
      "type": "vact_transfer",
      "transactionAmount": 120,
      "responseCode": "",
      "time": "2026-02-06T10:21:56Z",
      "aliasAccountReference": "122320250916PM"
    }
  }
}
```
Note: event field is `event_type` not `event`. Duplicate key is `requestId`.

### Webhook Retry Policy — CONFIRMED FROM DOCS
```
Nomba retries failed webhooks 5 times with exponential backoff:
  Attempt 1: 2 minutes
  Attempt 2: ~5 minutes
  Attempt 3: ~11 minutes
  Attempt 4: 24 minutes
  Attempt 5: ~53 minutes

Must return 2XX to stop retries. Both 4XX and 5XX trigger retry.
Always return 200 after successful processing.
```

### Webhook Setup — CONFIRMED FROM DOCS
```
Webhook secret is set by YOU in the Nomba dashboard — not sent by Nomba.
Path: Dashboard → Developer → Webhook Setup
Set your signature key there. This becomes your NOMBA_WEBHOOK_SECRET.
Also submit webhook URL via: https://forms.gle/hKfBRHZiTGvU7LC59
```

### POST /checkout/order — Request — CONFIRMED
```json
{
  "order": {
    "orderReference": "wix-order-id-here",
    "amount": 150000,
    "currency": "NGN",
    "callbackUrl": "https://[site]/_functions/post_updateTransaction",
    "customerId": "wix-customer-id",
    "customerEmail": "customer@example.com"
  }
}
```
Note: amount is in KOBO — ₦1.00 = 100 kobo. ₦1,500 = 150000 kobo.
Note: the order object is nested under the "order" key.

### POST /checkout/order — Response — CONFIRMED
```json
{
  "code": "00",
  "description": "Success",
  "data": {
    "orderReference": "ord_demo_001",
    "checkoutUrl": "https://checkout.nomba.com/pay/ord_demo_001",
    "amount": 250000,
    "currency": "NGN",
    "status": "pending"
  }
}
```
Redirect customer to `data.checkoutUrl` immediately after receiving this response.
Success code is "00". Check `code === "00"` to confirm success.

### Webhook Payload — Payment — CONFIRMED
```json
{
  "event": "payment_success",
  "requestId": "req_3f9a2c",
  "data": {
    "merchantTxRef": "wix-order-id-here",
    "amount": 150000,
    "currency": "NGN"
  }
}
```
Signature header: `nomba-signature` — HMAC-SHA256 hex digest of raw body using webhook secret.
Duplicate check: store `requestId` in a unique index, reject if already seen.
Always return 200 after processing — Nomba retries on anything else.

### POST /refunds — Request
```json
{
  "transactionId": "nomba-txn-id",
  "amount": 150000,
  "reason": "Customer requested refund"
}
```

---

## Wix SPI Contract

Wix expects these exact return shapes from the SPI functions.

### connectAccount — success
```json
{
  "credentials": {
    "accountId": "nomba-account-id",
    "title": "Business Name"
  }
}
```

### connectAccount — failure
```json
{
  "errorCode": "INVALID_CREDENTIALS",
  "errorMessage": "Invalid API credentials. Check your Nomba dashboard."
}
```

### createTransaction — success
```json
{
  "pluginTransactionId": "nomba-txn-id",
  "redirectUrl": "https://checkout.nomba.com/pay/abc123"
}
```

### createTransaction — failure
```json
{
  "errorCode": "PROVIDER_ERROR",
  "errorMessage": "Payment could not be initiated. Please try again."
}
```

### refundTransaction — success
```json
{
  "pluginRefundId": "nomba-refund-id",
  "refundStatus": "PENDING"
}
```

---

## Constants

```javascript
const NOMBA_BASE_URL = 'https://sandbox.api.nomba.com/v1'  
const RETRY_ATTEMPTS = 3
const RETRY_BASE_DELAY_MS = 500
const SUPPORTED_CURRENCY = 'NGN'
```

---

## Credentials Structure — CONFIRMED FROM NOMBA EMAIL

Nomba provides two account IDs and two sets of credentials (LIVE and TEST).
Always use TEST credentials during the hackathon build. Never use LIVE.

```
Parent Account ID  — used in the accountId header on every API call
Sub-account ID     — used to scope calls to your specific account
Client ID          — used in the token exchange request body
Private Key        — used in the token exchange request body (field name is privateKey, not clientSecret)
```

Auth token request using TEST credentials:
```
POST https://sandbox.api.nomba.com/v1/auth/token/issue
Headers: { Content-Type: application/json, accountId: <parent account ID> }
Body: { grant_type: "client_credentials", client_id: <test client ID>, client_secret: <test private key> }
```

Note: Nomba calls the secret field "Private key" in their email but the API body field is still `client_secret`.

---

## Secrets Map

All credentials stored in Wix Secrets Manager — never in source code, never in any file.

| Secret Name | What It Stores | Value From |
|---|---|---|
| `NOMBA_PARENT_ACCOUNT_ID` | Parent account ID for accountId header | Nomba credentials email |
| `NOMBA_SUB_ACCOUNT_ID` | Sub-account ID for scoping calls | Nomba credentials email |
| `NOMBA_CLIENT_ID` | TEST Client ID for token exchange | Nomba credentials email (TEST section) |
| `NOMBA_PRIVATE_KEY` | TEST Private Key for token exchange | Nomba credentials email (TEST section) |
| `NOMBA_WEBHOOK_SECRET` | Webhook signing secret for HMAC verification | NombaHackathon2026 — confirmed by Nomba team |

Webhook URL submission form: https://forms.gle/hKfBRHZiTGvU7LC59
Submit this on June 30 after Wix site is published and webhook URLs are live.

Confirmed webhook URLs (site published June 26, 2026):
  Payment: https://adeyemitaiwo24434.wixsite.com/nomba-pay-demo/_functions/post_updateTransaction
  Refund:  https://adeyemitaiwo24434.wixsite.com/nomba-pay-demo/_functions/post_updateRefund

---

## Sandbox Test Instruments

| Scenario | Card Number | Expiry | CVV |
|---|---|---|---|
| Successful payment | 5060 6666 6666 6666 666 | Any future date | Any |
| Insufficient funds | 5060 6666 6666 6666 674 | Any future date | Any |
| Bank transfer test | Wema Bank, account 0000000000 | — | — |

---

## Webhook URL Format

Wix generates these URLs automatically when `http-functions.js` exists:

```
Payment webhook:  https://[username].wixsite.com/[sitename]/_functions/post_updateTransaction
Refund webhook:   https://[username].wixsite.com/[sitename]/_functions/post_updateRefund
```

These URLs get registered with Nomba during `createTransaction()` via the `callbackUrl` field.

---

## Error Code Reference

| Code | Meaning | Shown To |
|---|---|---|
| `INVALID_CREDENTIALS` | API key or secret is wrong | Merchant |
| `CURRENCY_NOT_SUPPORTED` | Order is not in NGN | Customer |
| `PROVIDER_ERROR` | Nomba API returned an error | Customer |
| `NETWORK_ERROR` | Could not reach Nomba after retries | Customer |
| `DUPLICATE_TRANSACTION` | Same orderId already processed | Silent (idempotency) |
| `INVALID_WEBHOOK_SIGNATURE` | Webhook failed signature check | Silent (logged) |
| `REFUND_FAILED` | Nomba could not process refund | Merchant |

---

## Build Order (June 30 – July 4)

Build sprint officially starts June 30. Follow this exact sequence. Do not skip ahead.

**Day 1 — June 30**
1. `nomba-api.js` — build and test all API functions against sandbox
2. `crypto-utils.js` — build and test signature verification
3. `connectAccount()` — build, test with valid and invalid credentials

**Day 2 — July 1**
4. `createTransaction()` — build, test full payment flow end to end
5. `post_updateTransaction` — build, test with sandbox webhook payloads

**Day 3 — July 3**
6. `refundTransaction()` — build, test full and partial
7. `post_updateRefund` — build, test with sandbox webhook payloads
8. Test all error states from the error table

**Day 4 — July 4**
9. Test every scenario from the testing checklist
10. Record demo video
11. Write README

---

## Open Items (Resolve During Onboarding June 24–29)

- [ ] Exact Nomba auth mechanism — Bearer token? Direct API key header?
- [ ] Exact field names in checkout request and response
- [ ] Webhook signature header name (e.g. `x-nomba-signature`)
- [ ] Webhook secret — is it the API secret or a separate webhook secret?
- [ ] Sandbox base URL — same as production or different subdomain?
- [ ] Sandbox test card numbers for decline and insufficient funds scenarios
- [ ] Refund API endpoint path and required fields
- [ ] Does Nomba use kobo (smallest unit) or naira floats for amounts?

Ask these directly to Nomba engineers during the June 24–29 AMA sessions.
