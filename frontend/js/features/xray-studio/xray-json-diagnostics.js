/* XRAY STUDIO — live JSON diagnostics and conservative one-click fixes.
   Keeps the native textarea, its undo history, and existing JSON serialization. */
(function(global){
 'use strict';
 function locate(source,error){
   const message=String(error?.message||'Invalid JSON');
   const at=message.match(/\bposition\s+(\d+)\b/i);
   if(at)return Math.min(source.length,Number(at[1]));
   const lc=message.match(/\bline\s+(\d+)\s+column\s+(\d+)/i);
   if(lc){
     const line=Number(lc[1]),col=Number(lc[2]);
     let start=0;
     for(let i=1;i<line;i++){
       const next=source.indexOf('\n',start);
       if(next<0)return source.length;
       start=next+1;
     }
     return Math.min(source.length,start+col-1);
   }
   if(/end of (?:JSON )?input|unterminated/i.test(message))return source.length;
   return null;
 }
 function point(source,index){
   index=Math.max(0,Math.min(source.length,index));
   let line=1,last=-1;
   for(let i=0;i<index;i++)if(source.charCodeAt(i)===10){line++;last=i}
   return {line,column:index-last};
 }
 function notInsideString(text,index){
   let quote=false,escape=false;
   for(let i=0;i<index;i++){
     if(escape){escape=false;continue}
     if(quote && text[i]==='\\'){escape=true;continue}
     if(text[i]==='"')quote=!quote;
   }
   return !quote;
 }
 function nextNonSpace(text,start){
   let i=start;
   while(i<text.length&&/\s/.test(text[i]))i++;
   return i;
 }
 function previousNonSpace(text,start){
   let i=start;
   while(i>=0&&/\s/.test(text[i]))i--;
   return i;
 }
 function tryParseProgress(source,next,offset){
   if(next===source)return false;
   try{JSON.parse(next);return true}
   catch(e){
     const at=locate(next,e);
     // A conservative edit must advance the parser, not introduce a new error.
     return at!==null && at>offset;
   }
 }
 function safeFix(source,position){
   if(position===null)return null;
   // Two commas in a row, optionally separated by whitespace. The second
   // comma is the syntax error (e.g. "protocol": "vless",, on line 8).
   // Only change the offending comma near the parser position, outside
   // string literals, and only when parsing advances after removal.
   for(let i=Math.max(0,position-6);i<=Math.min(source.length-1,position+1);i++){
     if(source[i]!==','||!notInsideString(source,i))continue;
     const previous=previousNonSpace(source,i-1);
     if(previous<0||source[previous]!==','||Math.abs(i-position)>3)continue;
     const next=source.slice(0,i)+source.slice(i+1);
     if(tryParseProgress(source,next,position)){
       return {start:i,end:i+1,replacement:'',label:'Убрать лишнюю запятую'};
     }
   }
   // Remove one trailing comma before a closing object/array. Only outside strings.
   const commaCandidates=[];
   // The parser already pinpoints the invalid neighborhood. Never inspect
   // every comma in an arbitrarily large JSON file on each keystroke.
   for(let i=Math.max(0,position-100);i<Math.min(source.length,position+100);i++){
     if(source[i]!==','||!notInsideString(source,i))continue;
     const j=nextNonSpace(source,i+1);
     if(source[j]===']'||source[j]==='}')commaCandidates.push(i);
   }
   commaCandidates.sort((a,b)=>Math.abs(a-position)-Math.abs(b-position));
   for(const index of commaCandidates){
     if(Math.abs(index-position)>100)break;
     const value=source.slice(0,index)+source.slice(index+1);
     if(tryParseProgress(source,value,position))
       return {start:index,end:index+1,replacement:'',label:'Убрать лишнюю запятую'};
   }
   // Missing separator between a JSON property name and its value.
   // Use a complete quoted key followed by a JSON value. Do not rewrite strings.
   const keyRe=/"(?:\\.|[^"\\])*"([ \t\r\n]+)(?="|-?\d|true\b|false\b|null\b|\{|\[)/g;
   let match;
   while((match=keyRe.exec(source))){
     const start=match.index+match[0].length-match[1].length;
     const end=start+match[1].length;
     if(Math.abs(end-position)>35)continue;
     if(!notInsideString(source,match.index))continue;
     const before=previousNonSpace(source,match.index-1);
     if(before>=0&&!['{',','].includes(source[before]))continue;
     const value=source.slice(0,start)+':'+source.slice(start);
     if(tryParseProgress(source,value,position))
       return {start,end:start,replacement:':',label:'Добавить двоеточие'};
   }
   // Missing comma between completed values and the next quoted object key.
   // A quoted next key MUST be followed by ':' — never infer an arbitrary value.
   const separator=/([}\]"0-9eEltf])(\s+)("(?:\\.|[^"\\])*"\s*:)/g;
   while((match=separator.exec(source))){
     const start=match.index+match[1].length;
     const next=nextNonSpace(source,start);
     if(Math.abs(next-position)>35)continue;
     if(!notInsideString(source,match.index))continue;
     const value=source.slice(0,start)+','+source.slice(start);
     if(tryParseProgress(source,value,position))
       return {start,end:start,replacement:',',label:'Добавить запятую'};
   }
   return null;
 }
 function inspect(source){
   try{
     const parsed=JSON.parse(source);
     let problem=null;
     if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)){
       problem={message:'Корень конфигурации Xray должен быть JSON-объектом.',start:0,kind:'structure'};
     }else if(!Array.isArray(parsed.inbounds)){
       const start=Math.max(0,source.indexOf('"inbounds"'));
       problem={message:'Добавьте массив inbounds.',start,kind:'structure'};
     }else if(parsed.inbounds.length===0){
       const start=Math.max(0,source.indexOf('"inbounds"'));
       problem={message:'В inbounds требуется хотя бы одно подключение.',start,kind:'structure'};
     }
     if(problem){
       const p=point(source,problem.start);
       return {...problem,end:Math.min(source.length,problem.start+Math.min(10,source.length)),...p,fix:null};
     }
     return null;
   }catch(error){
     const at=locate(source,error);
     // If a browser supplies no offset, show the error without inventing coordinates.
     const p=at===null?{line:null,column:null}:point(source,at);
     const start=at===null?null:(at===source.length?Math.max(0,at-1):at);
     let end=start===null?null:Math.min(source.length,start+1);
     if(start!==null && source[start]==='\n' && start>0){end=start; }
     const fix=safeFix(source,at);
     return {kind:'syntax',message:String(error.message),start,end,...p,fix};
   }
 }
 function escapeText(text){
   return String(text).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
 }
 function inspectAll(source){
   const first=inspect(source);
   if(first?.kind==='syntax')return [first];
   const expert=global.XrayJsonIntelligence;
   if(expert){
     try{return expert.analyze(source)}catch(error){
       return [{kind:'info',severity:'info',message:'Расширенная проверка временно недоступна: '+error.message,start:0,end:1,line:1,column:1,code:'ENGINE_ERROR',fix:null}];
     }
   }
   return first?[first]:[];
 }
 function decorateRun(text,offset,kind,diagnostics){
   const issues=Array.isArray(diagnostics)?diagnostics:diagnostics?[diagnostics]:[];
   const cls=kind?' class="'+escapeText(kind)+'"':'';
   const wrap=segment=>segment?'<span'+cls+'>'+escapeText(segment)+'</span>':'';
   let current=0,out='';
   const candidates=issues.filter(d=>d.start!==null&&d.start!==undefined&&d.end>offset&&d.start<offset+text.length)
     .sort((a,b)=>a.start-b.start);
   for(const issue of candidates){
     const begin=Math.min(text.length,Math.max(current,issue.start-offset));
     const end=Math.min(text.length,Math.max(begin,issue.end-offset));
     if(end<=begin)continue;
     out+=wrap(text.slice(current,begin));
     out+='<span class="sr-json-squiggle '+(issue.severity==='warning'?'is-warning':issue.severity==='info'?'is-info':'is-error')+
       '" title="'+escapeText(issue.message)+'">'+wrap(text.slice(begin,end))+'</span>';
     current=end;
   }
   return out+wrap(text.slice(current));
 }
 function attach(textarea){
   const frame=textarea.closest('.xray-custom-code-view');
   if(!frame)return null;
   if(frame.dataset.diagnosticsAttached==='true')return frame._jsonDiagnostics||null;
   frame.dataset.diagnosticsAttached='true';
   const area=frame.parentElement;
   const gutter=document.createElement('div');
   gutter.className='sr-json-gutter';
   gutter.setAttribute('aria-hidden','true');
   frame.prepend(gutter);
   const bar=document.createElement('div');
   bar.id='xpb-json-diagnostic';
   bar.className='sr-json-diagnostic';
   bar.setAttribute('role','status');
   bar.setAttribute('aria-live','polite');
   bar.innerHTML='<span class="sr-json-status-icon" aria-hidden="true"></span>'+
     '<span class="sr-json-status-text"></span>'+
     '<button type="button" class="sr-json-jump" hidden>К ошибке</button>'+
     '<button type="button" class="sr-json-hotfix" hidden>⚡ Hot Fix</button>';
   area.insertBefore(bar,frame);
   textarea.setAttribute('aria-describedby','xpb-custom-error xpb-json-diagnostic');
   const text=bar.querySelector('.sr-json-status-text');
   const hotfix=bar.querySelector('.sr-json-hotfix');
   const jump=bar.querySelector('.sr-json-jump');
   let diagnostic=null,diagnostics=[],selected=0,expanded=false;
   let lastTop=null,lastN=null,lastLine=null,lastHeight=0;
   const issueList=document.createElement('div');
   issueList.className='sr-json-issue-list';
   issueList.setAttribute('aria-label','Найденные проблемы Xray');
   const counters=document.createElement('span');counters.className='sr-json-counters';
   const more=document.createElement('button');more.type='button';more.className='sr-json-more';more.hidden=true;
   bar.prepend(counters);
   bar.append(issueList,more);
   more.addEventListener('click',()=>{expanded=!expanded;renderItems();});

   function drawGutter(){
     const total=textarea.value.split('\n').length;
     const styles=getComputedStyle(textarea);
     const lineHeight=parseFloat(styles.lineHeight)||24;
     const topPad=parseFloat(styles.paddingTop)||16;
     const scroll=textarea.scrollTop;
     const first=Math.max(1,Math.floor((scroll-topPad)/lineHeight)+1-2);
     const last=Math.min(total,Math.ceil((scroll+frame.clientHeight-topPad)/lineHeight)+3);
     const flagged=diagnostics.filter(x=>x.line!==null&&x.line!==undefined).map(x=>x.line);
     if(lastTop===first && lastN===total&&lastLine===flagged.join(',')&&lastHeight===frame.clientHeight)return;
     lastTop=first;lastN=total;lastLine=flagged.join(',');lastHeight=frame.clientHeight;
     gutter.replaceChildren();
     const frag=document.createDocumentFragment();
     for(let line=first;line<=last;line++){
       const node=document.createElement('span');
       node.className='sr-json-gutter-number'+(flagged.includes(line)?' is-error':'');
       node.textContent=line;
       node.style.top=(topPad+(line-1)*lineHeight-scroll)+'px';
       node.style.height=lineHeight+'px';
       node.style.lineHeight=lineHeight+'px';
       if(flagged.includes(line))node.title='Проблема Xray: строка '+line;
       frag.append(node);
     }
     gutter.append(frag);
   }
   function jumpToError(){
     if(!diagnostic||diagnostic.start===null)return;
     const pos=diagnostic.start;
     textarea.focus();
     textarea.setSelectionRange(pos,pos+(diagnostic.end>pos?1:0));
     const lineHeight=parseFloat(getComputedStyle(textarea).lineHeight)||24;
     const padding=parseFloat(getComputedStyle(textarea).paddingTop)||16;
     textarea.scrollTop=Math.max(0,(diagnostic.line-1)*lineHeight+padding-textarea.clientHeight/3);
     drawGutter();
   }
   jump.addEventListener('click',jumpToError);
   hotfix.addEventListener('click',()=>{
     const proposal=diagnostic?.fix;
     if(!proposal)return;
     textarea.focus();
     textarea.setRangeText(proposal.replacement,proposal.start,proposal.end,'end');
     textarea.dispatchEvent(new Event('input',{bubbles:true}));
   });
   textarea.addEventListener('scroll',()=>{lastTop=null;drawGutter()},{passive:true});
   const selectIssue=index=>{
     if(index<0||index>=diagnostics.length)return;
     selected=index;diagnostic=diagnostics[index];
     renderStatus();
     jumpToError();
   };
   const renderItems=()=>{
     issueList.replaceChildren();
     issueList.hidden=diagnostics.length<2;
     const limit=expanded?diagnostics.length:Math.min(diagnostics.length,5);
     const frag=document.createDocumentFragment();
     diagnostics.slice(0,limit).forEach((item,index)=>{
       const button=document.createElement('button');
       button.type='button';
       button.className='sr-json-issue'+(index===selected?' is-selected':'');
       const tag=document.createElement('span');
       tag.className='sr-json-issue-severity '+(item.severity||item.kind||'warning');
       tag.textContent=(item.severity==='error'||item.kind==='syntax'?'Ошибка':item.severity==='info'?'Совет':'Предупреждение');
       const title=document.createElement('span');
       title.className='sr-json-issue-label';
       title.textContent=(item.line?('Строка '+item.line+' · '):'')+item.message;
       button.append(tag,title);
       button.addEventListener('click',()=>selectIssue(index));
       frag.append(button);
     });
     issueList.append(frag);
     more.hidden=diagnostics.length<=5;
     more.textContent=expanded?'Свернуть список':'Показать все ('+diagnostics.length+')';
   };
   const renderStatus=()=>{
     const issue=diagnostic;
     const status=issue?.kind==='syntax'||issue?.severity==='error'?'error':issue?.severity==='warning'||issue?.kind==='structure'?'warning':issue?'info':'ok';
     bar.dataset.state=status;
     const errs=diagnostics.filter(x=>x.severity==='error'||x.kind==='syntax').length;
     const warnings=diagnostics.filter(x=>x.severity==='warning').length;
     counters.textContent=diagnostics.length?('Проблемы: '+errs+' ошибок, '+warnings+' предупреждений'):'✓ JSON проверен';
     if(!issue){
       text.textContent='Синтаксис и известные параметры Xray: замечаний не найдено. Окончательная проверка — xray run -test.';
       jump.hidden=true;hotfix.hidden=true;
     }else{
       const where=issue.line==null?'':('Строка '+issue.line+', столбец '+issue.column+' · ');
       text.textContent=where+issue.message+(issue.fix?'':' · Автоматическая правка недоступна.');
       jump.hidden=issue.start==null;
       hotfix.hidden=!issue.fix;
       if(issue.fix)hotfix.textContent='⚡ Hot Fix: '+issue.fix.label;
     }
     renderItems();
     lastTop=null;drawGutter();
   };
   const update=issues=>{
     diagnostics=Array.isArray(issues)?issues:issues?[issues]:[];
     const previous=diagnostic?.code;
     const previousLine=diagnostic?.line;
     const preserved=diagnostics.findIndex(x=>x.code===previous&&x.line===previousLine);
     selected=preserved>=0?preserved:0;
     diagnostic=diagnostics[selected]||null;
     renderStatus();
   };
   const api={update,inspect,inspectAll,decorateRun,jumpToError};
   frame._jsonDiagnostics=api;
   if(global.ResizeObserver){const ro=new ResizeObserver(()=>{lastTop=null;drawGutter()});ro.observe(frame)}
   drawGutter();
   return api;
 }
 global.XrayJsonDiagnostics={inspect,inspectAll,locate,safeFix,point,decorateRun,attach};
})(window);
