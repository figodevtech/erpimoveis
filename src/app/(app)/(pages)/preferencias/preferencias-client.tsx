"use client";

import { LockKeyhole, RadioTower, SlidersHorizontal } from "lucide-react";

import { useUserPreferences } from "@/app/(app)/components/user-preferences-provider";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/lib/toast";

export function PreferenciasClient() {
  const { radio, loading, savingRadio, setRadioEnabled } = useUserPreferences();

  async function handleRadioChange(enabled: boolean) {
    try {
      await setRadioEnabled(enabled);
      toast.success(enabled ? "Player de rádio ativado." : "Player de rádio desativado.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível salvar sua preferência.");
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 pb-10">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl border bg-card text-primary shadow-sm">
          <SlidersHorizontal className="size-5" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">Preferências</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Personalize como os recursos do sistema aparecem para você.
          </p>
        </div>
      </div>

      <section aria-labelledby="preferencias-reproducao" className="space-y-3">
        <div>
          <h2 id="preferencias-reproducao" className="text-sm font-medium">
            Reprodução e mídia
          </h2>
          <p className="text-xs text-muted-foreground">
            Estes ajustes são pessoais e não alteram as configurações dos demais usuários.
          </p>
        </div>

        <Card className="relative overflow-hidden py-0">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 left-0 w-1 bg-primary"
          />
          <CardHeader className="border-b bg-muted/25 px-5 py-5 sm:px-6">
            <div className="flex items-start gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary ring-1 ring-primary/15">
                <RadioTower className="size-5" aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1">
                <CardTitle className="text-base">Player de rádio</CardTitle>
                <CardDescription className="mt-1 leading-relaxed">
                  Exiba o player no cabeçalho do sistema e o acesso compacto no celular.
                </CardDescription>
              </div>
              {loading ? (
                <Skeleton className="mt-1 h-5 w-8 rounded-full" />
              ) : (
                <Switch
                  aria-label="Exibir player de rádio"
                  checked={radio.enabled && radio.permitted}
                  disabled={!radio.permitted || savingRadio}
                  onCheckedChange={(checked) => void handleRadioChange(checked)}
                  className="mt-1"
                />
              )}
            </div>
          </CardHeader>

          <CardContent className="px-5 py-4 sm:px-6">
            {loading ? (
              <div className="space-y-2">
                <Skeleton className="h-4 w-44" />
                <Skeleton className="h-3 w-full max-w-md" />
              </div>
            ) : radio.permitted ? (
              <div className="flex items-start gap-2.5 text-sm">
                <span
                  aria-hidden="true"
                  className={`mt-1.5 size-2 shrink-0 rounded-full ${
                    radio.enabled ? "bg-emerald-500 shadow-[0_0_0_3px_rgb(16_185_129/0.12)]" : "bg-muted-foreground/40"
                  }`}
                />
                <div>
                  <p className="font-medium">
                    {radio.enabled ? "Player visível" : "Player oculto"}
                  </p>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                    {radio.enabled
                      ? "Você pode ouvir e controlar suas estações no topo da tela."
                      : "Sua escolha foi mantida e o rádio não será exibido neste acesso."}
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-2.5 rounded-lg border border-dashed bg-muted/30 p-3 text-sm">
                <LockKeyhole className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <div>
                  <p className="font-medium">Recurso não liberado</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                    Um administrador precisa conceder a permissão de rádio ao seu perfil antes que você possa ativar este ajuste.
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
