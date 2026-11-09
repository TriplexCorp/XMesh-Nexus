#!/usr/bin/env python3
import copy
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest

spec=importlib.util.spec_from_file_location('update',Path(__file__).resolve().parents[1]/'deploy/xmesh-xray-update.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
OLD='sha256:'+'a'*64;NEW='sha256:'+'b'*64

class Fake(m.Updater):
    def __init__(self,state,fault=None):
        super().__init__(state,emit=lambda e:self.events.append(e),health_seconds=0)
        self.events=[];self.calls=[];self.fault=fault
        self.containers={self.name:{'Id':'old-container','Image':OLD,'State':{'Running':True,'Pid':10},'RestartCount':3,'Config':{'Env':[],'Labels':{}},'HostConfig':{'NetworkMode':'host','RestartPolicy':{'Name':'unless-stopped'}},'Mounts':[{'Type':'bind','Source':str(state/'config.json'),'Destination':'/etc/xray/config.json','RW':False}]}}
    def run(self,args,**kw):
        self.calls.append(args)
        rc,out,err=0,b'',b''
        if args[0]=='inspect':
            x=self.containers.get(args[1])
            if args[1].startswith(m.OFFICIAL):x={'Id':NEW}
            if x:out=json.dumps([x]).encode()
            else:rc=1
        elif args[0]=='cp':Path(args[2]).write_bytes((self.state/'config.json').read_bytes())
        elif args[0]=='pull' and self.fault=='registry':rc,err=1,b'connection refused'
        elif args[0]=='run':
            if 'version' in args:out=b'Xray 26.10.31\n'
            elif self.fault=='config':rc,err=23,b'Failed config: privateKey=SECRET'
        elif args[0]=='create':
            self.containers[self.next]={'Id':'new-container','Image':NEW,'State':{'Running':False,'Pid':20},'RestartCount':0,'Config':{'Labels':{'io.xmesh.update-command':str(self.command)}}}
            if self.fault=='prepare':raise m.Failure('prepare_failed',125)
        elif args[0]=='stop':self.containers[args[-1]]['State']['Running']=False
        elif args[0]=='rename':self.containers[args[2]]=self.containers.pop(args[1])
        elif args[0]=='start':
            if self.fault=='start' and self.containers[args[1]]['Image']==NEW:raise m.Failure('start_failed',125)
            self.containers[args[1]]['State']['Running']=True
        elif args[0]=='rm':self.containers.pop(args[-1],None)
        if rc and kw.get('check',True):raise m.Failure(kw.get('code','prepare_failed'),rc)
        return rc,out,err
    def health(self,name,identity):
        if self.fault=='health' and identity==NEW:raise m.Failure('health_failed')
        return super().health(name,identity)

class TransactionTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.state=Path(self.tmp.name)
        (self.state/'config.json').write_text('{"inbounds":[]}')
    def tearDown(self):self.tmp.cleanup()
    def test_success_and_exact_duplicate(self):
        w=Fake(self.state);result=w.perform('v26.10.31',1);self.assertTrue(result['success'])
        count=len(w.calls);self.assertEqual(w.perform('v26.10.31',1),result);self.assertEqual(len(w.calls),count)
        self.assertEqual(json.loads((self.state/'pinned-release.json').read_text())['imageId'],NEW)
        self.assertIn(w.backup,w.containers)
    def test_preflight_failures_never_stop_old_runtime(self):
        for i,fault in enumerate(['registry','config','prepare'],1):
            w=Fake(self.state,fault);r=w.perform('26.10.31',i)
            self.assertFalse(r['success']);self.assertEqual(r['rollback'],'unchanged')
            self.assertTrue(w.containers[w.name]['State']['Running'])
            self.assertFalse(any(c[0] in ('stop','rename') for c in w.calls))
            self.assertNotIn('SECRET',json.dumps(w.events))
    def test_start_and_health_failures_restore_exact_old_container(self):
        for i,fault in enumerate(['start','health'],1):
            w=Fake(self.state,fault);r=w.perform('26.10.31',i)
            self.assertEqual(r['rollback'],'rolled_back');self.assertEqual(w.containers[w.name]['Id'],'old-container')
            self.assertTrue(w.containers[w.name]['State']['Running'])
    def test_interrupted_switch_is_recovered_once(self):
        w=Fake(self.state)
        def crash(e):
            if e['stage']=='health_check':raise SystemExit(99)
        w.emit=crash
        with self.assertRaises(SystemExit):w.perform('26.10.31',1)
        w.emit=lambda e:None
        r=w.perform('26.10.31',1);self.assertEqual(r['rollback'],'rolled_back');self.assertEqual(w.containers[w.name]['Id'],'old-container')
        self.assertEqual(w.perform('26.10.31',1),r)
    def test_expired_lease_is_recovered_before_next_command(self):
        w=Fake(self.state)
        def crash(e):
            if e['stage']=='health_check':raise SystemExit(99)
        w.emit=crash
        with self.assertRaises(SystemExit):w.perform('26.10.31',1)
        w.emit=lambda e:None;w.fault='config'
        result=w.perform('26.10.31',2)
        self.assertFalse(result['success']);self.assertEqual(w.containers[w.name]['Id'],'old-container')
        prior=json.loads((self.state/'updates/1/transaction.json').read_text())
        self.assertEqual(prior['result']['rollback'],'rolled_back')

    def test_target_cannot_change_on_redelivery(self):
        w=Fake(self.state);w.perform('26.10.31',1)
        with self.assertRaises(ValueError):w.perform('26.11.9',1)
    def test_preserves_official_anonymous_volumes_and_working_directory(self):
        w=Fake(self.state);w.logs=self.state
        old=w.containers[w.name];old['Config']['WorkingDir']='/home/nonroot'
        old['Mounts'].append({'Type':'volume','Name':'existing-log-volume','Source':'/private/docker/volume','Destination':'/var/log/xray','RW':True})
        args=w.resources(old)
        self.assertIn('type=volume,src=existing-log-volume,dst=/var/log/xray',args)
        self.assertIn('/home/nonroot',args)
    def test_exact_binary_version_is_required(self):
        class Wrong(Fake):
            def run(self,args,**kw):
                rc,out,err=super().run(args,**kw)
                return (rc,b'Xray 26.10.31-wrong\n',err) if args[0]=='run' and 'version' in args else (rc,out,err)
        w=Wrong(self.state);result=w.perform('26.10.31',1)
        self.assertEqual(result['code'],'image_identity');self.assertFalse(any(c[0]=='stop' for c in w.calls))

    def test_validation_reasons_are_closed_and_nonsecret(self):
        self.assertEqual(m.Updater.validation_code(b'open /etc/letsencrypt/fullchain.pem: no such file',23),'tls_resource_missing')
        self.assertEqual(m.Updater.validation_code(b'failed loading geosite.dat',23),'geodata_missing')
        self.assertEqual(m.Updater.validation_code(b'permission denied',23),'resource_permission')
        self.assertEqual(m.Updater.validation_code(b'runc create failed',125),'docker_validation')
    def test_stdout_stderr_are_drained_but_retention_is_bounded(self):
        w=m.Updater(self.state,docker=(sys.executable,'-c','import os;os.write(1,b"x"*200000);os.write(2,b"y"*200000)'))
        w.logs=self.state
        rc,out,err=w.run([]);self.assertEqual(rc,0);self.assertEqual(len(out),65536);self.assertEqual(len(err),65536)
        for path in self.state.glob('*.std*'):
            self.assertLessEqual(path.stat().st_size,65536);self.assertEqual(path.stat().st_mode&0o777,0o600)

if __name__=='__main__':unittest.main()
