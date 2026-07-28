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
import { Customer, Pagination } from "../(pages)/clientes/types";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsLeft,
  ChevronsRight,
  Loader,
  Plus,
  Search,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { CustomerDialog } from "../(pages)/clientes/components/customerDialogRegister/customerDialog";

interface CustomerSelectProps {
  children?: ReactNode;
  OnSelect?: (value: Customer) => void;
  setOpen?: (value: boolean) => void;
  open?: boolean;
}
export default function CustomerSelect({
  children,
  OnSelect,
  setOpen,
  open,
}: CustomerSelectProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [pagination, setPagination] = useState<Pagination>({
    total: 0,
    page: 1,
    limit: 20,
    totalPages: 0,
  });
  const [customerItems, setCustomerItems] = useState<Customer[] | []>([]);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [openCustomer, setOpenCustomer] = useState(false);
  const requestSequence = useRef(0);
  const requestController = useRef<AbortController | null>(null);
  const handleGetCustomers = async (
    pageNumber?: number,
    limit?: number,
    search?: string,
  ) => {
    const requestId = ++requestSequence.current;
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    setIsLoading(true);
    try {
      const response = await axios.get("/api/customers/com-veiculos", {
        signal: controller.signal,
        params: {
          page: pageNumber || 1,
          limit: limit || pagination.limit,
          search: search || undefined,
          status: "TODOS",
        },
      });
      if (response.status === 200 && requestId === requestSequence.current) {
        const { data } = response;
        setCustomerItems(data.data);
        setPagination(data.pagination);
      }
    } catch (error) {
      if (!axios.isCancel(error) && requestId === requestSequence.current) {
        console.error("Erro ao buscar clientes:", error);
      }
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
    void handleGetCustomers(1, pagination.limit, search);
    // A busca automatica depende somente do termo aplicado.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  useEffect(() => () => requestController.current?.abort(), []);

  const executarBusca = () => {
    const term = searchInput.trim();
    if (term === search) void handleGetCustomers(1, pagination.limit, term);
    else setSearch(term);
  };

  const limparBusca = () => {
    setSearchInput("");
    if (search === "") void handleGetCustomers(1, pagination.limit, "");
    else setSearch("");
  };

  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        if (setOpen) {
          setOpen(nextOpen);
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
            <DialogTitle>Selecione um cliente</DialogTitle>
            <DialogDescription></DialogDescription>
          </DialogHeader>
          <div className="h-full min-h-0 overflow-auto dark:bg-muted-foreground/5 px-6 py-10 space-y-2">
            <div className="flex flex-row items-center gap-2">
              <div className="relative w-full">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute left-1 top-1/2 z-10 h-8 w-8 -translate-y-1/2"
                  onClick={executarBusca}
                  aria-label="Pesquisar clientes"
                  title="Pesquisar"
                >
                  <Search className="h-4 w-4 text-muted-foreground" />
                </Button>
                <Input
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      executarBusca();
                    }
                  }}
                  placeholder="Buscar por nome, email ou telefone..."
                  className="pl-10 pr-10"
                />
                {searchInput ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2"
                    onClick={limparBusca}
                    aria-label="Limpar busca"
                    title="Limpar busca"
                  >
                    <X className="h-4 w-4 text-muted-foreground" />
                  </Button>
                ) : null}
              </div>
              <Button
                onClick={() => setOpenCustomer(true)}
                variant={"outline"}
                className="text-xs hover:cursor-pointer"
              >
                <Plus />
                Novo
              </Button>
              <CustomerDialog
                isOpen={openCustomer}
                setIsOpen={(open) => {
                  if (!open) {
                    handleGetCustomers(1, pagination.limit, search);
                  }
                  setOpenCustomer(open);
                }}
              />
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
            <Table className="text-[11px] mt-6">
              <TableHeader>
                <TableRow>
                  <TableCell>ID</TableCell>
                  <TableCell>NOME</TableCell>
                  <TableCell>TIPO</TableCell>
                </TableRow>
              </TableHeader>
              <TableBody>
                {customerItems.map((c) => (
                  <TableRow
                    className="hover:cursor-pointer"
                    onClick={() => {
                      if (OnSelect) {
                        OnSelect(c);
                      }
                      if (setOpen) {
                        setOpen(false);
                        setSearchInput("");
                        setSearch("");
                      }
                    }}
                    key={c.id}
                  >
                    <TableCell>{c.id}</TableCell>
                    <TableCell className="max-w-[200px] truncate">
                      {c.nomerazaosocial}
                    </TableCell>
                    <TableCell>{c.tipopessoa}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
        <DialogFooter>
          <div className="flex items-center pb-5 w-full h-full flex-row justify-center">
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
                onClick={() => handleGetCustomers(1, pagination.limit, search)}
                disabled={pagination.page === 1}
              >
                <ChevronsLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="hover:cursor-pointer"
                onClick={() =>
                  handleGetCustomers(
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
                  handleGetCustomers(
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
                  handleGetCustomers(
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
