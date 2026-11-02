"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, RemoteState, StatusBadge, requestJson, useRemote } from "./shared";
import { type Entity, endpoint } from "./model";
import { cn } from "@/lib/utils";
import {
  AlertCircle,
  AtSign,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Link2,
  Loader2,
  Lock,
  LockOpen,
  Mail,
  Send,
  ShieldCheck,
  Sparkles,
  UserX,
} from "lucide-react";

type AccessAccount = {
  user_id: string;
  email: string;
  status: "PENDENTE" | "ATIVO" | "BLOQUEADO";
  motivo_pendencia: string | null;
  created_at: string;
  updated_at: string;
  email_confirmed_at: string | null;
  last_sign_in_at: string | null;
  invited_at: string | null;
  recovery_sent_at: string | null;
  login_encontrado: boolean;
};

type AccessState = {
  item: AccessAccount | null;
  portalUrl: string;
  link?: string;
  aviso?: string;
  inviteSent?: boolean;
};

const STATUS_HINT: Record<string, string> = {
  SEM_ACESSO: "O proprietário ainda não tem login no portal.",
  PENDENTE: "Login criado, aguardando o primeiro acesso do proprietário.",
  ATIVO: "O proprietário já entrou no portal e está com o acesso liberado.",
  BLOQUEADO: "O login existe, mas o portal recusa a entrada até o desbloqueio.",
};

const MOTIVO_LABEL: Record<string, string> = {
  CONVITE_ENVIADO: "Convite enviado por e-mail; o proprietário ainda não definiu a senha.",
  SENHA_DEFINIDA_PELO_ERP: "Senha definida pelo ERP; aguardando o primeiro acesso.",
  BLOQUEADO_PELO_ERP: "Bloqueado pela equipe no ERP.",
  REVOGADO_PELO_ERP: "Revogado; o login foi mantido por ter registros vinculados.",
};

