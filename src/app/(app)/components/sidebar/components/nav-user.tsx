"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronsUpDown,
  LogOut,
  KeyRound,
  Loader2,
  SlidersHorizontal,
  UserRound,
} from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";

import { signOut } from "next-auth/react";
import { supabase } from "@/lib/supabase";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "@/lib/toast";

export function NavUser({
  user,
  billingBlocked = false,
}: {
  user: { nome: string; email: string };
  billingBlocked?: boolean;
}) {
  const { isMobile } = useSidebar();
  const router = useRouter();

  // --- Modal Alterar Senha
  const [pwdOpen, setPwdOpen] = useState(false);
  const [currentPwd, setCurrentPwd] = useState("");
  const [pwd, setPwd] = useState("");
  const [pwd2, setPwd2] = useState("");
  const [savingPwd, setSavingPwd] = useState(false);

  const handleLogout = async () => {
    void supabase.auth.signOut().catch(() => {});
    await signOut({ callbackUrl: "/login", redirect: true });
  };

  const openChangePwd = () => {
    setCurrentPwd("");
    setPwd("");
    setPwd2("");
    setPwdOpen(true);
  };

  const handleChangePassword = async () => {
    if (!currentPwd.trim()) return toast.error("Informe a senha atual.");
    if (!pwd.trim() || !pwd2.trim())
      return toast.error("Preencha a nova senha e a confirmação.");
    if (pwd !== pwd2) return toast.error("As senhas não conferem.");
    if (pwd.length < 8)
      return toast.error("A nova senha deve ter pelo menos 8 caracteres.");

    setSavingPwd(true);
    try {
      // 1) sessão temporária no Supabase
      const { error: signInErr } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: currentPwd,
      });
      if (signInErr) {
        const msg = (signInErr.message || "").toLowerCase();

        // senha atual errada
        if (msg.includes("invalid login")) {
          toast.error("Senha atual incorreta.");
        } else if (msg.includes("email not confirmed")) {
          toast.error(
            "E-mail não confirmado. Confirme seu e-mail para alterar a senha.",
          );
        } else {
          toast.error(signInErr.message || "Falha ao autenticar no Supabase.");
        }
        return;
      }

      // 2) troca a senha
      const { error: updErr } = await supabase.auth.updateUser({
        password: pwd,
      });
      if (updErr) {
        const m = (updErr.message || "").toLowerCase();
        if (m.includes("different")) {
          toast.error("A nova senha deve ser diferente da atual.");
        } else if (m.includes("at least") || m.includes("too short")) {
          toast.error("A senha não atende aos requisitos mínimos.");
        } else {
          toast.error(updErr.message || "Não foi possível alterar a senha.");
        }
        return;
      }

      // 3) limpa sessão temporária do Supabase
      await supabase.auth.signOut();

      toast.success("Senha alterada com sucesso.");
      setPwdOpen(false);
    } catch (e: any) {
      toast.error(e?.message || "Erro inesperado ao alterar a senha.");
    } finally {
      setSavingPwd(false);
    }
  };

  return (
    <>
      <SidebarMenu>
        <SidebarMenuItem>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <SidebarMenuButton
                size="lg"
                className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
              >
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">{user.nome}</span>
                  <span className="truncate text-xs">{user.email}</span>
                </div>
                <ChevronsUpDown className="ml-auto size-4" />
              </SidebarMenuButton>
            </DropdownMenuTrigger>

            <DropdownMenuContent
              className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
              side={isMobile ? "bottom" : "right"}
              align="end"
              sideOffset={4}
            >
              <DropdownMenuLabel className="p-0 font-normal">
                <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-medium">{user.nome}</span>
                    <span className="truncate text-xs">{user.email}</span>
                  </div>
                </div>
              </DropdownMenuLabel>

              <DropdownMenuSeparator />

              <DropdownMenuGroup>
                {/* Central Pessoal — indisponível enquanto o acesso está
                    restrito ao módulo de plano por bloqueio de cobrança. */}
                {!billingBlocked && (
                  <>
                    <DropdownMenuItem onSelect={() => router.push("/meu-perfil")}>
                      <UserRound />
                      Meu perfil
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => router.push("/preferencias")}>
                      <SlidersHorizontal />
                      Preferências
                    </DropdownMenuItem>
                  </>
                )}

                {/* Alterar senha */}
                <DropdownMenuItem
                  onSelect={(e) => {
                    e.preventDefault();
                    openChangePwd();
                  }}
                >
                  <KeyRound />
                  Alterar senha
                </DropdownMenuItem>
              </DropdownMenuGroup>

              <DropdownMenuSeparator />

              <DropdownMenuItem
                onSelect={(e) => {
                  e.preventDefault();
                  handleLogout();
                }}
              >
                <LogOut />
                Sair
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarMenuItem>
      </SidebarMenu>

      {/* Modal Alterar Senha */}
      <Dialog open={pwdOpen} onOpenChange={setPwdOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Alterar senha</DialogTitle>
            <DialogDescription>
              Informe sua senha atual e defina uma nova.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 py-2">
            <div className="grid gap-1.5">
              <Label htmlFor="senha-atual">Senha atual</Label>
              <Input
                id="senha-atual"
                type="password"
                value={currentPwd}
                onChange={(e) => setCurrentPwd(e.target.value)}
                placeholder="••••••••"
                disabled={savingPwd}
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="nova-senha">Nova senha</Label>
              <Input
                id="nova-senha"
                type="password"
                value={pwd}
                onChange={(e) => setPwd(e.target.value)}
                placeholder="••••••••"
                minLength={8}
                disabled={savingPwd}
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="confirma-senha">Confirmar nova senha</Label>
              <Input
                id="confirma-senha"
                type="password"
                value={pwd2}
                onChange={(e) => setPwd2(e.target.value)}
                placeholder="••••••••"
                minLength={8}
                disabled={savingPwd}
              />
            </div>
          </div>

          <DialogFooter className="gap-2 sm:space-x-2">
            <Button
              variant="outline"
              onClick={() => setPwdOpen(false)}
              disabled={savingPwd}
            >
              Cancelar
            </Button>
            <Button onClick={handleChangePassword} disabled={savingPwd}>
              {savingPwd ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Salvando…
                </>
              ) : (
                "Salvar"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
