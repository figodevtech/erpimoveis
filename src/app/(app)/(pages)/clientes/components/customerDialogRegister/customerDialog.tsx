"use client";

import { type ReactNode, useState } from "react";
import { Dialog, DialogTrigger } from "@/components/ui/dialog";
import dynamic from "next/dynamic";
import { MountOnDemand } from "@/components/mount-on-demand";

function FormLoading() {
  return <p role="status" className="fixed bottom-4 right-4 z-50 rounded-md border bg-background p-3 text-sm shadow">Carregando formulario...</p>;
}
const EditContent = dynamic(() => import("./editContent"), { loading: FormLoading });
const RegisterContent = dynamic(() => import("./registerContent"), { loading: FormLoading });
import { Customer } from "../../types";
import { NewCustomer } from "./types";
import { useMediaQuery } from "@/hooks/use-media-query";
import { Drawer, DrawerTrigger } from "@/components/ui/drawer";
import { useConfig } from "../../../config-context";

interface CustomerDialogProps {
  customerId?: number;
  children?: ReactNode;
  isOpen?: boolean;
  setIsOpen?: (value: boolean) => void;
  setSelectedCustomerId?: (value: number | undefined) => void;
  onRegister?: (c: Customer) => void;
  onUpdate?: (c: Customer) => void;
}

export function CustomerDialog({
  customerId,
  children,
  isOpen,
  setIsOpen,
  setSelectedCustomerId,
  onRegister,
  onUpdate,
}: CustomerDialogProps) {
  // estado interno caso o componente não seja controlado por props
  const [internalOpen, setInternalOpen] = useState(false);
  const open = isOpen ?? internalOpen;
  const setOpen = setIsOpen ?? setInternalOpen;

  const [newCustomer, setNewCustomer] = useState<NewCustomer>({
    tipopessoa: "FISICA",
    bairro: "",
    cpfcnpj: "",
    nomerazaosocial: "",
    email: "",
    telefone: "",
    endereco: "",
    enderecocomplemento: "",
    endereconumero: "",
    cidade: "",
    estado: "",
    cep: "",
    inscricaoestadual: "",
    inscricaomunicipal: "",
    codigomunicipio: "",
    status: "ATIVO",
    foto: "",
  });

  const isDesktop = useMediaQuery("(min-width: 768px)");
  const config = useConfig();

  if (isDesktop || !config?.habilitar_drawers) {
    return (
      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          // sempre sincroniza o estado (controlado ou interno)
          setOpen(nextOpen);

          if (!nextOpen) {
            setSelectedCustomerId?.(undefined);
            setNewCustomer({
              tipopessoa: "FISICA",
              cpfcnpj: "",
              nomerazaosocial: "",
              email: "",
              bairro: "",
              telefone: "",
              endereco: "",
              enderecocomplemento: "",
              endereconumero: "",
              cidade: "",
              estado: "",
              cep: "",
              inscricaoestadual: "",
              inscricaomunicipal: "",
              codigomunicipio: "",
              status: "ATIVO",
              foto: "",
            });
          }
        }}
      >
        <DialogTrigger autoFocus={false} asChild>
          {children}
        </DialogTrigger>

        <MountOnDemand active={open}>
          {customerId ? (
            <EditContent customerId={customerId} onUpdate={onUpdate} />
          ) : (
            <RegisterContent
              setSelectedCustomerId={setSelectedCustomerId}
              newCustomer={newCustomer}
              setNewCustomer={setNewCustomer}
              onRegister={onRegister}
            />
          )}
        </MountOnDemand>
      </Dialog>
    );
  }

  return (
    <Drawer
      open={open}
      onOpenChange={(nextOpen) => {
        // sempre sincroniza o estado (controlado ou interno)
        setOpen(nextOpen);

        if (!nextOpen) {
          setSelectedCustomerId?.(undefined);
          setNewCustomer({
            tipopessoa: "FISICA",
            cpfcnpj: "",
            nomerazaosocial: "",
            email: "",
            bairro: "",
            telefone: "",
            endereco: "",
            enderecocomplemento: "",
            endereconumero: "",
            cidade: "",
            estado: "",
            cep: "",
            inscricaoestadual: "",
            inscricaomunicipal: "",
            codigomunicipio: "",
            status: "ATIVO",
            foto: "",
          });
        }
      }}
    >
      <DrawerTrigger autoFocus={false} asChild>
        {children}
      </DrawerTrigger>

      <MountOnDemand active={open}>
        {customerId ? (
          <EditContent isDesktop={isDesktop} customerId={customerId} onUpdate={onUpdate} />
        ) : (
          <RegisterContent
            isDesktop={isDesktop}
            setSelectedCustomerId={setSelectedCustomerId}
            newCustomer={newCustomer}
            setNewCustomer={setNewCustomer}
            onRegister={onRegister}
          />
        )}
      </MountOnDemand>
    </Drawer>
  );
}