function dateTime(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

/** Senha forte e legível para ditar ou colar: sem 0/O, 1/l/I. */
function generatePassword(length = 12) {
  const groups = ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnpqrstuvwxyz", "23456789", "!@#$%*?"];
  const all = groups.join("");
  const random = (max: number) => crypto.getRandomValues(new Uint32Array(1))[0] % max;
  const chars = groups.map((group) => group[random(group.length)]);
  while (chars.length < length) chars.push(all[random(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = random(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

async function copy(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} copiado.`);
  } catch {
    toast.error("Não foi possível copiar. Selecione o texto e copie manualmente.");
  }
}

function PasswordField({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative w-full max-w-xs">
        <Input
          type={visible ? "text" : "password"}
          autoComplete="new-password"
          minLength={8}
          maxLength={128}
          placeholder="Mínimo de 8 caracteres"
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          className="h-11 sm:h-10 pr-10 font-mono text-base sm:text-sm"
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2 hover:cursor-pointer"
          onClick={() => setVisible((current) => !current)}
          aria-label={visible ? "Ocultar senha" : "Mostrar senha"}
          title={visible ? "Ocultar senha" : "Mostrar senha"}
        >
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </Button>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => {
          onChange(generatePassword());
          setVisible(true);
        }}
        className="h-10 sm:h-9 text-xs gap-1.5 hover:cursor-pointer"
      >
        <Sparkles className="h-3.5 w-3.5" />
        <span>Gerar senha</span>
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={!value}
        onClick={() => copy(value, "Senha")}
        className="h-10 sm:h-9 text-xs gap-1.5 hover:cursor-pointer"
      >
        <Copy className="h-3.5 w-3.5" />
        <span>Copiar</span>
      </Button>
    </div>
  );
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="space-y-0.5 min-w-0">
      <dt className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className="text-sm text-foreground break-all">{value}</dd>
    </div>
  );
}

export function PortalAccessPanel({
  item,
  onSaved,
}: {
  item: Entity;
  onSaved: () => void;
}) {
  const remote = useRemote<AccessState>(`${endpoint("proprietarios", item.id)}/acesso`);
  const [state, setState] = useState<AccessState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [link, setLink] = useState("");

  const [createEmail, setCreateEmail] = useState(String(item.email ?? ""));
  const [createMode, setCreateMode] = useState<"CONVITE" | "SENHA">("CONVITE");
  const [createPassword, setCreatePassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newEmail, setNewEmail] = useState("");

  const current = state ?? remote.data;
  const account = current?.item ?? null;
  const status = account?.status ?? "SEM_ACESSO";
  const ownerActive = item.ativo !== false;

  const run = async (acao: string, payload: Record<string, unknown>, success: string) => {
    setBusy(acao);
    setError("");
    try {
      const response: AccessState = await requestJson(`${endpoint("proprietarios", item.id)}/acesso`, {
        method: "POST",
        body: JSON.stringify({ acao, ...payload }),
      });
      setState(response);
      if (response.aviso) toast.warning(response.aviso);
      else toast.success(success);
      onSaved();
      return response;
    } catch (error) {
      setError((error as Error).message);
      return null;
    } finally {
      setBusy(null);
    }
  };

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    const response = await run(
      "CRIAR",
      { email: createEmail, modo: createMode, senha: createMode === "SENHA" ? createPassword : undefined },
      createMode === "SENHA"
        ? "Acesso criado. Repasse o e-mail e a senha ao proprietário."
        : "Acesso criado e convite enviado por e-mail."
    );
    if (response) {
      setLink("");
      setNewEmail("");
    }
  };

  const generateLink = async () => {
    const response = await run("GERAR_LINK_SENHA", {}, "Link gerado. Copie e envie ao proprietário.");
    if (response?.link) setLink(response.link);
  };

  const definePassword = async (event: React.FormEvent) => {
    event.preventDefault();
    await run("DEFINIR_SENHA", { senha: newPassword }, "Senha definida. Repasse ao proprietário por um canal seguro.");
  };

  const changeEmail = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!window.confirm(`Alterar o e-mail de acesso para ${newEmail}? O proprietário passará a entrar com o novo e-mail.`)) return;
    const response = await run("ALTERAR_EMAIL", { email: newEmail }, "E-mail de acesso alterado.");
    if (response) setNewEmail("");
  };

  const block = () => {
    if (!window.confirm("Bloquear o acesso deste proprietário ao portal? O login continua existindo e pode ser desbloqueado.")) return;
    void run("BLOQUEAR", {}, "Acesso bloqueado.");
  };

  const revoke = async () => {
    if (
      !window.confirm(
        "Revogar o acesso remove o login do proprietário no portal. Para voltar a acessar, será preciso criar um novo acesso. Continuar?"
      )
    )
      return;
    const response = await run("REVOGAR", {}, "Acesso revogado e login removido.");
    if (response && !response.item) {
      setLink("");
      setNewPassword("");
      setCreatePassword("");
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border/60 bg-muted/20 p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary border border-primary/20">
              <ShieldCheck className="h-4 w-4" />
            </div>
            <div>
              <h3 className="font-semibold text-sm sm:text-base text-foreground">Portal do Proprietário</h3>
              <p className="text-xs sm:text-sm text-muted-foreground mt-0.5 max-w-xl">
                Permite ao proprietário consultar relatórios, extratos e ocupação dos seus imóveis. O e-mail de acesso
                deve ser único e não pode pertencer a uma conta de hóspede ou a um usuário do ERP.
              </p>
              {current ? (
                <p className="text-xs text-muted-foreground mt-2">{STATUS_HINT[status]}</p>
              ) : null}
            </div>
          </div>
          {current ? <StatusBadge status={status} /> : null}
        </div>
      </div>

      <RemoteState loading={remote.loading && !current} error={current ? null : remote.error} retry={remote.reload}>
        {!account ? (
          <form
            onSubmit={create}
            className="space-y-5 rounded-xl border border-border/60 bg-card p-4 sm:p-5 shadow-xs"
          >
            <h4 className="font-semibold text-sm sm:text-base text-foreground">Criar acesso ao portal</h4>

            {!ownerActive ? (
              <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs sm:text-sm text-amber-700 dark:text-amber-400">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>Ative o cadastro do proprietário antes de criar o acesso.</span>
              </div>
            ) : null}

            <Field label="E-mail de acesso" hint="Será o login do proprietário no portal.">
              <Input
                type="email"
                required
                placeholder="proprietario@email.com"
                value={createEmail}
                onChange={(event) => setCreateEmail(event.target.value)}
                className="h-11 sm:h-10 text-base sm:text-sm max-w-md"
              />
            </Field>

            <div className="space-y-2">
              <span className="text-sm font-medium text-foreground block">Como o proprietário vai receber a senha</span>
              <div role="radiogroup" aria-label="Forma de criação do acesso" className="grid gap-3 sm:grid-cols-2">
                {(
                  [
                    {
                      value: "CONVITE",
                      icon: Mail,
                      title: "Enviar convite por e-mail",
                      text: "O proprietário recebe um link e escolhe a própria senha.",
                    },
                    {
                      value: "SENHA",
                      icon: KeyRound,
                      title: "Definir a senha agora",
                      text: "O login fica pronto na hora; você repassa a senha ao proprietário.",
                    },
                  ] as const
                ).map((option) => {
                  const selected = createMode === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => setCreateMode(option.value)}
                      className={cn(
                        "flex items-start gap-3 rounded-lg border p-3.5 text-left transition-colors hover:cursor-pointer touch-manipulation",
                        selected
                          ? "border-primary/60 bg-primary/5 ring-1 ring-primary/30"
                          : "border-border/60 bg-background/50 hover:bg-muted/20"
                      )}
                    >
                      <option.icon className={cn("h-4 w-4 mt-0.5 shrink-0", selected ? "text-primary" : "text-muted-foreground")} />
                      <span className="space-y-0.5">
                        <span className="text-sm font-medium text-foreground block">{option.title}</span>
                        <span className="text-xs text-muted-foreground block">{option.text}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {createMode === "SENHA" ? (
              <Field label="Senha inicial" hint="Entre 8 e 128 caracteres. Repasse por um canal seguro.">
                <PasswordField value={createPassword} onChange={setCreatePassword} disabled={Boolean(busy)} />
              </Field>
            ) : null}

            <div className="flex justify-end pt-1">
              <Button
                type="submit"
                disabled={
                  Boolean(busy) ||
                  !ownerActive ||
                  !createEmail.includes("@") ||
                  (createMode === "SENHA" && createPassword.length < 8)
                }
                className="h-10 sm:h-9 text-xs gap-1.5 hover:cursor-pointer touch-manipulation"
              >
                {busy === "CRIAR" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : createMode === "SENHA" ? (
                  <KeyRound className="h-3.5 w-3.5" />
                ) : (
                  <Send className="h-3.5 w-3.5" />
                )}
                <span>{createMode === "SENHA" ? "Criar acesso com senha" : "Criar acesso e enviar convite"}</span>
              </Button>
            </div>
          </form>
        ) : (
          <>
            {/* Dados do login */}
            <section className="space-y-4 rounded-xl border border-border/60 bg-card p-4 sm:p-5 shadow-xs">
              <h4 className="font-semibold text-sm sm:text-base text-foreground">Login do proprietário</h4>

              {!account.login_encontrado ? (
                <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs sm:text-sm text-destructive">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>O login deste acesso não foi encontrado no Supabase. Revogue e crie o acesso novamente.</span>
                </div>
              ) : null}

              <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <Info label="E-mail de acesso" value={account.email} />
                <Info label="Criado em" value={dateTime(account.created_at)} />
                <Info label="Último acesso ao portal" value={account.last_sign_in_at ? dateTime(account.last_sign_in_at) : "Nunca acessou"} />
                <Info label="E-mail confirmado em" value={account.email_confirmed_at ? dateTime(account.email_confirmed_at) : "Aguardando"} />
                <Info label="Último link de senha" value={dateTime(account.recovery_sent_at ?? account.invited_at)} />
                {account.motivo_pendencia && MOTIVO_LABEL[account.motivo_pendencia] ? (
                  <Info label="Observação" value={MOTIVO_LABEL[account.motivo_pendencia]} />
                ) : null}
              </dl>

              {current?.portalUrl ? (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/40 bg-muted/30 px-3 py-2">
                  <span className="text-xs text-muted-foreground">Endereço de entrada:</span>
                  <span className="text-xs font-mono text-foreground truncate min-w-0 flex-1">{current.portalUrl}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => copy(current.portalUrl, "Endereço do portal")}
                    className="h-7 text-xs gap-1 hover:cursor-pointer"
                  >
                    <Copy className="h-3 w-3" />
                    <span>Copiar</span>
                  </Button>
                </div>
              ) : null}
            </section>

            {/* Senha */}
            <section className="space-y-5 rounded-xl border border-border/60 bg-card p-4 sm:p-5 shadow-xs">
              <div>
                <h4 className="font-semibold text-sm sm:text-base text-foreground">Senha de acesso</h4>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Envie um link para o próprio proprietário definir a senha, ou defina uma nova senha aqui mesmo.
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={Boolean(busy)}
                  onClick={() => run("ENVIAR_LINK_SENHA", {}, `Link de definição de senha enviado para ${account.email}.`)}
                  className="h-10 sm:h-9 text-xs gap-1.5 hover:cursor-pointer touch-manipulation"
                >
                  {busy === "ENVIAR_LINK_SENHA" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />}
                  <span>Enviar link por e-mail</span>
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={Boolean(busy)}
                  onClick={generateLink}
                  className="h-10 sm:h-9 text-xs gap-1.5 hover:cursor-pointer touch-manipulation"
                >
                  {busy === "GERAR_LINK_SENHA" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
                  <span>Gerar link para copiar</span>
                </Button>
              </div>

              {link ? (
                <div className="space-y-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
                  <div className="flex items-center gap-2">
                    <Input readOnly value={link} onFocus={(event) => event.currentTarget.select()} className="h-9 font-mono text-xs" />
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => copy(link, "Link")}
                      className="h-9 text-xs gap-1.5 shrink-0 hover:cursor-pointer"
                    >
                      <Copy className="h-3.5 w-3.5" />
                      <span>Copiar</span>
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    O link vale para um único uso e expira em pouco tempo. Envie apenas ao proprietário (ex.: WhatsApp).
                    Gerar outro link invalida este.
                  </p>
                </div>
              ) : null}

              <form onSubmit={definePassword} className="space-y-2 border-t border-border/40 pt-4">
                <Field label="Definir nova senha agora" hint="A senha atual deixa de valer na hora. Repasse a nova por um canal seguro.">
                  <PasswordField value={newPassword} onChange={setNewPassword} disabled={Boolean(busy)} />
                </Field>
                <Button
                  type="submit"
                  disabled={Boolean(busy) || newPassword.length < 8}
                  className="h-10 sm:h-9 text-xs gap-1.5 hover:cursor-pointer touch-manipulation"
                >
                  {busy === "DEFINIR_SENHA" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}
                  <span>Salvar nova senha</span>
                </Button>
              </form>
            </section>

            {/* E-mail */}
            <form
              onSubmit={changeEmail}
              className="space-y-3 rounded-xl border border-border/60 bg-card p-4 sm:p-5 shadow-xs"
            >
              <div>
                <h4 className="font-semibold text-sm sm:text-base text-foreground">Alterar e-mail de acesso</h4>
                <p className="text-xs text-muted-foreground mt-0.5">
                  O login passa a ser o novo e-mail na hora, sem confirmação. A senha continua a mesma.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  type="email"
                  required
                  placeholder={account.email}
                  value={newEmail}
                  onChange={(event) => setNewEmail(event.target.value)}
                  className="h-11 sm:h-10 text-base sm:text-sm max-w-md"
                />
                <Button
                  type="submit"
                  variant="outline"
                  disabled={
                    Boolean(busy) ||
                    !newEmail.includes("@") ||
                    newEmail.trim().toLowerCase() === account.email
                  }
                  className="h-10 sm:h-9 text-xs gap-1.5 hover:cursor-pointer touch-manipulation"
                >
                  {busy === "ALTERAR_EMAIL" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <AtSign className="h-3.5 w-3.5" />}
                  <span>Alterar e-mail</span>
                </Button>
              </div>
            </form>

            {/* Situação */}
            <section className="space-y-3 rounded-xl border border-border/60 bg-card p-4 sm:p-5 shadow-xs">
              <div>
                <h4 className="font-semibold text-sm sm:text-base text-foreground">Situação do acesso</h4>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Bloquear impede a entrada e mantém o login. Revogar remove o login; depois é preciso criar um novo acesso.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {account.status === "BLOQUEADO" ? (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={Boolean(busy) || !ownerActive}
                    onClick={() => run("DESBLOQUEAR", {}, "Acesso desbloqueado.")}
                    className="h-10 sm:h-9 text-xs gap-1.5 hover:cursor-pointer touch-manipulation"
                  >
                    {busy === "DESBLOQUEAR" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LockOpen className="h-3.5 w-3.5" />}
                    <span>Desbloquear acesso</span>
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={Boolean(busy)}
                    onClick={block}
                    className="h-10 sm:h-9 text-xs gap-1.5 hover:cursor-pointer touch-manipulation"
                  >
                    {busy === "BLOQUEAR" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Lock className="h-3.5 w-3.5" />}
                    <span>Bloquear acesso</span>
                  </Button>
                )}
                <Button
                  type="button"
                  variant="destructive"
                  disabled={Boolean(busy)}
                  onClick={revoke}
                  className="h-10 sm:h-9 text-xs gap-1.5 hover:cursor-pointer touch-manipulation"
                >
                  {busy === "REVOGAR" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserX className="h-3.5 w-3.5" />}
                  <span>Revogar acesso</span>
                </Button>
              </div>
              {account.status === "BLOQUEADO" && !ownerActive ? (
                <p className="text-xs text-muted-foreground">Ative o cadastro do proprietário para poder desbloquear.</p>
              ) : null}
            </section>
          </>
        )}
      </RemoteState>

      {error ? (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs sm:text-sm text-destructive"
        >
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}
    </div>
  );
}
