#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const assert=require('node:assert/strict');
const resolver=path.resolve('scripts/resolve-panel-display-version.sh');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'xmesh-release-version-'));
const archive=fs.mkdtempSync(path.join(os.tmpdir(),'xmesh-release-archive-'));
const run=(rev,dir,anchor)=>execFileSync('sh',[resolver,rev,dir,...(anchor?[anchor]:[])],{encoding:'utf8'}).trim();
const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
try{
 fs.writeFileSync(path.join(root,'VERSION'),'6.0.0\n');
 fs.writeFileSync(path.join(archive,'VERSION'),'6.0.0\n');
 assert.equal(run('unknown',archive),'6.0.0');
 git('init','-q');
 git('config','user.name','XMesh CI');
 git('config','user.email','xmesh-ci@example.invalid');
 git('add','VERSION');
 git('commit','-qm','base');
 const base=git('rev-parse','HEAD');
 assert.equal(run(base,root,base),'6.0.0');
 fs.writeFileSync(path.join(root,'one'),'one\n');
 git('add','one');git('commit','-qm','first rollout');
 const first=git('rev-parse','HEAD');
 assert.equal(run(first,root,base),'6.0.1','First commit after anchor advances patch');
 fs.writeFileSync(path.join(root,'two'),'two\n');
 git('add','two');git('commit','-qm','second rollout');
 const second=git('rev-parse','HEAD');
 assert.equal(run(second,root,base),'6.0.2','Repeated updates advance patch');
 assert.equal(run(base,root,base),'6.0.0','Old revision must not impersonate HEAD');
 assert.equal(run(second,root,'a'.repeat(40)),'6.0.0','Unknown anchor is safe');
 assert.equal(run('main',root,base),'6.0.0','Invalid source revision is safe');
 assert.equal(run(second,archive,base),'6.0.0','No Git metadata does not invent release');
 console.log('Panel build version: 6.0.0 → 6.0.1 → 6.0.2; fail-closed provenance passed');
}finally{
 fs.rmSync(root,{recursive:true,force:true});
 fs.rmSync(archive,{recursive:true,force:true});
}
