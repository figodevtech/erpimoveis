import { CODE_E16A30, mensagemBloqueioE16a30 } from './regraE16a30';
import { avaliarRegraE16a30Xml } from './regraE16a30Xml';

/** Contrato da rota de autorização, avaliado antes da numeração e assinatura. */
export function bloqueioAutorizacaoE16a30(xmlNormalizado: string) {
  const resultado = avaliarRegraE16a30Xml(xmlNormalizado);
  if (!resultado.bloqueia) return null;
  return {
    status: 422,
    body: {
      ok: false,
      code: CODE_E16A30,
      regra: resultado.regra,
      cStat: resultado.cStat,
      fonte: resultado.fonte,
      mensagem: mensagemBloqueioE16a30(resultado.ufDestino),
    },
  };
}
