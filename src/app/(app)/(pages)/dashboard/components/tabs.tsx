import { TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Boxes, DollarSign, UsersIcon } from "lucide-react";

export default function TabsOptions() {
  const tabTheme =
    "group h-9 shrink-0 gap-2 rounded-xl border-0 px-2.5 text-muted-foreground transition-all duration-200 hover:cursor-pointer hover:bg-primary/5 hover:text-foreground data-[state=active]:px-3 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md data-[state=active]:shadow-primary/20 sm:px-3";

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span>
            <TabsTrigger
              value="financeiro"
              className={tabTheme}
            >
              <DollarSign className="h-4 w-4" />
              <span className="hidden group-data-[state=active]:inline sm:inline">Financeiro</span>
            </TabsTrigger>
          </span>
        </TooltipTrigger>
        <TooltipContent>Financeiro</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <span>
            <TabsTrigger
              value="usuarios"
              className={tabTheme}
            >
              <UsersIcon className="h-4 w-4" />
              <span className="hidden group-data-[state=active]:inline sm:inline">Clientes</span>
            </TabsTrigger>
          </span>
        </TooltipTrigger>
        <TooltipContent>Clientes</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <span>
            <TabsTrigger value="estoque" className={tabTheme}>
              <Boxes className="h-4 w-4" />
              <span className="hidden group-data-[state=active]:inline sm:inline">Estoque</span>
            </TabsTrigger>
          </span>
        </TooltipTrigger>
        <TooltipContent>Estoque</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
