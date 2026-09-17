import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function SpedLoading() {
  return (
    <div className="space-y-5" aria-label="Carregando SPED Fiscal" aria-busy="true">
      <div className="space-y-2"><Skeleton className="h-8 w-44" /><Skeleton className="h-4 w-full max-w-xl" /></div>
      <Card><CardHeader><Skeleton className="h-5 w-32" /><Skeleton className="h-4 w-72" /></CardHeader><CardContent className="space-y-2">{Array.from({ length: 3 }).map((_, index) => <Skeleton key={index} className="h-14 w-full" />)}</CardContent></Card>
      <Skeleton className="h-80 w-full" />
    </div>
  );
}
