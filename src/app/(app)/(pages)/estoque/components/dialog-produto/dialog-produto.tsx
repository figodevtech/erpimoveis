// ProductDialog.tsx
"use client";

import type React from "react";
import { Dialog, DialogTrigger } from "@/components/ui/dialog";
import { Drawer, DrawerTrigger } from "@/components/ui/drawer";
import { useMediaQuery } from "@/hooks/use-media-query";
import CadastroProduto from "./cadastro-produto";
import EdicaoProduto from "./edicao-produto";
import { ReactNode, useEffect, useRef, useState } from "react";
import { toast } from "@/lib/toast";
import { Estoque_status, Produto, Unidade_medida } from "../../types";
import { useConfig } from "../../../config-context";


interface DialogProdutoProps {
  productId?: number | undefined;
  children?: ReactNode;
  isOpen?: boolean;
  setIsOpen?: (value: boolean) => void;
  setSelectedProductId?: (value: number | undefined) => void;
  newProductData?: Produto | undefined;
  handleSearchFornecedor?: () => void;
  onAfterSaveProduct?: () => void;
  initialTab?: string;
}

const initialNewProduct: Produto = {
  id: 0,
  precovenda: 0,
  estoque: 0,
  estoqueminimo: 0,
  exibirPdv: true,
  status_estoque: Estoque_status.OK,
  unidade: Unidade_medida.UN,
  fornecedor: "DESCONHECIDO",
};

export function DialogProduto({
  productId,
  children,
  isOpen,
  setIsOpen,
  setSelectedProductId,
  newProductData,
  handleSearchFornecedor,
  onAfterSaveProduct,
  initialTab,
}: DialogProdutoProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = isOpen ?? internalOpen;
  const setOpen = setIsOpen ?? setInternalOpen;
  const atualizacaoPendente = useRef(false);

  // Cadastros em sequencia nao precisam recarregar a tabela oculta a cada POST.
  // Atualiza uma unica vez ao fechar, inclusive quando o pai controla o dialog.
  useEffect(() => {
    if (open || !atualizacaoPendente.current) return;
    atualizacaoPendente.current = false;
    Promise.resolve().then(() => onAfterSaveProduct?.()).catch(() => {
      toast.error("Produto salvo; não foi possível atualizar a listagem.");
    });
  }, [open, onAfterSaveProduct]);

  const handleAfterCreate = (registerAgain?: boolean) => {
    if (registerAgain && open) {
      atualizacaoPendente.current = true;
      return;
    }
    atualizacaoPendente.current = false;
    return onAfterSaveProduct?.();
  };

  const [, setSelectedProduct] = useState<Produto | undefined>(undefined);
  const [newProduct, setNewProduct] = useState<Produto>(() => ({
    ...initialNewProduct,
    ...newProductData,
  }));

  const isDesktop = useMediaQuery("(min-width: 768px)");
  const config = useConfig();

  if (isDesktop || !config?.habilitar_drawers) {
    return (
      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);

          if (newProductData && nextOpen) {
            setNewProduct({ ...initialNewProduct, ...newProductData });
          }

          if (!nextOpen) {
            setSelectedProductId?.(undefined);
            setSelectedProduct(undefined);
            setNewProduct(initialNewProduct);
          }
        }}
      >
        {children ? (
          <DialogTrigger autoFocus={false} asChild>
            {children}
          </DialogTrigger>
        ) : null}

        {productId ? (
          <EdicaoProduto
            key={productId}
            productId={productId}
            onAfterSaveProduct={onAfterSaveProduct}
            isDesktop={isDesktop}
            isDrawer={false}
            initialTab={initialTab}
          />
        ) : (
          <CadastroProduto
            onAfterSaveProduct={handleAfterCreate}
            handleSearchFornecedor={handleSearchFornecedor}
            setSelectedProductId={setSelectedProductId}
            newProduct={newProduct}
            setNewProduct={setNewProduct}
            isDesktop={isDesktop}
            isDrawer={false}
          />
        )}
      </Dialog>
    );
  }


  return (
    <Drawer
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);

        if (newProductData && nextOpen) {
          setNewProduct({ ...initialNewProduct, ...newProductData });
        }

        if (!nextOpen) {
          setSelectedProductId?.(undefined);
          setSelectedProduct(undefined);
          setNewProduct(initialNewProduct);
        }
      }}
    >
      {children ? (
        <DrawerTrigger autoFocus={false} asChild>
          {children}
        </DrawerTrigger>
      ) : null}

      {productId ? (
        <EdicaoProduto
          key={productId}
          productId={productId}
          onAfterSaveProduct={onAfterSaveProduct}
          isDesktop={false}
          isDrawer
          initialTab={initialTab}
        />
      ) : (
        <CadastroProduto
          onAfterSaveProduct={handleAfterCreate}
          handleSearchFornecedor={handleSearchFornecedor}
          setSelectedProductId={setSelectedProductId}
          newProduct={newProduct}
          setNewProduct={setNewProduct}
          isDesktop={false}
          isDrawer
        />
      )}
    </Drawer>
  );
}
