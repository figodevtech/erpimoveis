"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "@/lib/toast";
import ForgotPasswordDialog from "./forgot-password-dialog";

export function LoginFormClient() {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const [forgotOpen, setForgotOpen] = useState(false);

  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!identifier.trim() || !password.trim()) {
      toast.error("Por favor, preencha usuário/e-mail e senha.");
      return;
    }

    setLoading(true);

    try {
      const res = await signIn("credentials", {
        identifier,
        password,
        redirect: false,
      });

      if (res?.error) {
        switch (res.error) {
          case "CredentialsSignin":
          case "INVALID_CREDENTIALS":
            toast.error("Usuário/e-mail ou senha inválidos.");
            break;

          case "MISSING_CREDENTIALS":
          case "Por favor, forneça e-mail e senha.":
            toast.error("Por favor, preencha usuário/e-mail e senha.");
            break;

          case "LOGIN_RATE_LIMITED":
            toast.error("Muitas tentativas. Aguarde alguns minutos e tente novamente.");
            break;

          case "LOGIN_INTERNAL_ERROR":
            toast.error("Ocorreu um erro ao tentar fazer login. Tente novamente.");
            break;

          default:
            toast.error("Usuário/e-mail ou senha inválidos.");
            break;
        }
        return;
      }

      toast.success("Login efetuado!");
      router.replace("/");
      router.refresh();
    } catch (e: any) {
      toast.error(e?.message || "Falha de login.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form className="p-6 md:p-8" onSubmit={handleSubmit}>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col items-center text-center">
          <h1 className="text-2xl font-bold">Bem-vindo de volta</h1>
          <p className="text-muted-foreground text-balance">Conectar ao ERP</p>
        </div>

        <div className="grid gap-3">
          <Label htmlFor="identifier">Usuário ou e-mail</Label>
          <Input
            id="identifier"
            type="text"
            placeholder="Nome de usuário ou e-mail"
            required
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            autoComplete="username"
          />
        </div>

        <div className="grid gap-3">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Senha</Label>
          </div>

          <Input
            id="password"
            type="password"
            placeholder="Senha"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </div>

        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? "Entrando..." : "Entrar"}
        </Button>

        <button
          type="button"
          className="text-xs underline underline-offset-4 text-muted-foreground hover:text-primary"
          onClick={() => setForgotOpen(true)}
        >
          Esqueci minha senha
        </button>
      </div>

      <ForgotPasswordDialog open={forgotOpen} onOpenChange={setForgotOpen} />
    </form>
  );
}
