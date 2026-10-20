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
   // Remove one trailing comma before a closing object/array. Only outside strings.
   const commaCandidates=[];
   for(let i=0;i<source.length;i++){
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
 function decorateRun(text,offset,kind,diagnostic){
   let classes=kind?' class="'+escapeText(kind)+'"':'';
   if(diagnostic?.start===null||diagnostic?.start===undefined||diagnostic.end===null||diagnostic.end<=offset||diagnostic.start>=offset+text.length){
     return '<span'+classes+'>'+escapeText(text)+'</span>';
   }
   const a=Math.max(0,diagnostic.start-offset);
   const b=Math.min(text.length,Math.max(a+1,diagnostic.end-offset));
   const wrap=segment=>'<span'+classes+'>'+escapeText(segment)+'</span>';
   return wrap(text.slice(0,a))+
     '<span class="sr-json-squiggle" title="'+escapeText(diagnostic.message)+'">'+wrap(text.slice(a,b))+'</span>'+
     wrap(text.slice(b));
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
   let diagnostic=null;
   let lastTop=null,lastN=null,lastLine=null,lastHeight=0;
   function drawGutter(){
     const total=textarea.value.split('\n').length;
     const styles=getComputedStyle(textarea);
     const lineHeight=parseFloat(styles.lineHeight)||24;
     const topPad=parseFloat(styles.paddingTop)||16;
     const scroll=textarea.scrollTop;
     const first=Math.max(1,Math.floor((scroll-topPad)/lineHeight)+1-2);
     const last=Math.min(total,Math.ceil((scroll+frame.clientHeight-topPad)/lineHeight)+3);
     const flagged=diagnostic?.line;
     if(lastTop===first && lastN===total&&lastLine===flagged&&lastHeight===frame.clientHeight)return;
     lastTop=first;lastN=total;lastLine=flagged;lastHeight=frame.clientHeight;
     gutter.replaceChildren();
     const frag=document.createDocumentFragment();
     for(let line=first;line<=last;line++){
       const node=document.createElement('span');
       node.className='sr-json-gutter-number'+(flagged===line?' is-error':'');
       node.textContent=line;
       node.style.top=(topPad+(line-1)*lineHeight-scroll)+'px';
       node.style.height=lineHeight+'px';
       node.style.lineHeight=lineHeight+'px';
       if(flagged===line)node.title='Ошибка: строка '+line;
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
   const update=issue=>{
     diagnostic=issue;
     const status=issue?.kind==='syntax'?'error':issue?'warning':'ok';
     bar.dataset.state=status;
     if(!issue){
       text.textContent='JSON корректен — синтаксических ошибок нет.';
       jump.hidden=true;hotfix.hidden=true;
     }else{
       const where=issue.line===null?'':('Строка '+issue.line+', столбец '+issue.column+' · ');
       text.textContent=where+issue.message;
       jump.hidden=issue.start===null;
       hotfix.hidden=!issue.fix;
       if(issue.fix)hotfix.textContent='⚡ Hot Fix: '+issue.fix.label;
     }
     lastTop=null;drawGutter();
   };
   const api={update,inspect,decorateRun,jumpToError};
   frame._jsonDiagnostics=api;
   if(global.ResizeObserver){const ro=new ResizeObserver(()=>{lastTop=null;drawGutter()});ro.observe(frame)}
   drawGutter();
   return api;
 }
 global.XrayJsonDiagnostics={inspect,locate,safeFix,point,decorateRun,attach};
})(window);
