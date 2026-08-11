"use client";

import * as React from "react";
import { Tabs, TabsList } from "@/components/ui/tabs";
import {
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from "@/components/ui/dialog";
import {
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerClose,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

type Props = {
  title: React.ReactNode;
  description?: string;
  defaultTab: string;
  loading?: boolean;

  tabs: React.ReactNode;
  children: React.ReactNode;

  submitLabel: string;
  submitLabel2?: string;
  submitIcon?: React.ReactNode;
  submitting?: boolean;
  onSubmit: (value?: boolean) => void | Promise<void>;

  currentTab: string;

  /** ✅ NOVO */
  submitDisabled?: boolean;
  isDesktop?: boolean;
  isDrawer?: boolean;
};

export function ProductDialogLayout({
  title,
  description,
  defaultTab,
  loading = false,
  currentTab,
  tabs,
  children,
  submitLabel,
  submitLabel2,
  submitting = false,
  onSubmit,
  submitDisabled = false,
  isDesktop = true,
  isDrawer = false,
}: Props) {
  const DialogShellContent = isDrawer ? DrawerContent : DialogContent;
  const DialogShellHeader = isDrawer ? DrawerHeader : DialogHeader;
  const DialogShellFooter = isDrawer ? DrawerFooter : DialogFooter;
  const DialogShellTitle = isDrawer ? DrawerTitle : DialogTitle;
  const DialogShellDescription = isDrawer ? DrawerDescription : DialogDescription;
  const DialogShellClose = isDrawer ? DrawerClose : DialogClose;

  const mobileContentClass = isDrawer
    ? "!inset-0 !m-0 !h-[100dvh] !min-h-[100dvh] !w-[100dvw] !max-w-[100dvw] !max-h-none !rounded-none !border-0 overflow-x-hidden overflow-y-hidden overscroll-contain [&>div:first-child]:hidden data-[vaul-drawer-direction=bottom]:!mt-0 data-[vaul-drawer-direction=bottom]:!max-h-none data-[vaul-drawer-direction=bottom]:!rounded-none"
    : "flex h-[100dvh] min-h-[100dvh] w-[100dvw] max-w-[100dvw] flex-col gap-0 overflow-x-hidden overflow-y-hidden overscroll-contain rounded-none border-0 p-0 [&>[data-slot=dialog-close]]:right-2 [&>[data-slot=dialog-close]]:top-[max(0.5rem,env(safe-area-inset-top))] [&>[data-slot=dialog-close]]:grid [&>[data-slot=dialog-close]]:size-11 [&>[data-slot=dialog-close]]:place-items-center";

  return (
    <DialogShellContent
      className={
        isDesktop
          ? `
        h-svh w-[100dvw] max-w-[100dvw] p-0 overflow-hidden min-w-0
        sm:max-w-[1100px] sm:max-h-[850px] sm:w-[95vw] sm:min-w-0
      `
          : mobileContentClass
      }
    >
      <div className="flex h-full min-h-0 min-w-0 w-full max-w-full flex-col overflow-x-hidden">
        {!loading ? (
          <>
            <DialogShellHeader
              className={
                isDesktop
                  ? "shrink-0 border-b px-4 py-3 sm:px-6"
                  : "shrink-0 border-b pb-3 pl-4 pr-14 pt-[max(0.75rem,env(safe-area-inset-top))] text-left"
              }
            >
              <DialogShellTitle className={isDesktop ? "pr-4 text-sm sm:text-lg" : "text-sm text-left"}>
                {title}
              </DialogShellTitle>
              {description ? <DialogShellDescription>{description}</DialogShellDescription> : null}
            </DialogShellHeader>

            <Tabs
              value={currentTab}
              defaultValue={defaultTab}
              className="mt-4 flex-1 min-h-0 min-w-0 w-full max-w-full overflow-hidden"
            >
              <div className="sticky top-0 z-10 w-full min-w-0 max-w-full shrink-0 overflow-hidden">
                <div
                  className={
                    isDesktop
                      ? `
                    w-full min-w-0 max-w-full overflow-hidden px-6 pb-2
                  `
                      : "w-full min-w-0 max-w-full overflow-hidden px-4 pb-2"
                  }
                >
                  <TabsList
                    className="!flex h-auto !w-full !min-w-0 !max-w-full justify-start gap-1.5 overflow-x-auto overflow-y-hidden overscroll-x-contain rounded-2xl border-border bg-muted/90 p-1 shadow-sm backdrop-blur-sm [scrollbar-width:thin] [&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border"
                  >
                    {tabs}
                  </TabsList>
                </div>
              </div>

              {children}
            </Tabs>

            <DialogShellFooter
              className={
                isDesktop
                  ? "shrink-0 border-t px-4 py-3 sm:px-6"
                  : "shrink-0 min-w-0 max-w-full overflow-x-hidden border-t px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3"
              }
            >
              <div
                className={
                  isDesktop
                    ? "flex w-full flex-row justify-end gap-2"
                    : "grid w-full min-w-0 max-w-full grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2"
                }
              >
                <DialogShellClose asChild>
                  <Button
                    type="button"
                    className={isDesktop ? "h-9 min-w-24 shrink-0 hover:cursor-pointer" : "min-h-11 min-w-0 w-full px-2 hover:cursor-pointer"}
                    variant="outline"
                  >
                    Cancelar
                  </Button>
                </DialogShellClose>
                {submitLabel2 && (
                  <Button
                    variant="secondary"
                    type="button"
                    disabled={submitting || submitDisabled}
                    className={
                      isDesktop
                        ? "h-9 min-w-24 shrink-0 text-sm hover:cursor-pointer"
                        : "min-h-11 min-w-0 w-full whitespace-normal px-2 text-sm leading-tight hover:cursor-pointer"
                    }
                    onClick={() => onSubmit(true)}
                  >
                    {submitting ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Salvando...
                      </>
                    ) : (
                      submitLabel2
                    )}
                  </Button>
                )}
                <Button
                  type="button"
                  disabled={submitting || submitDisabled}
                  className={
                    isDesktop
                      ? "h-9 min-w-24 shrink-0 text-sm hover:cursor-pointer"
                      : `min-h-11 min-w-0 w-full px-2 text-sm hover:cursor-pointer ${submitLabel2 ? "col-span-2" : ""}`
                  }
                  onClick={() => onSubmit()}
                >
                  {submitting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Salvando...
                    </>
                  ) : (
                    submitLabel
                  )}
                </Button>
              </div>
            </DialogShellFooter>
          </>
        ) : (
          <>
            <DialogShellHeader className="sr-only">
              <DialogShellTitle>{title}</DialogShellTitle>
              {description ? <DialogShellDescription>{description}</DialogShellDescription> : null}
            </DialogShellHeader>
            <div className="flex flex-1 min-h-0 flex-col relative">
              {children}
            </div>
          </>
        )}
      </div>
    </DialogShellContent>
  );
}
