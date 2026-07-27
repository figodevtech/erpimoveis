import { ReportsGrid } from "./components/reports-grid";

export default function ReportsPage() {
  return (
    <div className="space-y-6 pb-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Relatórios</h1>
        <p className="text-sm text-muted-foreground">
          Consulte indicadores, filtre informações operacionais e gere documentos para análise.
        </p>
      </header>
      <ReportsGrid />
    </div>
  )
}
