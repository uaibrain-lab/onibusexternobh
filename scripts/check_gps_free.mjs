#!/usr/bin/env node
/* Explicit, read-only PBH GPS egress check. Never deploys or edits configs.
 * Run only after deploying the independent Free Worker to its own workers.dev.
 */
'use strict';
const args=Object.fromEntries(process.argv.slice(2).map(a=>{
  const [k,...v]=a.replace(/^--/,'').split('=');
  return [k,v.join('=')];
}));
const endpoint=args.worker;
const source=args.source||'CONVENCIONAL';
const nls=args.nls||'393';
if(!endpoint){
  console.error('Uso: node scripts/check_gps_free.mjs --worker=https://SEU-WORKER.workers.dev/api/gps --source=CONVENCIONAL --nls=393');
  process.exitCode=2;
}else{
  (async()=>{
    const url=new URL(endpoint);
    if(url.protocol!=='https:'||url.pathname!=='/api/gps'||url.search||url.hash)
      throw Error('O endpoint precisa ser HTTPS e terminar em /api/gps');
    url.searchParams.set('source',source);
    url.searchParams.set('nls',nls);
    const start=performance.now();
    const response=await fetch(url,{headers:{
      Origin:'https://hubufmg.web.app',Accept:'application/json'
    },signal:AbortSignal.timeout(12000)});
    const bytes=new Uint8Array(await response.arrayBuffer());
    const body=bytes.length<=1_000_000?JSON.parse(new TextDecoder().decode(bytes)):{error:'RESPONSE_TOO_LARGE'};
    if(!response.ok||body.available!==true||!Array.isArray(body.records))
      throw Error('Worker não respondeu corretamente (HTTP '+response.status+', '+String(body.error||'?')+')');
    if(response.headers.get('Access-Control-Allow-Origin')!=='https://hubufmg.web.app')
      throw Error('CORS ausente para a origem Hub UFMG');
    const count=body.records.length;
    if(count>1500)throw Error('Resposta ultrapassou limite configurado');
    const unique=new Set(body.records.map(v=>v.NV)).size;
    console.log(JSON.stringify({
      workerReachable:true,http:response.status,
      source,nls:nls.split(',').length,
      sampleVehicles:unique,fixes:count,
      transferBytes:bytes.length,elapsedMs:Math.round(performance.now()-start),
      receivedAt:new Date().toISOString(),
      gpsCoverageVerified:count>0,
      gpsEtaValidated:false,
      note:count?'Acesso ao Worker confirmado; valide idade e trajetorias em campo.':
        'Worker respondeu; nenhuma observação desta NL no momento.'
    },null,2));
  })().catch(error=>{
    console.error('GPS_PUBLIC_VALIDATION_FAILED',error.message);
    process.exitCode=2;
  });
}
