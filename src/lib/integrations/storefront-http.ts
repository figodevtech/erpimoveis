// Chamadas do ERP para a loja levam o segredo no header Authorization. Se
// STOREFRONT_API_URL aponta para um endereco que redireciona (http -> https,
// www -> sem www), o fetch segue o redirect para outra origem descartando o
// Authorization, e a loja responde um 401 que parece segredo errado. Por isso o
// redirect nao e seguido: vira um erro dizendo qual URL configurar.
export async function storefrontFetch(url: string, init: RequestInit) {
  const response = await fetch(url, { ...init, redirect: "manual" });

  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location");
    const target = location ? new URL(location, url) : null;
    throw new Error(
      target
        // Sem "https://" no texto: o toast do ERP esconde mensagens com URL.
        ? `O endereço da loja redireciona para ${target.host}. Configure STOREFRONT_API_URL no ERP com ${target.protocol.replace(":", "")} e o domínio ${target.host}, sem barra no final.`
        : `O endereço da loja respondeu com redirecionamento (HTTP ${response.status}). Revise STOREFRONT_API_URL no ERP.`,
    );
  }

  return response;
}
