import { redirect } from "next/navigation";

export default function RegistrarEtiquetaEstoqueRedirect() {
  redirect("/etiquetas/registrar?origem=produto");
}
