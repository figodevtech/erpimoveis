"use client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CheckoutCard } from "@/lib/checkout-card";

export function CheckoutCardFields({ value, onChange, disabled, saveCard=false }: { value: CheckoutCard; onChange: (value: CheckoutCard) => void; disabled: boolean; saveCard?:boolean }) {
  const fields: { key: keyof CheckoutCard; label: string; autoComplete: string; max: number; numeric?: boolean }[] = [
    { key: "holderName", label: "Nome impresso no cartão", autoComplete: "cc-name", max: 100 },
    { key: "number", label: "Número do cartão", autoComplete: "cc-number", max: 19, numeric: true },
    { key: "expiryMonth", label: "Mês de validade (MM)", autoComplete: "cc-exp-month", max: 2, numeric: true },
    { key: "expiryYear", label: "Ano de validade (AAAA)", autoComplete: "cc-exp-year", max: 4, numeric: true },
    { key: "ccv", label: "Código de segurança", autoComplete: "cc-csc", max: 4, numeric: true },
  ];
  return <div className="grid grid-cols-2 gap-3 mt-4">{fields.map(field => <div key={field.key} className={`space-y-1.5 min-w-0 ${["holderName", "number", "ccv"].includes(field.key) ? "col-span-2" : ""}`}>
    <Label htmlFor={`checkout-${field.key}`}>{field.label}</Label>
    <Input id={`checkout-${field.key}`} value={value[field.key]} type={field.key === "ccv" ? "password" : "text"} inputMode={field.numeric ? "numeric" : "text"} autoComplete={field.autoComplete} maxLength={field.max} disabled={disabled}
      onChange={event => onChange({ ...value, [field.key]: field.numeric ? event.target.value.replace(/\D/g, "") : event.target.value })} />
  </div>)}<p className="col-span-2 text-xs text-muted-foreground">{saveCard?'O Asaas poderá fornecer uma referência segura do cartão para compras futuras.':'Os dados são enviados ao Asaas para esta compra. O cartão não será salvo.'}</p></div>;
}
