import { TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { CalendarDays, DollarSign, LayoutDashboard, TrendingUp, UsersIcon } from "lucide-react";

export default function TabsOptions() {
  const tabTheme =
    " rounded-xl border border-transparent text-muted-foreground transition-all hover:cursor-pointer hover:text-foreground data-[state=active]:bg-primary dark:data-[state=active]:bg-primary data-[state=active]:text-primary-foreground dark:data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm";

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
            </TabsTrigger>
          </span>
        </TooltipTrigger>
        <TooltipContent>Ordens de Serviço</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <span>
            <TabsTrigger
              value="usuarios"
              className={tabTheme}
            >
              <UsersIcon className="h-4 w-4" />
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
            </TabsTrigger>
          </span>
        </TooltipTrigger>
        <TooltipContent>Rendimentos</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
