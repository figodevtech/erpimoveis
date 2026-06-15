"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight, type LucideIcon } from "lucide-react";
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

type SubItem = { title: string; url: string; icon?: LucideIcon };
type Item = {
  title: string;
  url: string; // pode ser "#" quando for agrupador
  icon?: LucideIcon;
  isActive?: boolean;
  items?: SubItem[];
};

function pathActive(href: string, pathname: string) {
  if (!href || href === "#") return false;
  if (pathname === href) return true;
  return pathname.startsWith(href.endsWith("/") ? href : href + "/");
}

function NavMainCollapsibleItem({ item }: { item: Item & { items: NonNullable<Item["items"]> } }) {
  const uid = React.useId();
  const contentId = `${uid}-content`;
  const pathname = usePathname();

  const isGroupActive = React.useMemo(
    () => item.items?.some((s) => pathActive(s.url, pathname)) ?? false,
    [item.items, pathname]
  );

  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (isGroupActive) setOpen(true);
  }, [isGroupActive]);

  return (
    <Collapsible asChild open={open} onOpenChange={setOpen} className="group/collapsible">
      <SidebarMenuItem>
        <CollapsibleTrigger asChild>
          <SidebarMenuButton
            // ⚠️ sem tooltip aqui para evitar wrapper do Radix e mismatch
            isActive={isGroupActive}
            className="transition-all hover:cursor-pointer hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            aria-controls={contentId}
          >
            {item.icon ? <item.icon /> : null}
            <span>{item.title}</span>
            <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
          </SidebarMenuButton>
        </CollapsibleTrigger>

        <CollapsibleContent id={contentId}>
          <SidebarMenuSub>
            {item.items.map((sub) => {
              const subActive = pathActive(sub.url, pathname);
              return (
                <SidebarMenuSubItem key={sub.title}>
                  <SidebarMenuSubButton
                    asChild
                    isActive={subActive as any}
                    data-active={subActive || undefined}
                    className="transition-all hover:cursor-pointer hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  >
                    <Link href={sub.url} aria-current={subActive ? "page" : undefined} title={sub.title}>
                      {sub.icon ? <sub.icon /> : null}
                      <span>{sub.title}</span>
                    </Link>
                  </SidebarMenuSubButton>
                </SidebarMenuSubItem>
              );
            })}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  );
}

export function NavMain({ items }: { items: Item[] }) {
  const pathname = usePathname();

  if (items.length === 0) return null;

  return (
    <SidebarGroup>
      <SidebarGroupLabel>Módulos</SidebarGroupLabel>
      <SidebarMenu>
        {items.map((item) => {
          if (item.items?.length) {
            return <NavMainCollapsibleItem key={item.title} item={item as any} />;
          }

          const isActive = pathActive(item.url, pathname);

          return (
            <SidebarMenuItem key={item.title}>
              <SidebarMenuButton
                asChild
                // ⚠️ sem tooltip aqui também
                isActive={isActive}
                className="transition-all hover:cursor-pointer hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              >
                <Link href={item.url} aria-current={isActive ? "page" : undefined} title={item.title}>
                  {item.icon ? <item.icon /> : null}
                  <span>{item.title}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          );
        })}
      </SidebarMenu>
    </SidebarGroup>
  );
}
