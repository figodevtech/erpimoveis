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
}: Props) {
  const DialogShellContent = isDesktop ? DialogContent : DrawerContent;
  const DialogShellHeader = isDesktop ? DialogHeader : DrawerHeader;
  const DialogShellFooter = isDesktop ? DialogFooter : DrawerFooter;
  const DialogShellTitle = isDesktop ? DialogTitle : DrawerTitle;
  const DialogShellDescription = isDesktop ? DialogDescription : DrawerDescription;
  const DialogShellClose = isDesktop ? DialogClose : DrawerClose;

  return (
    <DialogShellContent
      className={
        isDesktop
          ? `
        h-svh w-[100dvw] max-w-[100dvw] p-0 overflow-hidden min-w-0
        sm:max-w-[1100px] sm:max-h-[850px] sm:w-[95vw] sm:min-w-0
      `
          : `h-[100dvh] min-h-dvh mt-0 rounded-none max-h-none flex flex-col`
      }
    >
      <div className="flex h-full min-h-0 min-w-0 flex-col">
        {!loading ? (
          <>
            <DialogShellHeader className={isDesktop ? "shrink-0 border-b px-4 py-3 sm:px-6" : "shrink-0 border-b px-4 py-3"}>
              <DialogShellTitle className={isDesktop ? "pr-4 text-sm sm:text-lg" : "text-sm"}>
                {title}
              </DialogShellTitle>
              {description ? <DialogShellDescription>{description}</DialogShellDescription> : null}
            </DialogShellHeader>

            <Tabs
              value={currentTab}
              defaultValue={defaultTab}
              className="mt-4 flex-1 min-h-0 min-w-0 overflow-hidden"
            >
              <div className="sticky top-0 z-10 shrink-0">
                <div
                  className={
                    isDesktop
                      ? `
                    overflow-x-auto overflow-y-hidden px-6 pb-2
                    [scrollbar-width:thin] [&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border
                  `
                      : `overflow-x-auto overflow-y-hidden px-4 pb-2 [scrollbar-width:thin] [&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border`
                  }
                >
                  <TabsList
                    className="h-auto min-w-full justify-start gap-1.5 rounded-2xl border-border bg-muted/90 p-1 shadow-sm backdrop-blur-sm"
                  >
                    {tabs}
                  </TabsList>
                </div>
              </div>

              {children}
            </Tabs>

            <DialogShellFooter className={isDesktop ? "shrink-0 border-t px-4 py-3 sm:px-6" : "shrink-0 border-t px-4 py-3"}>
              <div className="flex w-full flex-row justify-end gap-2 overflow-x-auto">
                <DialogShellClose asChild>
                  <Button
                    type="button"
                    className="h-9 min-w-24 shrink-0 hover:cursor-pointer"
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
                    className="h-9 min-w-24 shrink-0 text-sm hover:cursor-pointer"
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
                  className="h-9 min-w-24 shrink-0 text-sm hover:cursor-pointer"
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
