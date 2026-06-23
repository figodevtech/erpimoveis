import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogFooter,
  DialogHeader,
  DialogTrigger,
  DialogDescription,
  DialogClose,
} from "@/components/ui/dialog";
import { Wallet } from "lucide-react";
import { ExportTransactionsButton } from "../../../(financeiro)/fluxodecaixa/components/ExportTransactionsButton";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tipo_transacao } from "../../../(financeiro)/fluxodecaixa/types";

export default function DialogFluxo() {
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [tipo, setTipo] = useState<Tipo_transacao | "">("");

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          className="h-auto hover:cursor-pointer flex-col items-start justify-start gap-2 p-4 text-left hover:bg-accent hover:text-accent-foreground bg-transparent"
        >
          <div className="flex w-full items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-muted">
              <Wallet />
            </div>
            <span className="flex-1 font-medium">Fluxo de Caixa</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Movimentações financeiras detalhadas
          </p>
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Fluxo de caixa</DialogTitle>
          <DialogDescription>
            Selecione dados para gerar o relatório
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-6 bg-muted/50 p-4 rounded-2xl">
          <div className="flex flex-col gap-2">
            <Label>Tipo de Transação:</Label>
            <Select
              value={tipo || ""}
              onValueChange={(value) => {
                if (value === "TODOS") setTipo("");
                else setTipo(value as Tipo_transacao);
              }}
            >
              <SelectTrigger
                className="w-full md:w-2/6 hover:cursor-pointer not-dark:bg-white"
                // <- estável
              >
                <SelectValue placeholder="Todos" />
              </SelectTrigger>
              <SelectContent>
                {" "}
                {/* <- estável */}
                <SelectItem value="TODOS" className="hover:cursor-pointer">
                  Todos
                </SelectItem>
                <SelectItem
                  value={Tipo_transacao.RECEITA}
                  className="hover:cursor-pointer"
                >
                  Receitas
                </SelectItem>
                <SelectItem
                  value={Tipo_transacao.DESPESA}
                  className="hover:cursor-pointer"
                >
                  Despesas
                </SelectItem>
                <SelectItem
                  value={Tipo_transacao.DEPOSITO}
                  className="hover:cursor-pointer"
                >
                  Depósitos
                </SelectItem>
                <SelectItem
                  value={Tipo_transacao.SAQUE}
                  className="hover:cursor-pointer"
                >
                  Saques
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          
          <div className="flex flex-col md:flex-row gap-6">
            <div className="flex flex-row gap-2">
              <Label>De:</Label>
              <Input
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                type="date"
                name="dateFrom"
                id=""
              />
            </div>
            <div className="flex flex-row gap-2">
              <Label>Até:</Label>
              <Input
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                type="date"
                name="dateTo"
                id=""
              />
            </div>
          </div>
        </div>
        <DialogFooter className="flex flex-row items-center">
          <ExportTransactionsButton
          tipo={tipo}
          dateTo={dateTo}
          dateFrom={dateFrom} />
          <DialogClose asChild>
            <Button className="hover:cursor-pointer">Cancelar</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
