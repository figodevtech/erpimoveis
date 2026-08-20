import { TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Boxes, CalendarDays, DollarSign, LayoutDashboard, TrendingUp, UsersIcon } from "lucide-react";

export default function TabsOptions() {
  const tabTheme =
    "h-9 shrink-0 gap-2 rounded-xl border-0 px-3 text-muted-foreground transition-all hover:cursor-pointer hover:bg-primary/5 hover:text-foreground data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md data-[state=active]:shadow-primary/20";

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span>
            <TabsTrigger
              value="geral"
              className={tabTheme}
            >
              <LayoutDashboard className="h-4 w-4" />
              <span className="hidden sm:inline">Ordens</span>
            </TabsTrigger>
          </span>
        </TooltipTrigger>
        <TooltipContent>Ordens de Serviço</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <span>
            <TabsTrigger value="estoque" className={tabTheme}>
              <Boxes className="h-4 w-4" />
              <span className="hidden sm:inline">Estoque</span>
            </TabsTrigger>
          </span>
        </TooltipTrigger>
        <TooltipContent>Estoque</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <span>
            <TabsTrigger
              value="usuarios"
              className={tabTheme}
            >
              <UsersIcon className="h-4 w-4" />
              <span className="hidden sm:inline">Clientes</span>
            </TabsTrigger>
          </span>
        </TooltipTrigger>
        <TooltipContent>Clientes</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <span>
            <TabsTrigger
              value="financeiro"
              className={tabTheme}
            >
              <DollarSign className="h-4 w-4" />
              <span className="hidden sm:inline">Financeiro</span>
            </TabsTrigger>
          </span>
        </TooltipTrigger>
        <TooltipContent>Financeiro</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <span>
            <TabsTrigger
              value="resumo-diario"
              className={tabTheme}
            >
              <CalendarDays className="h-4 w-4" />
              <span className="hidden sm:inline">Hoje</span>
            </TabsTrigger>
          </span>
        </TooltipTrigger>
        <TooltipContent>Resumo Diário</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <span>
            <TabsTrigger value="rendimentos" className={tabTheme}>
              <TrendingUp className="h-4 w-4" />
              <span className="hidden sm:inline">Rentabilidade</span>
            </TabsTrigger>
          </span>
        </TooltipTrigger>
        <TooltipContent>Rendimentos</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
