import { Button } from '@/components/ui/button';
export const dynamic='force-dynamic';
export const metadata={title:'Conexão de frete',robots:{index:false,follow:false}};
export default async function ShippingAuthorizationResult({searchParams}:{searchParams:Promise<{status?:string}>}){
 const {status}=await searchParams;
 const messages:Record<string,{title:string;description:string}>={connected:{title:'Melhor Envio conectado',description:'A conta foi autorizada para cotar fretes. Volte ao ERP e atualize o status da conexão.'},denied:{title:'Autorização cancelada',description:'Nenhuma nova conexão foi salva. Você pode tentar novamente pelo ERP.'},invalid:{title:'Autorização inválida ou expirada',description:'Inicie uma nova conexão pelo ERP. Não reutilize um link de autorização anterior.'},error:{title:'Não foi possível concluir a conexão',description:'Confira o ambiente, Client ID, Client Secret e URL de retorno do aplicativo. Depois, tente novamente pelo ERP.'}};
 const message=messages[status||'']||messages.invalid;
 let erp:string|undefined;
 try{const url=new URL(process.env.ERP_ORDER_WEBHOOK_URL||'');if(url.protocol==='https:')erp=url.origin+'/marketplace';}catch{/* No arbitrary browser-provided return URL. */}
 return <main className="mx-auto flex min-h-[60vh] max-w-xl items-center px-4 py-12"><section className="w-full space-y-4 rounded-xl border bg-card p-6"><h1 className="text-xl font-semibold">{message.title}</h1><p className="text-sm text-muted-foreground">{message.description}</p>{erp&&<Button asChild><a href={erp} rel="noreferrer">Voltar ao ERP</a></Button>}</section></main>;
}
