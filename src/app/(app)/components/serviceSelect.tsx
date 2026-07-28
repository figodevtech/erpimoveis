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
import { useSession } from "next-auth/react";

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
import { Servico } from "@/types/servico";
import { Pagination } from "../(pages)/estoque/types";
import ServicoDialog from "../(pages)/configuracoes/tipos/components/servicoDialog/servico-dialog";
import formatarEmReal from "@/utils/formatarEmReal";
import { PERMS, permissionSetHas } from "@/app/api/_authz/permission-constants";

interface ServiceSelectProps {
  children?: ReactNode;
  OnSelect?: (value: Servico) => void;
  setOpen?: (value: boolean) => void;
  open?: boolean;
}

type ServicoForm = {
  codigo: string;
  descricao: string;
  precohora: string;
  ativo: boolean;
  permite_agendamento: boolean;
};

const emptyForm: ServicoForm = {
  codigo: "",
  descricao: "",
  precohora: "",
  ativo: true,
  permite_agendamento: false,
};
export default function ServiceSelect({
  children,
  OnSelect,
  setOpen,
  open,
}: ServiceSelectProps) {
  const { data: session } = useSession();
  const canCreateService = permissionSetHas((session?.user as any)?.permissoes, PERMS.CONFIG_EDITAR);
  const [isLoading, setIsLoading] = useState(false);
  const [pagination, setPagination] = useState<Pagination>({
    total: 0,
    page: 1,
    limit: 20,
    totalPages: 0,
  });
  const [serviceItems, setServiceItems] = useState<Servico[] | []>([]);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const requestSequence = useRef(0);
  const requestController = useRef<AbortController | null>(null);
  const [form, setForm] = useState<ServicoForm>(emptyForm);

  const [openServico, setOpenServico] = useState(false);

  const handleGetServices = async (
    pageNumber?: number,
    limit?: number,
    searchText?: string
  ) => {
    const requestId = ++requestSequence.current;
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    setIsLoading(true);
    try {
      const response = await axios.get("/api/servicos/buscar", {
        signal: controller.signal,
        params: {
          page: pageNumber || 1,
          limit: limit || pagination.limit,
          search: searchText || undefined,
        },
      });
      if (response.status === 200 && requestId === requestSequence.current) {
        const { data } = response;
        setServiceItems(data.servicos);
        setPagination(data.pagination);
      }
    } catch (error) {
      if (!axios.isCancel(error) && requestId === requestSequence.current) console.log("Erro ao buscar Serviços:", error);
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
    if (open) void handleGetServices(1, pagination.limit, search);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, search]);
  useEffect(() => () => requestController.current?.abort(), []);

  const executarBusca = () => {
    const term = searchInput.trim();
    if (term === search) void handleGetServices(1, pagination.limit, term); else setSearch(term);
  };
  const limparBusca = () => {
    setSearchInput("");
    if (search === "") void handleGetServices(1, pagination.limit, ""); else setSearch("");
  };

  function openNovo() {
    setForm(emptyForm);
    setOpenServico(true);
  }

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
            <DialogTitle>Selecione um Serviço</DialogTitle>
            <DialogDescription></DialogDescription>
          </DialogHeader>
          <div className="h-full min-h-0 overflow-auto dark:bg-muted-foreground/5 px-6 py-10 space-y-2">
            <div className="flex flex-row items-center gap-2">
              <SelectSearchInput value={searchInput} onValueChange={setSearchInput} onSearch={executarBusca} onClear={limparBusca} placeholder="Buscar por código ou descrição..." />
              {canCreateService && (
                <>
                  <Button
                    onClick={() => openNovo()}
                    variant={"outline"}
                    className="hover:cursor-pointer text-xs"
                  >
                    <Plus /> Novo
                  </Button>
                  <ServicoDialog
                    open={openServico}
                    setOpen={(open) => {
                      if (!open) {
                        setForm(emptyForm);
                      }
                      setOpenServico(open);
                    }}
                    loadServicos={() => handleGetServices(1, pagination.limit, "")}
                    form={form}
                    setForm={setForm}
                  />
                </>
              )}
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
            <Table className="text-xs mt-6">
              <TableHeader>
                <TableRow>
                  <TableCell>ID</TableCell>
                  <TableCell>CÓDIGO</TableCell>
                  <TableCell>DESCRIÇÃO</TableCell>
                  <TableCell>VALOR</TableCell>
                  <TableCell></TableCell>
                </TableRow>
              </TableHeader>
              <TableBody>
                {serviceItems.map((s) => (
                  <TableRow
                    className="hover:cursor-pointer"
                    onClick={() => {
                      if (OnSelect) {
                        OnSelect(s);
                      }
                      if (setOpen) {
                        setOpen(false);
                        setSearch("");
                      }
                    }}
                    key={s.id}
                  >
                    <TableCell>{s.id}</TableCell>
                    <TableCell>{s.codigo}</TableCell>
                    <TableCell className="max-w-[200px] truncate">{s.descricao}</TableCell>
                    <TableCell>{formatarEmReal(s.precohora)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>

        <DialogFooter className="">
          <div className="flex flex-row w-full h-full items-center justify-center pb-5">
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
                onClick={() => handleGetServices(1, pagination.limit, search)}
                disabled={pagination.page === 1}
              >
                <ChevronsLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="hover:cursor-pointer"
                onClick={() =>
                  handleGetServices(
                    pagination.page - 1,
                    pagination.limit,
                    search
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
                  handleGetServices(
                    pagination.page + 1,
                    pagination.limit,
                    search
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
                  handleGetServices(
                    pagination.totalPages,
                    pagination.limit,
                    search
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
