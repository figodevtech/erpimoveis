export type LoginFeedbackTone = "info" | "warning" | "error";

export type LoginFeedback = {
  tone: LoginFeedbackTone;
  title: string;
  description: string;
};

const INVALID_CREDENTIALS: LoginFeedback = {
  tone: "error",
  title: "Não foi possível entrar",
  description: "Confira o usuário/e-mail e a senha informados.",
};

export function getLoginFeedback(code: string | null | undefined): LoginFeedback {
  switch (code) {
    case "MISSING_CREDENTIALS":
      return {
        tone: "info",
        title: "Preencha os dados de acesso",
        description: "Informe o usuário/e-mail e a senha para continuar.",
      };

    case "LOGIN_RATE_LIMITED":
      return {
        tone: "warning",
        title: "Acesso temporariamente limitado",
        description: "Houve muitas tentativas. Aguarde alguns minutos antes de tentar novamente.",
      };

    case "CAPTCHA_FAILED":
      return {
        tone: "info",
        title: "Verificação de segurança expirada",
        description: "Conclua a nova verificação e tente entrar novamente.",
      };

    case "LOGIN_INTERNAL_ERROR":
    case "Configuration":
      return {
        tone: "error",
        title: "Serviço de login indisponível",
        description: "Não foi possível validar o acesso agora. Tente novamente em alguns instantes.",
      };

    case "CredentialsSignin":
    case "credentials":
    case "INVALID_CREDENTIALS":
      return INVALID_CREDENTIALS;

    default:
      return {
        tone: "error",
        title: "Não foi possível concluir o login",
        description: "Tente novamente. Se o problema continuar, procure o suporte.",
      };
  }
}
