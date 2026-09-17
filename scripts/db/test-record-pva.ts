import Module from "node:module";

// Mock 'server-only' para execução CLI fora do Next.js
const originalRequire = (Module.prototype as any).require;
(Module.prototype as any).require = function (id: string) {
  if (id === "server-only") return {};
  return originalRequire.apply(this, arguments);
};

async function main() {
  const { recordPvaValidation, getSpedPvaValidations, getSpedCompetenceDetail } = await import(
    "../../src/services/fiscal/sped/competenciaService"
  );

  console.log("=== REGISTRANDO APONTAMENTO DE VALIDAÇÃO DO PVA NO ARQUIVO 1 ===");
  const ACTOR_ID = "34dae869-87ab-452a-bc79-d383f9c09ebc";

  const validacao = await recordPvaValidation({
    arquivoId: "1",
    pvaVersao: "10.0.4",
    status: "COM_AVISOS",
    observacao: "Primeira prévia gerada para homologação do exercício 2026. Necessário cadastrar contador e perfil no ERP para validação final.",
    actorId: ACTOR_ID,
  });

  console.log("\n✓ Validação registrada no banco:", validacao);

  const historico = await getSpedPvaValidations("1");
  console.log(`\nHistórico de validações do arquivo 1 (${historico.length} registros):`, historico);

  const detail = await getSpedCompetenceDetail("1");
  const arquivoAtualizado = detail.arquivos.find((a: any) => a.id === "1") as Record<string, any> | undefined;
  console.log("\nArquivo na competência após apontamento do PVA:");
  console.log({
    id: arquivoAtualizado?.id,
    sequencia: arquivoAtualizado?.sequencia,
    tipo: arquivoAtualizado?.tipo,
    pvaStatus: arquivoAtualizado?.pvaStatus,
    validacoesCount: (arquivoAtualizado?.pvaValidacoes as any[])?.length,
  });
}

main().catch((err) => {
  console.error("Falha ao registrar validação PVA:", err);
  process.exit(1);
});
