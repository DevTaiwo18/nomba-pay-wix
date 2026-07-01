# Nomba Pay for Wix

A Wix Payment Provider Service Plugin that lets Nigerian Wix store owners accept Nomba payments at checkout. Built for the Nomba x DevCareer Hackathon 2026.

## What It Does

Merchants install this plugin on their Wix store, enter their Nomba API credentials, and immediately start accepting payments from Nigerian customers. No custom code required from the merchant.

## How It Works

1. Merchant connects their Nomba account via the Wix dashboard
2. Customer adds items to cart and proceeds to checkout
3. Wix calls the plugin to create a Nomba checkout session
4. Customer is redirected to Nomba's hosted payment page
5. Nomba sends a webhook after payment — the plugin verifies the signature and updates the order status in Wix
6. Merchant can issue full or partial refunds directly from the Wix Orders dashboard

## File Structure

```
backend/
  payment-provider/
    payment-provider.js       ← SPI: connectAccount, createTransaction, refundTransaction
  http-functions.js           ← Webhooks: post_updateTransaction, post_updateRefund
  utils/
    nomba-api.js              ← All Nomba API calls (auth, checkout, refund)
    crypto-utils.js           ← HMAC-SHA256 webhook signature verification

Service Plugins/
  payment-provider/
    nomba-pay/
      nomba-pay-config.js     ← Plugin config: title, logos, credential fields
      nomba-pay.js            ← SPI implementation for Wix Service Plugin
```

## Setup

### 1. Add Secrets to Wix Secrets Manager

| Secret Name | Value |
|---|---|
| `NOMBA_PARENT_ACCOUNT_ID` | Your Nomba parent account ID |
| `NOMBA_CLIENT_ID` | Your Nomba TEST client ID |
| `NOMBA_PRIVATE_KEY` | Your Nomba TEST private key |
| `NOMBA_WEBHOOK_SECRET` | Your webhook signing secret |

### 2. Register the Service Plugin

In the Wix Editor, go to **Service Plugins → Payment** and add a new plugin named `nomba-pay`. Paste the contents of `nomba-pay-config.js` and `nomba-pay.js` into the generated files.

### 3. Connect the Payment Provider

In the Wix Dashboard, go to **Getting Paid → Accept Payments → See More Payment Options** and click **Connect** next to Nomba Pay. Enter your Nomba credentials.

### 4. Webhook URLs

Register these URLs in your Nomba dashboard:

- Payment: `https://[your-site]/_functions/post_updateTransaction`
- Refund: `https://[your-site]/_functions/post_updateRefund`

## Tech Stack

- **Platform**: Wix Velo (JavaScript, ES Modules)
- **Payment API**: Nomba Sandbox API v1
- **Webhook Security**: HMAC-SHA256 signature verification
- **Secrets**: Wix Secrets Manager

## Demo Site

[https://adeyemitaiwo24434.wixsite.com/nomba-pay-demo](https://adeyemitaiwo24434.wixsite.com/nomba-pay-demo)

## Built By

Adeyemi Taiwo — Nomba x DevCareer Hackathon 2026
