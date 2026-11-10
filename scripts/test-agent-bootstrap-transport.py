#!/usr/bin/env python3
"""Exercise the real bootstrap function with the installed strict-PQ PATH.

Only filesystem locations, systemd and the public HTTP boundary are fixtures.
The production adapter and signed_post implementation execute unchanged logic.
No host services, enrolled keys or external network are used.
"""
import argparse
import json
import os
from pathlib import Path
import shlex
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--node-root', type=Path, required=True)
args, remaining = parser.parse_known_args()
CONTROL = (ROOT / 'deploy/node-control-agent.sh').read_text()
NODE = args.node_root.resolve()


def between(source, start, end):
    return source[source.index(start):source.index(end, source.index(start))]


class TransportTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='xmesh-bootstrap-')
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.bin = self.base / 'strict-pq-bin'
        self.bin.mkdir()
        self.calls = self.base / 'calls'
        self.calls.touch()
        product = self.base / 'product'
        product.write_text('''#!/usr/bin/env python3
import json,os,sys
from pathlib import Path
v=dict(zip(sys.argv[2::2],sys.argv[3::2]))
with open(os.environ['CALLS'],'a') as f:f.write('pq '+v['--path']+'\\n')
Path(v['--output-file']).write_text('{"ok":true}')
Path(v['--status-file']).write_text('200\\n')
''')
        product.chmod(0o700)
        adapter = (NODE / 'deploy/xmesh-strict-pq-curl.sh').read_text()
        adapter = adapter.replace('PRODUCT=/usr/local/bin/xmesh-agent-xspv2-product',
                                  'PRODUCT=' + shlex.quote(str(product)))
        adapter = adapter.replace('/run/xmesh-pq-', str(self.base / 'xmesh-pq-'))
        (self.bin / 'curl').write_text(adapter)
        (self.bin / 'curl').chmod(0o700)
        self.env = dict(os.environ, PATH=str(self.bin) + ':' + os.environ['PATH'],
                        XMESH_API_URL='https://panel.example', XMESH_NODE_ID='41',
                        XMESH_STRICT_PQ_REQUIRED='1', CALLS=str(self.calls))
        self.bootstrap = self.base / 'updater-fixture'
        self.bootstrap.write_text('''#!/bin/bash
# XMESH_TARGET_AWARE_UPDATER=1
# AGENT_VERSION="control-v6.0.11"
# xmesh-node-agent-upgrade.service
printf 'executed\\n' >> "$CALLS"
''')
        self.env['BOOTSTRAP_FIXTURE'] = str(self.bootstrap)
        self.env['FETCH_RC'] = '0'

    def shell(self, script):
        return subprocess.run(['bash', '-Eeuo', 'pipefail', '-c', script],
                              env=self.env, text=True, capture_output=True, timeout=20)

    def bootstrap_call(self):
        worker = between(CONTROL, 'run_agent_updater(){', '\nstop_xray(){')
        worker = worker.replace('/run/xmesh-node-control', str(self.base / 'run'))
        # A function at this exact name intercepts only the public HTTP boundary.
        # The unqualified curl must still execute the actual adapter from PATH.
        return self.shell('''
/usr/bin/curl(){
 printf 'public\\n' >> "$CALLS"
 local output=''
 while (($#));do
  if [[ "$1" == -o ]];then output="$2";shift 2;else shift;fi
 done
 cp "$BOOTSTRAP_FIXTURE" "$output"
 return "$FETCH_RC"
}
sleep(){ :; }
systemctl(){ :; }
systemd-run(){
 printf 'systemd\\n' >> "$CALLS"
 while [[ "$1" != /bin/bash ]];do shift;done
 "$@"
}
timeout(){ shift; "$@"; }
sanitize_updater_error(){ :; }
''' + worker + '''
if run_agent_updater control-v6.0.11;then
 printf 'success\\n'
else
 printf '%s\\n' "$UPDATER_ERROR"
 exit 1
fi
''')

    def test_reproduces_old_curl_exit_2(self):
        result = self.shell("curl -4 --proto '=https' --tlsv1.2 -fsSL "
                            "--connect-timeout 8 --max-time 30 "
                            "https://raw.githubusercontent.com/TriplexCorp/XMesh-Nexus/main/deploy/update-node-control-agent.sh")
        self.assertEqual(result.returncode, 2)
        self.assertIn('unsupported option in strict-PQ transport adapter: -4', result.stderr)
        self.assertEqual(self.calls.read_text(), '')

    def test_bootstrap_uses_system_client_with_strict_path(self):
        result = self.bootstrap_call()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(self.calls.read_text().splitlines(), ['public', 'systemd', 'executed'])

    def test_partial_download_is_never_executed(self):
        self.env['FETCH_RC'] = '28'
        result = self.bootstrap_call()
        self.assertEqual(result.returncode, 1)
        self.assertIn('connection timeout (IPv4, 3 attempts)', result.stdout)
        self.assertEqual(self.calls.read_text().splitlines(), ['public'] * 3)
        self.assertFalse((self.base / 'run/update-node-control-agent.bootstrap').exists())

    def test_wrong_target_is_never_executed(self):
        self.bootstrap.write_text(self.bootstrap.read_text().replace('6.0.11', '6.0.10'))
        result = self.bootstrap_call()
        self.assertEqual(result.returncode, 1)
        self.assertIn('failed target validation', result.stdout)
        self.assertEqual(self.calls.read_text().splitlines(), ['public'])

    def test_signed_requests_still_use_pq_adapter(self):
        key = self.base / 'node.key'
        subprocess.run(['openssl', 'genpkey', '-algorithm', 'Ed25519', '-out', str(key)],
                       check=True, capture_output=True)
        function = between(CONTROL, 'signed_post(){', '\n# Report the actual runtime')
        result = self.shell('KEY=' + shlex.quote(str(key)) + '\n' + function + '''
/usr/bin/curl(){ echo 'unexpected public transport' >&2;return 99; }
signed_post '/api/v1/node/restart/poll' '{"node_id":41}'
''')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout), {'ok': True})
        self.assertEqual(self.calls.read_text().splitlines(), ['pq /api/v1/node/restart/poll'])
        result = self.shell("curl -X POST https://panel.example/api/v1/not-registered --data-binary '{}'")
        self.assertEqual(result.returncode, 2)
        self.assertIn('unregistered strict-PQ operational path', result.stderr)

    def test_all_public_updater_downloads_use_system_client(self):
        for name in ['update-node-control-agent.sh', 'install-node-metrics-agent.sh']:
            script = (ROOT / 'deploy' / name).read_text()
            self.assertNotRegex(script, r'(?m)^curl\s')
            self.assertIn('/usr/bin/curl ', script)
        installer = (NODE / 'deploy/install-v6-strict-operational-agents.sh').read_text()
        self.assertIn('STRICT_PATH=/usr/local/libexec/xmesh-strict-pq-bin:', installer)
        self.assertIn('Environment="PATH=$STRICT_PATH"', installer)


if __name__ == '__main__':
    unittest.main(argv=[__file__] + remaining)
