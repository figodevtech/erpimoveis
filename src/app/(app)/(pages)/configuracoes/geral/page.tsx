"use client";

import Link from "next/link";
import { useEffect, useState, useCallback } from "react";
import { useForm } from "react-hook-form";
import { toast } from "@/lib/toast";
import {
  Settings,
  Receipt,
  ShoppingCart,
  ClipboardCheck,
  Loader2,
  Save,
  AlertCircle,
  FileText,
  Package,
  Search,
  CalendarDays,
  Palette,
  Boxes,
  Building2,
  CheckCircle2,
  Store,
  Unplug,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import type { Config } from "../../type";

type UsoConsultasPlaca = {
  limite: number;
  usadas: number;
  mes: string;
};

type EmpresaResumo = {
  id: number;
  nome: string;
  cnpj: string;
};

type MercadoLivreAccount = {
  id: number;
  userId: number;
  nickname: string | null;
  siteId: string;
  needsReconnect: boolean;
  updatedAt: string | null;
  shipping?: {
    modes: string[];
    option: string | null;
    mercadoEnviosEnabled: boolean;
    error: string | null;
  } | null;
};

const DIAS_SEMANA = [
  { value: 0, label: "Dom" },
  { value: 1, label: "Seg" },
  { value: 2, label: "Ter" },
  { value: 3, label: "Qua" },
  { value: 4, label: "Qui" },
  { value: 5, label: "Sex" },
  { value: 6, label: "Sab" },
];

function colorPickerValue(value: string | undefined, fallback: string) {
  return /^#[0-9a-fA-F]{6}$/.test(value ?? "") ? value! : fallback;
}

export default function ConfigGeralPage() {
  const [salvando, setSalvando] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [desconectandoMercadoLivre, setDesconectandoMercadoLivre] = useState(false);
  const [usoConsultasPlaca, setUsoConsultasPlaca] = useState<UsoConsultasPlaca | null>(null);
  const [empresaResumo, setEmpresaResumo] = useState<EmpresaResumo | null>(null);
  const [mercadoLivreAccount, setMercadoLivreAccount] = useState<MercadoLivreAccount | null>(null);

  const { handleSubmit, setValue, watch, reset } = useForm<Partial<Config>>({
    defaultValues: {
      checklist_obrigatorio: false,
      alerta_estoque_pdv: false,
      habilitar_emissao_nfe: false,
      emissao_nf_no_modulo_ordens: false,
      emissao_nf_no_modulo_vendas: false,
      emissao_nf_ordens_nao_pagas: false,
      emissao_nf_vendas_nao_pagas: false,
      agendamento_intervalo_minutos: 60,
      agendamento_hora_inicio: "08:00",
      agendamento_hora_fim: "18:00",
      agendamento_dias_trabalho: [1, 2, 3, 4, 5],
      impressao_cor_primaria: "#2563eb",
      impressao_cor_secundaria: "#0891b2",
      modo_baixa_estoque_os: "ORCAMENTO",
      produto_preco_medio_compra_obrigatorio: false,
    },
  });

  const carregarConfig = useCallback(async () => {
    setCarregando(true);
    try {
      const [response, empresaResponse, mercadoLivreResponse] = await Promise.all([
        fetch("/api/config", { cache: "no-store" }),
        fetch("/api/config/empresa", { cache: "no-store" }),
        fetch("/api/config/integracoes/mercadolivre", { cache: "no-store" }),
      ]);
      const data = await response.json();
      const empresaData = await empresaResponse.json().catch(() => ({}));
      const mercadoLivreData = await mercadoLivreResponse.json().catch(() => ({}));
      if (response.ok && data.config) {
        reset(data.config);
      } else {
        toast.error("Erro ao carregar configurações");
      }
      if (empresaResponse.ok && empresaData?.empresa) {
        const empresa = empresaData.empresa;
        setEmpresaResumo({
          id: Number(empresa.empresaId),
          nome: empresa.nomefantasia || empresa.razaosocial || "Empresa",
          cnpj: empresa.cnpj || "",
        });
        setUsoConsultasPlaca({
          limite: Number(empresa.placa_consulta_limite_mensal ?? 0),
          usadas: Number(empresa.placa_consulta_qtd_mes ?? 0),
          mes: empresa.placa_consulta_mes ?? "",
        });
      } else {
        setUsoConsultasPlaca(null);
        setEmpresaResumo(null);
      }
      setMercadoLivreAccount(mercadoLivreResponse.ok ? mercadoLivreData?.account ?? null : null);
    } catch (error) {
      console.error(error);
      toast.error("Falha na comunicação com o servidor");
    } finally {
      setCarregando(false);
    }
  }, [reset]);

  useEffect(() => {
    carregarConfig();
  }, [carregarConfig]);

  const onSalvar = async (values: Partial<Config>) => {
    setSalvando(true);
    try {
      const response = await fetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });

      const data = await response.json();
      if (response.ok) {
        toast.success("Configurações atualizadas com sucesso!");
        reset(data.config);
      } else {
        throw new Error(data.error || "Erro ao salvar");
      }
    } catch (error: any) {
      toast.error(error.message || "Erro ao salvar configurações");
    } finally {
      setSalvando(false);
    }
  };

  const desconectarMercadoLivre = async () => {
    setDesconectandoMercadoLivre(true);
    try {
      const response = await fetch("/api/config/integracoes/mercadolivre", { method: "DELETE" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || "Falha ao desconectar a conta.");
      setMercadoLivreAccount(null);
      toast.success("Conta Mercado Livre desconectada.");
    } catch (error: any) {
      toast.error(error?.message || "Falha ao desconectar a conta Mercado Livre.");
    } finally {
      setDesconectandoMercadoLivre(false);
    }
  };

  if (carregando) {
    return (
      <div className="flex h-[80vh] w-full items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="size-8 animate-spin rounded-t-full border-t-2 border-primary" />
          <p className="text-primary">Carregando configurações...</p>
        </div>
      </div>
    );
  }

  const limitePlacas = usoConsultasPlaca?.limite ?? 0;
  const usadasPlacas = usoConsultasPlaca?.usadas ?? 0;
  const diasTrabalho = watch("agendamento_dias_trabalho") ?? [1, 2, 3, 4, 5];
  const impressaoCorPrimaria = watch("impressao_cor_primaria") ?? "#2563eb";
  const impressaoCorSecundaria = watch("impressao_cor_secundaria") ?? "#0891b2";
  const percentualPlacas =
    limitePlacas > 0 ? Math.min(100, Math.round((usadasPlacas / limitePlacas) * 100)) : 100;

  return (
    <div className="container mx-auto max-w-7xl space-y-6 px-4 py-1 animate-in fade-in duration-500 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-4 rounded-lg border bg-card px-5 py-4 shadow-sm md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Settings className="h-8 w-8 text-primary" />
            Configurações Gerais
          </h1>
          <p className="text-muted-foreground">
            Gerencie o comportamento global do sistema, módulos fiscais e alertas do PDV.
          </p>
        </div>
        <Button
          onClick={handleSubmit(onSalvar)}
          disabled={salvando}
          className="shadow-md hover:shadow-lg transition-all"
        >
          {salvando ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Save className="mr-2 h-4 w-4" />
          )}
          Salvar Alterações
        </Button>
      </div>

      <Card className="overflow-hidden border-primary/10 p-0 shadow-sm">
        <CardHeader className="bg-primary/5 py-4">
          <div className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-primary" />
            <CardTitle>Empresa e marketplace</CardTitle>
          </div>
          <CardDescription>Dados da empresa desta instalação e conta vendedora vinculada.</CardDescription>
        </CardHeader>
        <CardContent className="grid p-0 md:grid-cols-2">
          <section className="flex min-h-32 flex-col justify-between gap-4 p-5 md:border-r">
            <div className="flex items-start gap-3">
              <Building2 className="mt-0.5 h-5 w-5 text-muted-foreground" />
              <div className="min-w-0">
                <p className="text-sm font-medium">Empresa do ERP</p>
                <p className="truncate text-base font-semibold">{empresaResumo?.nome || "Não configurada"}</p>
                <p className="text-xs text-muted-foreground">{empresaResumo?.cnpj || "CNPJ não informado"}</p>
              </div>
            </div>
            <Button asChild variant="outline" size="sm" className="w-fit bg-transparent">
              <Link href="/configuracoes/fiscal-pagamentos">Alterar dados da empresa</Link>
            </Button>
          </section>

          <section className="flex min-h-32 flex-col justify-between gap-4 p-5">
            <div className="flex items-start gap-3">
              <Store className="mt-0.5 h-5 w-5 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium">Conta Mercado Livre</p>
                  {mercadoLivreAccount && !mercadoLivreAccount.needsReconnect ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  ) : null}
                </div>
                <p className="truncate text-base font-semibold">
                  {mercadoLivreAccount?.nickname || (mercadoLivreAccount ? `Usuário ${mercadoLivreAccount.userId}` : "Não conectada")}
                </p>
                <p className="text-xs text-muted-foreground">
                  {mercadoLivreAccount
                    ? mercadoLivreAccount.needsReconnect
                      ? "Reconexão necessária"
                      : `User ID ${mercadoLivreAccount.userId}`
                    : "Nenhuma conta vendedora vinculada"}
                </p>
                {mercadoLivreAccount?.shipping && !mercadoLivreAccount.needsReconnect ? (
                  <p className={`mt-1 text-xs ${mercadoLivreAccount.shipping.mercadoEnviosEnabled ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400"}`}>
                    {mercadoLivreAccount.shipping.mercadoEnviosEnabled
                      ? "Mercado Envios habilitado para esta conta"
                      : "Mercado Envios não habilitado para esta conta"}
                  </p>
                ) : null}
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm" variant={mercadoLivreAccount && !mercadoLivreAccount.needsReconnect ? "outline" : "default"}>
                <a href="/api/integracoes/mercadolivre/auth">
                  {mercadoLivreAccount ? (mercadoLivreAccount.needsReconnect ? "Reconectar" : "Trocar conta") : "Conectar conta"}
                </a>
              </Button>

              {mercadoLivreAccount ? (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="outline" size="sm" className="bg-transparent text-destructive hover:text-destructive">
                      <Unplug className="h-4 w-4" />
                      Desconectar
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Desconectar conta Mercado Livre?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Os pedidos históricos serão preservados. Os vínculos dos anúncios serão removidos e precisarão ser refeitos ao conectar outra conta.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancelar</AlertDialogCancel>
                      <AlertDialogAction onClick={desconectarMercadoLivre} disabled={desconectandoMercadoLivre}>
                        {desconectandoMercadoLivre ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                        Desconectar
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              ) : null}
            </div>
          </section>
        </CardContent>
      </Card>

      <div className="grid items-start gap-6 lg:grid-cols-12">
        <Card className="overflow-hidden border-primary/10 p-0 shadow-sm lg:col-span-5">
          <CardHeader className="bg-primary/5 py-4">
            <div className="flex items-center gap-2">
              <Search className="h-5 w-5 text-primary" />
              <CardTitle>Consultas de placa</CardTitle>
            </div>
            <CardDescription>Uso mensal da API de placas.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 py-6">
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
              <div className="rounded-lg border bg-muted/20 p-4">
                <span className="text-xs text-muted-foreground">Usadas no mes</span>
                <p className="mt-1 text-2xl font-semibold">{usoConsultasPlaca ? usadasPlacas : "-"}</p>
              </div>
              <div className="rounded-lg border bg-muted/20 p-4">
                <span className="text-xs text-muted-foreground">Limite mensal</span>
                <p className="mt-1 text-2xl font-semibold">{usoConsultasPlaca ? limitePlacas : "-"}</p>
              </div>
              <div className="rounded-lg border bg-muted/20 p-4">
                <span className="text-xs text-muted-foreground">Mes vigente</span>
                <p className="mt-1 text-2xl font-semibold">{usoConsultasPlaca?.mes || "-"}</p>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{usoConsultasPlaca ? `${usadasPlacas}/${limitePlacas}` : "Sem dados"}</span>
                <span>{usoConsultasPlaca ? `${percentualPlacas}%` : "-"}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: usoConsultasPlaca ? `${percentualPlacas}%` : "0%" }}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Ao virar o mes, o contador e reiniciado automaticamente na proxima consulta.
              </p>
            </div>
          </CardContent>
        </Card>
        <Card className="overflow-hidden border-primary/10 p-0 shadow-sm lg:col-span-7">
          <CardHeader className="bg-primary/5 py-4">
            <div className="flex items-center gap-2">
              <CalendarDays className="h-5 w-5 text-primary" />
              <CardTitle>Agenda de atendimento</CardTitle>
            </div>
            <CardDescription>Defina dias, horario de trabalho e intervalo padrao dos agendamentos.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-6 py-6">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label>Intervalo dos slots</Label>
                <Select
                  value={String(watch("agendamento_intervalo_minutos") ?? 60)}
                  onValueChange={(value) => setValue("agendamento_intervalo_minutos", Number(value), { shouldDirty: true })}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="15">15 minutos</SelectItem>
                    <SelectItem value="30">30 minutos</SelectItem>
                    <SelectItem value="45">45 minutos</SelectItem>
                    <SelectItem value="60">1 hora</SelectItem>
                    <SelectItem value="90">1h30</SelectItem>
                    <SelectItem value="120">2 horas</SelectItem>
                    <SelectItem value="180">3 horas</SelectItem>
                    <SelectItem value="240">4 horas</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Inicio do expediente</Label>
                <Input
                  type="time"
                  value={(watch("agendamento_hora_inicio") ?? "08:00").slice(0, 5)}
                  onChange={(event) => setValue("agendamento_hora_inicio", event.target.value, { shouldDirty: true })}
                />
              </div>

              <div className="space-y-2">
                <Label>Fim do expediente</Label>
                <Input
                  type="time"
                  value={(watch("agendamento_hora_fim") ?? "18:00").slice(0, 5)}
                  onChange={(event) => setValue("agendamento_hora_fim", event.target.value, { shouldDirty: true })}
                />
              </div>
            </div>

            <div className="space-y-3">
              <Label>Dias de trabalho</Label>
              <div className="flex flex-wrap gap-2">
                {DIAS_SEMANA.map((dia) => {
                  const active = diasTrabalho.includes(dia.value);
                  return (
                    <Button
                      key={dia.value}
                      type="button"
                      variant={active ? "default" : "outline"}
                      size="sm"
                      onClick={() => {
                        const next = active
                          ? diasTrabalho.filter((item) => item !== dia.value)
                          : [...diasTrabalho, dia.value].sort((a, b) => a - b);
                        if (next.length === 0) {
                          toast.error("Selecione ao menos um dia de trabalho.");
                          return;
                        }
                        setValue("agendamento_dias_trabalho", next, { shouldDirty: true });
                      }}
                    >
                      {dia.label}
                    </Button>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground">
                Esses valores controlam a grade do calendario e a duracao padrao sugerida em novos agendamentos.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="overflow-hidden border-primary/10 p-0 shadow-sm lg:col-span-12">
          <CardHeader className="bg-primary/5 py-4">
            <div className="flex items-center gap-2">
              <Palette className="h-5 w-5 text-primary" />
              <CardTitle>Impressao</CardTitle>
            </div>
            <CardDescription>Cores usadas nos modelos de OS e orcamento de venda.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 py-6 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Cor primaria</Label>
              <div className="flex gap-3">
                <Input
                  type="color"
                  className="h-10 w-14 shrink-0 p-1"
                  value={colorPickerValue(impressaoCorPrimaria, "#2563eb")}
                  onChange={(event) => setValue("impressao_cor_primaria", event.target.value, { shouldDirty: true })}
                />
                <Input
                  value={impressaoCorPrimaria}
                  onChange={(event) => setValue("impressao_cor_primaria", event.target.value, { shouldDirty: true })}
                  placeholder="#2563eb"
                  className="font-mono"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Cor secundaria</Label>
              <div className="flex gap-3">
                <Input
                  type="color"
                  className="h-10 w-14 shrink-0 p-1"
                  value={colorPickerValue(impressaoCorSecundaria, "#0891b2")}
                  onChange={(event) => setValue("impressao_cor_secundaria", event.target.value, { shouldDirty: true })}
                />
                <Input
                  value={impressaoCorSecundaria}
                  onChange={(event) => setValue("impressao_cor_secundaria", event.target.value, { shouldDirty: true })}
                  placeholder="#0891b2"
                  className="font-mono"
                />
              </div>
            </div>
          </CardContent>
        </Card>
        {/* MÓDULO FISCAL */}
        <Card className="overflow-hidden border-primary/10 p-0 shadow-sm lg:col-span-12">
          <CardHeader className="bg-primary/5 py-4">
            <div className="flex items-center gap-2">
              <Receipt className="h-5 w-5 text-primary" />
              <CardTitle>Módulo Fiscal (NF-e / NFC-e)</CardTitle>
            </div>
            <CardDescription>
              Configure a visibilidade e as travas de emissão de notas fiscais no sistema.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-6 py-6">
            <div className="flex items-center justify-between space-x-2">
              <div className="flex flex-col space-y-1">
                <Label className="text-base">Habilitar Emissão de NF</Label>
                <span className="text-sm text-muted-foreground">
                  Habilita globalmente os botões e recursos de emissão de NF-e e NFC-e.
                </span>
              </div>
              <Switch
                checked={watch("habilitar_emissao_nfe")}
                onCheckedChange={(v) => setValue("habilitar_emissao_nfe", v)}
              />
            </div>

            <Separator />

            <div className="grid gap-6 lg:grid-cols-2">
              <div className="space-y-4">
                <div className="flex items-center gap-2 font-medium text-sm text-primary">
                  <FileText className="h-4 w-4" /> Módulo de Vendas
                </div>
                <div className="flex items-center justify-between p-4 rounded-lg bg-muted/30 border">
                  <div className="flex flex-col space-y-1">
                    <Label>Exibir no Módulo</Label>
                    <span className="text-xs text-muted-foreground">Botão de emissão de NF é exibido no módulo de Vendas.</span>
                  </div>
                  <Switch
                    checked={watch("emissao_nf_no_modulo_vendas")}
                    onCheckedChange={(v) => setValue("emissao_nf_no_modulo_vendas", v)}
                  />
                </div>
                <div className="flex items-center justify-between p-4 rounded-lg bg-muted/30 border">
                  <div className="flex flex-col space-y-1">
                    <Label>Emitir sem Pagamento</Label>
                    <span className="text-xs text-muted-foreground">Permite emissão de NF de Vendas antes do financeiro baixar.</span>
                  </div>
                  <Switch
                    checked={watch("emissao_nf_vendas_nao_pagas")}
                    onCheckedChange={(v) => setValue("emissao_nf_vendas_nao_pagas", v)}
                  />
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex items-center gap-2 font-medium text-sm text-primary">
                  <ClipboardCheck className="h-4 w-4" /> Módulo de Ordens (OS)
                </div>
                <div className="flex items-center justify-between p-4 rounded-lg bg-muted/30 border">
                  <div className="flex flex-col space-y-1">
                    <Label>Exibir no Módulo</Label>
                    <span className="text-xs text-muted-foreground">Botão de emissão de NF é exibido no módulo de Ordens.</span>
                  </div>
                  <Switch
                    checked={watch("emissao_nf_no_modulo_ordens")}
                    onCheckedChange={(v) => setValue("emissao_nf_no_modulo_ordens", v)}
                  />
                </div>
                <div className="flex items-center justify-between p-4 rounded-lg bg-muted/30 border">
                  <div className="flex flex-col space-y-1">
                    <Label>Emitir sem Pagamento</Label>
                    <span className="text-xs text-muted-foreground">Permite emissão de NF de OS antes do financeiro baixar.</span>
                  </div>
                  <Switch
                    checked={watch("emissao_nf_ordens_nao_pagas")}
                    onCheckedChange={(v) => setValue("emissao_nf_ordens_nao_pagas", v)}
                  />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* SISTEMA E INTERFACE */}
        <Card className="border-primary/10 shadow-sm lg:col-span-5">
            <CardHeader>
              <div className="flex items-center gap-2">
                <ShoppingCart className="h-5 w-5 text-primary" />
                <CardTitle>Operações de Venda & PDV</CardTitle>
              </div>
              <CardDescription>
                Alertas e comportamentos do fluxo de caixa e ponto de venda.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between">
                <div className="flex flex-col space-y-1">
                  <div className="flex items-center gap-2">
                    <Label>Alerta de Estoque PDV</Label>
                    <Package className="h-3 w-3 text-muted-foreground" />
                  </div>
                  <span className="text-xs text-muted-foreground">Exibe alerta em produtos sem etoque no módulo PDV.</span>
                </div>
                <Switch
                  checked={watch("alerta_estoque_pdv")}
                  onCheckedChange={(v) => setValue("alerta_estoque_pdv", v)}
                />
              </div>
            </CardContent>
        </Card>

        <Card className="border-primary/10 shadow-sm lg:col-span-7">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Boxes className="h-5 w-5 text-primary" />
              <CardTitle>Estoque em Ordens de Serviço</CardTitle>
            </div>
            <CardDescription>Defina quando os produtos da OS saem do estoque.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-between gap-4">
              <div className="flex flex-col space-y-1">
                <Label>Valor médio de compra obrigatório</Label>
                <span className="text-xs text-muted-foreground">
                  Exige um custo médio maior que zero ao cadastrar ou editar produtos.
                </span>
              </div>
              <Switch
                checked={watch("produto_preco_medio_compra_obrigatorio")}
                onCheckedChange={(value) =>
                  setValue("produto_preco_medio_compra_obrigatorio", value, { shouldDirty: true })
                }
              />
            </div>
            <Separator />
            <div className="space-y-2">
            <Label>Modo de baixa no estoque</Label>
            <Select
              value={watch("modo_baixa_estoque_os") ?? "ORCAMENTO"}
              onValueChange={(value) =>
                setValue("modo_baixa_estoque_os", value as Config["modo_baixa_estoque_os"], { shouldDirty: true })
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ORCAMENTO">Baixa no Orçamento</SelectItem>
                <SelectItem value="EXECUCAO">Baixa na Execução</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Na execução, o estoque é validado quando a OS é iniciada.
            </p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-primary/10 shadow-sm lg:col-span-12">
            <CardHeader>
              <div className="flex items-center gap-2">
                <AlertCircle className="h-5 w-5 text-primary" />
                <CardTitle>Processos & Qualidade</CardTitle>
              </div>
              <CardDescription>
                Regras de negócio para garantir a execução de processos internos.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between">
                <div className="flex flex-col space-y-1">
                  <Label>Checklist de Entrada Obrigatório</Label>
                  <span className="text-xs text-muted-foreground">
                    Impede o início de uma OS sem que o veículo passe pelo checklist.
                  </span>
                </div>
                <Switch
                  checked={watch("checklist_obrigatorio")}
                  onCheckedChange={(v) => setValue("checklist_obrigatorio", v)}
                />
              </div>

              <div className="p-4 rounded-lg bg-primary/5 border border-primary/20 flex gap-3">
                <AlertCircle className="h-5 w-5 text-primary shrink-0" />
                <p className="text-xs text-primary/80 leading-relaxed">
                  <strong>Dica:</strong> Ao ativar o checklist obrigatório, certifique-se de que todos os seus técnicos têm acesso aos formulários de inspeção.
                </p>
              </div>
            </CardContent>
        </Card>
      </div>

    </div>
  );
}
