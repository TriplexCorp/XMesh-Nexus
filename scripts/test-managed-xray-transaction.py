#!/usr/bin/env python3
"""Real official images, TLS traffic, exact rollback and fault injection at Docker boundary."""
import contextlib
import http.server
import importlib.util
import json
import os
from pathlib import Path
import socket
import ssl
import subprocess
import tempfile
import threading
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('updater',ROOT/'deploy/xmesh-xray-update.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
DOCKER=['docker','--host=unix:///var/run/docker.sock']
for key in ('DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH'):os.environ.pop(key,None)
OLD='ghcr.io/xtls/xray-core:26.10.21';NEW=os.environ.get('XMESH_TEST_NEW_IMAGE','ghcr.io/xtls/xray-core:26.10.31')
REPRO_ONLY=os.environ.get('XMESH_TEST_REPRO_ONLY')=='1'


def docker(*args,check=True):
    return subprocess.run(DOCKER+list(args),capture_output=True,check=check)


def port():
    with socket.socket() as s:s.bind(('127.0.0.1',0));return s.getsockname()[1]


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200);self.end_headers();self.wfile.write(b'xmesh-update-real-tls-traffic')
    def log_message(self,*args):pass


class Injected(m.Updater):
    """The images/runtime are real; inject only a specific Docker/health failure."""
    fault=None
    def run(self,args,**kwargs):
        if self.fault=='registry' and args[0]=='pull':return 1,b'',b'registry connection refused'
        if self.fault=='start' and args[:2]==['start',self.name]:
            self.fault=None;raise m.Failure('start_failed',125)
        if self.fault=='config' and 'run'==args[0] and '-test' in args:
            return 23,b'config stdout',b'Failed to build config: privateKey=DO-NOT-UPLOAD'
        if self.fault=='geo' and args[0]=='run' and '-test' in args:
            return 23,b'',b'failed to load geosite: no such file'
        return super().run(args,**kwargs)


