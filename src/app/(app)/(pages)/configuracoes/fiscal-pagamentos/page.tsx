"use client";

import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "@/lib/toast";
import { Building2, Landmark, Loader2, Receipt, Save, Settings } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { EmpresaTab } from "./components/empresa-tab";
import { NFeTab } from "./components/nfe-tab";
import { NFSeTab } from "./components/nfse-tab";
import type { FormValues } from "./types";

const limparDigitos = (s: string) => (s || "").replace(/\D+/g, "");

const tabTriggerClass =
  "h-8 rounded-xl border border-transparent px-3 text-xs font-medium text-muted-foreground transition-all hover:cursor-pointer hover:text-foreground data-[state=active]:bg-primary dark:data-[state=active]:bg-primary data-[state=active]:text-primary-foreground dark:data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm";

export default function ConfigFiscalPagamentosPage() {
  const [salvando, setSalvando] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [activeTab, setActiveTab] = useState("empresa");

  const { register, handleSubmit, setValue, watch } = useForm<FormValues>({
    defaultValues: {
      empresa: {
        empresaId: 1,
        cnpj: "",
        razaosocial: "",
        nomefantasia: "",
        inscricaoestadual: "",
        inscricaomunicipal: "",
        inscricaoestadualst: "",
        endereco: "",
        numero: "",
        complemento: "",
        bairro: "",
        cep: "",
        uf: "PB",
        codigomunicipio: "2507507",
        codigopais: "1058",
        nomepais: "BRASIL",
        telefone: "",
        cnae: "",
        regimetributario: "1",
        ambiente: "HOMOLOGACAO",
        certificadocaminho: "",
        certificadosenha: "",
        cschomologacao: "",
        cscproducao: "",
        placa_consulta_limite_mensal: 100,
        placa_consulta_qtd_mes: 0,
        placa_consulta_mes: "",
      },
      nfe: {
        serieNFe: "1",
        serieNFCe: "",
        cscHomologacao: "",
        cscProducao: "",
        idCscHomologacao: "",
        idCscProducao: "",
        naturezaOperacao: "Venda de mercadoria",
        naturezaOperacaoNFCe: "Venda ao consumidor",
        qrCodeVersao: "3",
        nfceConfigurada: false,
        padroesFiscais: { NFE: {}, NFCE: {} },
      },
      nfse: {
        provedor: "",
        inscricaoMunicipal: "",
        serieRPS: "",
        usuario: "",
        senha: "",
        token: "",
        certificadoA1Base64: "",
        senhaCertificado: "",
      },
    },
  });

  const applyEmpresa = useCallback(
    (e: any) => {
      if (!e) return;
      setValue("empresa.empresaId", Number(e.id ?? 1));
      setValue("empresa.cnpj", e.cnpj ?? "");
      setValue("empresa.razaosocial", e.razaosocial ?? "");
      setValue("empresa.nomefantasia", e.nomefantasia ?? "");
      setValue("empresa.inscricaoestadual", e.inscricaoestadual ?? "");
      setValue("empresa.inscricaomunicipal", e.inscricaomunicipal ?? "");
      setValue("empresa.inscricaoestadualst", e.inscricaoestadualst ?? "");
      setValue("empresa.endereco", e.endereco ?? "");
      setValue("empresa.numero", e.numero ?? "");
      setValue("empresa.complemento", e.complemento ?? "");
      setValue("empresa.bairro", e.bairro ?? "");
      setValue("empresa.cep", e.cep ?? "");
      setValue("empresa.uf", e.uf ?? "PB");
      setValue("empresa.codigomunicipio", e.codigomunicipio ?? "");
      setValue("empresa.codigopais", e.codigopais ?? "1058");
      setValue("empresa.nomepais", e.nomepais ?? "BRASIL");
      setValue("empresa.telefone", e.telefone ?? "");
      setValue("empresa.cnae", e.cnae ?? "");
      setValue("empresa.regimetributario", (e.regimetributario as any) ?? "1");
      setValue("empresa.ambiente", (e.ambiente as any) ?? "HOMOLOGACAO");
      setValue("empresa.certificadocaminho", e.certificadocaminho ?? "");
      setValue("empresa.certificadosenha", e.certificadosenha ?? "");
      setValue("empresa.cschomologacao", e.cschomologacao ?? "");
      setValue("empresa.cscproducao", e.cscproducao ?? "");
      setValue("empresa.placa_consulta_limite_mensal", Number(e.placa_consulta_limite_mensal ?? 100));
      setValue("empresa.placa_consulta_qtd_mes", Number(e.placa_consulta_qtd_mes ?? 0));
      setValue("empresa.placa_consulta_mes", e.placa_consulta_mes ?? "");
    },
    [setValue]
  );

  const applyNfe = useCallback(
    (n: any) => {
      if (!n) return;
      setValue("nfe.serieNFe", n.serieNFe ?? "1");
      setValue("nfe.serieNFCe", n.serieNFCe ?? "");
      // Chegam mascarados. Reenviar o mascarado é inofensivo: o backend ignora
      // qualquer valor com "*" e mantém o CSC que já está gravado.
      setValue("nfe.cscHomologacao", n.cscHomologacao ?? "");
      setValue("nfe.cscProducao", n.cscProducao ?? "");
      setValue("nfe.idCscHomologacao", n.idCscHomologacao ?? "");
      setValue("nfe.idCscProducao", n.idCscProducao ?? "");
      setValue("nfe.naturezaOperacao", n.naturezaOperacao ?? "Venda de mercadoria");
      setValue("nfe.naturezaOperacaoNFCe", n.naturezaOperacaoNFCe ?? "Venda ao consumidor");
      setValue("nfe.qrCodeVersao", n.qrCodeVersao ?? "3");
      setValue("nfe.nfceConfigurada", Boolean(n.nfceConfigurada));
      setValue("nfe.padroesFiscais", {
        NFE: n.padroesFiscais?.NFE ?? {},
        NFCE: n.padroesFiscais?.NFCE ?? {},
      });
    },
    [setValue]
  );

  const applyNfse = useCallback(
    (n: any) => {
      if (!n) return;
      setValue("nfse.provedor", n.provedor ?? "");
      setValue("nfse.inscricaoMunicipal", n.inscricaoMunicipal ?? "");
      setValue("nfse.serieRPS", n.serieRPS ?? "");
      setValue("nfse.usuario", n.usuario ?? "");
      setValue("nfse.senha", n.senha ?? "");
      setValue("nfse.token", n.token ?? "");
      setValue("nfse.certificadoA1Base64", n.certificadoA1Base64 ?? "");
      setValue("nfse.senhaCertificado", n.senhaCertificado ?? "");
    },
    [setValue]
  );

  const carregarTudo = useCallback(async () => {
    setCarregando(true);
    try {
      const [rEmp, rNfe, rNfse] = await Promise.all([
        fetch("/api/config/empresa", { cache: "no-store" }),
        fetch("/api/config/nfe", { cache: "no-store" }),
        fetch("/api/config/nfse", { cache: "no-store" }),
      ]);
      const jEmp = await rEmp.json().catch(() => ({}));
      const jNfe = await rNfe.json().catch(() => ({}));
      const jNfse = await rNfse.json().catch(() => ({}));
      if (rEmp.ok && jEmp?.empresa) applyEmpresa(jEmp.empresa);
      if (rNfe.ok && jNfe?.nfe) applyNfe(jNfe.nfe);
      if (rNfse.ok && jNfse?.nfse) applyNfse(jNfse.nfse);
    } catch (e) {
      console.warn(e);
    } finally {
      setCarregando(false);
    }
  }, [applyEmpresa, applyNfe, applyNfse]);

  useEffect(() => {
    carregarTudo();
  }, [carregarTudo]);

  function validar(v: FormValues, tab: string) {
    const errs: string[] = [];
    if (tab === "empresa") {
      const cnpj = limparDigitos(v.empresa.cnpj);
      if (cnpj.length < 14) errs.push("CNPJ invalido.");
      if (!v.empresa.razaosocial?.trim()) errs.push("Razao social obrigatoria.");
      if (!v.empresa.endereco?.trim()) errs.push("Endereco obrigatorio.");
      if (!v.empresa.numero?.trim()) errs.push("Numero do endereco obrigatorio.");
      const ibge = limparDigitos(v.empresa.codigomunicipio);
      if (ibge.length !== 7) errs.push("Codigo do Municipio (IBGE) deve ter 7 digitos.");
      if (!v.empresa.regimetributario?.trim()) errs.push("Regime tributario obrigatorio.");
    }
    if (tab === "nfe" && !v.nfe.naturezaOperacao?.trim()) {
      errs.push("Natureza de operacao (NF-e) obrigatoria.");
    }
    return errs;
  }

  async function onSalvar(values: FormValues) {
    if (activeTab === "empresa") {
      values.empresa.cnpj = limparDigitos(values.empresa.cnpj);
      values.empresa.codigomunicipio = limparDigitos(values.empresa.codigomunicipio);
      if (values.empresa.inscricaoestadual) values.empresa.inscricaoestadual = limparDigitos(values.empresa.inscricaoestadual);
      if (values.empresa.inscricaomunicipal) values.empresa.inscricaomunicipal = limparDigitos(values.empresa.inscricaomunicipal);
      if (values.empresa.inscricaoestadualst) values.empresa.inscricaoestadualst = limparDigitos(values.empresa.inscricaoestadualst);
      if (values.empresa.cep) values.empresa.cep = limparDigitos(values.empresa.cep);
      if (values.empresa.telefone) values.empresa.telefone = limparDigitos(values.empresa.telefone);
      if (values.empresa.codigopais) values.empresa.codigopais = limparDigitos(values.empresa.codigopais);
    }

    const erros = validar(values, activeTab);
    if (erros.length) {
      toast.error(erros[0]);
      return;
    }

    setSalvando(true);
    try {
      if (activeTab === "empresa") {
        const empresaPayload: Record<string, unknown> = { ...values.empresa };
        delete empresaPayload.placa_consulta_limite_mensal;
        delete empresaPayload.placa_consulta_qtd_mes;
        delete empresaPayload.placa_consulta_mes;
        const r = await fetch("/api/config/empresa", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ empresa: empresaPayload }),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j?.error || "Falha ao salvar Empresa");
      }
      if (activeTab === "nfe") {
        const r = await fetch("/api/config/nfe", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nfe: values.nfe }),
        });
        const j = await r.json().catch(() => ({}));
        // O 422 do padrão fiscal traz o motivo em `detalhe`; sem ele o usuário
        // veria só "corrija o padrão" e não saberia qual campo está errado.
        if (!r.ok) {
          throw new Error(
            [j?.error, j?.detalhe].filter(Boolean).join(" ") || "Falha ao salvar NFe",
          );
        }
      }
      if (activeTab === "nfse") {
        const r = await fetch("/api/config/nfse", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nfse: values.nfse }),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j?.error || "Falha ao salvar NFS-e");
      }

      toast.success("Configuracoes salvas!");
      await carregarTudo();
    } catch (e: any) {
      toast.error(e?.message || "Erro ao salvar");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="container mx-auto max-w-7xl space-y-6 px-4 py-1 animate-in fade-in duration-500 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-4 rounded-lg border bg-card px-5 py-4 shadow-sm md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight">
            <Settings className="h-8 w-8 text-primary" />
            Fiscal e Pagamentos
          </h1>
          <p className="text-muted-foreground">
            Configure dados da empresa, emissao fiscal e credenciais de servicos.
          </p>
        </div>
        <Button
          onClick={handleSubmit(onSalvar)}
          disabled={salvando || carregando}
          className="shadow-md transition-all hover:shadow-lg"
          aria-label="Salvar alterações"
          title="Salvar alterações"
        >
          {salvando || carregando ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {carregando ? "Carregando..." : "Salvando..."}
            </>
          ) : (
            <>
              <Save className="mr-2 h-4 w-4" />
              Salvar Alterações
            </>
          )}
        </Button>
      </div>

      <main className="w-full">
        <Tabs defaultValue="empresa" value={activeTab} onValueChange={setActiveTab} className="w-full">
          <Card className="overflow-hidden border-primary/10 p-0 shadow-sm">
            <CardContent className="p-3">
              <div className="max-w-full overflow-x-auto [scrollbar-width:thin] [&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border">
                <TabsList className="h-auto min-w-full justify-start gap-1.5 rounded-2xl border bg-muted/40 p-1 backdrop-blur-sm">
                  <TabsTrigger value="empresa" className={tabTriggerClass}>
                    <Building2 className="h-4 w-4" /> <span className="hidden sm:inline">Empresa</span>
                  </TabsTrigger>
                  <TabsTrigger value="nfe" className={tabTriggerClass}>
                    <Receipt className="h-4 w-4" /> <span className="hidden sm:inline">NF-e / NFC-e</span>
                  </TabsTrigger>
                  <TabsTrigger value="nfse" className={tabTriggerClass}>
                    <Landmark className="h-4 w-4" /> <span className="hidden sm:inline">NFS-e</span>
                  </TabsTrigger>
                </TabsList>
              </div>
            </CardContent>
          </Card>

          <TabsContent value="empresa" className="mt-6">
            <EmpresaTab register={register} setValue={setValue} watch={watch} />
          </TabsContent>

          <TabsContent value="nfe" className="mt-6">
            <NFeTab register={register} setValue={setValue} watch={watch} />
          </TabsContent>

          <TabsContent value="nfse" className="mt-6">
            <NFSeTab register={register} setValue={setValue} />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
