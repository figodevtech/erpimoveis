// src/app/(page)/recuperar-senha/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { toast } from "@/lib/toast";
import { supabase } from "@/lib/supabase";
import { Loader2, Check, ShieldCheck } from "lucide-react";

/** Regras simples de força de senha (0-4) */
function scorePassword(pwd: string) {
  const len = pwd.length;
  let lengthPts = 0;
  if (len >= 15) lengthPts = 3;
  else if (len >= 11) lengthPts = 2;
  else if (len >= 8) lengthPts = 1;

  let variety = 0;
  if (/[a-z]/.test(pwd)) variety += 1;
  if (/[A-Z]/.test(pwd)) variety += 1;
  if (/\d/.test(pwd)) variety += 1;
  if (/[^A-Za-z0-9]/.test(pwd)) variety += 1;

  // de 0 a 4
  const score = Math.max(0, Math.min(4, lengthPts + Math.max(0, variety - 1)));
  return score;
}

function scoreToLabel(score: number) {
  switch (score) {
    case 0:
    case 1:
      return { label: "Fraca", className: "text-red-600", bar: "bg-red-600" };
    case 2:
      return { label: "Média", className: "text-amber-600", bar: "bg-amber-500" };
    case 3:
      return { label: "Boa", className: "text-emerald-600", bar: "bg-emerald-600" };
    case 4:
    default:
      return { label: "Forte", className: "text-emerald-700", bar: "bg-emerald-700" };
  }
}

export default function RecuperarSenhaPage() {
  const [pwd, setPwd] = useState("");
  const [pwd2, setPwd2] = useState("");
  const [working, setWorking] = useState(false);
  const [ready, setReady] = useState(false);
  const router = useRouter();

  // Habilita sessão a partir do link do e-mail (?code=...) ou hash (fallback)
  useEffect(() => {
    (async () => {
      try {
        const url = new URL(window.location.href);
        const code = url.searchParams.get("code");
        if (code) {
          // Novo fluxo
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
          url.searchParams.delete("code");
          url.searchParams.delete("type");
          window.history.replaceState({}, "", url.toString());
          setReady(true);
          return;
        }

        // Fallback links antigos: #access_token & #refresh_token
        const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
        const at = hash.get("access_token");
        const rt = hash.get("refresh_token");
        if (at && rt) {
          const { error } = await supabase.auth.setSession({
            access_token: at,
            refresh_token: rt,
          });
          if (error) throw error;
          window.history.replaceState({}, "", window.location.pathname + window.location.search);
          setReady(true);
          return;
        }

        // Se já houver sessão
        const { data } = await supabase.auth.getSession();
        if (data.session) setReady(true);
      } catch (e: any) {
        toast.error(e?.message || "Não foi possível iniciar a recuperação. Abra o link do e-mail novamente.");
      }
    })();

    const sub = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "PASSWORD_RECOVERY") {
        setReady(true);
      }
    }).data?.subscription;

    return () => sub?.unsubscribe();
  }, []);

  const s = useMemo(() => scorePassword(pwd), [pwd]);
  const info = useMemo(() => scoreToLabel(s), [s]);

  const atualizar = async () => {
    if (!ready) {
      toast.error("Sessão de recuperação não ativa. Abra o link do e-mail novamente.");
      return;
    }
    if (!pwd.trim() || !pwd2.trim()) return toast.error("Preencha a nova senha e a confirmação.");
    if (pwd !== pwd2) return toast.error("As senhas não conferem.");
    if (pwd.length < 8) return toast.error("A senha deve ter pelo menos 8 caracteres.");
    if (s <= 1) {
      toast.error("Senha muito fraca. Use letras maiúsculas/minúsculas, números e símbolos.");
      return;
    }

    setWorking(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: pwd });
      if (error) throw error;
      await supabase.auth.signOut({ scope: "local" });
      // Sucesso → vai para tela de sucesso
      router.push("/recuperar-senha/sucesso");
    } catch (e: any) {
      const msg = (e?.message || "").toLowerCase();
      if (msg.includes("auth session missing")) {
        toast.error("Sessão ausente. Abra o link do e-mail de recuperação novamente.");
      } else if (msg.includes("password should")) {
        toast.error("A senha não atende aos requisitos definidos.");
      } else {
        toast.error(e?.message || "Não foi possível atualizar a senha.");
      }
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="min-h-[100svh] grid place-items-center p-4">
      <Card className="w-full max-w-md border-border">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            <CardTitle>Definir nova senha</CardTitle>
          </div>
          <CardDescription>
            Crie uma senha forte para proteger sua conta.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {!ready && (
            <div className="text-xs text-muted-foreground">
              Preparando a sessão de recuperação… Se não habilitar em alguns segundos, reabra o link do e-mail.
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="pwd">Nova senha</Label>
            <Input
              id="pwd"
              type="password"
              placeholder="••••••••"
              value={pwd}
              onChange={(e) => setPwd(e.target.value)}
              disabled={working}
            />

            {/* Indicador de força */}
            <div className="mt-2 space-y-1.5">
              <div className="flex gap-1">
                {[0, 1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className={`h-1.5 w-full rounded ${
                      s > i ? info.bar : "bg-muted"
                    } transition-colors`}
                  />
                ))}
              </div>
              <div className={`text-xs font-medium ${info.className}`}>Força: {info.label}</div>
              <ul className="text-xs text-muted-foreground list-disc pl-4 space-y-0.5">
                <li>Mínimo de 8 caracteres</li>
                <li>Combine maiúsculas, minúsculas, números e símbolos</li>
              </ul>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="pwd2">Confirmar senha</Label>
            <Input
              id="pwd2"
              type="password"
              placeholder="••••••••"
              value={pwd2}
              onChange={(e) => setPwd2(e.target.value)}
              disabled={working}
            />
          </div>

          <Button onClick={atualizar} className="w-full" disabled={working || !ready}>
            {working ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Atualizando…
              </>
            ) : (
              <>
                <Check className="h-4 w-4 mr-2" />
                Atualizar senha
              </>
            )}
          </Button>

          <div className="text-center text-xs text-muted-foreground">
            Problemas com o link? Refaça o processo em <span className="underline">“Esqueci minha senha”</span>.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
