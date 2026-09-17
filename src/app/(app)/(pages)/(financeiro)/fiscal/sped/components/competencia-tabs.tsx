"use client";

import {
  Archive,
  Boxes,
  Building2,
  Calculator,
  Download,
  FileClock,
  Landmark,
  PackageSearch,
  ReceiptText,
  ShieldCheck,
  UsersRound,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import {
  formatCivilDate,
  formatCurrency,
  formatEnum,
  formatFileSize,
  formatInteger,
  formatTimestamp,
} from "../formatters";
import type { SpedArquivo, SpedCompetenciaDetail } from "../types";
import { AdjustmentPanel } from "./adjustment-panel";
import { EmptyState } from "./empty-state";
import { ImportPanel, type SpedImportKind } from "./import-panel";
import { ConfigurationEditor } from "./configuration-editor";
import { ItemDecisionEditor } from "./item-decision-editor";
import { SourceTrace } from "./source-trace";
import { DiagnosticBadge, GateStatusBadge } from "./status-badges";

export function CompetenciaTabs({
  competencia,
  canDownload,
  canManage,
  busy,
  onDownload,
  onImport,
  onConfigSaved,
}: {
  competencia: SpedCompetenciaDetail;
  canDownload: boolean;
  canManage: boolean;
  busy: boolean;
  onDownload: (file: SpedArquivo) => void;
  onImport: (kind: SpedImportKind, file: File) => void;
  onConfigSaved: () => void;
}) {
  const timezone = competencia.configuracao.timezoneIana;

  return (
    <Tabs defaultValue="geral" className="gap-4">
      <div className="overflow-x-auto pb-1">
        <TabsList className="h-auto min-w-max justify-start">
          <TabsTrigger value="geral">Visão geral</TabsTrigger>
          <TabsTrigger value="configuracao">Configuração</TabsTrigger>
          <TabsTrigger value="importacoes">Importações</TabsTrigger>
          <TabsTrigger value="documentos">Documentos ({competencia.documentos.length})</TabsTrigger>
          <TabsTrigger value="decisoes-itens">Decisões por item</TabsTrigger>
          <TabsTrigger value="participantes">Participantes ({competencia.participantes.length})</TabsTrigger>
          <TabsTrigger value="itens">Itens ({competencia.itens.length})</TabsTrigger>
          <TabsTrigger value="apuracao">Apuração</TabsTrigger>
          <TabsTrigger value="1601">1601 ({competencia.pagamentos1601.length})</TabsTrigger>
          <TabsTrigger value="inventario">Inventário</TabsTrigger>
          <TabsTrigger value="inconsistencias">Inconsistências ({competencia.inconsistencias.length})</TabsTrigger>
          <TabsTrigger value="arquivos">Arquivos ({competencia.arquivos.length})</TabsTrigger>
          <TabsTrigger value="auditoria">Auditoria</TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="geral"><OverviewTab competencia={competencia} /></TabsContent>
      <TabsContent value="configuracao"><ConfigurationEditor competencia={competencia} canManage={canManage} disabled={busy} onSaved={onConfigSaved} /></TabsContent>
      <TabsContent value="importacoes"><ImportPanel competencia={competencia} canManage={canManage} busy={busy} onImport={onImport} /></TabsContent>
      <TabsContent value="documentos"><DocumentsTab competencia={competencia} /></TabsContent>
      <TabsContent value="decisoes-itens"><ItemDecisionEditor competencia={competencia} canManage={canManage} disabled={busy} onSaved={onConfigSaved} /></TabsContent>
      <TabsContent value="participantes"><ParticipantsTab competencia={competencia} /></TabsContent>
      <TabsContent value="itens"><ItemsTab competencia={competencia} /></TabsContent>
      <TabsContent value="apuracao"><AssessmentTab competencia={competencia} canManage={canManage} disabled={busy} onSaved={onConfigSaved} /></TabsContent>
      <TabsContent value="1601"><PaymentTab competencia={competencia} /></TabsContent>
      <TabsContent value="inventario"><InventoryTab competencia={competencia} /></TabsContent>
      <TabsContent value="inconsistencias"><DiagnosticsTab competencia={competencia} /></TabsContent>
      <TabsContent value="arquivos">
        <FilesTab competencia={competencia} canDownload={canDownload} onDownload={onDownload} />
      </TabsContent>
      <TabsContent value="auditoria"><AuditTab competencia={competencia} timezone={timezone} /></TabsContent>
    </Tabs>
  );
}

function OverviewTab({ competencia }: { competencia: SpedCompetenciaDetail }) {
  const { configuracao } = competencia;
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(20rem,0.7fr)]">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><ShieldCheck className="size-4" aria-hidden="true" /> Gates fiscais</CardTitle>
          <CardDescription>Todos os gates devem estar decididos antes do fechamento.</CardDescription>
        </CardHeader>
        <CardContent>
          {competencia.gates.length ? (
            <div className="divide-y rounded-lg border">
              {competencia.gates.map((gate) => (
                <div key={gate.id} className="grid gap-2 p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{gate.titulo}</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                      {gate.descricao || "Sem observação complementar."}
                    </p>
                    {gate.evidencia ? <p className="mt-2 text-xs"><span className="text-muted-foreground">Evidência:</span> {gate.evidencia}</p> : null}
                  </div>
                  <GateStatusBadge status={gate.status} />
                </div>
              ))}
            </div>
          ) : (
            <EmptyState icon={ShieldCheck} title="Nenhum gate retornado" description="A validação fiscal deve cadastrar os gates aplicáveis antes do fechamento." />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><Building2 className="size-4" aria-hidden="true" /> Estabelecimento</CardTitle>
          <CardDescription>Configuração usada na projeção desta competência.</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
            <Definition label="Estabelecimento" value={configuracao.estabelecimento} />
            <Definition label="CNPJ" value={configuracao.cnpj} mono />
            <Definition label="Inscrição estadual" value={configuracao.inscricaoEstadual} />
            <Definition label="Timezone" value={configuracao.timezoneIana} mono />
            <Definition label="Perfil EFD" value={configuracao.perfil} />
            <Definition label="Indicador de atividade" value={configuracao.indicadorAtividade} />
            <Definition label="Corte das fontes" value={competencia.sourceCutoffAt ? formatTimestamp(competencia.sourceCutoffAt, configuracao.timezoneIana) : null} />
            <Definition label="Hash do contexto" value={competencia.contextHash} mono />
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}

function DocumentsTab({ competencia }: { competencia: SpedCompetenciaDetail }) {
  if (!competencia.documentos.length) {
    return <EmptyState icon={ReceiptText} title="Nenhum documento escriturável" description="Documentos só aparecem após a seleção fiscal das fontes e a confirmação das datas de entrada." />;
  }
  return (
    <DataCard title="Documentos fiscais" description="Projeção feita a partir do XML autorizado e das decisões fiscais do contribuinte.">
      <Table>
        <TableHeader><TableRow><TableHead>Documento</TableHead><TableHead>Participante</TableHead><TableHead>Data fiscal</TableHead><TableHead>CFOP</TableHead><TableHead className="text-right">Valor</TableHead><TableHead className="text-right">Fonte</TableHead></TableRow></TableHeader>
        <TableBody>
          {competencia.documentos.map((documento) => (
            <TableRow key={documento.id} className="[content-visibility:auto]">
              <TableCell className="whitespace-normal"><p className="font-medium">{documento.modelo} · {documento.serie}/{documento.numero}</p><p className="text-xs text-muted-foreground">{formatEnum(documento.direcao)} · {documento.situacao}</p>{documento.chave ? <p className="mt-1 break-all font-mono text-[10px] text-muted-foreground">{documento.chave}</p> : null}</TableCell>
              <TableCell className="max-w-56 whitespace-normal"><p>{documento.participante}</p>{documento.documentoParticipante ? <p className="font-mono text-[10px] text-muted-foreground">{documento.documentoParticipante}</p> : null}</TableCell>
              <TableCell>{formatCivilDate(documento.dataFiscal)}</TableCell>
              <TableCell className="whitespace-normal">{documento.cfops.length ? documento.cfops.join(", ") : "—"}</TableCell>
              <TableCell className="text-right tabular-nums">{formatCurrency(documento.valorTotal)}</TableCell>
              <TableCell className="text-right"><SourceTrace sources={documento.fontes} /></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </DataCard>
  );
}

function ParticipantsTab({ competencia }: { competencia: SpedCompetenciaDetail }) {
  if (!competencia.participantes.length) return <EmptyState icon={UsersRound} title="Nenhum participante referenciado" description="Participantes serão derivados dos documentos da competência, preservando a identidade histórica do XML." />;
  return (
    <DataCard title="Participantes — registro 0150" description="CNPJ é tratado como texto canônico e pode conter letras nas doze posições-base.">
      <Table>
        <TableHeader><TableRow><TableHead>Código</TableHead><TableHead>Participante</TableHead><TableHead>Documento</TableHead><TableHead>IE</TableHead><TableHead>Município</TableHead><TableHead className="text-right">Docs.</TableHead><TableHead className="text-right">Fonte</TableHead></TableRow></TableHeader>
        <TableBody>{competencia.participantes.map((participante) => (
          <TableRow key={participante.id} className="[content-visibility:auto]"><TableCell className="font-mono text-xs">{participante.codigo}</TableCell><TableCell className="max-w-64 whitespace-normal font-medium">{participante.nome}</TableCell><TableCell className="font-mono text-xs">{participante.documento || "—"}</TableCell><TableCell>{participante.inscricaoEstadual || "—"}</TableCell><TableCell className="whitespace-normal">{participante.municipio || participante.pais || "—"}</TableCell><TableCell className="text-right tabular-nums">{formatInteger(participante.documentosReferenciados)}</TableCell><TableCell className="text-right"><SourceTrace sources={participante.fontes} /></TableCell></TableRow>
        ))}</TableBody>
      </Table>
    </DataCard>
  );
}

function ItemsTab({ competencia }: { competencia: SpedCompetenciaDetail }) {
  if (!competencia.itens.length) return <EmptyState icon={PackageSearch} title="Nenhum item referenciado" description="Itens do 0200 serão incluídos somente quando exigidos pelos documentos e registros da competência." />;
  return (
    <DataCard title="Itens da escrituração" description="O snapshot fiscal não é reescrito por alterações futuras no cadastro do produto.">
      <Table>
        <TableHeader><TableRow><TableHead>Código</TableHead><TableHead>Descrição</TableHead><TableHead>Tipo</TableHead><TableHead>NCM / CEST</TableHead><TableHead>Unidade</TableHead><TableHead>Registros</TableHead><TableHead className="text-right">Fonte</TableHead></TableRow></TableHeader>
        <TableBody>{competencia.itens.map((item) => (
          <TableRow key={item.id} className="[content-visibility:auto]"><TableCell className="font-mono text-xs">{item.codigo}</TableCell><TableCell className="max-w-72 whitespace-normal font-medium">{item.descricao}</TableCell><TableCell>{item.tipoItem || "—"}</TableCell><TableCell><p>{item.ncm || "—"}</p>{item.cest ? <p className="text-xs text-muted-foreground">CEST {item.cest}</p> : null}</TableCell><TableCell>{item.unidade || "—"}</TableCell><TableCell className="whitespace-normal"><div className="flex flex-wrap gap-1">{item.possui0220 ? <Badge variant="outline">0220</Badge> : null}{item.possui0221 ? <Badge variant="outline">0221</Badge> : null}{!item.possui0220 && !item.possui0221 ? "—" : null}</div></TableCell><TableCell className="text-right"><SourceTrace sources={item.fontes} /></TableCell></TableRow>
        ))}</TableBody>
      </Table>
    </DataCard>
  );
}

function AssessmentTab({
  competencia,
  canManage,
  disabled,
  onSaved,
}: {
  competencia: SpedCompetenciaDetail;
  canManage: boolean;
  disabled: boolean;
  onSaved: () => void;
}) {
  const values = [
    ["Saldo credor anterior", competencia.apuracao.saldoCredorAnterior],
    ["Débitos", competencia.apuracao.totalDebitos],
    ["Créditos", competencia.apuracao.totalCreditos],
    ["Ajustes", competencia.apuracao.totalAjustes],
    ["Imposto a recolher", competencia.apuracao.impostoRecolher],
    ["Saldo a transportar", competencia.apuracao.saldoTransportar],
  ] as const;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{values.map(([label, value]) => <Card key={label}><CardContent className="p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-xl font-semibold tabular-nums">{formatCurrency(value)}</p></CardContent></Card>)}</div>
      {competencia.apuracao.linhas.length ? (
        <DataCard title="Composição da apuração" description="Saldos, débitos, créditos e ajustes que formam os registros do Bloco E.">
          <Table><TableHeader><TableRow><TableHead>Grupo</TableHead><TableHead>Código</TableHead><TableHead>Descrição</TableHead><TableHead>Origem</TableHead><TableHead className="text-right">Valor</TableHead><TableHead className="text-right">Fonte</TableHead></TableRow></TableHeader><TableBody>{competencia.apuracao.linhas.map((line) => <TableRow key={line.id}><TableCell>{line.grupo}</TableCell><TableCell className="font-mono text-xs">{line.codigo || "—"}</TableCell><TableCell className="max-w-80 whitespace-normal">{line.descricao}</TableCell><TableCell>{line.origem}</TableCell><TableCell className="text-right tabular-nums">{formatCurrency(line.valor)}</TableCell><TableCell className="text-right"><SourceTrace sources={line.fontes} /></TableCell></TableRow>)}</TableBody></Table>
        </DataCard>
      ) : <EmptyState icon={Calculator} title="Apuração ainda não calculada" description="Importe a EFD anterior, classifique os créditos e execute a validação para formar a apuração." />}
      <AdjustmentPanel competencia={competencia} canManage={canManage} disabled={disabled} onSaved={onSaved} />
    </div>
  );
}

function PaymentTab({ competencia }: { competencia: SpedCompetenciaDetail }) {
  if (!competencia.pagamentos1601.length) return <EmptyState icon={Landmark} title="Nenhum dado do registro 1601" description="Importe e revise o arquivo mensal agregado por instituição antes do fechamento, quando aplicável." />;
  return (
    <DataCard title="Operações com instrumentos de pagamento — 1601" description="Valores importados e revisados; Pix e transferência não são inferidos dos XMLs.">
      <Table><TableHeader><TableRow><TableHead>Instituição</TableHead><TableHead>Intermediário</TableHead><TableHead className="text-right">Operações</TableHead><TableHead className="text-right">ISS</TableHead><TableHead className="text-right">Outros</TableHead><TableHead>Origem</TableHead></TableRow></TableHeader><TableBody>{competencia.pagamentos1601.map((payment) => <TableRow key={payment.id}><TableCell className="whitespace-normal"><p className="font-medium">{payment.instituicao}</p><p className="font-mono text-[10px] text-muted-foreground">{payment.documentoInstituicao}</p></TableCell><TableCell className="whitespace-normal">{payment.intermediario ? <><p>{payment.intermediario}</p><p className="font-mono text-[10px] text-muted-foreground">{payment.documentoIntermediario}</p></> : "—"}</TableCell><TableCell className="text-right tabular-nums">{formatCurrency(payment.totalOperacoes)}</TableCell><TableCell className="text-right tabular-nums">{formatCurrency(payment.totalIss)}</TableCell><TableCell className="text-right tabular-nums">{formatCurrency(payment.totalOutros)}</TableCell><TableCell className="whitespace-normal text-xs">{payment.origem}</TableCell></TableRow>)}</TableBody></Table>
    </DataCard>
  );
}

function InventoryTab({ competencia }: { competencia: SpedCompetenciaDetail }) {
  const inventory = competencia.inventario;
  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Boxes className="size-4" aria-hidden="true" /> Inventário — Bloco H</CardTitle><CardDescription>Somente um fechamento de inventário aprovado pode alimentar H005/H010/H020.</CardDescription></CardHeader>
      <CardContent>
        <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <div><dt className="text-xs text-muted-foreground">Aplicabilidade</dt><dd className="mt-1"><GateStatusBadge status={inventory.aplicabilidade} /></dd></div>
          <Definition label="Data do inventário" value={formatCivilDate(inventory.dataInventario)} />
          <Definition label="Motivo" value={inventory.motivo} />
          <Definition label="Status" value={inventory.status} />
          <Definition label="Quantidade de itens" value={formatInteger(inventory.quantidadeItens)} />
          <Definition label="Valor total" value={formatCurrency(inventory.valorTotal)} />
        </dl>
      </CardContent>
    </Card>
  );
}

function DiagnosticsTab({ competencia }: { competencia: SpedCompetenciaDetail }) {
  if (!competencia.inconsistencias.length) return <EmptyState icon={ShieldCheck} title="Nenhuma inconsistência registrada" description="Execute uma validação para confirmar que os gates e os dados fiscais continuam aptos." />;
  return (
    <DataCard title="Diagnóstico fiscal" description="Bloqueios e erros impedem o fechamento; somente avisos podem ser reconhecidos.">
      <div className="divide-y">
        {competencia.inconsistencias.map((diagnostic) => (
          <article key={diagnostic.id} className="grid gap-3 py-4 first:pt-0 last:pb-0 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-start">
            <DiagnosticBadge severity={diagnostic.severidade} />
            <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-medium">{diagnostic.titulo}</h3><span className="font-mono text-[10px] text-muted-foreground">{diagnostic.codigo}</span>{diagnostic.resolvida ? <Badge variant="secondary">Resolvida</Badge> : null}</div><p className="mt-1 text-sm leading-relaxed text-muted-foreground">{diagnostic.mensagem}</p>{diagnostic.registro || diagnostic.campo ? <p className="mt-2 text-xs"><span className="text-muted-foreground">Contexto:</span> {[diagnostic.registro, diagnostic.campo].filter(Boolean).join(" · ")}</p> : null}</div>
            <SourceTrace sources={diagnostic.fontes} />
          </article>
        ))}
      </div>
    </DataCard>
  );
}

function FilesTab({ competencia, canDownload, onDownload }: { competencia: SpedCompetenciaDetail; canDownload: boolean; onDownload: (file: SpedArquivo) => void }) {
  if (!competencia.arquivos.length) return <EmptyState icon={Archive} title="Nenhum arquivo gerado" description="O TXT final só pode ser produzido a partir de uma versão fechada e imutável." />;
  return (
    <DataCard title="Arquivos gerados" description="Cada artefato possui versão, contagem de registros e hash SHA-256 próprios.">
      <Table><TableHeader><TableRow><TableHead>Arquivo</TableHead><TableHead>Versão</TableHead><TableHead>Gerado em</TableHead><TableHead className="text-right">Registros</TableHead><TableHead className="text-right">Tamanho</TableHead><TableHead>PVA</TableHead><TableHead className="text-right">Ação</TableHead></TableRow></TableHeader><TableBody>{competencia.arquivos.map((file) => <TableRow key={file.id}><TableCell className="max-w-72 whitespace-normal"><p className="font-medium">{file.nome}</p><p className="mt-1 break-all font-mono text-[10px] text-muted-foreground">SHA-256 {file.sha256}</p></TableCell><TableCell>v{file.versao} · {formatEnum(file.tipo)}</TableCell><TableCell>{formatTimestamp(file.geradoEm, competencia.configuracao.timezoneIana)}</TableCell><TableCell className="text-right tabular-nums">{formatInteger(file.quantidadeRegistros)}</TableCell><TableCell className="text-right">{formatFileSize(file.tamanhoBytes)}</TableCell><TableCell>{formatEnum(file.pvaStatus)}</TableCell><TableCell className="text-right"><Button type="button" size="sm" variant="outline" disabled={!canDownload} onClick={() => onDownload(file)}><Download aria-hidden="true" /> Baixar</Button></TableCell></TableRow>)}</TableBody></Table>
    </DataCard>
  );
}

function AuditTab({ competencia, timezone }: { competencia: SpedCompetenciaDetail; timezone: string }) {
  if (!competencia.auditoria.length) return <EmptyState icon={FileClock} title="Nenhum evento de auditoria" description="Validações, fechamentos, reaberturas e gerações aparecerão aqui com usuário e horário." />;
  return (
    <DataCard title="Trilha de auditoria" description="Histórico operacional e fiscal da competência.">
      <div className="divide-y">{competencia.auditoria.map((event) => <article key={event.id} className="grid gap-1 py-3 first:pt-0 last:pb-0 sm:grid-cols-[10rem_minmax(0,1fr)_12rem]"><p className="text-xs text-muted-foreground">{formatTimestamp(event.ocorridoEm, timezone)}</p><div><p className="text-sm font-medium">{event.acao}</p><p className="text-sm text-muted-foreground">{event.descricao}</p></div><p className="text-xs text-muted-foreground sm:text-right">{event.usuario || "Sistema"}{event.versao ? ` · v${event.versao}` : ""}</p></article>)}</div>
    </DataCard>
  );
}

function Definition({ label, value, mono = false }: { label: string; value: string | number | null | undefined; mono?: boolean }) {
  return <div className="min-w-0"><dt className="text-xs text-muted-foreground">{label}</dt><dd className={mono ? "mt-1 break-all font-mono text-xs" : "mt-1 break-words text-sm font-medium"}>{value === null || value === undefined || value === "" ? "—" : value}</dd></div>;
}

function DataCard({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return <Card><CardHeader><CardTitle className="text-base">{title}</CardTitle><CardDescription>{description}</CardDescription></CardHeader><CardContent>{children}</CardContent></Card>;
}
