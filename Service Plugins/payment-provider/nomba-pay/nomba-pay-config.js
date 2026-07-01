export function getConfig() {
  return {
    title: 'Nomba Pay',
    paymentMethods: [{
      hostedPage: {
        title: 'Nomba Pay',
        logos: {
          white: {
            svg: 'https://nomba.com/lovable-uploads/67211a34-83e2-4b4a-a69c-5252f214a7ff.png',
            png: 'https://nomba.com/lovable-uploads/67211a34-83e2-4b4a-a69c-5252f214a7ff.png'
          },
          colored: {
            svg: 'https://nomba.com/lovable-uploads/67211a34-83e2-4b4a-a69c-5252f214a7ff.png',
            png: 'https://nomba.com/lovable-uploads/67211a34-83e2-4b4a-a69c-5252f214a7ff.png'
          }
        }
      }
    }],
    credentialsFields: [
      { simpleField: { name: 'clientId', label: 'Client ID' } },
      { simpleField: { name: 'privateKey', label: 'Private Key' } },
      { simpleField: { name: 'parentAccountId', label: 'Parent Account ID' } }
    ]
  };
}
