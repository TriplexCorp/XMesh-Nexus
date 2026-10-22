'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('xray-studio-dialogs.js','utf8');

class Element{
 constructor(tag){this.tagName=tag;this.children=[];this.events={};this.attrs={};this.value='';this.hidden=false;this.parent=null;this.removed=false;this.textContent='';}
 append(...items){for(const item of items){item.parent=this;this.children.push(item)}}
 remove(){if(this.parent)this.parent.children=this.parent.children.filter(x=>x!==this);this.removed=true}
 addEventListener(name,fn){(this.events[name]??=[]).push(fn)}
 setAttribute(n,v){this.attrs[n]=v}
 removeAttribute(n){delete this.attrs[n]}
 focus(){document.activeElement=this}
 select(){}
 close(){this.open=false}
 showModal(){this.open=true}
 set innerHTML(value){this.markup=value}
 get innerHTML(){return this.markup||''}
}
class Input extends Element{constructor(tag){super(tag)}}
const body=new Element('body');
const document={body,activeElement:null,createElement:tag=>tag==='input'?new Input(tag):new Element(tag)};
const window={};
vm.runInNewContext(source,{window,document,HTMLInputElement:Input});
const find=(node,predicate)=>predicate(node)?node:node.children.reduce((match,c)=>match||find(c,predicate),null);
const tick=async()=>{for(let i=0;i<8;i++)await Promise.resolve()};
const emit=(node,event)=>{const e={type:event,preventDefault(){},target:node};for(const handler of node.events[event]||[])handler(e)};
const top=()=>body.children.at(-1);
async function main(){
 const before=new Element('button');before.focus();
 const pending=window.XMeshStudioDialogs.request({
  title:'Новое соединение',fields:[{name:'tag',label:'Тег',required:true,pattern:'[A-Za-z0-9_.-]{1,64}',value:'bad value',patternMessage:'Некорректный тег'},
   {name:'port',label:'Порт',type:'number',min:1,max:65535,value:'443'}]
 });
 await tick();
 let modal=top(),form=find(modal,n=>n.tagName==='form');
 assert.ok(modal.open,'native browser dialog enhanced by theme');
 const tag=find(modal,n=>n.name==='tag');
 emit(form,'submit');assert.equal(tag.attrs['aria-invalid'],'true','bad tag flagged inside modal');
 assert.equal(modal.open,true,'validation stops modal from closing');
 tag.value='valid-tag';emit(form,'submit');
 const values=await pending;
 assert.equal(values.tag,'valid-tag');assert.equal(values.port,'443');
 assert.ok(modal.removed,'modal cleaned after submission');
 assert.equal(document.activeElement,before,'previous focus restored');

 const cancel=window.XMeshStudioDialogs.request({title:'Отмена',fields:[]});await tick();
 modal=top();emit(modal,'cancel');assert.equal(await cancel,null,'Escape cancels without writing');

 const no=window.XMeshStudioDialogs.confirm({title:'Удаление?',danger:true});await tick();
 modal=top();const cancelBtn=find(modal,n=>n.className==='xm-studio-modal-cancel');
 emit(cancelBtn,'click');assert.equal(await no,false,'cancel is never interpreted as confirmation');

 const yes=window.XMeshStudioDialogs.confirm({title:'Удаление?',danger:true});await tick();
 modal=top();emit(find(modal,n=>n.tagName==='form'),'submit');
 assert.equal(await yes,true,'explicit submit approves');

 assert.equal(body.children.length,0,'all dialogs removed from document');
 console.log('XRAY STUDIO dialogs: validation, cancel, submit, focus restoration and confirmation passed.');
}
main().catch(e=>{console.error(e);process.exitCode=1});
