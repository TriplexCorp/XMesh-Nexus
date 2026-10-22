'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const source=fs.readFileSync('xray-studio-v4.js','utf8');

const start=source.indexOf('function describeProfile(p){');
const end=source.indexOf("get('profilesSearch').addEventListener('input',renderProfiles);",start);
assert.ok(start>0&&end>start,'Profile view logic exists');
const body=source.slice(start,end);

class Element{
 constructor(tag){this.tagName=tag;this.children=[];this.className='';this.textContent='';this.value='';this.attrs={};this.hidden=false;this.disabled=false;}
 append(...elements){this.children.push(...elements);}
 replaceChildren(...elements){this.children=elements;}
 setAttribute(key,value){this.attrs[key]=value;}
 focus(){}
 set innerHTML(value){this._innerHTML=value;}
 get innerHTML(){return this._innerHTML||'';}
}
const elements=Object.fromEntries(['profilesSearch','profilesList','profilesCount','profilesTotal','profilesActive','profilesFound'].map(k=>[k,new Element('div')]));
const get=k=>elements[k];
const document={createElement:tag=>new Element(tag)};
const profiles=[
 {id:4,name:'Germany VLESS',config:JSON.stringify({
   inbounds:[{protocol:'vless',tag:'DE_MAIN',streamSettings:{security:'reality',network:'xhttp'}}],
   outbounds:[{protocol:'freedom',tag:'direct'}]
 })},
 {id:5,name:'Poland Trojan',config:JSON.stringify({
   inbounds:[{protocol:'trojan',tag:'PL_MAIN',streamSettings:{security:'tls',network:'grpc'}},{protocol:'trojan',tag:'PL_BACKUP'}],
   outbounds:[{protocol:'freedom'},{protocol:'blackhole'}]
 })},
 {id:6,name:'Invalid profile',config:'{broken'},
];
const ctx={DB:{profiles},api:{async remove(collection,id){
 assert.equal(collection,'profiles');
 const idx=profiles.findIndex(p=>p.id===id);
 if(idx>=0)profiles.splice(idx,1);
}}};
const notified=[],opened=[];
let createCount=0,approved=true,paintCalls=0;
const construct=new Function('ctx','get','document','openProfile','newProfile','approve','input','paint','notify','id','name','saved',
 body+'\nreturn {renderProfiles,describeProfile};');
const api=construct(ctx,get,document,p=>opened.push(p.id),()=>{createCount++},async()=>approved,
 {value:'{}'},()=>{paintCalls++},x=>notified.push(x),4,'Germany VLESS','{}');
const list=()=>elements.profilesList.children;
const getChildren=(el,klass)=>el.children.filter(x=>x.className?.split(' ').includes(klass));
async function main(){
 api.renderProfiles();
 assert.equal(elements.profilesCount.textContent,'3');
 assert.equal(elements.profilesTotal.textContent,'3');
 assert.equal(list().length,3);
 assert.equal(getChildren(list()[0],'sv-profile-top').length,1);
 assert.ok(list()[0].className.includes('is-current'),'current card highlighted');
 assert.equal(api.describeProfile(profiles[1]).inbound,2);
 assert.equal(api.describeProfile(profiles[1]).outbound,2);
 assert.ok(api.describeProfile(profiles[2]).valid===false,'malformed JSON does not crash view');
 assert.ok(list()[2].children.some(x=>x.className==='sv-profile-chips'),'invalid config still creates card');

 elements.profilesSearch.value='PL_MAIN';
 api.renderProfiles();
 assert.equal(list().length,1,'search by inbound tag');
 assert.equal(elements.profilesFound.textContent,'Найдено: 1 из 3');
 elements.profilesSearch.value='vmess';
 api.renderProfiles();
 assert.equal(list().length,1,'search empty placeholder');
 assert.equal(list()[0].className,'sv-library-empty');
 getChildren(list()[0],'sv-library-empty-action')[0].onclick();
 assert.equal(elements.profilesSearch.value,'','reset search works');
 elements.profilesSearch.value='';
 api.renderProfiles();

 const card=list()[0];
 const footer=getChildren(card,'sv-profile-footer')[0];
 const open=getChildren(footer,'sv-profile-open')[0];
 const deleteButton=getChildren(footer,'sv-profile-delete')[0];
 open.onclick();assert.deepEqual(opened,[4],'open button dispatches');
 approved=false;
 await deleteButton.onclick();assert.equal(profiles.length,3,'cancel delete preserves library');
 approved=true;
 await deleteButton.onclick();
 assert.equal(profiles.length,2,'successful delete updates data');
 assert.equal(elements.profilesCount.textContent,'2','counter updates without app remount');
 assert.equal(list().length,2,'card removed immediately');

 elements.profilesSearch.value='';
 ctx.DB.profiles.length=0;
 api.renderProfiles();
 assert.equal(list().length,1);
 const emptyButton=getChildren(list()[0],'sv-library-empty-action')[0];
 emptyButton.onclick();assert.equal(createCount,1,'empty library offers new profile');
 assert.ok(source.includes('id=created.id'),'saving a newly-created profile retains its ID');
 assert.ok(source.includes('saved=input.value;paint();renderProfiles();'),'save refreshes library without destroying editor state');
 console.log('XRAY STUDIO profiles: search, empty state, counters, invalid JSON, open/delete and selection tests passed.');
}
main().catch(err=>{console.error(err);process.exitCode=1});
