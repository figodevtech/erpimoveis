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
import { SituacaoImovel } from "../types";

interface SearchFilterProps {
  search: string;
  setSearch: (value: string) => void;
  onSearch: () => void;
  onClear: () => void;
  setSituacao: (value: SituacaoImovel) => void;
  situacao: SituacaoImovel;
}

export default function SearchFilter({
  search,
  setSearch,
  onSearch,
  onClear,
  setSituacao,
  situacao,
}: SearchFilterProps) {
  return (
    <div className="flex gap-4 md:gap-6 flex-col md:flex-row bg-card p-4 rounded-2xl shadow-sm border border-primary/30">
      <div className="relative w-full">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute left-1 top-1/2 z-10 h-8 w-8 -translate-y-1/2"
          onClick={onSearch}
          aria-label="Pesquisar imóveis"
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
          placeholder="Buscar por ID, título ou localização..."
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

      <Select
        value={situacao}
        onValueChange={(value) => setSituacao(value as SituacaoImovel)}
      >
        <SelectTrigger className="w-full md:w-2/6 hover:cursor-pointer">
          <SelectValue placeholder="Situação" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={SituacaoImovel.TODOS} className="hover:cursor-pointer">
            Todas as situações
          </SelectItem>
          <SelectItem value={SituacaoImovel.DISPONIVEL} className="hover:cursor-pointer">
            Disponível
          </SelectItem>
          <SelectItem value={SituacaoImovel.RESERVADO} className="hover:cursor-pointer">
            Reservado
          </SelectItem>
          <SelectItem value={SituacaoImovel.ALUGADO} className="hover:cursor-pointer">
            Alugado
          </SelectItem>
          <SelectItem value={SituacaoImovel.VENDIDO} className="hover:cursor-pointer">
            Vendido
          </SelectItem>
          <SelectItem value={SituacaoImovel.INATIVO} className="hover:cursor-pointer">
            Inativo
          </SelectItem>
          <SelectItem value={SituacaoImovel.MANUTENCAO} className="hover:cursor-pointer">
            Manutenção
          </SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
