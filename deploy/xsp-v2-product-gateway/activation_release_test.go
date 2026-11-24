package main

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestActivationRequiresExactReleaseEnrolledForNode(t *testing.T) {
	enrolled := releaseIdentity{
		Version: "control-v6.0.27", SourceRevision: strings.Repeat("1", 40),
		ArtifactSHA256: strings.Repeat("2", 64),
	}
	makeRequest := func(nodeID int, revision string, claimed releaseIdentity, fallback bool) parsedEnvelope {
		payload, err := json.Marshal(map[string]any{
			"schema": "xmesh-v6-strict-pq-activation-request-1", "nodeId": nodeID,
			"releaseIdentity": claimed, "automaticClassicalFallback": fallback,
		})
		if err != nil {
			t.Fatal(err)
		}
		return parsedEnvelope{Env: envelope{NodeID: 7, Revision: revision}, Payload: payload}
	}
	original := makeRequest(7, enrolled.SourceRevision, enrolled, false)
	if err := verifyActivationRelease(original, enrolled); err != nil {
		t.Fatal(err)
	}
	anotherBuild := enrolled
	anotherBuild.ArtifactSHA256 = strings.Repeat("3", 64)
	downgrade := enrolled
	downgrade.Version = "control-v6.0.24"
	cases := map[string]parsedEnvelope{
		"foreign node":              makeRequest(8, enrolled.SourceRevision, enrolled, false),
		"changed envelope revision": makeRequest(7, strings.Repeat("3", 40), enrolled, false),
		"changed binary":            makeRequest(7, enrolled.SourceRevision, anotherBuild, false),
		"downgrade":                 makeRequest(7, enrolled.SourceRevision, downgrade, false),
		"classical fallback":        makeRequest(7, enrolled.SourceRevision, enrolled, true),
	}
	for name, request := range cases {
		t.Run(name, func(t *testing.T) {
			if err := verifyActivationRelease(request, enrolled); err == nil {
				t.Fatal("activation passed outside enrolled release")
			}
		})
	}
}
