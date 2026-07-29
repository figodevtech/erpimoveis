import { redirect } from "next/navigation";

export default function RegistrarEtiquetaUsoConsumoRedirect() {
  redirect("/etiquetas/registrar?origem=usoconsumo");
}