def main():
    for image in ((NEW,) if REPRO_ONLY else (OLD,NEW)):docker('image','inspect',image)
    target_server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler)
    threading.Thread(target=target_server.serve_forever,daemon=True).start()
    with tempfile.TemporaryDirectory(prefix='xmesh-real-update-',dir='/workspace/scratch' if Path('/workspace/scratch').exists() else None) as tmp:
        state=Path(tmp);tls=state/'certificates';live=tls/'live/update.test';archive=tls/'archive/update.test';live.mkdir(parents=True);archive.mkdir(parents=True)
        subprocess.run(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-keyout',str(archive/'privkey1.pem'),'-out',str(archive/'fullchain1.pem'),'-days','1','-subj','/CN=update.test','-addext','subjectAltName=DNS:update.test'],check=True,capture_output=True)
        for name in ('privkey','fullchain'):(live/(name+'.pem')).symlink_to('../../archive/update.test/'+name+'1.pem')
        client_id=str(uuid.uuid4());listen=port();config={'log':{'loglevel':'warning'},'inbounds':[{'listen':'127.0.0.1','port':listen,'protocol':'vless','settings':{'decryption':'none','clients':[{'id':client_id}]},'streamSettings':{'network':'raw','security':'tls','tlsSettings':{'certificates':[{'certificateFile':'/etc/letsencrypt/live/update.test/fullchain.pem','keyFile':'/etc/letsencrypt/live/update.test/privkey.pem'}]}}}],'outbounds':[{'protocol':'freedom','settings':{'finalRules':[{'action':'allow','ip':['127.0.0.1'],'port':str(target_server.server_port)}]}}]}
        (state/'config.json').write_text(json.dumps(config));os.chmod(state/'config.json',0o600)
        mounts=['-v',str(state/'config.json')+':/etc/xray/config.json:ro']
        sandbox=['--user',(str(os.getuid())+':'+str(os.getgid()) if REPRO_ONLY else '0:0'),'--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--entrypoint','xray']
        # Exact old updater environment, then identical image/config with the runtime TLS mount.
        missing=docker('run','--rm','--network','none',*sandbox,*mounts,NEW,'run','-test','-config','/etc/xray/config.json',check=False)
        assert missing.returncode!=0 and b'/etc/letsencrypt/' in missing.stderr+missing.stdout,(missing.returncode,missing.stderr[:1500],missing.stdout[:1500])
        mounts+=['-v',str(tls)+':/etc/letsencrypt:ro']
        good=docker('run','--rm','--network','none',*sandbox,*mounts,NEW,'run','-test','-config','/etc/xray/config.json')
        print('PASS reproduced: same official image/config fails without runtime TLS mount and passes with it; exit',missing.returncode,flush=True)
        if REPRO_ONLY:
            target_server.shutdown();target_server.server_close();return
        name='xmesh-update-test-'+uuid.uuid4().hex[:10];events=[]
        def transfer():
            ctx=ssl.create_default_context(cafile=str(archive/'fullchain1.pem'))
            with socket.create_connection(('127.0.0.1',listen),timeout=3) as raw:
                with ctx.wrap_socket(raw,server_hostname='update.test') as s:
                    header=b'\x00'+uuid.UUID(client_id).bytes+b'\x00\x01'+target_server.server_port.to_bytes(2,'big')+b'\x01\x7f\x00\x00\x01'
                    s.sendall(header+b'GET / HTTP/1.0\r\nHost: update.test\r\n\r\n');data=b''
                    response=b''
                    while len(response)<2:
                        part=s.recv(2-len(response));assert part,'VLESS stream closed before response';response+=part
                    assert response==b'\x00\x00','VLESS response header must be accepted'
                    while True:
                        part=s.recv(4096)
                        if not part:break
                        data+=part
                    assert b'xmesh-update-real-tls-traffic' in data
        try:
            docker('run','-d','--name',name,'--restart','unless-stopped','--network','host',*sandbox,*mounts,OLD,'run','-config','/etc/xray/config.json')
            time.sleep(2);transfer();old=json.loads(docker('inspect',name).stdout)[0];old_id=old['Id']
            def worker(fault=None):
                w=Injected(state,name,DOCKER,events.append,health_seconds=2);w.fault=fault;return w
            original=(state/'config.json').read_bytes()
            def preflight(command,change,code):
                change()
                result=worker().perform('v26.10.31',command)
                (state/'config.json').write_bytes(original)
                assert not result['success'] and result['code']==code and result['rollback']=='unchanged',result
                observed=json.loads(docker('inspect',name).stdout)[0];assert observed['Id']==old_id and observed['State']['StartedAt']==old['State']['StartedAt'];transfer()
                print('PASS real preflight preserves TLS traffic:',code,flush=True)
            def invalid_config():
                bad=json.loads(original);bad['inbounds'][0]['streamSettings']['network']='invalid-DO-NOT-UPLOAD';(state/'config.json').write_text(json.dumps(bad))
            preflight(1,invalid_config,'config_invalid')
            def missing_geo():
                bad=json.loads(original);bad['routing']={'rules':[{'type':'field','domain':['ext:/nonexistent-xmesh-geosite.dat:cn'],'outboundTag':'direct'}]};bad['outbounds'][0]['tag']='direct';(state/'config.json').write_text(json.dumps(bad))
            preflight(2,missing_geo,'geodata_missing')
            result=worker('registry').perform('v26.10.31',3);assert result['code']=='registry_unavailable' and result['rollback']=='unchanged';transfer()
            cert=(archive/'fullchain1.pem').read_bytes();(archive/'fullchain1.pem').unlink()
            result=worker().perform('v26.10.31',6);(archive/'fullchain1.pem').write_bytes(cert)
            assert result['code']=='tls_resource_missing' and result['rollback']=='unchanged',result;transfer()
            assert 'DO-NOT-UPLOAD' not in json.dumps(events)
            result=worker('start').perform('v26.10.31',4)
            assert not result['success'] and result['rollback']=='rolled_back',result
            assert json.loads(docker('inspect',name).stdout)[0]['Id']==old_id;transfer()
            print('PASS startup failure restores exact previous container and real traffic',flush=True)
            result=worker().perform('v26.10.31',5);assert result['success'],result;transfer()
            new=json.loads(docker('inspect',name).stdout)[0];assert new['Image']!=old['Image']
            assert json.loads((state/'pinned-release.json').read_text())['imageId']==new['Image']
            repeat=worker().perform('v26.10.31',5);assert repeat==result
            assert json.loads(docker('inspect',name).stdout)[0]['Id']==new['Id'];transfer()
            print('PASS official 26.10.21 → 26.10.31, exact image, real TLS HTTP, persisted pin and duplicate delivery',flush=True)
        finally:
            for suffix in ('','.next-4','.rollback-4','.next-5','.rollback-5'):
                docker('rm','-f',name+suffix,check=False)
            target_server.shutdown();target_server.server_close()


if __name__=='__main__':main()
