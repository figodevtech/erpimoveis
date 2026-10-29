import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusReserva } from "../types";
import { Lookup } from "@/components/imobiliario/shared";

interface SearchFilterProps {
  search: string;
  setSearch: (value: string) => void;
  onSearch: () => void;
  onClear: () => void;
  setStatus: (value: StatusReserva) => void;
  status: StatusReserva;
  inicio: string;
  setInicio: (value: string) => void;
  fim: string;
  setFim: (value: string) => void;
  propertyId: number | null;
  setPropertyId: (value: number | null) => void;
}

export default function SearchFilter({
  search,
  setSearch,
  onSearch,
  onClear,
  setStatus,
  status,
  inicio,
  setInicio,
  fim,
  setFim,
  propertyId,
  setPropertyId,
}: SearchFilterProps) {
  return (
    <div className="flex gap-4 flex-col lg:flex-row bg-card p-4 rounded-2xl shadow-sm border border-primary/30 items-stretch lg:items-center">
      <div className="relative flex-1">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute left-1 top-1/2 z-10 h-8 w-8 -translate-y-1/2"
          onClick={onSearch}
          aria-label="Pesquisar reservas"
          title="Pesquisar"
        >
          <Search className="h-4 w-4 text-muted-foreground" />
        </Button>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onSearch();
            }
          }}
          placeholder="Buscar por código, cliente ou imóvel..."
          className="pl-10 pr-10"
        />
        {search ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2"
            onClick={onClear}
            aria-label="Limpar busca"
            title="Limpar busca"
          >
            <X className="h-4 w-4 text-muted-foreground" />
          </Button>
        ) : null}
      </div>

      <div className="w-full lg:w-48 shrink-0">
        <Select
          value={status}
          onValueChange={(value) => setStatus(value as StatusReserva)}
        >
          <SelectTrigger className="w-full hover:cursor-pointer">
            <SelectValue placeholder="Situação" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={StatusReserva.TODOS} className="hover:cursor-pointer">
              Todas as situações
            </SelectItem>
            <SelectItem value={StatusReserva.CONFIRMADA} className="hover:cursor-pointer">
              Confirmada
            </SelectItem>
            <SelectItem value={StatusReserva.EM_ANDAMENTO} className="hover:cursor-pointer">
              Em andamento
            </SelectItem>
            <SelectItem value={StatusReserva.CONCLUIDA} className="hover:cursor-pointer">
              Concluída
            </SelectItem>
            <SelectItem value={StatusReserva.CANCELADA} className="hover:cursor-pointer">
              Cancelada
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <div className="flex flex-col">
          <Input
            type="date"
            value={inicio}
            onChange={(e) => setInicio(e.target.value)}
            className="w-36 text-xs"
            title="Data de início"
          />
        </div>
        <span className="text-muted-foreground text-xs">até</span>
        <div className="flex flex-col">
          <Input
            type="date"
            min={inicio || undefined}
            value={fim}
            onChange={(e) => setFim(e.target.value)}
            className="w-36 text-xs"
            title="Data final"
          />
        </div>
      </div>

      <div className="w-full lg:w-56 shrink-0">
        <Lookup
          tipo="imoveis"
          label=""
          value={propertyId}
          required={false}
          onChange={(id) => setPropertyId(id)}
        />
      </div>

      {(search || status !== StatusReserva.TODOS || inicio || fim || propertyId) ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            onClear();
            setStatus(StatusReserva.TODOS);
            setInicio("");
            setFim("");
            setPropertyId(null);
          }}
          className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
        >
          Limpar filtros
        </Button>
      ) : null}
    </div>
  );
}

