"use client";

import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type SelectSearchInputProps = {
  value: string;
  onValueChange: (value: string) => void;
  onSearch: () => void;
  onClear: () => void;
  placeholder: string;
};

export function SelectSearchInput({ value, onValueChange, onSearch, onClear, placeholder }: SelectSearchInputProps) {
  return (
    <div className="relative w-full">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="absolute left-1 top-1/2 z-10 h-8 w-8 -translate-y-1/2"
        onClick={onSearch}
        aria-label="Pesquisar"
        title="Pesquisar"
      >
        <Search className="h-4 w-4 text-muted-foreground" />
      </Button>
      <Input
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            onSearch();
          }
        }}
        placeholder={placeholder}
        className="pl-10 pr-10"
      />
      {value ? (
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
  );
}
