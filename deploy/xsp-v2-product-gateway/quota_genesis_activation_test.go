package main

import "testing"

// The private forwarder must not synthesize a trusted activation SHA on an
// unregistered or unrelated Node path. The digest comes ONLY from the
// gateway's authenticated, signed, durable product-activation receipt.
func TestFirstGenesisActivationHeaderRestrictedToExactTunnelPaths(t *testing.T) {
	valid := []string{
		"/api/v1/node/quota-v2/wal",
		"/api/v1/node/desired-config",
		"/api/v1/node/quota-v2/policy-pin",
		"/api/v1/node/quota-v2/genesis-reservation",
		"/api/v1/node/quota-v2/genesis-cap-delivery",
		"/api/v1/node/quota-v2/public-tls-preflight",
	}
	for _, path := range valid {
		if !allowedTunnelPaths[path] {
			t.Errorf("enrolled strict-PQ path is not registered: %s", path)
		}
		if !needsGenesisActivationBinding(path) {
			t.Errorf("original signed activation must bind: %s", path)
		}
	}
	bad := []string{
		"/api/v1/node/quota-v2/policy-pin/",
		"/api/v1/node/quota-v2/policy-pin?nodeId=1",
		"/api/v1/node/quota-v2/policy-pin/../wal",
		"/api/v1/node/quota-v2/genesis-reservation/",
		"/api/v1/node/quota-v2/genesis-reservation?nodeId=1",
		"/api/v1/node/quota-v2/genesis-reservation/../grant",
		"/api/v1/node/quota-v2/grant",
		"/api/v1/node/quota-v2/public-tls-preflight/",
		"/api/v1/node/quota-v2/public-tls-preflight?nodeId=1",
		"/api/v1/node/quota-v2/public-tls-preflight/../grant",
		"/api/v1/node/desired-config/extra",
		"/api/v1/metrics/ingest",
		"/api/v1/node/heartbeat",
		"http://attacker.invalid/api/v1/node/desired-config",
	}
	for _, path := range bad {
		if needsGenesisActivationBinding(path) {
			t.Errorf("non-genesis path could acquire original product receipt: %s", path)
		}
	}
	for _, path := range bad[:5] {
		if allowedTunnelPaths[path] {
			t.Errorf("unregistered alternate tunnel path accepted: %s", path)
		}
	}
}
