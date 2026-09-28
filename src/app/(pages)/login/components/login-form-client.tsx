"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { toast } from "@/lib/toast";
import { getLoginFeedback, type LoginFeedback } from "@/lib/login-feedback";
import ForgotPasswordDialog from "./forgot-password-dialog";
import { TurnstileWidget } from "./turnstile-widget";

const LOGIN_TOAST_ID = "login-feedback";

function showLoginFeedback(feedback: LoginFeedback) {
  const options = { id: LOGIN_TOAST_ID, description: feedback.description };

  if (feedback.tone === "info") {
    toast.info(feedback.title, options);
    return;
  }

  if (feedback.tone === "warning") {
    toast.warning(feedback.title, options);
    return;
  }

  toast.error(feedback.title, options);
}

export function LoginFormClient({ turnstileSiteKey }: { turnstileSiteKey: string | null }) {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaResetKey, setCaptchaResetKey] = useState(0);

  const [forgotOpen, setForgotOpen] = useState(false);

  const router = useRouter();
  const handleCaptchaToken = useCallback((token: string) => setCaptchaToken(token), []);
  const resetCaptcha = () => {
    setCaptchaToken("");
    setCaptchaResetKey((current) => current + 1);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!identifier.trim() || !password.trim()) {
      showLoginFeedback(getLoginFeedback("MISSING_CREDENTIALS"));
      return;
    }

    if (turnstileSiteKey && !captchaToken) {
      showLoginFeedback({
        tone: "info",
        title: "Conclua a verificação de segurança",
        description: "Confirme a verificação abaixo antes de entrar.",
      });
      return;
    }

    setLoading(true);

    try {
      const res = await signIn("credentials", {
        identifier,
        password,
        captchaToken,
        redirect: false,
      });

      if (res?.error) {
        resetCaptcha();
        showLoginFeedback(getLoginFeedback(res.code ?? res.error));
        return;
      }

      toast.success("Acesso autorizado", {
        id: LOGIN_TOAST_ID,
        description: "Carregando o sistema…",
      });
      router.replace("/");
      router.refresh();
    } catch {
      resetCaptcha();
      showLoginFeedback({
        tone: "error",
        title: "Não foi possível conectar ao login",
        description: "Verifique sua conexão e tente novamente.",
      });
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

          <div className="relative">
            <Input
              id="password"
              type={showPassword ? "text" : "password"}
              placeholder="Senha"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              className="pr-10"
            />
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground absolute inset-y-0 right-0 flex w-10 items-center justify-center transition-colors"
              onClick={() => setShowPassword((visible) => !visible)}
              aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
              aria-pressed={showPassword}
              title={showPassword ? "Ocultar senha" : "Mostrar senha"}
            >
              {showPassword ? (
                <EyeOff className="size-4" aria-hidden="true" />
              ) : (
                <Eye className="size-4" aria-hidden="true" />
              )}
            </button>
          </div>
        </div>

        {turnstileSiteKey ? (
          <TurnstileWidget
            siteKey={turnstileSiteKey}
            resetKey={captchaResetKey}
            onTokenChange={handleCaptchaToken}
          />
        ) : null}

        <Button
          type="submit"
          className="w-full"
          disabled={loading || Boolean(turnstileSiteKey && !captchaToken)}
        >
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
