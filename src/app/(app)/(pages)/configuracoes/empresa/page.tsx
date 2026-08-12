"use client";

import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { Building2, Loader2, Save } from "lucide-react";

import { Button } from "@/components/ui/button";
import { toast } from "@/lib/toast";

import { EmpresaForm } from "./components/empresa-form";
import { EMPRESA_DEFAULTS, empresaDoServidor, type EmpresaFormValues } from "./types";

const limparDigitos = (s: string) => (s || "").replace(/\D+/g, "");

export default function ConfigEmpresaPage() {
  const [salvando, setSalvando] = useState(false);
  const [carregando, setCarregando] = useState(true);

  const { register, handleSubmit, setValue, watch, reset } = useForm<EmpresaFormValues>({
    defaultValues: { empresa: EMPRESA_DEFAULTS },
  });

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const r = await fetch("/api/config/empresa", { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j?.empresa) reset({ empresa: empresaDoServidor(j.empresa) });
    } catch (e) {
      console.warn(e);
    } finally {
      setCarregando(false);
    }
  }, [reset]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function onSalvar(values: EmpresaFormValues) {
    const empresa = { ...values.empresa };
    empresa.cnpj = limparDigitos(empresa.cnpj);
    empresa.codigomunicipio = limparDigitos(empresa.codigomunicipio);
    if (empresa.inscricaoestadual) empresa.inscricaoestadual = limparDigitos(empresa.inscricaoestadual);
    if (empresa.inscricaomunicipal) empresa.inscricaomunicipal = limparDigitos(empresa.inscricaomunicipal);
    if (empresa.inscricaoestadualst) empresa.inscricaoestadualst = limparDigitos(empresa.inscricaoestadualst);
    if (empresa.cep) empresa.cep = limparDigitos(empresa.cep);
    if (empresa.telefone) empresa.telefone = limparDigitos(empresa.telefone);
    if (empresa.codigopais) empresa.codigopais = limparDigitos(empresa.codigopais);

    const erros: string[] = [];
    if (empresa.cnpj.length < 14) erros.push("CNPJ invalido.");
    if (!empresa.razaosocial?.trim()) erros.push("Razao social obrigatoria.");
    if (!empresa.endereco?.trim()) erros.push("Endereco obrigatorio.");
    if (!empresa.numero?.trim()) erros.push("Numero do endereco obrigatorio.");
    if (empresa.codigomunicipio.length !== 7) erros.push("Codigo do Municipio (IBGE) deve ter 7 digitos.");
    if (!empresa.regimetributario?.trim()) erros.push("Regime tributario obrigatorio.");
    if (erros.length) {
      toast.error(erros[0]);
      return;
    }

    // Contador de consulta de placa é do sistema, não do cadastro: mandar de
    // volta o que a tela leu zeraria o consumo do mês a cada salvamento.
    const payload: Record<string, unknown> = { ...empresa };
    delete payload.placa_consulta_limite_mensal;
    delete payload.placa_consulta_qtd_mes;
    delete payload.placa_consulta_mes;

    setSalvando(true);
    try {
      const r = await fetch("/api/config/empresa", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ empresa: payload }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error || "Falha ao salvar Empresa");

      toast.success("Dados da empresa salvos!");
      await carregar();
    } catch (e: any) {
      toast.error(e?.message || "Erro ao salvar");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="container mx-auto max-w-7xl space-y-6 px-4 py-1 animate-in fade-in duration-500 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-4 rounded-lg border bg-card px-5 py-4 shadow-sm md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight">
            <Building2 className="h-8 w-8 text-primary" />
            Empresa
          </h1>
          <p className="text-muted-foreground">
            Identificacao, endereco, regime tributario e certificado digital do emitente.
          </p>
        </div>
        <Button
          onClick={handleSubmit(onSalvar)}
          disabled={salvando || carregando}
          className="shadow-md transition-all hover:shadow-lg"
          aria-label="Salvar alterações"
          title="Salvar alterações"
        >
          {salvando || carregando ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {carregando ? "Carregando..." : "Salvando..."}
            </>
          ) : (
            <>
              <Save className="mr-2 h-4 w-4" />
              Salvar Alterações
            </>
          )}
        </Button>
      </div>

      <main className="w-full">
        <EmpresaForm register={register} setValue={setValue} watch={watch} />
      </main>
    </div>
  );
}
