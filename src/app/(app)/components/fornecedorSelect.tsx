import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import axios from "axios";
import { ReactNode, useEffect, useRef, useState } from "react";

import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsLeft,
  ChevronsRight,
  Loader,
  Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SelectSearchInput } from "./select-search-input";
import { Fornecedor, Pagination } from "../(pages)/estoque/types";
import FornecedorDialog from "../(pages)/configuracoes/tipos/components/fornecedorDialog";

interface FornecedorSelectProps {
  children?: ReactNode;
  OnSelect?: (value: Fornecedor) => void;
  setOpen?: (value: boolean) => void;
  open?: boolean;
}
export default function FornecedorSelect({
  children,
  OnSelect,
  setOpen,
  open,
}: FornecedorSelectProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [pagination, setPagination] = useState<Pagination>({
    total: 0,
    page: 1,
    limit: 20,
    totalPages: 0,
  });
  const [fornecedorItems, setFornecedorItems] = useState<Fornecedor[] | []>([]);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const requestSequence = useRef(0);
  const requestController = useRef<AbortController | null>(null);
  const [openFornecedor, setOpenFornecedor] = useState(false);

  const handleGetFornecedores = async (
    pageNumber?: number,
    limit?: number,
    searchText?: string,
  ) => {
    const requestId = ++requestSequence.current;
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    setIsLoading(true);
    try {
      const response = await axios.get("/api/tipos/fornecedores", {
        signal: controller.signal,
        params: {
          page: pageNumber || 1,
          limit: limit || pagination.limit,
          search: searchText || undefined,
        },
      });
      if (response.status === 200 && requestId === requestSequence.current) {
        setFornecedorItems(response.data.items);
        setPagination(response.data.pagination);
      }
    } catch (error) {
      if (!axios.isCancel(error) && requestId === requestSequence.current) console.log(error);
    } finally {
      if (requestId === requestSequence.current) setIsLoading(false);
    }
  };

  useEffect(() => {
    requestSequence.current += 1;
    requestController.current?.abort();
    const timer = window.setTimeout(() => setSearch(searchInput.trim()), 450);
    return () => window.clearTimeout(timer);
  }, [searchInput]);
  useEffect(() => {
    if (open) void handleGetFornecedores(1, pagination.limit, search);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, search]);
  useEffect(() => () => requestController.current?.abort(), []);

  const executarBusca = () => {
    const term = searchInput.trim();
    if (term === search) void handleGetFornecedores(1, pagination.limit, term); else setSearch(term);
  };
  const limparBusca = () => {
    setSearchInput("");
    if (search === "") void handleGetFornecedores(1, pagination.limit, ""); else setSearch("");
  };

  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        if (setOpen) {
          setOpen(nextOpen);
          handleGetFornecedores(1, pagination.limit, "");
        }
        
        if (!nextOpen) {
          setSearchInput("");
          setSearch("");
        }
      }}
      open={open}
    >
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="h-lvh min-w-screen max-h-[600px] p-0 overflow-hidden sm:max-w-[500px] sm:max-h-[600px] sm:w-[95vw] sm:min-w-0">
        <div className="flex h-full min-h-0 flex-col">
          <DialogHeader className="shrink-0 px-6 py-4 border-b-1">
            <DialogTitle>Selecione um Fornecedor</DialogTitle>
            <DialogDescription></DialogDescription>
          </DialogHeader>
          <div className="h-full min-h-0 min-w-0 overflow-auto dark:bg-muted-foreground/5 px-4 py-6 sm:px-6 sm:py-10 space-y-2">
            <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1"><SelectSearchInput value={searchInput} onValueChange={setSearchInput} onSearch={executarBusca} onClear={limparBusca} placeholder="Buscar por nome, documento ou contato..." /></div>
              <Button
                onClick={() => setOpenFornecedor(true)}
                variant={"outline"}
                className="text-xs hover:cursor-pointer"
              >
                <Plus />
                Novo
              </Button>
              <FornecedorDialog
                dialogOpen={openFornecedor}
                setDialogOpen={setOpenFornecedor}
                loadFornecedores={() =>
                  handleGetFornecedores(
                    pagination.page,
                    pagination.limit,
                    search,
                  )
                }
              ></FornecedorDialog>
            </div>

            <div
              className={`${
                isLoading && " opacity-100"
              } transition-all opacity-0 h-0.5 bg-slate-400 w-full overflow-hidden absolute left-0 right-0 top-0`}
            >
              <div
                className={`w-1/2 bg-primary h-full  absolute left-0 rounded-lg  -translate-x-[100%] ${
                  isLoading && "animate-slideIn "
                } `}
              ></div>
            </div>
            <Table className="mt-6 w-full table-fixed text-xs">
              <TableHeader>
                <TableRow>
                  <TableCell className="w-14">ID</TableCell>
                  <TableCell>NOME</TableCell>
                  <TableCell className="w-32">CPF/CNPJ</TableCell>
                </TableRow>
              </TableHeader>
              <TableBody>
                {fornecedorItems.map((f) => (
                  <TableRow
                    className="hover:cursor-pointer"
                    onClick={() => {
                      if (OnSelect) {
                        OnSelect(f);
                      }
                      if (setOpen) {
                        setOpen(false);
                        setSearch("");
                      }
                    }}
                    key={f.id}
                  >
                    <TableCell className="w-14">{f.id}</TableCell>
                    <TableCell className="max-w-0 truncate" title={f.nomerazaosocial}>
                      {f.nomerazaosocial}
                    </TableCell>
                    <TableCell className="w-32 truncate" title={f.cpfcnpj}>
                      {f.cpfcnpj}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
        <DialogFooter>
          <div className="flex flex-row items-center pb-5 w-full h-full justify-center">
            <div className="text-xs text-muted-foreground flex flex-nowrap">
              <span>{pagination.limit * (pagination.page - 1) + 1}</span> -{" "}
              <span>
                {pagination.limit * (pagination.page - 1) +
                  (pagination.pageCount || 0)}
              </span>
              <span className="ml-1 hidden sm:block">
                de {pagination.total}
              </span>
              <Loader
                className={`ml-2 w-4 h-full animate-spin transition-all opacity-0 ${
                  isLoading && "opacity-100"
                }`}
              />
            </div>

            <div className="flex items-center justify-center space-x-1 sm:space-x-3">
              <Button
                variant="outline"
                size="icon"
                className="hover:cursor-pointer"
                onClick={() =>
                  handleGetFornecedores(1, pagination.limit, search)
                }
                disabled={pagination.page === 1}
              >
                <ChevronsLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="hover:cursor-pointer"
                onClick={() =>
                  handleGetFornecedores(
                    pagination.page - 1,
                    pagination.limit,
                    search,
                  )
                }
                disabled={pagination.page === 1}
              >
                <ChevronLeftIcon className="h-4 w-4" />
              </Button>
              <span className="text-xs font-medium text-nowrap">
                Pg. {pagination.page} de {pagination.totalPages || 1}
              </span>

              <Button
                className="hover:cursor-pointer"
                variant="outline"
                size="icon"
                onClick={() =>
                  handleGetFornecedores(
                    pagination.page + 1,
                    pagination.limit,
                    search,
                  )
                }
                disabled={
                  pagination.page === pagination.totalPages ||
                  pagination.totalPages === 0
                }
              >
                <ChevronRightIcon className="h-4 w-4" />
              </Button>
              <Button
                className="hover:cursor-pointer"
                variant="outline"
                size="icon"
                onClick={() =>
                  handleGetFornecedores(
                    pagination.totalPages,
                    pagination.limit,
                    search,
                  )
                }
                disabled={
                  pagination.page === pagination.totalPages ||
                  pagination.totalPages === 0
                }
              >
                <ChevronsRight className="h-4 w-4" />
              </Button>
            </div>
            <div className="">
              <Select>
                <SelectTrigger className="hover:cursor-pointer ml-2">
                  <SelectValue placeholder={pagination.limit}></SelectValue>
                </SelectTrigger>
                <SelectContent className="">
                  <SelectItem className="hover:cursor-pointer" value="20">
                    {pagination.limit}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
