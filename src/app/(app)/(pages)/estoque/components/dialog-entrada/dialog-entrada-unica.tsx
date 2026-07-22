import { useIsMobile } from "@/app/(app)/hooks/use-mobile";
import FornecedorSelect from "@/app/(app)/components/fornecedorSelect";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Building2, Loader2, Search, X } from "lucide-react";
import { useState } from "react";
import ValueInput from "../dialog-produto/entrada-valor";
import { toast } from "@/lib/toast";
import axios, { isAxiosError } from "axios";
import { Entrada_tipo, Estoque_status, Fornecedor, Pagination } from "../../types";

interface DialogEntradaProps {
  children?: React.ReactNode;
  isOpen?: boolean;
  setIsOpen?: (value: boolean) => void;
  productId?: number;
  productDescription: string;
  currentQuantity: number;
  search?: string;
  handleGetProducts?: (pageNumber?: number, limit?: number, search?: string, status?: Estoque_status) => void;
  paginantion?: Pagination;
  status?: Estoque_status;
}

export default function DialogEntrada({
  children,
  isOpen,
  setIsOpen,
  productId,
  currentQuantity,
  productDescription,
  handleGetProducts,
  paginantion,
  search,
  status,
}: DialogEntradaProps) {
  const [newQtd, setNewQtd] = useState(0);
  const [value, setValue] = useState(0);
  const isMobile = useIsMobile();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [openFornecedor, setOpenFornecedor] = useState(false);
  const [selectedFornecedor, setSelectedFornecedor] = useState<Fornecedor | undefined>(undefined);
  const [selectedType, setSelectedType] = useState<Entrada_tipo | undefined>(undefined)

  const ENTRADA_API = "/api/entradas";

  const onCloseReset = () => {
    setNewQtd(0);
    setValue(0);
    setSelectedFornecedor(undefined);
    setSelectedType(undefined);
    setOpenFornecedor(false);
  };

  const handleCreateEntrada = async () => {
    setIsSubmitting(true);

    try {
      if (!productId) {
        toast.error("Produto inválido.");
        return;
      }

      if (!newQtd || newQtd <= 0) {
        toast.error("Insira uma quantidade maior que zero para realizar a entrada");
        return;
      }

      if(!selectedType){
        toast.error("Selecione um tipo para a entrada")
        return;
      }

      // valor_unitario em entradaitens é NOT NULL.
      // Se você quiser permitir custo 0, remova essa validação.
      if (!value || value <= 0) {
        toast.error("Informe um valor unitário maior que zero.");
        return;
      }

      // Formato simples (compatível com a API ajustada):
      // cria 1 entrada (cabeçalho) + 1 entradaitens
      const payload = {
        fornecedorid: selectedFornecedor?.id ?? null,
        produtoid: productId,
        quantidade: newQtd,
        valor_unitario: value,
        tipo: selectedType,
        // opcional:
        // tipo: "COMPRA_FORNECEDOR",
        // fiscal: false,
        // notachave: null,
      };

      const response = await axios.post(ENTRADA_API, payload);

      if (response.status === 201) {
        toast.success("Sucesso!", {
          description: "Entrada realizada.",
          duration: 2000,
        });

        onCloseReset();
        setIsOpen?.(false);

        // Atualiza lista (se necessário)
        handleGetProducts?.(paginantion?.page, paginantion?.limit, search, status);
      }
    } catch (error) {
      if (isAxiosError(error)) {
        toast.error("Erro", {
          description: error.response?.data?.error ?? "Falha ao registrar entrada.",
          duration: 2000,
        });
      } else {
        toast.error("Erro inesperado ao registrar entrada.");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const fornecedorField = (
    <div className="space-y-2">
      <Label>Fornecedor</Label>
      <div className="flex min-w-0 items-center gap-2">
        <Button
          type="button"
          variant="outline"
          className="h-auto min-h-10 min-w-0 flex-1 justify-start px-3 py-2 text-left font-normal"
          onClick={() => setOpenFornecedor(true)}
        >
          {selectedFornecedor ? (
            <>
              <Building2 className="mr-2 h-4 w-4 shrink-0 text-primary" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {selectedFornecedor.nomerazaosocial}
                </span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  #{selectedFornecedor.id}
                  {selectedFornecedor.cpfcnpj ? ` · ${selectedFornecedor.cpfcnpj}` : ""}
                </span>
              </span>
            </>
          ) : (
            <>
              <Search className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="text-muted-foreground">Selecionar fornecedor</span>
            </>
          )}
        </Button>

        {selectedFornecedor ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-10 w-10 shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => setSelectedFornecedor(undefined)}
            aria-label="Remover fornecedor selecionado"
          >
            <X className="h-4 w-4" />
          </Button>
        ) : null}
      </div>
    </div>
  );

  if (isMobile) {
    return (
      <Drawer
        open={isOpen}
        onOpenChange={(nextOpen) => {
          setIsOpen?.(nextOpen);
          if (!nextOpen) onCloseReset();
        }}
      >
        <DrawerTrigger asChild>{children}</DrawerTrigger>
        <FornecedorSelect
          OnSelect={(fornecedor) => {
            setSelectedFornecedor(fornecedor);
            setOpenFornecedor(false);
          }}
          open={openFornecedor}
          setOpen={setOpenFornecedor}
        />
        <DrawerContent onDoubleClick={(e) => e.stopPropagation()}>
          <div className="mx-auto w-full max-w-sm">
            <DrawerHeader className="border-b px-4 py-3">
              <DrawerTitle>Entrada de produto</DrawerTitle>
              <DrawerDescription className="flex flex-col gap-1 text-sm">
                <span>{productDescription}</span>
                <span>Em estoque: {currentQuantity}</span>
              </DrawerDescription>
            </DrawerHeader>

            <div className="p-4 space-y-4 relative">
              <div className="space-y-2">
                <Label>Tipo:</Label>
                <Select value={selectedType} onValueChange={(v:Entrada_tipo)=> setSelectedType(v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione"></SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(Entrada_tipo).map((tipo)=>
                      <SelectItem key={tipo[1]} value={tipo[0]}>{tipo[1]}</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Quantidade:</Label>
                <Input className="w-24" type="numeric" value={newQtd} onChange={(e) => setNewQtd(Number(e.target.value))} />
              </div>

              <div className="space-y-2">
                <Label>Valor unitário:</Label>
                <ValueInput price={value} setPrice={setValue} />
              </div>

              {fornecedorField}
            </div>

            <DrawerFooter className="flex flex-row gap-2 items-center justify-center">
              <Button onClick={handleCreateEntrada} className="hover:cursor-pointer" disabled={isSubmitting}>
                {isSubmitting ? (
                  <>
                    <Loader2 className="animate-spin" /> Registrando...
                  </>
                ) : (
                  "Registrar Entrada"
                )}
              </Button>
              <DrawerClose asChild>
                <Button
                  disabled={isSubmitting}
                  className="hover:cursor-pointer"
                  variant="outline"
                  onClick={onCloseReset}
                >
                  Cancelar
                </Button>
              </DrawerClose>
            </DrawerFooter>
          </div>
        </DrawerContent>
      </Drawer>
    );
  } 

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(nextOpen) => {
        setIsOpen?.(nextOpen);
        if (!nextOpen) onCloseReset();
      }}
    >
      <DialogTrigger asChild>{children}</DialogTrigger>
      <FornecedorSelect
        OnSelect={(fornecedor) => {
          setSelectedFornecedor(fornecedor);
          setOpenFornecedor(false);
        }}
        open={openFornecedor}
        setOpen={setOpenFornecedor}
      />
      <DialogContent className="p-0 overflow-hidden h-[600px]" onDoubleClick={(e) => e.stopPropagation()}>
        <div className="flex h-full min-h-0 flex-col">
          <DialogHeader className="shrink-0 px-6 py-4 border-b-1">
            <DialogTitle>Entrada de produto</DialogTitle>
            <DialogDescription className="flex flex-row items-center justify-between">
              <span>{productDescription}</span>
              <span>Em estoque: {currentQuantity}</span>
            </DialogDescription>
          </DialogHeader>

          <div className="h-full min-h-0 overflow-auto dark:bg-muted-foreground/5 bg-muted px-6 py-10 space-y-2 relative">
            <div className="h-full min-h-0 rounded-md px-4 py-8 space-y-4 bg-card">
              <div className="space-y-2">
                <Label>Tipo:</Label>
                <Select value={selectedType} onValueChange={(v:Entrada_tipo)=> setSelectedType(v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione"></SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(Entrada_tipo).map((tipo)=>
                      <SelectItem key={tipo[1]} value={tipo[0]}>{tipo[1]}</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Quantidade:</Label>
                <Input className="w-24" type="numeric" value={newQtd} onChange={(e) => setNewQtd(Number(e.target.value))} />
              </div>

              <div className="space-y-2">
                <Label>Valor unitário:</Label>
                <ValueInput price={value} setPrice={setValue} />
              </div>

              {fornecedorField}
            </div>
          </div>

          <DialogFooter className="px-6 py-4">
            <div className="flex sm:flex-row gap-3 sm:gap-4">
              <Button onClick={handleCreateEntrada} className="hover:cursor-pointer" disabled={isSubmitting}>
                {isSubmitting ? (
                  <>
                    <Loader2 className="animate-spin" /> Registrando...
                  </>
                ) : (
                  "Registrar Entrada"
                )}
              </Button>

              <DialogClose asChild>
                <Button
                  disabled={isSubmitting}
                  className="hover:cursor-pointer"
                  variant="outline"
                  onClick={onCloseReset}
                >
                  Cancelar
                </Button>
              </DialogClose>
            </div>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
