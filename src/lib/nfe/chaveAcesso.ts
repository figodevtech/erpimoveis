// src/lib/nfe/chaveAcesso.ts

/**
 * Gera o código numérico (cNF) da NF-e.
 * Por regra é 8 dígitos. Aqui usamos um aleatório para testes.
 */
export function gerarCNF(_numeroNota: number): string {
  void _numeroNota;
  const rand = Math.floor(Math.random() * 100000000); // 0..99.999.999
  return String(rand).padStart(8, '0');
}

/**
 * Calcula o dígito verificador (DV) da chave de acesso
 * (módulo 11 com pesos 2..9 da direita para a esquerda).
 */
function calcularDV(chave43: string): number {
  const pesos = [2, 3, 4, 5, 6, 7, 8, 9];
  let soma = 0;
  let iPeso = 0;

  for (let i = chave43.length - 1; i >= 0; i--) {
    const n = parseInt(chave43.charAt(i), 10);
    soma += n * pesos[iPeso];
    iPeso++;
    if (iPeso >= pesos.length) iPeso = 0;
  }

  const resto = soma % 11;
  const dv = 11 - resto;

  // regra da NF-e: se resultado for 0, 10 ou 11 -> DV = 0
  if (dv === 0 || dv === 10 || dv === 11) return 0;
  return dv;
}

/**
 * Confere uma chave de acesso digitada: 44 dígitos e DV coerente com os 43
 * primeiros. Serve para barrar erro de digitação na NF-e referenciada antes de
 * o lote chegar na SEFAZ — chave com DV errado volta como rejeição 240.
 */
export function chaveAcessoValida(chave: unknown): boolean {
  const digitos = String(chave ?? '').replace(/\D/g, '');
  if (digitos.length !== 44) return false;
  return calcularDV(digitos.slice(0, 43)) === Number(digitos.charAt(43));
}

type ParamsChave = {
  cUF: string; // 2 dígitos
  ano: number; // AAAA
  mes: number; // 1..12
  cnpj: string; // 14 dígitos (com ou sem máscara)
  mod: string; // 55
  serie: number; // até 3 dígitos
  nNF: number; // até 9 dígitos
  tpEmis: number; // 1 normalmente
  cNF: string; // 8 dígitos
};

/**
 * Gera a chave de acesso da NF-e (44 dígitos) + Id ("NFe" + chave) + DV.
 */
export function gerarChaveAcesso(params: ParamsChave): {
  chave: string;
  id: string;
  dv: string;
} {
  const aa = String(params.ano).slice(-2);
  const mm = String(params.mes).padStart(2, '0');
  const cnpjLimpo = params.cnpj.replace(/\D/g, '').padStart(14, '0');
  const serie = String(params.serie).padStart(3, '0');
  const nNF = String(params.nNF).padStart(9, '0');
  const cUF = params.cUF.padStart(2, '0');
  const mod = params.mod.padStart(2, '0');
  const tpEmis = String(params.tpEmis);
  const cNF = params.cNF.padStart(8, '0');

  const chave43 =
    cUF + aa + mm + cnpjLimpo + mod + serie + nNF + tpEmis + cNF;

  const dvNumber = calcularDV(chave43);
  const dv = String(dvNumber);

  const chave = chave43 + dv;
  const id = `NFe${chave}`;

  return { chave, id, dv };
}

/**
 * Quebra uma chave de acesso (44 dígitos) em seus componentes:
 * cUF, ano, mês, CNPJ, modelo, série, nNF, tpEmis, cNF, dv.
 *
 * Usamos isso para "ler" a chave gerada pelo banco e montar
 * o bloco <ide> e o Id="NFe########..." coerentes com ela.
 */
export function decomporChaveAcesso(chave: string) {
  const s = chave.replace(/\D/g, '');
  if (s.length !== 44) {
    throw new Error(
      `Chave de acesso deve ter 44 dígitos numéricos. Recebido: "${chave}"`
    );
  }

  const cUF = s.substring(0, 2);
  const aa = s.substring(2, 4);
  const mm = s.substring(4, 6);
  const cnpj = s.substring(6, 20);
  const mod = s.substring(20, 22);
  const serie = s.substring(22, 25);
  const nNF = s.substring(25, 34);
  const tpEmis = s.substring(34, 35);
  const cNF = s.substring(35, 43);
  const dv = s.substring(43, 44);

  return {
    cUF,
    aa,
    mm,
    cnpj,
    mod,
    serie,
    nNF,
    tpEmis,
    cNF,
    dv,
  };
}
