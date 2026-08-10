import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { loadCaptureEnv } from "../../tests/captures/support/capture-env";

const projectRoot = path.resolve(import.meta.dirname, "../..");
loadEnvConfig(projectRoot);
loadCaptureEnv();

const DEMO_PROJECT_REF = "ozluphhwktyvqfrypjin";
const MARKER = "[CAPTURA PLAYWRIGHT]";

function assertDemoSafety() {
  if (!process.argv.includes("--apply")) {
    throw new Error(
      "Seed não executado. Use `npm run capture:seed:demo -- --apply` depois de revisar os dados.",
    );
  }
  if (process.env.CAPTURE_SEED_CONFIRM !== "DEMONSTRACAO") {
    throw new Error("Defina CAPTURE_SEED_CONFIRM=DEMONSTRACAO em .env.capture.");
  }

  const configuredUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!configuredUrl) throw new Error("NEXT_PUBLIC_SUPABASE_URL não configurada.");
  const projectRef = new URL(configuredUrl).hostname.split(".")[0];
  if (projectRef !== DEMO_PROJECT_REF) {
    throw new Error(
      `Seed bloqueado: o projeto atual (${projectRef || "desconhecido"}) não é a Demonstração.`,
    );
  }
}

async function main() {
  assertDemoSafety();
  const { supabaseAdmin } = await import("../../src/lib/supabaseAdmin");

  const { data: usuario, error: usuarioError } = await supabaseAdmin
    .from("usuario")
    .select("id")
    .eq("ativo", true)
    .order("createdat", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (usuarioError) throw usuarioError;
  if (!usuario?.id) throw new Error("A Demonstração precisa ter ao menos um usuário ativo.");

  const { data: setor, error: setorError } = await supabaseAdmin
    .from("setor")
    .select("id")
    .eq("ativo", true)
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (setorError) throw setorError;

  const customerPayload = {
    tipopessoa: "FISICA",
    cpfcnpj: "00000000191",
    nomerazaosocial: "CLIENTE DEMONSTRAÇÃO PLAYWRIGHT",
    email: "cliente.captura@example.invalid",
    telefone: "(00) 90000-0000",
    endereco: "Avenida Demonstração",
    endereconumero: "100",
    bairro: "Centro",
    cidade: "Fortaleza",
    estado: "CE",
    cep: "60000000",
    status: "ATIVO",
    is_deleted: false,
  };
  const { data: existingCliente, error: clienteError } = await supabaseAdmin
    .from("cliente")
    .select("id")
    .eq("cpfcnpj", customerPayload.cpfcnpj)
    .maybeSingle();
  if (clienteError) throw clienteError;
  let cliente = existingCliente;
  if (cliente?.id) {
    const result = await supabaseAdmin.from("cliente").update(customerPayload).eq("id", cliente.id);
    if (result.error) throw result.error;
  } else {
    const result = await supabaseAdmin.from("cliente").insert(customerPayload).select("id").single();
    if (result.error) throw result.error;
    cliente = result.data;
  }

  const vehiclePayload = {
    clienteid: cliente.id,
    placa: "DEM0A01",
    modelo: "MODELO DEMONSTRAÇÃO",
    marca: "MARCA EXEMPLO",
    ano: 2024,
    cor: "PRATA",
    kmatual: 42500,
    tipo: "CARROS",
    chassi: "9DEMO000000000001",
  };
  const { data: existingVeiculo, error: veiculoError } = await supabaseAdmin
    .from("veiculo")
    .select("id")
    .eq("placa", vehiclePayload.placa)
    .maybeSingle();
  if (veiculoError) throw veiculoError;
  let veiculo = existingVeiculo;
  if (veiculo?.id) {
    const result = await supabaseAdmin.from("veiculo").update(vehiclePayload).eq("id", veiculo.id);
    if (result.error) throw result.error;
  } else {
    const result = await supabaseAdmin.from("veiculo").insert(vehiclePayload).select("id").single();
    if (result.error) throw result.error;
    veiculo = result.data;
  }

  const productPayload = {
    titulo: "FILTRO DE ÓLEO DEMONSTRAÇÃO",
    descricao: `${MARKER} Produto fictício para imagens do sistema`,
    referencia: "DEMO-FLT-001",
    codigobarras: "7890000000001",
    fabricante: "FABRICANTE EXEMPLO",
    precovenda: 89.9,
    estoque: 25,
    estoqueminimo: 5,
    unidade: "UN",
    exibirPdv: true,
    is_deleted: false,
  };
  const { data: existingProduto, error: produtoError } = await supabaseAdmin
    .from("produto")
    .select("id")
    .eq("referencia", productPayload.referencia)
    .limit(1)
    .maybeSingle();
  if (produtoError) throw produtoError;
  let produto = existingProduto;
  if (produto?.id) {
    const result = await supabaseAdmin.from("produto").update(productPayload).eq("id", produto.id);
    if (result.error) throw result.error;
  } else {
    const result = await supabaseAdmin.from("produto").insert(productPayload).select("id").single();
    if (result.error) throw result.error;
    produto = result.data;
  }

  const servicePayload = {
    codigo: "DEMO-SRV-001",
    descricao: "REVISÃO PREVENTIVA DEMONSTRAÇÃO",
    precohora: 180,
    ativo: true,
  };
  const { data: existingServico, error: servicoError } = await supabaseAdmin
    .from("servico")
    .select("id")
    .eq("codigo", servicePayload.codigo)
    .limit(1)
    .maybeSingle();
  if (servicoError) throw servicoError;
  let servico = existingServico;
  if (servico?.id) {
    const result = await supabaseAdmin.from("servico").update(servicePayload).eq("id", servico.id);
    if (result.error) throw result.error;
  } else {
    const result = await supabaseAdmin.from("servico").insert(servicePayload).select("id").single();
    if (result.error) throw result.error;
    servico = result.data;
  }

  const orderPayload = {
    clienteid: cliente.id,
    veiculoid: veiculo.id,
    usuariocriadorid: usuario.id,
    setorid: setor?.id ?? null,
    status: "ORCAMENTO",
    statusaprovacao: "PENDENTE",
    descricao: `${MARKER} Revisão completa com troca de filtros`,
    observacoes: "Dados totalmente fictícios preparados para capturas de tela.",
    prioridade: "ALTA",
    alvo_tipo: "VEICULO",
    orcamentototal: 359.8,
    is_deleted: false,
  };
  const { data: existingOrdem, error: ordemError } = await supabaseAdmin
    .from("ordemservico")
    .select("id")
    .eq("descricao", orderPayload.descricao)
    .limit(1)
    .maybeSingle();
  if (ordemError) throw ordemError;
  let ordem = existingOrdem;
  if (ordem?.id) {
    const result = await supabaseAdmin.from("ordemservico").update(orderPayload).eq("id", ordem.id);
    if (result.error) throw result.error;
  } else {
    const result = await supabaseAdmin.from("ordemservico").insert(orderPayload).select("id").single();
    if (result.error) throw result.error;
    ordem = result.data;
  }

  const osProduto = await supabaseAdmin.from("osproduto").upsert(
    {
      ordemservicoid: ordem.id,
      produtoid: produto.id,
      quantidade: 2,
      precounitario: 89.9,
      subtotal: 179.8,
    },
    { onConflict: "ordemservicoid,produtoid" },
  );
  if (osProduto.error) throw osProduto.error;

  const osServico = await supabaseAdmin.from("osservico").upsert(
    {
      ordemservicoid: ordem.id,
      servicoid: servico.id,
      quantidade: 1,
      precounitario: 180,
      subtotal: 180,
    },
    { onConflict: "ordemservicoid,servicoid" },
  );
  if (osServico.error) throw osServico.error;

  const start = new Date();
  start.setDate(start.getDate() + 1);
  start.setHours(10, 0, 0, 0);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  const appointmentPayload = {
    clienteid: cliente.id,
    veiculoid: veiculo.id,
    ordemservicoid: ordem.id,
    usuarioid: usuario.id,
    titulo: `${MARKER} Revisão agendada`,
    descricao: "Agendamento fictício para apresentação do módulo.",
    inicio: start.toISOString(),
    fim: end.toISOString(),
    status: "CONFIRMADO",
    observacoes: "Não corresponde a um atendimento real.",
  };
  const { data: existingAppointment, error: appointmentFindError } = await supabaseAdmin
    .from("agendamento")
    .select("id")
    .eq("titulo", appointmentPayload.titulo)
    .limit(1)
    .maybeSingle();
  if (appointmentFindError) throw appointmentFindError;
  const appointmentResult = existingAppointment?.id
    ? await supabaseAdmin.from("agendamento").update(appointmentPayload).eq("id", existingAppointment.id)
    : await supabaseAdmin.from("agendamento").insert(appointmentPayload);
  if (appointmentResult.error) throw appointmentResult.error;

  console.log("Dados fictícios de captura criados/atualizados na Demonstração.");
  console.log(`Cliente #${cliente.id}, veículo #${veiculo.id}, produto #${produto.id}, OS #${ordem.id}.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
