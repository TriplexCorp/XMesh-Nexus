#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const source=fs.readFileSync('frontend/js/features/hosts/remark-picker.js','utf8');
const sandbox={window:{},Event:class Event { constructor(type,options){this.type=type;this.bubbles=options?.bubbles;} }};
vm.runInNewContext(source,sandbox,{filename:'remark-picker.js'});
const picker=sandbox.window.XMeshRemarkPicker;
assert(picker&&picker.variables.some(([name])=>name==='STATUS_EMOJI'));

function editor(selector,initial,cursor=0){
  const listeners={};let focused=false,dispatched=0;
  const preview={textContent:''};
  const field={
    value:initial,selectionStart:cursor,selectionEnd:cursor,
    setSelectionRange(start,end){this.selectionStart=start;this.selectionEnd=end;},
    focus(){focused=true;},
    dispatchEvent(event){
      assert.equal(event.type,'input');
      dispatched++;
      listeners.input?.({target:field});
    }
  };
  const root={
    dataset:{},querySelector(s){return s===selector?field:s==='[data-remark-preview]'?preview:null;},
    addEventListener(type,fn){listeners[type]=fn;},
    contains(button){return button?.dataset?.remarkInsert!==undefined;}
  };
  picker.bind(root,selector);
  function insert(key){
    const button={dataset:{remarkInsert:key}};
    let prevented=false;
    listeners.click({
      target:{closest(sel){return sel==='[data-remark-insert]'?button:null;}},
      preventDefault(){prevented=true;}
    });
    assert(prevented,'click should not submit the surrounding form');
  }
  return {field,preview,insert,get focused(){return focused;},get dispatched(){return dispatched;}};
}

for(const selector of ['[name="remark"]','[data-endpoint="remark"]']){
  const regular=editor(selector,'🇵🇱 Польша',0);
  regular.insert('STATUS_EMOJI');
  assert.equal(regular.field.value,'🇵🇱 Польша {STATUS_EMOJI}','variable should follow title even when caret starts at zero');
  assert.equal(regular.field.selectionStart,regular.field.value.length,'caret should finish at the end');
  assert.equal(regular.field.selectionEnd,regular.field.value.length);
  assert.equal(regular.preview.textContent,'🇵🇱 Польша ✅');
  regular.insert('DATA_LEFT');
  assert.equal(regular.field.value,'🇵🇱 Польша {STATUS_EMOJI} {DATA_LEFT}');
  assert(regular.focused&&regular.dispatched===2,'input and focus are required for live form updates');

  const selected=editor(selector,'Premium Server',3);
  selected.insert('DAYS_LEFT');
  assert.equal(selected.field.value,'Premium Server {DAYS_LEFT}','inserting must never replace the name or its selection');

  const trailing=editor(selector,'🇩🇪 Германия   ',0);
  trailing.insert('USERNAME');
  assert.equal(trailing.field.value,'🇩🇪 Германия {USERNAME}','trailing whitespace should be normalized');

  const empty=editor(selector,'',0);
  empty.insert('PROTOCOL');
  assert.equal(empty.field.value,'{PROTOCOL}','empty remarks must not gain a leading space');
}
console.log('Remark picker: append tokens after name in both Host and XRAY STUDIO editors: PASS');
