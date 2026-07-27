// ProductDialog.tsx
"use client";

import type React from "react";
import { Dialog, DialogTrigger } from "@/components/ui/dialog";
import { Drawer, DrawerTrigger } from "@/components/ui/drawer";
import { useMediaQuery } from "@/hooks/use-media-query";
import CadastroProduto from "./cadastro-produto";
import EdicaoProduto from "./edicao-produto";
import { ReactNode, useState } from "react";
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
  grupo_produto_id: 1,
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
}: DialogProdutoProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = isOpen ?? internalOpen;
  const setOpen = setIsOpen ?? setInternalOpen;

  const [, setSelectedProduct] = useState<Produto | undefined>(undefined);
  const [newProduct, setNewProduct] = useState<Produto>(initialNewProduct);

  const isDesktop = useMediaQuery("(min-width: 768px)");
  const config = useConfig();

  if (isDesktop || !config?.habilitar_drawers) {
    return (
      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);

          if (newProductData && nextOpen) {
            setNewProduct({ ...newProductData });
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
            isDesktop={true}
          />
        ) : (
          <CadastroProduto
            onAfterSaveProduct={onAfterSaveProduct}
            handleSearchFornecedor={handleSearchFornecedor}
            setSelectedProductId={setSelectedProductId}
            newProduct={newProduct}
            setNewProduct={setNewProduct}
            isDesktop={true}
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
          setNewProduct({ ...newProductData });
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
        />
      ) : (
        <CadastroProduto
          onAfterSaveProduct={onAfterSaveProduct}
          handleSearchFornecedor={handleSearchFornecedor}
          setSelectedProductId={setSelectedProductId}
          newProduct={newProduct}
          setNewProduct={setNewProduct}
          isDesktop={false}
        />
      )}
    </Drawer>
  );
}
