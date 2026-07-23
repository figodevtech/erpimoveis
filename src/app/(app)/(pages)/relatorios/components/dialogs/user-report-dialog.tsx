"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/lib/toast";
import { ReportFiltersPanel, ReportPeriod, ReportTrigger, isInvalidPeriod } from "../report-ui";

type User = { id: string; nome: string | null; email?: string };

export function UserReportDialog({
  icon,
  cardTitle,
  cardDescription,
  dialogTitle,
  dialogDescription,
  userLabel,
  userPlaceholder,
  tone,
  renderExport,
}: {
  icon: ReactNode;
  cardTitle: string;
  cardDescription: string;
  dialogTitle: string;
  dialogDescription: string;
  userLabel: string;
  userPlaceholder: string;
  tone: string;
  renderExport: (filters: { userId: string; dateFrom: string; dateTo: string; disabled: boolean }) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [users, setUsers] = useState<User[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [userId, setUserId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const invalid = isInvalidPeriod(dateFrom, dateTo);

  useEffect(() => {
    if (!open || users.length) return;
    let active = true;
    fetch("/api/users?ativos=1", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload?.error || "Falha ao carregar usuários.");
        if (active) setUsers(Array.isArray(payload?.users) ? payload.users : []);
      })
      .catch((error) => {
        if (active) toast.error(error instanceof Error ? error.message : "Falha ao carregar usuários.");
      })
      .finally(() => active && setLoadingUsers(false));
    return () => { active = false; };
  }, [open, users.length]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen && users.length === 0) setLoadingUsers(true);
    setOpen(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <ReportTrigger icon={icon} title={cardTitle} description={cardDescription} tone={tone} />
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{dialogTitle}</DialogTitle>
          <DialogDescription>{dialogDescription}</DialogDescription>
        </DialogHeader>
        <ReportFiltersPanel>
          <div className="space-y-2">
            <Label>{userLabel}</Label>
            <Select value={userId} onValueChange={setUserId} disabled={loadingUsers}>
              <SelectTrigger><SelectValue placeholder={loadingUsers ? "Carregando usuários..." : userPlaceholder} /></SelectTrigger>
              <SelectContent>
                {loadingUsers && <div className="flex items-center gap-2 px-2 py-3 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Carregando...</div>}
                {users.map((user) => <SelectItem key={user.id} value={String(user.id)}>{user.nome || user.email || user.id}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <ReportPeriod dateFrom={dateFrom} dateTo={dateTo} onDateFromChange={setDateFrom} onDateToChange={setDateTo} />
        </ReportFiltersPanel>
        <DialogFooter>
          <DialogClose asChild><Button type="button" variant="outline">Cancelar</Button></DialogClose>
          {renderExport({ userId, dateFrom, dateTo, disabled: !userId || invalid })}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
