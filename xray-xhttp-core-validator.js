'use strict';
(()=>{
 const intelligence=window.XrayJsonIntelligence;
 if(!intelligence?.analyze)return;
 const original=intelligence.analyze.bind(intelligence);
 function visit(data){
  const issues=[];
  for(const group of ['inbounds','outbounds']){
   const list=Array.isArray(data?.[group])?data[group]:[];
   list.forEach((endpoint,index)=>{
    const stream=endpoint?.streamSettings;
    const network=String(stream?.network||stream?.method||'').toLowerCase();
    if(network!=='xhttp'&&network!=='splithttp')return;
    const settings=stream?.xhttpSettings??stream?.splithttpSettings;
    if(!settings||typeof settings!=='object'||Array.isArray(settings))return;
    const strict=window.XMeshXhttpStrict;
    if(!strict?.validateSettings)return;
    const role=group==='outbounds'?'client':'server';
    for(const message of strict.validateSettings(settings,role))issues.push({
     severity:'error',kind:'structure',code:'XHTTP_CORE_SCHEMA',message,
     line:1,column:1,start:0,end:1,path:[group,index,'streamSettings','xhttpSettings'],fix:null
    });
   });
  }
  return issues;
 }
 intelligence.analyze=(source,data)=>{
  const base=original(source,data);
  let parsed=data;
  if(!parsed||typeof parsed!=='object')try{parsed=JSON.parse(source)}catch{return base}
  return [...base,...visit(parsed)].slice(0,intelligence.MAX_ISSUES||100);
 };
})();
