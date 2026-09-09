export class ApiError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export async function api<T=any>(path:string, method='GET', value?:unknown):Promise<T> {
  const response=await fetch(`/api${path}`,{method,headers:{'Content-Type':'application/json'},...(value===undefined?{}:{body:JSON.stringify(value)})});
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
            if(['turn.completed','turn.failed','turn.cancelled'].includes(event.type))return;
          }
        }
      } finally {reader.releaseLock();}
      const turn=await api(`/turns/${id}`);if(['completed','failed','cancelled'].includes(turn.status))return;
    } catch(error) {if(signal.aborted||attempt===3)throw error;}
    await new Promise((resolve)=>setTimeout(resolve,500*(attempt+1)));
  }
  throw new Error('事件连接已断开，可刷新页面恢复。');
}
