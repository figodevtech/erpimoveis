import { useConfig } from "@/app/(app)/(pages)/config-context";
import { StatusOS } from "@/app/(app)/(pages)/ordens/types";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { ReactNode } from "react";

interface DeleteAlertProps{
    children?: ReactNode;
    handleDeleteTransaction: (value: number)=>void
    isAlertOpen: boolean
    setIsAlertOpen: (value: boolean)=>void
    idToDelete: number
    statusOs?: StatusOS | null
  
}
export default function DeleteAlert({children, handleDeleteTransaction, isAlertOpen, setIsAlertOpen, idToDelete, statusOs}: DeleteAlertProps) {
  const config = useConfig();
  return (
    <AlertDialog open={isAlertOpen} onOpenChange={setIsAlertOpen}>
      <AlertDialogTrigger asChild>
        {children}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Você tem certeza?</AlertDialogTitle>
          <AlertDialogDescription>
            {statusOs === "CONCLUIDO" ?
            
            `A OS já está concluída. Excluir esta transação é irreversível. Se a cobertura ficar abaixo do total, a OS retornará para ${config?.habilitar_faturamento_os ? "Faturamento" : "Pagamento"}.`
            :
            "Esta ação não pode ser desfeita. Deletará a transação." 
          }
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="hover:cursor-pointer">Cancelar</AlertDialogCancel>
          <AlertDialogAction className="hover:cursor-pointer" onClick={()=>handleDeleteTransaction(idToDelete)}>Continuar</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

