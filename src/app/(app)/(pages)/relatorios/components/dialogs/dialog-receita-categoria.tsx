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
import { PieChart } from "lucide-react";
import { ExportTransactionsButton } from "../../../(financeiro)/fluxodecaixa/components/ExportTransactionsButton";
import { Label } from "@/components/ui/label";
import { useState } from "react";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tipo_transacao } from "../../../(financeiro)/fluxodecaixa/types";
import { useCategoriasTransacao } from "../../../(financeiro)/fluxodecaixa/hooks/use-categoria-transacao";

export default function DialogReceitaCategoria() {
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [selectedCategoria, setSelectedCategoria] = useState<string>("");
   const { categorias } = useCategoriasTransacao();

  return (
    <Dialog>
      <DialogTrigger asChild>
       <Button
            variant="outline"
            className="h-auto hover:cursor-pointer flex-col items-start justify-start gap-2 p-4 text-left hover:bg-accent hover:text-accent-foreground bg-transparent"
          >
            <div className="flex w-full items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-muted">
                <PieChart />
              </div>
              <span className="flex-1 font-medium">Receitas por Categoria</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Categorização de receitas
            </p>
          </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Receitas por Categoria</DialogTitle>
          <DialogDescription>
            Selecione dados para gerar o relatório
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-6 bg-muted/50 p-4 rounded-2xl">
          <div className="flex flex-col gap-2">
            <Label>Categoria de Transação:</Label>
            <Select
              value={selectedCategoria || ""}
              onValueChange={(value) => {
                if (value === "TODOS") setSelectedCategoria("");
                else setSelectedCategoria(value);
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
                {categorias.map((c) => (

                <SelectItem
                key={c.id}
                  value={c.nome}
                  className="hover:cursor-pointer"
                >
                  {c.nome}
                </SelectItem>
                ))}
                
               
              </SelectContent>
            </Select>
          </div>
          
          <div className="flex flex-col md:flex-row gap-6">
            <div className="flex flex-row gap-2">
              <Label>De:</Label>
              <DatePicker value={dateFrom} onChange={setDateFrom} placeholder="Data inicial" />
            </div>
            <div className="flex flex-row gap-2">
              <Label>Até:</Label>
              <DatePicker value={dateTo} onChange={setDateTo} placeholder="Data final" />
            </div>
          </div>
        </div>
        <DialogFooter className="flex flex-row items-center">
          <ExportTransactionsButton
          tipo={Tipo_transacao.RECEITA}
          categoria={selectedCategoria}
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
