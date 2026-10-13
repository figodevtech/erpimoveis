// Read-only HTTP availability probe. Never sends payment or customer data.
const targets = [
 ['ERP local','http://localhost:3000'],
 ['Central local','http://localhost:3001'],
 ['Loja local','http://localhost:3002'],
 ['Loja publicada','https://demirdiesel.com.br'],
];
Promise.all(targets.map(async ([service,url])=>{
 try {const response=await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(8000)});console.log(JSON.stringify({service,status:response.status}));await response.body?.cancel();}
 catch(error){console.log(JSON.stringify({service,unavailable:true,code:error.cause?.code||error.name}));}
})).catch(()=>{process.exitCode=1;});
