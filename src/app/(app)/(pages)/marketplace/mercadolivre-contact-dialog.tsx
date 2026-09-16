"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import type { ContactOption } from "@/lib/integrations/mercadolivre-contact-options";

export function MercadoLivreContactDialog({ orderDbId, onSent }: { orderDbId: number; onSent: () => void }) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<ContactOption[]>([]);
  const [selected, setSelected] = useState("");
  const [text, setText] = useState("");
  const [startHour, setStartHour] = useState("");
  const [endHour, setEndHour] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const inFlight = useRef(false);
  const option = options.find(item => item.id === selected);
  const validHours = startHour !== "" && endHour !== "" && Number.isInteger(Number(startHour)) && Number.isInteger(Number(endHour)) && Number(startHour) >= 0 && Number(endHour) <= 23 && Number(startHour) < Number(endHour);

  async function load() {
    if (inFlight.current) return;
    inFlight.current = true;
    setOpen(true); setBusy(true); setError(""); setOptions([]); setSelected(""); setText(""); setSent(false);
    setStartHour(""); setEndHour("");
    try {
      const response = await fetch(`/api/integracoes/mercadolivre/messages?orderDbId=${orderDbId}&actionGuide=true`, { cache: "no-store" });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "Não foi possível consultar os motivos.");
      setOptions(json.options ?? []);
    } catch (e) { setError(e instanceof Error ? e.message : "Falha ao consultar motivos."); }
    finally { setBusy(false); inFlight.current = false; }
  }

  async function send() {
    if (!option || inFlight.current) return;
    if (option.deliveryVariables && !validHours) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      const response = await fetch("/api/integracoes/mercadolivre/messages", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderDbId, optionId: option.id, text: option.templateId ? "" : text,
          delivery: option.deliveryVariables ? { start: Number(startHour), end: Number(endHour) } : undefined }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "Não foi possível enviar. Confira o histórico antes de tentar novamente.");
      setSent(true); setOptions([]); setSelected(""); onSent();
    } catch (e) { setError(e instanceof Error ? e.message : "Falha no envio. Confira o histórico antes de tentar novamente."); }
    finally { setBusy(false); inFlight.current = false; }
  }

  return <>
    <Button type="button" size="sm" variant="outline" className="mx-4 mb-2 self-start" onClick={() => void load()} disabled={busy}>Iniciar contato por motivo</Button>
    <Dialog open={open} onOpenChange={value => { if (!busy) setOpen(value); }}>
      <DialogContent className="max-h-[85svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader><DialogTitle>Motivo de contato</DialogTitle><DialogDescription>Para iniciar contato, escolha uma opção liberada pelo Mercado Livre. Para responder ao comprador, use o campo normal da conversa.</DialogDescription></DialogHeader>
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        {sent ? <p role="status" className="text-sm">Solicitação enviada ao Mercado Livre. Confira no histórico o conteúdo e a situação da mensagem.</p> : busy && !options.length ? <p role="status" className="text-sm">Consultando opções...</p> : options.length ? <>
          <Select value={selected} onValueChange={value => { setSelected(value); setText(""); setStartHour(""); setEndHour(""); }} disabled={busy}>
            <SelectTrigger aria-label="Motivo de contato"><SelectValue placeholder="Selecione o motivo" /></SelectTrigger>
            <SelectContent>{options.map(item => <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>)}</SelectContent>
          </Select>
          {option?.deliveryVariables ? <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Esta ação comunica uma faixa de horário ao comprador. Não ativa o Flex, não altera o frete e não muda a data de entrega. A data usada no texto é definida pelo Mercado Livre conforme o envio. Confirme a data no pedido antes de enviar e informe apenas horários que poderá cumprir.</p>
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1 text-sm">Hora inicial<Input type="number" min={0} max={22} step={1} value={startHour} disabled={busy} onChange={event => setStartHour(event.target.value)} /></label>
              <label className="space-y-1 text-sm">Hora final<Input type="number" min={1} max={23} step={1} value={endHour} disabled={busy} onChange={event => setEndHour(event.target.value)} /></label>
            </div>
            <p className="text-xs text-muted-foreground">Horas inteiras no horário local da entrega, por exemplo: 12 a 18. Não aceita intervalo que atravessa a meia-noite.</p>
          </div> : null}
          {option?.templateId ? <p className="text-sm text-muted-foreground">Será enviado o texto padrão do Mercado Livre para “{option.label}”, sem alterações.</p> : option ? <><Textarea aria-label="Mensagem ao comprador" value={text} maxLength={option.charLimit} disabled={busy} onChange={event => setText(event.target.value)} /><p className="text-right text-xs text-muted-foreground">{text.length}/{option.charLimit}</p></> : null}
        </> : !error ? <p className="text-sm text-muted-foreground">Nenhum motivo compatível está disponível neste ERP para este pedido. Se o comprador já iniciou a conversa, responda pelo campo normal. Outras ações podem estar disponíveis no Mercado Livre.</p> : null}
        <DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(false)}>Fechar</Button>{!sent ? <Button type="button" disabled={busy || !option || (!option.templateId && !text.trim()) || (!!option.deliveryVariables && !validHours)} onClick={() => void send()}>{busy ? "Aguarde..." : "Enviar contato"}</Button> : null}</DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
