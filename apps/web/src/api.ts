export class ApiError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export async function api<T=any>(path:string, method='GET', value?:unknown, options: { keepalive?: boolean; signal?: AbortSignal } = {}):Promise<T> {
  const bodyText = value === undefined ? undefined : JSON.stringify(value);
  // Browsers cap keepalive bodies at 64 KiB; normal large edits must still save.
  const keepalive = options.keepalive === true && new Blob([bodyText ?? '']).size < 60_000;
  const response=await fetch(`/api${path}`,{keepalive,method,headers:{'Content-Type':'application/json'},...(options.signal ? { signal: options.signal } : {}),...(bodyText===undefined?{}:{body:bodyText})});
  const body=await response.json(); if(!response.ok)throw new ApiError(response.status,body.error??`HTTP ${response.status}`); return body as T;
}
export async function streamTurn(id:string,onEvent:(event:any)=>void,signal:AbortSignal) {
  let after=0;
  for(let attempt=0;attempt<4;attempt++) {
    try {
      const response=await fetch(`/api/turns/${id}/events?after=${after}`,{signal});
      if(!response.ok||!response.body)throw new Error('无法连接生成事件流。');
      const reader=response.body.getReader(); const decoder=new TextDecoder(); let buffer='';
      try {
        while(true) {
          const {value,done}=await reader.read(); if(done)break;
          buffer+=decoder.decode(value,{stream:true}).replaceAll('\r\n','\n');
          let boundary:number;
          while((boundary=buffer.indexOf('\n\n'))>=0) {
            const block=buffer.slice(0,boundary);buffer=buffer.slice(boundary+2);
            const data=block.split('\n').filter((line)=>line.startsWith('data:')).map((line)=>line.slice(5).trimStart()).join('\n');
            if(!data)continue;const event=JSON.parse(data);if(event.id>0&&event.id<=after)continue;if(event.id>0)after=event.id;onEvent(event);
            if(['turn.completed','turn.partial','turn.failed','turn.cancelled'].includes(event.type))return;
          }
        }
      } finally {reader.releaseLock();}
      const turn=await api(`/turns/${id}`);if(['partial','failed','cancelled'].includes(turn.status)||(turn.status==='completed'&&turn.recordsStatus!=='running'))return;
    } catch(error) {if(signal.aborted||attempt===3)throw error;}
    await new Promise((resolve)=>setTimeout(resolve,500*(attempt+1)));
  }
  throw new Error('事件连接已断开，可刷新页面恢复。');
}
