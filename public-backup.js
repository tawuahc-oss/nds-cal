// Only explicitly public GET routes can read the backup store. Admin requests never do.
export function withPublicBackup(handler,{prefix,publicPath,keys,snapshot,restore,warmKeys}){
  return {async fetch(request,env,ctx){
    const url=new URL(request.url),isPublic=request.method==='GET'&&publicPath(url.pathname,url);
    let response;
    try{response=await handler.fetch(request,env,ctx);}catch(error){
      if(!isPublic)throw error;
      response=Response.json({error:'服務暫時無法連線。'},{status:503});
    }
    if(!env.PUBLIC_BACKUPS)return response;
    const refresh=async(force=false)=>{
      for(const key of force?warmKeys():keys(url)){
        try{
          const previous=await env.PUBLIC_BACKUPS.get(prefix+key,'json');
          const age=previous?Date.now()-Date.parse(previous.saved_at):Infinity;
          if(!force&&age<900000)continue;
          if(force&&age<1100)await new Promise(resolve=>setTimeout(resolve,1100-age));
          const data=await snapshot(env,key);
          await env.PUBLIC_BACKUPS.put(prefix+key,JSON.stringify({saved_at:new Date().toISOString(),data}));
        }catch{console.error('Public backup refresh failed: '+prefix+key);}
      }
    };
    if(isPublic&&response.ok){
      if(ctx?.waitUntil)ctx.waitUntil(refresh());
      return response;
    }
    if(request.method!=='GET'&&url.pathname.startsWith('/api/admin/')&&response.ok&&
       !/\/(login|logout|change-password|recovery-code|reset-password)$/.test(url.pathname)){
      if(ctx?.waitUntil)ctx.waitUntil(refresh(true));
    }
    if(!isPublic||response.status<500)return response;
    try{
      const backups=await Promise.all(keys(url).map(key=>env.PUBLIC_BACKUPS.get(prefix+key,'json')));
      if(backups.some(value=>!value))return response;
      const data=restore(backups.map(value=>value.data),url);
      const saved=backups.map(value=>value.saved_at).sort()[0];
      const headers=new Headers(response.headers);
      headers.set('Content-Type','application/json; charset=utf-8');
      headers.set('Cache-Control','no-store');headers.set('X-Data-Backup','1');
      return new Response(JSON.stringify({...data,stale:true,backup_saved_at:saved}),{status:200,headers});
    }catch{return response;}
  }};
}
